# 项目长期记忆 — 农资315 追溯码管理平台

> **细节一律看交接文档，本文件只留「改错了会出生产事故」的硬约定。**
> 26号=功能漏洞复查(N1–N6 线上已存在) · 25号=新对话接续(先读) · 24号=上线执行单 · 23号=缺陷总账 · 21号=机制/铁律。
> 复测用 skill `nz315-func-regression`，别从零搭。

## 🔴 部署与数据库
- 补列补索引一律 `node scripts/db-init.mjs --migrate-only`，**`--migrate-only` 不可省**（裸跑会 seed 演示企业/4条码/admin123）。三明治留证：`verify-db-migration.mjs dump` → 迁移 → `compare`（判据 `bad=0`）。
- 服务器与 www.cynx.cn **共用 PM2 daemon**：绝不 `pm2 kill`/`delete all`，只能 `pm2 reload nz315`；`nz315.conf` 绝不写 `listen 443 ssl default_server`；绝不把本机 `.output` 传上去；**改 `.env` 必须重新 build**（runtimeConfig 构建期内嵌）；顺序固定 补列→构建→reload；静态资源清单构建期固化（工具包须 build 前放进 `public/tools/`）。
- 三段 token：旧两段被主动拒 ⇒ 每次部署后所有用户需重登（预期非故障）；改他人凭证须顺带 `revokeUserSessions`。
- Origin 校验别退回 `startsWith`（`host.evil.com` 可绕）；**无 Origin 的请求要放行**（API 客户端依赖）。

## 🔴 git（本机特有）
- 工作副本在 **`ycdb`**（非 master），未合入、未推送，**带 DDL**、**依赖零变化** ⇒ 上线必须 `--migrate-only`。规模用前现测：`git rev-list --count master..ycdb`。
- **本机写不了嵌套分支引用**（`a/b` 静默失败且 exit 0）⇒ 分支名用平铺名。
- `checkout`/`merge` 后可能只落地差异文件（`git status` 报一堆 ` D`）⇒ 文件没丢，`git reset --hard HEAD` 全铺回。判「文件是否缺失」**只能看 `git status`**（`ls-files`+`existsSync` 会因中文名转义假阳性）。
- 🔴 **ycdb 上提交一律显式列文件路径，绝不用 `-A`/`.`**：工作区常驻两个 master 线的未跟踪项（`docs/厂家后台使用说明/` + `scripts/generate-user-guide.mjs`）。误提交回退 = `git reset --soft HEAD~1`。

## 🔴 工程铁律（跨项目）
- **同一文件多次 Edit 绝不并行**（写覆盖竞态，两个都报成功但丢改动）。
- **`node --check` 只查语法、不查未声明引用**（`return { undefVar }` 语法合法）。
- **Vue/SPA 修复必须真浏览器验证**（DOM 完整 ≠ 视觉正常）。
- **沙箱**：`rm`/`tail`/`head`/`grep`/`find` 多不可用 → 用 node `fs`/Read/Glob；长输出落盘再 Read；`schtasks`/`sc.exe` 被策略拉黑。
- 🔴 **失败命令的 fallback 输出绝不能当证据**（`grep` 不可用时 `|| echo "结论"` 会打印假话）。
- 🔴 **「上限/截断/唯一性」这类怀疑必须用真实数据算边界**，别靠读代码定性。

## 数据口径与合规（农业农村部公告第1049号）
- 库里的演示/测试数据**数值不可信**；能据代码下结论的只有「机制」（代码事实）。
- 扫码必显六项：农药名称/登记证持有人/生产日期（须与标签一致）/生产批次/原药登记证号/原药生产企业。接口本就全返回，只差展示。
- `status=1`（已生成）的码 `batch_id` 为空 ⇒ 日期/批次无从展示，是业务链路问题、非展示缺陷。

