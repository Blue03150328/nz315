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
- 🔴 **「外码来源页快照与比对」这条功能线已于 2026-09-24 提交为 `0598e2d`**（⚠️ **仍未推送、未上线**）：`feat(核验): 外码来源页快照与比对，并把 M7 外部核验解析器并入同一内核` —— 27 文件 / +1,562 −280（新增 13 / 修改 14），基线 `affe459`。含 `shared/types/source-snapshot.ts` · `server/utils/source-{fetch,parser,compare,snapshot}.ts` · `server/api/admin/source-snapshots.get.ts` · `server/api/trace-snapshots/[id].get.ts` · `app/components/TraceSourceSnapshot.vue` · `app/pages/admin/source-snapshots.vue` · `app/pages/trace-snapshot/[id].vue` · `tests/`（`source-snapshot.test.mjs` 8 例 + `fixtures/ddspp.html`）。**验证：单测 8/8 + 12 项集成验收 `passed` + `/api/admin/external-verify` 四路回归 22/22。**
- 🔴 该线**含新 DDL**（表 `external_source_snapshot`，已同步进 `db-init.mjs` 的 `DDL` 数组与 `verify-db-migration.mjs` 的 `ACTIVE_TABLES`/`EXPECTED_NEW_TABLES` 白名单）⇒ **33 号执行单（零 DDL）不适用**，要上线必须另出执行单。**33 号的包 `35da7cc` 不含这批改动 = 两条独立线，别混淆**。
- ⚠️ 该线已知待接线/待裁定：`TraceNotFound.vue` 的「外部页面信息」块读 `outcome.externalSource`，而**服务端从未赋值**（`server/` 全目录零赋值）⇒ 死代码、永不显示；`trace.get.ts` 的 `resultType: hasReg || sourceSnapshot` 会让「带 `source` 但抓取失败」也判 `external-reg`；码页不符（mismatch）时仍把整页原文（约 233KB）落库。

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
- 🔴 **「抓外部页面并解析」原有两套并行实现，2026-09-24 已合并为一套**（提交 **`0598e2d`**；⚠️ **未推送、未上线**）：
  ① **M1 公众侧** = `server/utils/source-parser.ts`（`sourceText`/`labelKey`/`actualDate`/`parseSourceDocument`，带 `SOURCE_PARSER_VERSION`）+ `source-compare.ts`（**4 态，含 `review` 降级**）+ 落表 `external_source_snapshot`；消费者看 `TraceSourceSnapshot.vue` / `/trace-snapshot/[id]`。
  ② **M7 后台侧** = `server/utils/external-verification.ts`，现**只保留** `fetchWla1`（`productionType` 唯一来源）· `toExternalSource()`（字段映射 `productExpiry`→`expireDate`）· `extractOriginalsFromJson()` · `verifyExternalCode`（**6 项判定 + 触发预警 3/5/6/7，一字未动**）+ 落表 `external_verification`；**内联解析实现已全删**，改调 `parseSourceDocument`。
  ③ **合并后新增能力**（原 M7 有、内核没有，现并入）：同义词表 `FIELD_ALIASES`（12 字段中文标签 + JS/JSON 键名）· 全角转半角 `normalizeLabel` · 脚本键提取 `extractScriptKeys` · `spec` 字段；`pick()` 三层取值 = **精确标签 → 同义词别名 → 脚本键**（精确层命中时结果与合并前完全一致）。
  🔴 **两侧口径必须同时保住（改 `sourceText` 前先看这条）**：内核用 `/<[a-zA-Z!/][^>]*>/` 探测输入是**纯文本**还是**含标签的 HTML**——
  · **纯文本**（M7 手工粘贴）⇒ **换行必须保留**；分隔认「冒号 / Tab / **2+空格** / **换行**」（含「标签一行、值一行」兜底，取下方 1–2 行内首个非空行，下一行本身是标签则不给值）；
  · **含标签的 HTML**（M1 公众端外页快照）⇒ 源码层换行**先压平成空格**、行结构只由块级标签产生 ⇒ **口径逐字节不变**。
  ⚠️ 一刀切 `.replace(/\r?\n/g, ' ')` 会让纯文本整段并成一行、**登记证号与持有人全部取不到**（2026-09-24 实测踩到，属真回归，`SOURCE_PARSER_VERSION` 因此 `.2` → **`.3`**）。**纯文本特有的兜底一律挂在那个 `plain` 探测下面**，才能保证公众端零变化。
  📌 **回归入口**：单测 `node --test tests/source-snapshot.test.mjs`（**8 例**，含 ddspp 真实页面用例 = HTML 侧零变化的证据）· 四路 HTTP 回归 `node logs/_m7-regression.mjs`（自登录 + 查库取真实样本 + 22 项断言，结果落 `logs/m7-regression-result.json`）。**该接口会真写库**（`external_verification` 一行/次，mismatch 还会触发 `risk_alert`）⇒ 跑完按 `id > 基线 AND created_at >= 今天` 清理。**「判包/判回归基线」都别用 `MAX(id)`** —— 本机库有 44 行 09-22 的历史测试残留。
  ⚠️ **`wla1` 与通用 HTML 抓取两路在本机不可测**（本机出口经代理 ⇒ 域名被解析到非公网地址 ⇒ 硬化抓取主动拒绝；wla1 表现为 **500 裸错**、通用页 **502**）⇒ 只能到能直连外网的机器上验；`productionType` 只由 wla1 路产出，它从键名合集里消失属环境限制、**不是回归**。
  ℹ️ `raw.extracted` 形状已变（旧＝9 字段对象 → 新＝数字），**全库零消费者**，仅供留档 ⇒ 安全，但记录在案。


## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 **`{total,page,pageSize,rows}`**（**不是裸数组**）。
- 🔴 `POST /api/auth/login` 响应 **`{"ok":true,"user":null}`** ⇒ 用户态只能取 `GET /api/auth/me`。
- 断言页面文案前**去组件源码取真实字符串**；断言响应前先 `Object.keys` 打印结构。
- raw `mysql2` `conn.query()` 返 `[rows,fields]`，项目 `db.ts query()` 返行数组 ⇒ 混用后 `if(row)` 对空数组为真 ⇒ 统一收口 `firstRow()`。

## 本机环境
- 无系统 Node（用托管 `22.22.2-3`）；dev 端口 **3100**。判服务跑没跑最新代码：带恶意前缀 Origin 登录 → 新版 403。
- 账号 `admin`/`lvfeng`/`codeop`/`viewer`（密码 `admin123`）；⚠️ `viewer` **只在本机库**。

## 状态（易漂移，用前现测）
- 🔴 **【2026-09-24 更正】线上 = `35da7cc`**：构建指纹 `1790158070910` = **2026-09-23 18:07:50 北京时间**，09-24 11:3x 公网实测（`/` `/trace` `/bill` `/login` 全 200；`genuine` 页「记一笔账」计数 = 1、「一键举报」= 0）。⇒ **下方几行里「N1 未上线 / 线上 = 39753e3 / 旧包须重打」的表述一律作废**，仅作历史留档；线 B（外码来源页快照，含新 DDL）**才是唯一未上线的线**。
- ~~**线上 = `39753e3`（2026-09-23 15:29 上线）**~~：`/bill` 200 · `/api/bill` 401 · 门店双 404 · `farm_bill` 16 列/0 行 · `/api/stats` 真数 · `/trace` 返 `external-reg` · 恶意 Origin 403；N3 巡检计划任务已在宝塔跑通（每天 03:00 + node22 绝对路径）。细节/回滚点/`.deploy-version` 见 30/31 号。裸域名 301 已修；微信后台「网页授权域名」是否保存成功**必须问用户**。
- 🆕 **N1 已修（提交 `2c1e1f2` + 四页入口 `14fd75e` + 正品页大按钮 `b173abf` · ⚠️ 仍未上线，2026-09-23 17:2x）**：登记库**完整证号精确匹配** + **仅证号变化时校验**（存量孤儿产品不被锁死；本机库有 2 条 `id=21/22`）+ 新证豁免仅 `platform_admin`（落 `risk_alert(3)` **必带 `product_id`**）；**原药行不动**。公众端另补 **「一键记账」`TraceBillEntry`**（**四个结果页全覆盖**：正品 / 外码 / 异常 / 查无此码；**四处形态统一 = 页面底部操作区撑满一行的大按钮（`x=621/w=640/h=36`），页头不放**；正品页那份内联实现已删除、统一到组件）+ **「一键举报」`TraceReport`**（`tel:12316` + 农业农村局原文、接外码/异常/查无此码 3 页、**纯展示零接口**）。**零 DDL / 零依赖 / 零 nginx / 无需重登**；**上线须 rebuild + reload、旧包 `39753e3` 已过期须重打**。门店模块已删 ⇒ N6④/N6-b CLOSED；`a573f09`/`f3c43e0`/`1c6730a` 三包作废。
- 🆕 **本轮上线包已打好、33 号执行单已出（2026-09-23 16:4x · ⚠️ 只准备、未部署未推送）**：基线 `ycdb` @ **`35da7cc`**（= master + 71 提交 / 84 文件 / +10,792 −1,028）；包 = `E:\software\workbuddy\文件存放处\2026-09-23-1640-ycdb-N1与四页记账入口上线包v3\nz315-ycdb-35da7cc.tar.gz`（**698,370 B** / SHA256 **`445b2c8ddf06f7a10341f2d1f1baba542650d0b956dea28aeee36a7054f8d018`** / 170 文件 + 55 目录 / 自验 **0 多 0 缺 0 泄漏 0 内容不一致**）。**零 DDL · 零删除 · 零依赖 · 零 `.env` · 零 nginx**。⚠️ **N1 上线前必查**：线上 `product` 里**证号不在 `pesticide_reg`** 的行（那些行以后**改证号**会被拦，改名/停用不受影响）。旧包 `39753e3`（671,250 B）与更早三个包**全部作废勿传**。
- ⚠️ **仍未做**：外码页记账预填类别恒为「其他」（`TraceRegistryCandidate` 无 `category`，用户裁定「先不管」）· P2「内容不符」**主动**提示位（被动反馈入口已可用）· 数据治理（线上仍旧演示企业/产品/批次/码；**建议顺序 = N1 上线后再换真数据**）· 服务器残留早年 `docs/handover`+`.workbuddy`+`AGENTS.md`+`PROJECT_LOG.md`（**公网实测全 404、不构成泄露**）· `.output.bak-*` 本轮后会有 **4 个**（盘 75%）。
