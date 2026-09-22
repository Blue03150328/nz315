# 项目长期记忆 — 农资315 追溯码管理平台

> 只留跨会话必须遵守的约定；细节/证据/进度看 `docs/handover/` 与当日 `.workbuddy/memory/YYYY-MM-DD.md`。
> 三份最常用的：**21 号**＝新对话接续手册 · **22 号**＝功能测试报告 · **23 号**＝**缺陷与待办总账（P0/P1/P2）**。
> 复测可直接用 skill `nz315-func-regression`（独立断言脚本 + 四层验证法），别每次从零搭。

## 数据口径
- 库里演示/测试数据**数值不可信**，别拿测试数据之间的矛盾当缺陷结论；能据代码下结论的只有「机制」（代码事实）；合规判断必须上真实数据。
- 脏值举例（防误判）：`product_original.ingredient` 3/5 为 NULL 且 2 行与字典表不符；两租户电话相同；`enterprise.address/website` 全 NULL。

## 合规（农业农村部公告第1049号）
- 扫码结果页必显六项：农药名称、登记证持有人、生产日期（须与标签一致）、生产批次、原药登记证号、原药生产企业。接口本就全返回，只差展示；其他字段可空。
- `status=1`（已生成）的码 `batch_id` 为空 ⇒ 日期/批次无从展示，是业务链路问题、非展示缺陷。

## 32 位单元识别码（唯一实现 `shared/utils/unit-code.ts`）
- 结构：第1位类别(1=PD/2=WP)·第2-7位登记证后六位·第8位生产类型。三处共用（后台核验/公众端兜底/两个前端结果页），**别再自己 slice**。码提取唯一来源 `shared/utils/trace-code.ts`。
- 公众端 `/api/trace` 未命中本平台时走登记库兜底：命中⇒`external-reg`（`TraceExternal.vue`）；再未命中⇒`not-found`（`TraceNotFound.vue` 多出结构解析卡）。**只读：不写 `scan_log`、不触发预警**。
- 比对**必须先按类别过滤**（第1位=1→PD/PDN/LS/EX；=2→WP/WPN/WL），否则别的类别撞后六位会给出错误候选。未命中原因文案按 `structureOk` 分流（「结构非法」≠「结构合规但无此证」）。
- 性能：`RIGHT(registration_no,6)=?` 走不了索引（全扫 95,386 行 / 26-32ms），靠 `registry-lookup.ts` 进程内 LRU（500条/10分钟）兜；加生成列+索引可提速（DDL，未做）。
- 合规边界：登记命中**≠正品**；日期/批次本平台给不了（指向瓶身标签）；**不抓外部平台页面**。
- ✅ `scan_log.province`/`city` **已于 2026-09-22 补齐写入**（提交 `66b0f6b`，在 `ycdb`）：新增 `server/utils/ip-geo.ts`，走**高德 IP 定位**（复用 `runtimeConfig.amapWebKey`，**零新依赖**）；写 `scan_log` 时**缓存命中即当场写、首见新 IP 交后台异步补齐（fire-and-forget）** —— 公众端是唯一被陌生人高频打的路径，外部调用**不得阻塞扫码主链路**。**零 DDL**（两列与索引本已存在）。**尚未部署。**
  - 高德两条实测硬约束（改 `ip-geo.ts` 前必看）：① **限流/配额用尽时 HTTP 仍是 200**（返 `status:'0'` + `CUQPS_HAS_EXCEEDED_THE_LIMIT`；实测**连打 4 次即中**）⇒ 必须显式判 `status === '1'`；② **未命中返回空数组 `[]` 而非空串**（内网/境外 IP）⇒ 直接 `String()` 会把 `[]` 写进库。
  - 🔴 **取客户端 IP 一律 `clientIpOf(event)`（优先 `x-real-ip`）**：nginx 的 `$proxy_add_x_forwarded_for` 会把**客户端自带**的 `x-forwarded-for` 拼在真实 IP **前面**，取 `split(',')[0]` 等于采信客户端自报归属地 ⇒ **「重复查询」的省份可被任意伪造**（原 `trace.get.ts` 就是这么写的，已随本次修复改掉）。
  - 本机 `x-real-ip` 常是 `127.0.0.1`（内网 ⇒ 查不出省市）⇒ **线上验这条必须用公网 IP 打**，本机只能伪造头模拟。线上 `nz315.conf` 带 `proxy_set_header X-Real-IP $remote_addr`，链路是通的。
