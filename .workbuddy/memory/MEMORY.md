# 项目长期记忆 — 农资315 追溯码管理平台

> **细节看交接文档，本文件只留「改错会出生产事故」的硬约定。**
> **28号=实施记录(最新，先读它)** · 27号=N2–N6 方案 · 26号=漏洞复查 · 25号=接续 · **24号=上线执行单** · 23号=缺陷总账。复测用 skill `nz315-func-regression`。

## 🔴 部署与数据库
- 补列补索引一律 `node scripts/db-init.mjs --migrate-only`（**参数不可省**，裸跑会 seed 演示企业/4条码/admin123）。三明治：`verify-db-migration.mjs dump` → 迁移 → `compare`（判据 `bad=0`）。
- 服务器与 www.cynx.cn **共用 PM2 daemon**：绝不 `pm2 kill`/`delete all`，只能 `pm2 reload nz315`；`nz315.conf` 绝不写 `listen 443 ssl default_server`；绝不传本机 `.output`；**改 `.env` 必须重新 build**（runtimeConfig 构建期内嵌）；顺序固定 补列→构建→reload；工具包须 **build 前**放进 `public/tools/`（静态清单构建期固化）。
- 三段 token：旧两段被主动拒 ⇒ 部署后所有用户需重登（非故障）；改他人凭证须顺带 `revokeUserSessions`。
- Origin 校验别退回 `startsWith`（`host.evil.com` 可绕）；**无 Origin 的请求要放行**。

## 🔴 git（本机特有）
- 工作副本在 **`ycdb`**（非 master），未合入未推送，**带 DDL**、依赖零变化 ⇒ 上线必须 `--migrate-only`。规模用前现测 `git rev-list --count master..ycdb`。
- **本机写不了嵌套分支引用**（`a/b` 静默失败且 exit 0）⇒ 分支名用平铺名。
- `checkout`/`merge` 后可能只落地差异文件（`git status` 报一堆 ` D`）⇒ 文件没丢，`git reset --hard HEAD` 全铺回。判「文件缺失」**只能看 `git status`**。
- 🔴 **ycdb 上提交一律显式列文件路径，绝不用 `-A`/`.`**：工作区常驻两个 master 线未跟踪项（`docs/厂家后台使用说明/` + `scripts/generate-user-guide.mjs`）。误提交回退 = `git reset --soft HEAD~1`。

## 🔴 工程铁律（跨项目，详见 AGENTS.md 踩坑记录表）
- **同一文件多次 Edit 绝不并行**（写覆盖竞态）；**`node --check` 不查未声明引用**；**Vue/SPA 修复必须真浏览器验证**（CDP `el.click()` 须等 hydration；`ui-shot.js --js-file` 是表达式，须 IIFE）。
- **沙箱**：`rm`/`tail`/`head`/`grep`/`find` 多不可用 → 用 node `fs`/Read/Glob；长输出落盘再 Read；`schtasks`/`sc.exe` 被拉黑。
- 🔴 **失败命令的 fallback 输出绝不能当证据**；**「上限/截断/唯一性」类怀疑必须用真实数据算边界**；**「已修」≠「已上线」，判线上只能公网实测**。

## 数据口径与合规（1049号公告）
- 演示/测试数据**数值不可信**；能据代码下结论的只有「机制」。
- 扫码必显六项：农药名称/登记证持有人/生产日期（须与标签一致）/生产批次/原药登记证号/原药生产企业——接口本就全返回，只差展示。`status=1` 的码 `batch_id` 为空 ⇒ 日期/批次无从展示，属业务链路问题。

## 关键实现（别自己重写）
- 32 位码：结构 `shared/utils/unit-code.ts` · 提取 `shared/utils/trace-code.ts`，**别自己 slice**。比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL），否则别的类别撞后六位会给出错误候选。
- `/api/trace` 未命中本平台 → 登记库兜底 `external-reg`(`TraceExternal.vue`)；未命中 → `not-found`。**只读：不写 `scan_log`、不触发预警**。
- 上限一律取 `shared/utils/code-limits.ts`（50万/20万），四条硬边界写在该文件顶部（**MySQL 占位符已贴 65535 顶，CHUNK 只能减不能加**）。线上 PM2 `max_memory_restart` 仅 800M ⇒ **线上验收只跑 5 万**。
- 写接口 `requireWritableUser`；前端写入口 = 接口守卫 + 按钮 `v-if="canWrite"`，**别散落写 `role==='viewer'`**。`admin.vue` 的 `writeOnly:true` ⇒ viewer 侧栏 9 项。
- 取客户端 IP 一律 `clientIpOf(event)`（优先 `x-real-ip`）：nginx 把客户端自带的 x-forwarded-for 拼在真实 IP **前面**。
- 限流用 `server/utils/rate-limit.ts`（零依赖固定窗口、**进程内**，改 cluster 须换共享存储）；`feedback.post.ts` 是**本项目第一个匿名写接口**，限流须放**入参校验之后**。
- 高德：POI 与 `ip-geo` **共用 `amapWebKey`**（配额爆了省份静默写不进 = P1-1 死穴，N6④ 暂缓）；两坑：**配额用尽 HTTP 仍 200**（须判 `status==='1'`）、**未命中返 `[]` 非空串**。

## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 **`{total,page,pageSize,rows}`**（**不是裸数组**）。
- 🔴 `POST /api/auth/login` 响应 **`{"ok":true,"user":null}`**，`user` **恒为 null** ⇒ 用户态只能取 `GET /api/auth/me`。
- **断言页面文案前去组件源码取真实字符串**；**断言响应前先 `Object.keys` 打印结构**。
- raw `mysql2` `conn.query()` 返 `[rows,fields]`，项目 `db.ts query()` 返行数组 ⇒ 混用后 `if(row)` 对空数组为真、静默走错分支 ⇒ 临时脚本统一收口 `firstRow()`。

## 本机环境
- 无系统 Node（用托管 `22.22.2-3`）；dev 端口 **3100**（3000 被占用）。判服务是否跑最新代码：带恶意前缀 Origin 登录 → 新版 403。
- 账号 `admin`/`lvfeng`/`codeop`/`viewer`，密码统一 `admin123`。⚠️ `viewer` **只存在于本机库，线上没有**。
- 启动日志 `[h3] Please prefer using message…` WARN ＝ 既有告警、非故障。

## 状态（易漂移，用前现测）
- 线上构建产物 = **2026-09-19 18:08:56** ⇒ **ycdb 整条线未上线**；裸域名 `https://nz315.cn` 301→www 已修复。微信后台「网页授权域名」是否保存成功**必须问用户**。
- 🔴 **N2–N6 六条已全部修完并提交（5 个提交，在 `ycdb`），但未上线** ⇒ **原备的 `nz315-ycdb-1c6730a.tar.gz` 已过期（不含这 5 个提交）** ⇒ **上线前必须重新 `git archive` 打包 + 同步 24 号包指纹**。细节全在 **28 号**。
- 🚀 上线照 **24 号**（ycdb 已含 19 号的 `68163bb`，别单独再跑 19 号）；**上线后到宝塔加 N3 每日 03:00 巡检任务**（`/usr/local/node22/bin/node …/scripts/inspect-daily.mjs --apply`，**首次先不加 `--apply` 看量**，脚本不参与 build）。判据 `/trace?code=10929272000000000000000000000000`（前 not-found → 后 external-reg）。
- ⚠️ 用户在 09-23 表示 `/api/stores/nearby` 附近门店模块**可能整体下架**、改做农资记账 ⇒ N6④/N6-b 暂缓。
