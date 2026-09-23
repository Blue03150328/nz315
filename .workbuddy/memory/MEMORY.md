# 项目长期记忆 — 农资315 追溯码管理平台

> **细节看交接文档与 AGENTS.md，本文件只留「改错会出生产事故」的硬约定。**
> **33号=本轮上线执行单（`35da7cc`，取代 24 号用于本次）** · 32号=本轮功能记录（N1 + 四公众端入口） · 31号=上线后现状实测 · 30号=记账上线总纲（含 9 步现场实测） · 28号=实施记录 · 27号=N2–N6 方案 · 26号=漏洞复查 · 24号=整线上线执行单（已跑完）。复测用 skill `nz315-func-regression`。

## 🔴 部署与数据库
- 补列补索引一律 `db-init.mjs --migrate-only`（**不可省**，裸跑会 seed 演示企业/4条码/admin123）。三明治 `verify-db-migration.mjs dump→迁移→compare`（判据 `bad=0`）。
- 与 www.cynx.cn **共用 PM2 daemon**：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`nz315.conf` 绝不写 `listen 443 ssl default_server`；绝不传本机 `.output`；**改 `.env` 必须重新 build**；顺序 补列→构建→reload；工具包须 **build 前**放 `public/tools/`。
- 三段 token：旧两段被拒 ⇒ 部署后用户需重登（非故障）；改他人凭证顺带 `revokeUserSessions`。Origin 别退回 `startsWith`；**无 Origin 要放行**。
- 🔴 服务器上 `mysqldump` **必须加 `--no-tablespaces`**：库账号无 PROCESS 权限，默认会报 `Access denied ... when trying to dump tablespaces`（**非致命、数据照 dump**，但光看报错会误判）。**备份有效的判据是 `gzip -dc db.sql.gz | tail -3` 里有 `-- Dump completed on …`**，没有 = 中途断了 = 无回滚兜底。`ls -lh` 看不到 `.env`，备份验收要用 **`ls -la`**。
- 🔴 **`mv .output .output.bak-<TS>` 会【当场】断静态资源**（Nitro 静态资源是**运行期读盘**：`/`、`/trace` 照旧 200 的迷惑现象下，页面其实没样式没交互、`/tools/*.exe` 500）⇒ **必须放在 `npm run build` 的紧前一行**，把「备份 / 迁移判据核对 / 解包核对」等**需要停下看数字的步骤全排在前面**；`mv` 之后一路跑到 build 结束。（24 号把它放第 1 步 ⇒ 实测窗口 **23 分钟**；33 号已改为 build 紧前 ⇒ **2–3 分钟**。）
- 🔴 **判「上线包是否过期」只能逐文件比内容，绝不能比 SHA256**（`git archive` 在包首写 `pax_global_header`，同内容不同提交的包 SHA 必不同）；比对前**两侧都要 `\r\n→\n` 归一**（Windows 打包机产物是 CRLF、`git cat-file` 吐 LF ⇒ 不归一会全红，字节差恰好等于行数）。自验还须：`git ls-tree -c core.quotePath=false`（不加会中文名假缺失）**先剔除 `export-ignore` 项**再判缺失，否则假 FAIL。
- ⚠️ **`tar xzf` 解包不会删除「包里没有、服务器上还在」的文件** ⇒ 本轮上线**含删除**时，执行单必须有独立的 `rm -f` + `rmdir` + 复核小节（自检法：把 `git diff --name-status <基线>..<包基线>` 里所有 `D` 路径当反向清单逐个对）。

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
- 🆕 **N1 已修（提交 `2c1e1f2` + 四页入口 `14fd75e` + 正品页大按钮 `b173abf` · ⚠️ 仍未上线，2026-09-23 17:2x）**：登记库**完整证号精确匹配** + **仅证号变化时校验**（存量孤儿产品不被锁死；本机库有 2 条 `id=21/22`）+ 新证豁免仅 `platform_admin`（落 `risk_alert(3)` **必带 `product_id`**）；**原药行不动**。公众端另补 **「一键记账」`TraceBillEntry`**（**四个结果页全覆盖**：正品 / 外码 / 异常 / 查无此码；**四处形态统一 = 页面底部操作区撑满一行的大按钮（`x=621/w=640/h=36`），页头不放**；正品页那份内联实现已删除、统一到组件）+ **「一键举报」`TraceReport`**（`tel:12316` + 农业农村局原文、接外码/异常/查无此码 3 页、**纯展示零接口**）。**零 DDL / 零依赖 / 零 nginx / 无需重登**；**上线须 rebuild + reload、旧包 `39753e3` 已过期须重打**。门店模块已删 ⇒ N6④/N6-b CLOSED；`a573f09`/`f3c43e0`/`1c6730a` 三包作废。
- 🆕 **本轮上线包已打好、33 号执行单已出（2026-09-23 16:4x · ⚠️ 只准备、未部署未推送）**：基线 `ycdb` @ **`35da7cc`**（= master + 71 提交 / 84 文件 / +10,792 −1,028）；包 = `E:\software\workbuddy\文件存放处\2026-09-23-1640-ycdb-N1与四页记账入口上线包v3\nz315-ycdb-35da7cc.tar.gz`（**698,370 B** / SHA256 **`445b2c8ddf06f7a10341f2d1f1baba542650d0b956dea28aeee36a7054f8d018`** / 170 文件 + 55 目录 / 自验 **0 多 0 缺 0 泄漏 0 内容不一致**）。**零 DDL · 零删除 · 零依赖 · 零 `.env` · 零 nginx**。⚠️ **N1 上线前必查**：线上 `product` 里**证号不在 `pesticide_reg`** 的行（那些行以后**改证号**会被拦，改名/停用不受影响）。旧包 `39753e3`（671,250 B）与更早三个包**全部作废勿传**。
- ⚠️ **仍未做**：外码页记账预填类别恒为「其他」（`TraceRegistryCandidate` 无 `category`，用户裁定「先不管」）· P2「内容不符」**主动**提示位（被动反馈入口已可用）· 数据治理（线上仍旧演示企业/产品/批次/码；**建议顺序 = N1 上线后再换真数据**）· 服务器残留早年 `docs/handover`+`.workbuddy`+`AGENTS.md`+`PROJECT_LOG.md`（**公网实测全 404、不构成泄露**）· `.output.bak-*` 本轮后会有 **4 个**（盘 75%）。