- 微信扫码有数据 = 直接打开了该码所属平台的 H5 —— **架构事实，不是缺陷**。

## 异常场景扫码测试
- `node scripts/seed-abnormal-demo.mjs --verify` 造 9 张真能扫的码 + 数据 + 总览页，覆盖 `/trace` 全分支（正常/重复(跨3省)/过期/冻结/作废/证过期/查无此码/结构非法/外部平台码）。产物 `qr-test/`（`manifest.json` 机器可读）；`--clean` 只清本脚本数据；须 dev 在 3100。
- **硬安全闸：`DB_HOST` 非 127.0.0.1/localhost/::1 直接 exit(2)**，别放宽。演示数据带 `【测试】` 前缀 + 独立企业（本机 `enterprise_id=5`），upsert 幂等。
- 改结果页后**两层都要验**：接口 `resultType` + SSR 文案断言（只验接口漏白屏，只验页面漏"渲染了错组件"）；第三层 zxing 反解 PNG。
- 🔴 **32 位码绝不手抄**，一律取 `qr-test/manifest.json`（手抄错一位白查半小时；别拿 HTML 字节数当页面指纹，不同页面可能恰好等长）。
- raw `mysql2` `conn.query()` 返回 `[rows,fields]`，项目封装 `db.ts query()` 返回行数组本身 —— 混用后 `if(row)` 对空数组为真，会静默走错分支。**临时脚本统一收口 `firstRow()`**（本项目已踩三次）。

## 🔴 数据库与部署硬约定
- 真实库补列补索引一律 `node scripts/db-init.mjs --migrate-only`，**`--migrate-only` 不可省**（裸跑会 `seed()`：插演示企业/4 条码/产品批次/`admin123` 账号）。三明治留证：`verify-db-migration.mjs dump` → 迁移 → `compare`（期望 PASS）。
- 服务器：① 绝不 `pm2 kill`/`delete all`（与 `www.cynx.cn` 共用 daemon，只能 `pm2 reload nz315`）② `nz315.conf` 绝不写 `listen 443 ssl default_server` ③ 绝不把本机构建的 `.output` 传上去 ④ 改 `.env` 必须重新 build（runtimeConfig 构建期内嵌）⑤ 顺序固定：补列→构建→reload ⑥ 静态资源清单构建期固化（工具包须在 build 前放进 `public/tools/`）。
- 三段 token（09-19 起）：旧两段被主动拒绝 ⇒ 每次部署后所有在线用户需重登（预期非故障）；**改他人凭证的写操作（改密/改角色/禁用）要顺带 `revokeUserSessions`**。
- Origin 校验**别退回 `startsWith`**（`host.evil.com` 可绕）；**无 Origin 的请求要放行**（API 客户端依赖）。

## 角色收口
- 写接口 `requireWritableUser`（非 viewer）；用户管理/企业信息仅 platform_admin / enterprise_admin；总部专属 `requirePlatformAdmin`；`requireBackendUser` 只给 GET。
- 前端新增写入口 = 两个动作：接口 `requireWritableUser` + 按钮 `v-if="canWrite"`。**别散落写 `role==='viewer'`**。
- 验收：viewer 页面不应存在任何可点写操作 ——「后端 403」与「看不到按钮」必须分开验（后者只能真浏览器或 SSR 提取可见元素）。
- `app/layouts/admin.vue` 的 `writeOnly: true` ⇒ viewer 侧栏看不到「外部二维码核验」（应为 9 项）。

