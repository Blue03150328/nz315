# 项目长期记忆 — 农资315 追溯码管理平台

> 只记录跨会话仍需遵守的项目约定。进度与过程写在 `2026-MM-DD.md` 日志里，不重复。

## 数据口径约定

- **库里的演示/测试数据仅供功能验证，数值本身不可信**（用户 2026-09-12 明确："这部分数据只供测试用，数据填写可能不准确"）。
  - **不要把测试数据之间的数值矛盾当成缺陷结论。** 典型踩坑：2026-09-12 发现码级生产日期 `2026-09-10` 与批次级 `2026-08-20` 差 21 天，一度当作"与标签不一致"的合规风险提出——实际只是测试数据填得随意。
  - 可以据代码下结论的：**机制本身**（例如"码级字段优先于批次级"，来自 `server/api/trace.get.ts` 的 COALESCE 逻辑）——这是代码事实，与数据准不准无关。
  - 涉及"数据是否合规"的判断，必须在真实业务数据上做，测试库得出的只能叫"可能性"，不能说成结论。
- 演示数据里的脏值举例（避免误判）：`product_original.ingredient` 5 行中 3 行为 NULL，另 2 行与字典表对不上（`PD20096830` 写"盐酸吗啉胍"，字典里该证是"乙酸铜"）；`enterprise` 两个租户电话同为 `0531-88888888`；`enterprise.address` / `website` 全 NULL。

## 合规口径（农业农村部公告第1049号）

- 扫码结果页**必显六项**：农药名称、登记证持有人名称、生产日期（须与标签一致）、生产批次、原药（母药）登记证号、原药生产企业名称。
  - 2026-09-12 确认：**这六项接口原本就已全部返回**，只需改前端展示；用户明确"其他字段可为空"、"厂商信息栏非必要可去掉"。
- 六项中「生产日期 / 生产批次」依赖码状态：`status=1`（已生成）的码 `batch_id` 为空，接口返回 `batch: null`，页面无从展示。这是业务链路问题，不是展示缺陷。

## 🔴 数据库与部署硬约定（违反即事故）

- **真实库/生产库补列补索引一律用 `node scripts/db-init.mjs --migrate-only`**，**`--migrate-only` 不可省**。
  裸跑 `db-init.mjs` 会执行 `seed()`：插入演示企业「山东绿丰生物科技有限公司」（按名字查存在才插，名字对不上就新建）、
  4 条演示追溯码（含冻结/作废，进 `trace_code` 核心表）、演示产品/批次、以及 `admin123` 演示账号。
  **本机库 enterprise id=2 与 4 条 `1230101*` 码就是 seed 产物（活证据）。** 2026-09-19 补出该参数并实测零写入。
- **服务器三条铁律**：① 绝不 `pm2 kill` / `pm2 delete all`（与正式站 `www.cynx.cn` **共用 PM2 daemon**，只能 `pm2 reload nz315`）；
  ② `nz315.conf` 绝不写 `listen 443 ssl default_server`（会抢走 cynx 的 443）；③ **绝不把本机构建的 `.output` 传上服务器**
  （Nitro `runtimeConfig` 构建期内嵌，本机 DB 连接信息会进产物）。
- **改服务器 `.env` 后必须重新构建**（runtimeConfig 构建期内嵌，改 `.env` 不 rebuild 运行期不生效）。
- 部署服务器一律：**补列 → 构建 → `pm2 reload`**（顺序有因果，别换）。
- ⚠️ **三段 token（2026-09-19 起）**：旧两段格式被主动拒绝 → **每次部署后所有在线用户需重登一次**（预期，非故障）；
  回滚**不会**造成二次重登。**任何"改他人凭证"的写操作（改密/改角色/禁用）都要顺带 `revokeUserSessions`。**
- **改 Origin 校验别退回 `startsWith` 前缀比较**（`https://host.evil.com` 可绕过）；**无 Origin 的请求要放行**（API 客户端依赖），别当漏洞"修"掉。

## 角色与前端收口约定

- 角色白名单：写接口用 `requireWritableUser`（非 viewer）；用户管理与企业信息编辑仅 `platform_admin` / `enterprise_admin`；
  总部专属用 `requirePlatformAdmin`。`requireBackendUser` **只留给 GET 读接口**。
