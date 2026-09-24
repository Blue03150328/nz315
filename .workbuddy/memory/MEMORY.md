# 项目长期记忆 — 农资315 追溯码管理平台

> **本文件只留「改错会出生产事故」的硬约定。** 细节看 `AGENTS.md` 踩坑表与 `docs/handover/`。
> 文档地图：**35 号**=本轮上线执行单（线 B：外码来源页快照 + M7/M1 解析器合并，`35da7cc`→`a40ef08`，🔴 **有 DDL**）· **34 号**=线 B 交接手册 · **33 号**=线 A 执行单（`35da7cc`，✅ 已于 09-23 18:07 上线，仅历史留档）· 32 号=线 A 功能记录 · 31/30 号=更早。复测用 skill `nz315-func-regression`。

## 🔴 判「线上是什么版本」——只看公网构建指纹，本机记录一律不可信
`curl -s https://www.nz315.cn/_nuxt/builds/latest.json` → `timestamp`。
- 已知：`1790158070910` = **2026-09-23 18:07:50**（线 A / `35da7cc`）；09-24 15:4x 实测**仍是这个** ⇒ **线 B 未上线**。判据：两个新路由现在**必须 404**（`/api/admin/source-snapshots`、`/trace-snapshot/<uuid>`）。
- 教训来源：本机 early memory 写「线上 = `39753e3`、33 号未部署」，**被公网实测推翻**。若照旧记录写执行单，基线/备份名/包指纹/`.deploy-version` 全错。