## 接口形状与登录（2026-09-22 实测，断言前先看这条）
- `GET /api/admin/external-verifications` 返回 **`{total,page,pageSize,rows}`**（**不是裸数组**）——按 `Array/.list/.items` 解析会误报"列表 0 条"。
- 🔴 `POST /api/auth/login` 响应 **`{"ok":true,"user":null}`**，`user` **恒为 null**：`setAuthCookie` 写的是**响应** cookie，紧接着 `getCurrentUser(event)` 读**请求** header ⇒ 必然读不到。用户态只能从 `GET /api/auth/me` 取；前端 `useUser.loginWithPassword` 靠 `await refresh()` 补回，**仅 refresh 失败时的兜底回填会拿到 null**（该兜底形同虚设）。
- **断言页面文案前，去组件源码取真实字符串**（示例：是「登记证**号**后六位」，不是「登记证后六位」）；**断言响应前先 `Object.keys` 打印结构**。断言口径写错会伪装成"被测对象出错"。

## 外部二维码核验（ycdb）
- 拿别人的码 → 用国家登记库 `pesticide_reg`(97,471) 当基准，只判前 8 位。**码提取是硬前置**：需从「码值/来源链接/粘贴正文」提取到 ≥32 位连续数字，否则 400；只粘贴正文但正文不含码也是 400。
- 判定天花板：后六位不唯一（同类别 15.8% 多候选，最多 4 个）⇒ 未给完整证号时产品名/持有人/证号三项 `insufficient`；8,914 条老证号（`PD91109-10` 形态）永不命中。
- 字段提取：能过制表符/双空格/冒号内联/JS 引号键值/标签独占行+下行/别名；**不过单空格分隔**；「见瓶身喷码」会溜过占位词闸门被当生产日期。
- ⚠️ `normalizeProductName` 只剥 `\d+%` ⇒ 真实平台把剂型+序号写进产品名会被判 mismatch，并**落 `risk_alert`(alert_type=5)**。
- ⚠️ `external-verification.ts` 的 `PRIVATE_HOST` 正则末尾 `$` ⇒ 点分内网 IPv4（含 127.0.0.1）全放行，**SSRF 防护实际失效**。`NOISE_LABELS` 是死代码。

## 数量上限（`shared/utils/code-limits.ts`）
- 上限一律从该文件取（`MAX_CODES_PER_BATCH`/`MAX_CODES_PER_WRITE`=**50万**，`LARGE_BATCH_CONFIRM_THRESHOLD`=20万），**别在页面/接口就地写数字**。
- 四条硬边界：响应体积（50 万 `allCodes` 实测 19MB）/ nginx `proxy_read_timeout 120s` / MySQL 占位符上限 65535（`CHUNK=5000×11列=55000`，**只能减不能加**）/ 浏览器内存（+59MB）。引擎耗时 1.5s 非瓶颈。
- ⚠️ 别在 dev 反复跑满 50 万（曾 OOM exit 134）。线上 PM2 `max_memory_restart` 仅 800M ⇒ **线上验收只跑 5 万**；要常态化 20 万+ 需调到 1200-1500M，而该字段 `pm2 reload` 不重读（需专门窗口，别顺手做）。

## 验证手法
- 改页面 `setup()` 先跑 **SSR 直出探针**：带 cookie `fetch http://127.0.0.1:3100/<页面>`，500 页面的 `<script>` payload 里内嵌 ReferenceError 堆栈（含文件名行号）。
- 真浏览器验证**必须同一浏览器实例内跑完**（会话 cookie 不跨实例）；`ui-shot.js` 固定「先 `--click` 后 `--js`」，需先设值再点击时把点击也写进 `--js-file`；`--js-file` 用正斜杠绝对路径。
- 无摄像头环境验扫码回调：从 DOM 向上遍历 `__vueParentComponent` 取页面组件（dev 下 `setupState` 可达）直接调方法断言。

## 本机环境
- 无系统 Node（用托管路径 `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`）；dev 端口 **3100**（3000 被"农码查"残留占用）。计划任务 `NZ315 Dev Server` 查无，当前是后台进程，重启即失。判服务是否最新代码：带恶意前缀 Origin 登录 → 新版 403。
- 账号 `admin`/`lvfeng`/`codeop`/`viewer`（只读），密码统一 `admin123`。
- 沙箱：`rm`/`tail`/`head`/`grep`/`find`/`wc` 多不可用 → 删文件用 node `fs`，长输出落盘再 Read；`schtasks`/`sc.exe` 被策略拉黑。
- 本机 git 写不了嵌套引用（分支名用平铺名，如 `ycdb`）；checkout/merge 后可能只落地差异文件（`git status` 报一堆 ` D`）—— 文件没丢，`git reset --hard HEAD` 全铺回。