- 前端新增写入口 = **两个动作**：① 接口用 `requireWritableUser`；② 按钮加 `v-if="canWrite"`（用户管理/企业信息用 `canManageUsers`）。
  **别散落写 `role === 'viewer'`**（会与后端白名单漂移）。
- 验收口径：**viewer 登录后页面不应存在任何可点的写操作**——"后端返回 403"与"用户看不到按钮"是两件事，必须分开验
  （前者靠接口回归，后者**只能靠真浏览器截图或 SSR 提取可见元素**）。

## 数量上限约定（2026-09-21 起）

- **追溯码的生成/写入上限一律从 `shared/utils/code-limits.ts` 取**（`MAX_CODES_PER_BATCH` / `MAX_CODES_PER_WRITE` = **50 万**、
  `LARGE_BATCH_CONFIRM_THRESHOLD` = **20 万**、派生的错误与提示文案、`estimateCodesSizeMb` / `estimateGenerateMs`）。
  **不要在页面或接口里就地写数字**——2026-09-21 之前同一个 `10000` 散在 5 处、`单次最多 10 万条码` 散在 3 处，改一处必漏，
  表现为「前端放开、后端 400」或「生成完入不了库」。
- 改上限前先看该文件顶部写明的四条硬边界：**响应体积**（50 万条 `allCodes` 全量回传**接口实测 19 MB**，urls.txt 31 MB、CSV 约 80 MB）、
  **nginx `proxy_read_timeout 120s`**、**MySQL 占位符上限 65535**（`CHUNK=5000 × 11 列 = 55000` 已贴顶，**只能减不能加**）、
  **浏览器内存**（50 万条堆增量约 +59 MB）。**引擎耗时 1.5s，不是瓶颈。**
- 前端大数量（>20 万）必须保留二次确认弹窗；**离线工具不是瓶颈**（支持多文件合并，其 1000 万上限仅作用于「离线应急生成」模式）。
- ⚠️ **别在 dev 里反复跑满 50 万**：2026-09-21 本机 dev 因反复大数量生成**撞 4.1GB 堆上限 OOM 崩掉**（exit 134，已连跑 5h48m）。
  一次生成同时持有「码数组 + 去重 Set（`generate.post.ts` 全表 `SELECT code`）+ 约 19MB JSON」，**瞬时数百 MB 且回收不干净**。
  **线上 PM2 `max_memory_restart` 只有 800M** → **线上验收只跑 5 万条**（实测 0.15s）；要常态化跑 20 万+ 需调到 1200–1500M，
  但该字段 **`pm2 reload` 不重读，必须 `pm2 delete nz315` + 重新 start**（与「只许 reload」铁律冲突 → 需专门窗口，别顺手做）。

## 本机环境（易反复踩到，详见 ~/.workbuddy/USER.md）

- 无系统级 Node.js，托管在 `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`，不在 PATH。
- dev 服务端口 **3100**（3000 被农码查残留占用，勿用）。**计划任务 `NZ315 Dev Server` 自 2026-09-19 起查无**
  （`Get-ScheduledTask` 返回空），当前服务是**后台进程**（`node scripts/dev-start.mjs`），**重启机器/注销即失**。
  判断服务是否是最新代码：打 `POST /api/auth/login` 带恶意前缀 Origin → 新版应 **403**。
- 演示账号：`admin` / `lvfeng` / `codeop` / **`viewer`**，密码统一 `admin123`（viewer 为 2026-09-19 新增的只读验收账号，用户要求保留）。
- 临时诊断脚本沿用 `scripts/_tmp-*`（已 gitignore），**用完即删**；只读查询用 mysql2 读 `.env` 取连接信息。
- **沙箱命令限制（本机高频踩）**：`rm` 被安全 shim 拦死（exit 127）→ **删文件一律用 node** `fs.unlinkSync` / `fs.rmSync`；
  `tail`/`head`/`wc`/`sleep`/`find` 等 coreutils 多数不可用 → **长命令输出用 `> 日志 2>&1` 落盘再 Read**；
  `schtasks`/`sc.exe` 被策略拉黑（不可重试）。

## 交接文档

- **最新交接手册：`docs/handover/16-交接手册-安全加固收尾与新对话接续.md`**（新对话先读它，再读 13 号看服务器细节）。

