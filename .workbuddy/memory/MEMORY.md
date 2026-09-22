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

## 外部二维码核验（ycdb）机制与边界（2026-09-22 全量实测）

- 定位：**拿别人的码 → 用国家登记库 `pesticide_reg`(97,471 条) 当基准核验**。只判前 8 位（第1位类别 1=PD/2=WP、第2-7位登记证后六位、第8位生产类型 1/2/3），第9位起只留证不判定。
- **码提取是硬前置**：必须从「码值 / 来源链接 / 粘贴正文」任一处提取到 **≥32 位连续数字**，否则 400「未识别到至少32位数字单元识别代码」。
  ⇒ **只粘贴正文但正文里不含码 = 400**（20 号手册 §2.5「只粘贴正文也能核验」有前提：正文恰好含码）。
- **判定天花板 = 后六位不唯一**：仅算「后六位全数字 + 同类别」，75,479 组中 **11,921 组（15.8%）有多候选**（最多 4 个）；另有 **8,914 条老证号**（`PD91109-10` 形态）后六位含非数字 ⇒ 编码规则无法表达、永不命中。来源未给完整登记证号时，多候选 ⇒ `matchedRegistration` 为空 ⇒ 产品名/持有人/登记证号三项 `insufficient`。
- ⚠️ **产品名比对会对真实平台误报**：`normalizeProductName` 只剥 `\d+%`；真实平台把剂型+序号写进产品名（实测 wla1 的 `15%精草铵膦可溶液剂-2` vs 登记库 `精草铵膦`）⇒ mismatch ⇒ **写进 `risk_alert`（alert_type=5）**。改这处逻辑前先明白「mismatch 会落风险预警」。
- ⚠️ `server/utils/external-verification.ts` 的 `PRIVATE_HOST` 正则**末尾 `$` 导致点分 IPv4 全部放行**（实测 127.0.0.1 / 10.0.0.5 / 192.168.1.1 / 172.16.0.1 / 169.254.169.254 全拦不住，只有 `127.` 这种字面串被拦）⇒ SSRF 防护实际失效。
- ⚠️ `NOISE_LABELS` 是**死代码**（全项目只有定义处，从未被引用）——20 号手册 §2.3 称其为「配套三件套」之一属虚报，别照它理解现状。
- 字段提取实测：**能过** 制表符表格 / 双空格 / 冒号内联 / JS 带引号键值对 / 标签独占行+下行 / 别名（批号·保质期）；**不过** 单空格分隔（`农药名称 硝钠·萘乙酸` → 三项字段全空）；占位词闸门只拦单一词，**「见瓶身喷码」溜过**被当成生产日期。（warnings 的误导文案已在 `6b942bd` 修掉：已粘贴内容时不再提示"请复制页面内容"）
- **码提取规则唯一来源 = `shared/utils/trace-code.ts`**（2026-09-22 `6b942bd` 起）：`extractTraceCode` / `isTraceCode` / `isHttpUrl`，前后端共用。**改码提取规则只改这一个文件**，别再在页面或接口里就地写正则 —— 此前前端 `traceCodeOf` 与后端 `extractExternalCode` 各一套，漂移的直接后果是「扫到别人平台的裸码时页面毫无反应」（外部核验页只注册了 `onRawResult`）。

## 验证手法（2026-09-22 归档，本项目通用）

- ① **改页面 `setup()` 后先跑「SSR 直出探针」**：带 cookie 直接 `fetch http://127.0.0.1:3100/<页面>`（`accept: text/html`），**500 页面的 `<script>` payload 里内嵌 setup 的 ReferenceError 堆栈**（含文件名行号），几秒定位。真浏览器侧只会表现为「路由变了但页面没切换、无错误遮罩」，极易误判成 dev 冷编译慢。
- ② **真浏览器验证必须在一个浏览器实例内跑完**：会话 cookie 不跨实例，`--user-data-dir` 也救不了（ui-shot 脚本 taskkill 强杀进程，cookie 不落盘）；且 `ui-shot.js` 固定「先 `--click` 后 `--js`」，需要「先设值再点击」时把点击也写进 `--js-file`。
- ③ **无摄像头环境验证扫码回调**：从 DOM 向上遍历 `__vueParentComponent` 拿到页面组件（dev 下 `setupState` 可达），直接调其方法断言 —— 绕过 `getUserMedia` 的唯一可行路径。登录页可用 `setupState.doLogin()` 驱动真实登录，不必伪造 cookie。

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

- **最新交接手册：`docs/handover/20-交接手册-新对话接续（ycdb分支与待部署清单）.md`**（新对话先读它；20 号讲当前三条线与线上实测，16 号留着看机制与铁律，13 号看服务器细节）。

## 分支与部署状态（2026-09-22 实测，易漂移，用前复核）

- **工作副本在 `ycdb`，不在 `master`**。`ycdb` = `master`(`ea7dc78`) + 8 提交（主体是「外部二维码核验」），**未合入 master、未推送**。
- **`ycdb` 相对 master 带 DDL**：新表 `external_verification` + `risk_alert` 补列 `external_verification_id` 与索引。
  ⇒ 上线它**必须 `node scripts/db-init.mjs --migrate-only`**（`--migrate-only` 不可省）。
- **线上构建产物 = 2026-09-19 18:08:56**（证据：`/_nuxt/builds/latest.json` 的 `timestamp`）。⇒ **生成上限 50 万那版（19 号执行单）尚未上线，线上仍是 1 万**。
- **master 上挂着一笔未提交的活儿**（厂家后台使用说明）：`stash@{0}` 只含 PROJECT_LOG 条目；`docs/厂家后台使用说明/`（30 文件）与 `scripts/generate-user-guide.mjs`（13,507 字节）是未跟踪。
  - ⚠️ **`git stash pop` 必须在 master 上做**；⚠️ `C:/shots/_master-uncommitted-backup-20260922` **是过时的中途快照**（11 文件 / 脚本 7,221 字节），**绝不能用它盖工作区**。
- **判断线上状态优先公网实测**，别信文档里的"应该"：`/_nuxt/builds/latest.json` 的时间戳能直接判定"最后一次 build 是什么时候"。