## 分支与部署状态（易漂移，用前复核）
- 工作副本在 **`ycdb`**（2026-09-22 18:0x 实测 = master + **21** 提交 / **35** 文件 / **+3,624 −114**；取数 `git rev-list --count master..ycdb` + `git diff --shortstat master...ycdb`），未合入 master、未推送；**带 DDL**（新表 `external_verification` + `risk_alert` 补列补索引），**依赖零变化**（package.json/lock/nuxt.config 与 master 零差异）⇒ 上线必须 `--migrate-only`。
  - ⚠️ **文档里的旧数字一律别信**：21 号记「+15」、23 号初版记「+17」**均偏低**，用前现测。
  - 🧭 **路线已定（2026-09-22，用户裁定「走 ycdb」）**：不回 master 收尾、**不动 `stash@{0}`**（见下条）。
- 线上构建产物 = **2026-09-19 18:08:56**（`/_nuxt/builds/latest.json` 的 `timestamp`=`1789812536370`）⇒ **50 万上限与 ycdb 整条线都未上线**。
- 🚀 **要上线就照 `docs/handover/24-部署执行单-ycdb整线上线.md`（2026-09-22 新增，取代 19 号）**。**`ycdb` 已包含 19 号那笔 `68163bb`**（→ 跑 24 号即可，别单独跑 19 号，同一份代码何必构建两遍）。
  - 包：`E:\software\workbuddy\文件存放处\2026-09-22-1819-ycdb整线上线\nz315-ycdb-1c6730a.tar.gz` = **875,337 字节** / SHA256 `5b6649c5309f95437b458280344b7f7fb06ee8cf50c4440186a8744166692495`（190 文件 + 57 目录，已与 `git ls-tree` 双向核对：多出 0 / 缺失 0）。
  - ⚠️ 与 19 号的关键差别：**本次带 DDL** ⇒ 必须 `verify-db-migration dump` → `db-init --migrate-only` → `compare` 三明治；`compare` 判据是 `bad=0`（业务表严格相等，`scan_log`/`operation_log` 放宽为只增不减）。
  - ✅ **服务器 `AMAP_WEB_KEY` 已在线可用**（2026-09-22 实测 `GET /api/stores/nearby?lng=108.32&lat=22.82` → 200 + 真实 POI）⇒ P1-1 上线即生效。它**没写进 `.env.example`**（只记了 `NUXT_PUBLIC_AMAP_*`），别被误导。
  - 🔴 **严禁在生产跑 `scripts/seed-abnormal-demo.mjs`**：它的安全闸只拦「`DB_HOST` 不是本机」，而**服务器 `DB_HOST` 正是 `127.0.0.1`** ⇒ 闸门放行、会往生产库灌演示数据。**开发库专用。**
- ✳️ **上线的 before/after 判据（同一条 URL）**：`https://www.nz315.cn/trace?code=10929272000000000000000000000000` —— 部署前 `not-found`（页面含「未查询到」），部署后应为 `external-reg`（页面含「不是农资315签发」「农药登记资料库」「PD20092927」）。
- ✅ **裸域名 `https://nz315.cn` 已修复**（301→www，路径/query 保留，`rejectUnauthorized:true` 严格校验通过）。**别再当待办。**
- `MP_verify_OUOoNSqTrpZkfWli.txt` 公网 200，但微信后台「网页授权域名」是否保存成功**必须问用户**。
- master 上挂着未提交的「厂家后台使用说明」：`stash@{0}` 只含 PROJECT_LOG 条目（**`stash pop` 必须在 master 上做**），`docs/厂家后台使用说明/`(30 项) + `scripts/generate-user-guide.mjs`(13,507 字节) 未跟踪；备份目录 `C:/shots/_master-uncommitted-backup-20260922` **已过时，别拿它盖工作区**。
- **判断线上状态优先公网实测**，别信文档里的"应该"。