## 🔴 部署与数据库
- 补列补索引一律 `db-init.mjs --migrate-only`（**不可省**，裸跑会 seed 演示企业/4条码/admin123）。三明治 `verify-db-migration.mjs dump→迁移→compare`（判据 `bad=0`）。
- 🔴 **「新建表」不打印 `[db] 迁移：…` 行** —— 新表由 `DDL` 数组的 `CREATE TABLE IF NOT EXISTS` 建立，只体现在 `[db] N 张表创建完成` 的计数上；`[db] 迁移：…` 只由 `migrate()` 的补列/补索引打印。⇒ 判「建表成功」的证据 = 迁移前 `表数=16` → 迁移后 `17 张表创建完成` → `compare` 打出 `OK 新表 external_source_snapshot 0` + 退出码 0。⛔ 别把「不出现任何 `[db] 迁移：…` 行 = 正确」当通用判据（那只是**零 DDL 轮**的判据）。
- 🔴 **带新表上线必须同时改两处白名单**：`db-init.mjs` 的 `DDL` 数组 + `verify-db-migration.mjs` 的 `ACTIVE_TABLES` / `EXPECTED_NEW_TABLES`（**累积制**，老表要留）。漏改 ⇒ 三明治第 ③ 步假 FAIL「出现了基线中不存在、且不在预期白名单里的新表」，会盖住真判据。
- 🔴 **`external_source_snapshot` 是「匿名可写」表**（`/api/trace?code=<32位>&source=<任意公网URL>` 未登录可触发）：每次最多抓 **1MB** 原文落库；`status='unavailable'` 的行**不参与 10 分钟缓存复用** ⇒ 抓取失败时**每次请求新落一行**（限流 60 行/分）⇒ 存储放大，而服务器与 cynx **共用磁盘、盘约 75%**。方案已定（失败只落元数据 + `raw_document` 置 null；成功时 `slice(0,64*1024)`）但**未修** ⇒ 上线后要偶尔 `SELECT COUNT(*) FROM external_source_snapshot;`。
- 📌 **包内体积大头 = `AGENTS.md`（189,100 B）+ `PROJECT_LOG.md`（465,464 B）≈ 654 KB ≈ 732,720 B 包的 89%**（两者没加 `export-ignore`，**待用户裁定**；加了可瘦到约 78 KB，**零运行时影响**）。
- 与 www.cynx.cn **共用 PM2 daemon**：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`nz315.conf` 绝不写 `listen 443 ssl default_server`；绝不传本机 `.output`；**改 `.env` 必须重新 build**；顺序 补列→构建→reload；工具包须 **build 前**放 `public/tools/`。
- 三段 token：旧两段被拒 ⇒ 部署后用户需重登（非故障）；改他人凭证顺带 `revokeUserSessions`。Origin 别退回 `startsWith`；**无 Origin 要放行**。
- 🔴 服务器 `mysqldump` **必须加 `--no-tablespaces`**（库账号无 PROCESS 权限，默认报 `Access denied ... tablespaces`；**非致命、数据照 dump**，光看报错会误判）。**备份有效判据 = `gzip -dc db.sql.gz | tail -3` 里出现 `-- Dump completed on …`**；没有 = 断了 = 无回滚兜底。`ls -lh` 看不到 `.env`，验收用 **`ls -la`**。
- 🔴 **`mv .output .output.bak-<TS>` 会【当场】断静态资源**（Nitro 静态资源是**运行期读盘**：`/`、`/trace` 照旧 200 的迷惑现象下，页面其实无样式无交互、`/tools/*.exe` 500）⇒ **必须放在 `npm run build` 紧前一行**，把「备份 / 迁移判据核对 / 解包核对」等**要停下看数字的步骤全排在前面**；`mv` 之后一路跑到 build 结束。（24 号放第 1 步 ⇒ 窗口 **23 分钟**；33 号改到 build 紧前 ⇒ **2–3 分钟**。）
- 🔴 **判「上线包是否过期」只能逐文件比内容，绝不能比 SHA256**（`git archive` 在包首写 `pax_global_header`，同内容不同提交的包 SHA 必不同）；比对前**两侧都要 `\r\n→\n` 归一**（Windows 产物 CRLF、`git cat-file` 吐 LF ⇒ 不归一会全红，字节差恰等于行数）。自验还须 `git -c core.quotePath=false ls-tree`（`-c` 必须写在子命令**之前**，否则 exit 0 但输出 0 文件 = 假成功；不加 `quotePath=false` 会中文名假缺失），**先剔除 `export-ignore` 项**再判缺失，否则假 FAIL。
- ⚠️ **`tar xzf` 不会删除「包里没有、服务器上还在」的文件** ⇒ 上线**含删除**时执行单必须有独立 `rm -f` + `rmdir` + 复核小节（自检法：把 `git diff --name-status <基线>..<包基线>` 的所有 `D` 路径当反向清单逐个对）。

## 🔴 git（本机特有）
- ✅ **工作副本 `ycdb` 已推送**（2026-09-24 `git push -u origin ycdb` 成功）：本地 `ycdb` = `origin/ycdb` = **`a40ef08`**，ahead/behind **0/0**。旧表述「未合入未推送」已作废；该线**未合入 master、未上线**仍成立。带 DDL ⇒ 上线必须 `--migrate-only`。
- 本机 git 两个老毛病（写不了嵌套引用 `a/b`；`checkout`/`merge` 后只落地差异文件、`git status` 报一堆 ` D`，`git reset --hard HEAD` 即铺回）⇒ 详见用户级记忆与 AGENTS 踩坑表。另：`push` 成功后跟踪引用可能不落盘（`[origin/ycdb: gone]`）⇒ 用 node 直写 loose ref 修。
- 🔴 ycdb 上**绝不用 `-A`/`.`**（工作区常驻 master 线未跟踪项，如 `docs/厂家后台使用说明/` + `scripts/generate-user-guide.mjs`）。**索引还会残留**别处的已暂存项（`git add <路径>` 挡不住）⇒ 看 `git diff --cached --name-only`，**最硬用 `git commit -m "…" -- <路径>`（pathspec 绕过索引）** + `git show --name-status` 复核。误提交回退 = `git reset --soft HEAD~1`。