## 关键实现（别自己重写）
- 32 位码：结构 `shared/utils/unit-code.ts` · 提取 `shared/utils/trace-code.ts`。三处共用，**别自己 slice**。比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL），否则别的类别撞后六位给出错误候选。
- `/api/trace` 未命中本平台 → 登记库兜底 `external-reg`(`TraceExternal.vue`)；未命中 → `not-found`。**只读：不写 `scan_log`、不触发预警**。
- 数量上限一律取 `shared/utils/code-limits.ts`（`MAX_CODES_PER_WRITE`=50万、`LARGE_BATCH_CONFIRM_THRESHOLD`=20万）。硬边界：响应体积(50万 allCodes≈19MB) / nginx `proxy_read_timeout 120s` / MySQL 占位符 65535（CHUNK=5000×11=55000，**只能减**）/ 浏览器内存。线上 PM2 `max_memory_restart` 仅 800M ⇒ **线上验收只跑 5 万**。
- 写接口 `requireWritableUser`；前端写入口 = 接口守卫 + 按钮 `v-if="canWrite"`，**别散落写 `role==='viewer'`**。`admin.vue` 的 `writeOnly:true` ⇒ viewer 侧栏 9 项。
- 取客户端 IP 一律 `clientIpOf(event)`（优先 `x-real-ip`）：nginx 的 `$proxy_add_x_forwarded_for` 把客户端自带的 x-forwarded-for 拼在真实 IP **前面**。

## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 **`{total,page,pageSize,rows}`**（**不是裸数组**）。
- 🔴 `POST /api/auth/login` 响应 **`{"ok":true,"user":null}`**，`user` **恒为 null** ⇒ 用户态只能取 `GET /api/auth/me`。
- **断言页面文案前去组件源码取真实字符串**；**断言响应前先 `Object.keys` 打印结构**，口径写错会伪装成「被测对象出错」。
- raw `mysql2` `conn.query()` 返 `[rows,fields]`，项目 `db.ts query()` 返行数组 ⇒ 混用后 `if(row)` 对空数组为真、静默走错分支。临时脚本统一收口 `firstRow()`。

## 本机环境
- 无系统 Node（用托管 `22.22.2-3`）；dev 端口 **3100**（3000 被残留占用）。判服务是否跑最新代码：带恶意前缀 Origin 登录 → 新版 403。
- 账号 `admin`/`lvfeng`/`codeop`/`viewer`，密码统一 `admin123`。⚠️ `viewer` **只存在于本机库，线上没有**。
- 启动日志 `[h3] Please prefer using message…` WARN ＝ `createError({statusMessage})` 触发的**既有告警、非故障**。

## 状态（易漂移，用前现测）
- 线上构建产物 = **2026-09-19 18:08:56** ⇒ **ycdb 整条线（含 50 万上限、P1-1）未上线**；裸域名 `https://nz315.cn` 301→www 已修复。微信后台「网页授权域名」是否保存成功**必须问用户**。
- 🚀 上线照 **24 号**（ycdb 已含 19 号的 `68163bb`，别单独再跑 19 号）；判据 URL `https://www.nz315.cn/trace?code=10929272000000000000000000000000`（前 `not-found` → 后 `external-reg`）。
- ⚠️ `/api/stores/nearby` 匿名可用、进程 Map 无上限、与 `ip-geo` **共用同一把高德 key** ⇒ POI 配额被打爆会让 `scan_log.province` 静默写不进去（**P1-1 的死穴**）。用户在 09-23 表示该模块**可能整体下架**、改为农资记账（类微信支付账单），故 N6-b/N6④ 暂缓，只做 N6①②③ 纯防御。
- 高德两条硬约束：① 限流/配额用尽时 HTTP 仍 200（`status:'0'` + `CUQPS_HAS_EXCEEDED_THE_LIMIT`）⇒ 必须显式判 `status==='1'`；② 未命中返**空数组 `[]` 而非空串** ⇒ `String()` 会把 `[]` 写进库。
