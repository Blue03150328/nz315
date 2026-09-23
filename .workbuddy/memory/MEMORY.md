# 项目长期记忆 — 农资315 追溯码管理平台

> **细节看交接文档与 AGENTS.md，本文件只留「改错会出生产事故」的硬约定。**
> **30号=本次上线总纲（含 9 步现场实测）** · 28号=实施记录 · 27号=N2–N6 方案 · 26号=漏洞复查 · **24号=上线执行单**。复测用 skill `nz315-func-regression`。

## 🔴 部署与数据库
- 补列补索引一律 `db-init.mjs --migrate-only`（**不可省**，裸跑会 seed 演示企业/4条码/admin123）。三明治 `verify-db-migration.mjs dump→迁移→compare`（判据 `bad=0`）。
- 与 www.cynx.cn **共用 PM2 daemon**：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`nz315.conf` 绝不写 `listen 443 ssl default_server`；绝不传本机 `.output`；**改 `.env` 必须重新 build**；顺序 补列→构建→reload；工具包须 **build 前**放 `public/tools/`。
- 三段 token：旧两段被拒 ⇒ 部署后用户需重登（非故障）；改他人凭证顺带 `revokeUserSessions`。Origin 别退回 `startsWith`；**无 Origin 要放行**。
- 🔴 服务器上 `mysqldump` **必须加 `--no-tablespaces`**：库账号无 PROCESS 权限，默认会报 `Access denied ... when trying to dump tablespaces`（**非致命、数据照 dump**，但光看报错会误判）。**备份有效的判据是 `gzip -dc db.sql.gz | tail -3` 里有 `-- Dump completed on …`**，没有 = 中途断了 = 无回滚兜底。`ls -lh` 看不到 `.env`，备份验收要用 **`ls -la`**。

## 🔴 git（本机特有）
- 工作副本在 **`ycdb`**（非 master），未合入未推送，带 DDL ⇒ 上线必须 `--migrate-only`。
- 本机 git 两个老毛病（写不了嵌套引用 `a/b`；`checkout`/`merge` 后只落地差异文件、`git status` 报一堆 ` D`，`git reset --hard HEAD` 即铺回）⇒ 详见用户级记忆与 AGENTS 踩坑表。
- 🔴 ycdb 上**绝不用 `-A`/`.`**（工作区常驻两个 master 线未跟踪项）。**索引还会残留**别处的已暂存项（`git add <路径>` 挡不住）⇒ 看 `git diff --cached --name-only`，**最硬用 `git commit -m "…" -- <路径>`（pathspec 绕过索引）** + `git show --name-status` 复核。误提交回退 = `git reset --soft HEAD~1`。

## 🔴 工程铁律（细节见 AGENTS.md 踩坑表）
- 同一文件**多次 Edit 绝不并行**（写覆盖竞态）；`node --check` 不查未声明引用；Vue/SPA 修复必须真浏览器验证。
- **失败命令的 fallback 输出绝不能当证据**；「上限/截断/唯一性」类怀疑必须用真实数据算边界；**「已修」≠「已上线」**。

## 数据口径与合规（1049号）
- 演示/测试数据**数值不可信**，能下结论的只有「机制」。合规必显六项（名称/持有人/生产日期〔须与标签一致〕/批次/原药证号/原药企业），接口全返回、只差展示；`status=1` 的码 `batch_id` 空 ⇒ 批次与日期无从展示。

## 关键实现（别自己重写）
- 32 位码：结构 `shared/utils/unit-code.ts` · 提取 `shared/utils/trace-code.ts`，**别自己 slice**；比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL）。
- `/api/trace` 未命中 → 登记库兜底 `external-reg`，再未命中 `not-found`。**只读：不写 `scan_log`、不触发预警**。
- 上限取 `shared/utils/code-limits.ts`（50万/20万），硬边界在文件顶部（**MySQL 占位符已贴 65535，CHUNK 只能减不能加**）；线上 PM2 仅 800M ⇒ **线上验收只跑 5 万**。
- 写接口 `requireWritableUser` + 按钮 `v-if="canWrite"`，**别散落 `role==='viewer'`**。取客户端 IP 一律 `clientIpOf(event)`（优先 `x-real-ip`）。
- 限流用 `server/utils/rate-limit.ts`（**进程内**）；`feedback.post.ts` 是**首个匿名写接口**，限流须放**入参校验之后**。
- 高德 `amapWebKey` 现**仅 `ip-geo.ts` 一个调用方**（POI 调用已随「附近门店」删除，2026-09-23）⇒ 配额被刷爆 = **省份静默写不进** = P1-1 死穴；**配额用尽 HTTP 仍 200**（须判 `status==='1'`）、**未命中返 `[]`**。

## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 **`{total,page,pageSize,rows}`**（**不是裸数组**）。
- 🔴 `POST /api/auth/login` 响应 **`{"ok":true,"user":null}`** ⇒ 用户态只能取 `GET /api/auth/me`。
- 断言页面文案前**去组件源码取真实字符串**；断言响应前先 `Object.keys` 打印结构。
- raw `mysql2` `conn.query()` 返 `[rows,fields]`，项目 `db.ts query()` 返行数组 ⇒ 混用后 `if(row)` 对空数组为真 ⇒ 统一收口 `firstRow()`。

## 本机环境
- 无系统 Node（用托管 `22.22.2-3`）；dev 端口 **3100**。判服务跑没跑最新代码：带恶意前缀 Origin 登录 → 新版 403。
- 账号 `admin`/`lvfeng`/`codeop`/`viewer`（密码 `admin123`）；⚠️ `viewer` **只在本机库**。

## 状态（易漂移，用前现测）
- ✅ **线上 = `39753e3`（2026-09-23 15:29 上线）**：`/bill` 200 · `/api/bill` 401 · 门店双 404 · `farm_bill` 16 列/0 行 · `/api/stats` 真数 · `/trace` 返 `external-reg` · 恶意 Origin 403；N3 巡检计划任务已在宝塔跑通（每天 03:00 + node22 绝对路径）。细节/回滚点/`.deploy-version` 见 30/31 号。裸域名 301 已修；微信后台「网页授权域名」是否保存成功**必须问用户**。
- 🆕 **N1 已修（`ycdb` @ `2c1e1f2` · ⚠️ 未上线，2026-09-23 17:0x）**：登记库**完整证号精确匹配** + **仅证号变化时校验**（存量孤儿产品不被锁死）+ 新证豁免仅 `platform_admin`（落 `risk_alert(3)` **必带 `product_id`**）；**原药行不动**。公众端另补 **「一键记账」`TraceBillEntry`**（外码页）+ **「一键举报」`TraceReport`**（`tel:12316` + 农业农村局原文、接 4 结果页、**纯展示零接口**）。**上线须 rebuild + reload、旧包 `39753e3` 已过期须重打**；**零 DDL**。门店模块已删 ⇒ N6④/N6-b CLOSED；`a573f09`/`f3c43e0`/`1c6730a` 三包作废。
- ⚠️ **仍未做**：外码页记账预填类别恒为「其他」· 正品页「记一笔」未统一到 `TraceBillEntry` · P2「内容不符」主动提示位 · 数据治理（线上仍旧演示企业/产品/批次/码）；服务器残留早年 `docs/handover`+`.workbuddy`（公网 404）。