## 🔴 工程铁律（细节见 AGENTS.md 踩坑表）
- 同一文件**多次 Edit 绝不并行**（写覆盖竞态）；`node --check` 不查未声明引用；Vue/SPA 修复必须真浏览器验证。
- **失败命令的 fallback 输出绝不能当证据**；「上限/截断/唯一性」类怀疑必须用真实数据算边界；**「已修」≠「已上线」**。
- ⚠️ **判「重构有没有改变行为」不能只跑既有断言**：断言覆盖不到「截断边界」这类分支，**全表穷举集合比较**才作数（范例 `logs/_equivalence-proof.mjs`）。**探测脚本里不能用近似口径替代真实函数口径**（本轮第一版栽在 `LIKE 'PD%'` 近似上）。**"回归全绿"证明不了服务在跑新代码** ⇒ 需**金丝雀**；**同码复测会命中缓存**必须换码。

## 数据口径与合规（1049号）
- 演示/测试数据**数值不可信**，能下结论的只有「机制」。合规必显六项（名称/持有人/生产日期〔须与标签一致〕/批次/原药证号/原药企业），接口全返回、只差展示；`status=1` 的码 `batch_id` 空 ⇒ 批次与日期无从展示。

## 关键实现（别自己重写）
- 32 位码：结构 `shared/utils/unit-code.ts` · 提取 `shared/utils/trace-code.ts`，**别自己 slice**；比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL）。
- 🔴 **登记库「后六位 + 类别过滤」唯一实现 = `registry-lookup.ts` 的 `findRegistryRowsByUnitCode(codeParts)`**（2026-09-24 收口，提交 `797407c`）：**公众端兜底（`queryRegistry`）与后台 M7 核验（`external-verification.ts`）共用**，改它就是同时改两端。守卫 = `validCategory && registrationLast6`（**刻意不含 `validLength`** —— 公众端调用前自判）。`MAX_ROW_SCAN = 20` 加在**类别过滤之前** ⇒ 管的是「仅按后六位」的桶（本机 97,471 行实测最大 **6** 条 ⇒ **3 倍余量**）；`MAX_CANDIDATES = 5`（展示截断）。⚠️ **上下限联动**：将来某桶 >20 条 ⇒ 原语会在过滤前丢行 ⇒ 核验漏候选、可能**把一致误判成不一致** ⇒ 两个常量**必须一起上调**。同后六位**跨类别**的桶有 **4,389** 个 ⇒ 类别过滤不可省。🔴 **M7 刻意不用 `lookupRegistryByCode()`**（带 `slice(0,5)` + 10 分钟缓存）：M7 要完整候选集做 `.find(证号完全相等)`，截断会把**一致误判成不一致**。
- 🔴 **「抓外部页面并解析」两套并行实现已于 2026-09-24 合并为一套**（提交 **`0598e2d`**）：① M1 公众侧 = `source-parser.ts`（`sourceText`/`labelKey`/`actualDate`/`parseSourceDocument`，带 `SOURCE_PARSER_VERSION`）+ `source-compare.ts`（**4 态，含 `review` 降级**）+ 落表 `external_source_snapshot`，消费者 `TraceSourceSnapshot.vue` / `/trace-snapshot/[id]`；② M7 后台侧 `external-verification.ts` **内联解析实现全删**，改调 `parseSourceDocument`，只留 `fetchWla1`（`productionType` 唯一来源）· `toExternalSource()` · `extractOriginalsFromJson()` · `verifyExternalCode`（**6 项判定 + 预警 3/5/6/7 一字未动**）+ 落表 `external_verification`。③ 新增能力：同义词表 `FIELD_ALIASES`（12 字段）· 全角转半角 `normalizeLabel` · 脚本键 `extractScriptKeys` · `spec` 字段；`pick()` **三层取值**（精确标签 → 同义词别名 → 脚本键，精确层命中时结果与合并前完全一致）。
  🔴 **两侧口径必须同时保住（改 `sourceText` 前先看这条）**：内核用 `/<[a-zA-Z!/][^>]*>/` 探测输入类型 —— **纯文本**（M7 手工粘贴）⇒ **换行必须保留**，分隔认「冒号 / Tab / **2+空格** / **换行**」（含「标签一行、值一行」兜底）；**含标签的 HTML**（M1 外页快照）⇒ 源码层换行**先压平成空格**、行结构只由块级标签产生 ⇒ **口径逐字节不变**。⚠️ 一刀切 `.replace(/\r?\n/g,' ')` 会让纯文本并成一行、**登记证号与持有人全部取不到**（09-24 实测的真回归，`SOURCE_PARSER_VERSION` 因此 `.2`→**`.3`**）。**纯文本特有兜底一律挂在 `plain` 探测下面**，才能保证公众端零变化。
  📌 **回归入口**：单测 `node --test tests/source-snapshot.test.mjs`（**8 例**，含 ddspp 真实页面用例 = HTML 侧零变化的证据）· 四路 HTTP 回归 `node logs/_m7-regression.mjs`（自登录 + 查库取真实样本 + 22 项断言，落 `logs/m7-regression-result.json`）。**该接口会真写库**（`external_verification` 一行/次，mismatch 还触发 `risk_alert`）⇒ 跑完按 `id > 基线 AND created_at >= 今天` 清理。**判基线别用 `MAX(id)`**（本机有 44 行 09-22 历史残留）。
  ⚠️ **`wla1` 与通用 HTML 抓取两路在本机不可测**（本机出口经代理 ⇒ 域名解析到非公网地址 ⇒ 硬化抓取主动拒绝；wla1 表现 **500 裸错**、通用页 **502**）⇒ 只能到能直连外网的机器验；`productionType` 从键名合集消失属环境限制、**不是回归**。
- ℹ️ `raw.extracted` 形状已变（旧＝9 字段对象 → 新＝数字），**全库零消费者**，仅留档 ⇒ 安全。
- `/api/trace` 未命中 → 登记库兜底 `external-reg`，再未命中 `not-found`。**只读：不写 `scan_log`、不触发预警**。
- 上限取 `shared/utils/code-limits.ts`（50万/20万），硬边界在文件顶部（**MySQL 占位符已贴 65535，CHUNK 只能减不能加**）；线上 PM2 仅 800M ⇒ **线上验收只跑 5 万**。
- 写接口 `requireWritableUser` + 按钮 `v-if="canWrite"`，**别散落 `role==='viewer'`**。取客户端 IP 一律 `clientIpOf(event)`（优先 `x-real-ip`）。
- 限流用 `server/utils/rate-limit.ts`（**进程内**）；`feedback.post.ts` 是**首个匿名写接口**，限流须放**入参校验之后**。
- 高德 `amapWebKey` 现**仅 `ip-geo.ts` 一个调用方**（POI 调用随「附近门店」删除，2026-09-23）⇒ 配额被刷爆 = **省份静默写不进** = P1-1 死穴；**配额用尽 HTTP 仍 200**（须判 `status==='1'`）、**未命中返 `[]`**。

## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 **`{total,page,pageSize,rows}`**（**不是裸数组**）。
- 🆕 `GET /api/admin/source-snapshots`（守卫 **`requirePlatformAdmin`**）返 **`{total, rows}`**，rows 项 = `{id, code, source_url, parser_version, created_at, status}`，20 条/页。**未登录 `401`；非 platform_admin `403`（正确行为，不是故障）**。
- 🆕 `GET /api/trace-snapshots/<uuid>` **匿名可读**、60 次/分、**不返 `raw_document`**（只返 `payload`）；id 正则是**小写 hex** UUID。页面 `/trace-snapshot/<id>` 走 `useFetch` ⇒ 假 UUID 是**页面 200 + 文案「快照不存在或暂时无法读取」**，而**接口层**是 `404` —— 别混判。
- 🔴 `/api/trace` 的 `sourceSnapshot` **只出现在 `not-found` / `external-reg` 两类响应里**；`genuine`/`voided`/`frozen`/`reg-expired`/`expired`/`repeat` 六类**不带**（只 spread `baseOutcome`）。
- 🔴 `POST /api/auth/login` 响应 **`{"ok":true,"user":null}`** ⇒ 用户态只能取 `GET /api/auth/me`（返 **`{"user":{…}}`**，不是裸对象）。
- 断言页面文案前**去组件源码取真实字符串**；断言响应前先 `Object.keys` 打印结构。
- raw `mysql2` `conn.query()` 返 `[rows,fields]`，项目 `db.ts query()` 返行数组 ⇒ 混用后 `if(row)` 对空数组为真 ⇒ 统一收口 `firstRow()`。
- 🔴 `external_source_snapshot` 的列名是 **`code`**（不是 `trace_code`）；`scan_log` **没有** `created_at` 列 —— 写探测 SQL 前先 `DESCRIBE`。

## 本机环境
- 无系统 Node（用托管 `22.22.2-3`）；dev 端口 **3100**。判服务跑没跑最新代码：带恶意前缀 Origin 登录 → 新版 403。
- 账号 `admin`/`lvfeng`/`codeop`/`viewer`（密码 `admin123`）；⚠️ `viewer` **只在本机库**。
- 🔴 **Git Bash coreutils 全瘫**（`ls`/`head`/`tail`/`wc`/`sleep` 全 `command not found`）⇒ 一律 **node 绝对路径 + 落盘再 Read**；`ls` 报「文件不存在」是**假阴性**（用 Glob/Read 复核）。PowerShell 的 stdout 也常被整体吞掉 ⇒ 同样走「脚本写文件 → Read」。

## 状态（易漂移，用前现测）
- 🆕 **【2026-09-24 15:4x】线 B 已 100% 就绪，部署 0% 开始**：基线 **`35da7cc`（= 线上）→ `a40ef08`**，已推 `origin/ycdb`；包 `...2026-09-24-1447-ycdb-外码来源页快照与解析器合并上线包\nz315-ycdb-a40ef08.tar.gz`（**732,720 B** / SHA256 `9353df93c9d48bb3e4b28ee3a638d23274ba820a7e6c27a4d837c8f594acadf3` / **182 文件** / 自验 **0 多 0 缺 0 泄漏 0 内容不一致**）；35 号执行单已出（**但尚未提交**）。🔴 **有 DDL**（新建 `external_source_snapshot`，**16 → 17** 张）。**公网实测三个尺子一致证明未上线**：指纹仍 `1790158070910`、两个新路由仍 `404`。
- ⚠️ **待提交（上一轮文档产物，尚未落提交）**：`AGENTS.md` · `PROJECT_LOG.md` · `docs/handover/README.md` · `.workbuddy/memory/*` · **未跟踪的 35 号执行单**。
- ⚠️ **仍未做**：`external_source_snapshot` 存储放大修复（匿名可写，见上）· 外码页记账预填类别恒为「其他」（`TraceRegistryCandidate` 无 `category`，用户裁定「先不管」）· P2「内容不符」**主动**提示位 · 数据治理（线上仍旧演示企业/产品/批次/码；**建议顺序 = 线上换真数据放在功能上线之后**）· 服务器残留早年 `docs/handover`+`.workbuddy`+`AGENTS.md`+`PROJECT_LOG.md`（**公网实测全 404、不构成泄露**）· 线 B 自带缺口：死代码 `outcome.externalSource`（服务端零赋值）· `trace.get.ts` 的 `resultType: hasReg || sourceSnapshot` 隐式真值 · `PRIVATE_HOST` 正则末尾多 `$`（当前不可利用）。
