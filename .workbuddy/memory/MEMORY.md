# 项目长期记忆 — 农资315 追溯码管理平台

> 只留跨会话必须遵守的约定；细节看 `docs/handover/` 与当日 `.workbuddy/memory/YYYY-MM-DD.md`。
> 交接手册：**26 号**=**功能漏洞复查（线上已存在 N1–N6，最新）** · **25 号**=**新对话接续（先读它）** · **24 号**=**上线执行单（要部署就看它）** · **23 号**=缺陷与待办总账(P0/P1/P2) · **22 号**=功能测试报告 · 21 号=上一版接续（机制/铁律仍有效）。
> 复测用 skill `nz315-func-regression`，别从零搭。

## 数据口径
- 库里的演示/测试数据**数值不可信**，别拿测试数据之间的矛盾当缺陷结论；能据代码下结论的只有「机制」（代码事实）；合规判断必须上真实数据。

## 合规（农业农村部公告第1049号）
- 扫码结果页必显六项：农药名称/登记证持有人/生产日期（须与标签一致）/生产批次/原药登记证号/原药生产企业。接口本就全返回，只差展示。
- `status=1`（已生成）的码 `batch_id` 为空 ⇒ 日期/批次无从展示，是业务链路问题、非展示缺陷。

## 32 位码与公众端兜底（唯一实现 `shared/utils/unit-code.ts`；码提取 `shared/utils/trace-code.ts`）
- 结构：第1位类别(1=PD/2=WP)·第2-7位登记证后六位·第8位生产类型。三处共用，**别再自己 slice**。
- `/api/trace` 未命中本平台 → 登记库兜底：命中⇒`external-reg`(`TraceExternal.vue`)；未命中⇒`not-found`(`TraceNotFound.vue`)。**只读：不写 `scan_log`、不触发预警**。
- 比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL），否则别的类别撞后六位会给出错误候选。未命中文案按 `structureOk` 分流。
- 性能：`RIGHT(registration_no,6)=?` 走不了索引（全扫 95,386 行/26-32ms），靠 `registry-lookup.ts` 进程内 LRU(500条/10分钟)兜。
- 边界：登记命中**≠正品**；日期/批次本平台给不了（指向瓶身标签）；**不抓外部平台页面**。微信扫码有数据＝打开了该码所属平台的 H5 —— **架构事实，非缺陷**。
- ✅ `scan_log.province/city` 已补齐写入（`66b0f6b`，在 ycdb）：`server/utils/ip-geo.ts` 走高德 IP 定位（复用 `runtimeConfig.amapWebKey`，**零新依赖**）；缓存命中当场写、首见新 IP 交后台异步补齐(fire-and-forget) —— **外部调用不得阻塞扫码主链路**；**零 DDL**。**尚未部署。**
  - 高德两条硬约束（改 `ip-geo.ts` 前必看）：① 限流/配额用尽时 HTTP 仍 200（返 `status:'0'`+`CUQPS_HAS_EXCEEDED_THE_LIMIT`，实测连打 4 次即中）⇒ 必须显式判 `status==='1'`；② 未命中返**空数组 `[]` 而非空串** ⇒ 直接 `String()` 会把 `[]` 写进库。
  - 🔴 取客户端 IP 一律 `clientIpOf(event)`（优先 `x-real-ip`）：nginx 的 `$proxy_add_x_forwarded_for` 把**客户端自带**的 x-forwarded-for 拼在真实 IP **前面**，取 `split(',')[0]` 等于采信客户端自报归属地。
  - 本机 `x-real-ip` 常是 `127.0.0.1`（内网查不出省市）⇒ **线上验这条必须用公网 IP 打**。

## 异常场景扫码测试
- `node scripts/seed-abnormal-demo.mjs --verify` 造 9 张真能扫的码，覆盖 `/trace` 全分支；产物 `qr-test/`（`manifest.json` 机器可读）；`--clean` 只清本脚本数据；须 dev 在 3100。
- **硬安全闸：`DB_HOST` 非本机直接 exit(2)**，别放宽。演示数据带 `【测试】` 前缀 + 独立企业（本机 `enterprise_id=5`），upsert 幂等。
- 🔴 **严禁在生产跑**：闸门只拦「DB_HOST 非本机」，而**服务器 `DB_HOST` 正是 127.0.0.1** ⇒ 闸门放行、会往生产库灌演示数据。**开发库专用。**
- 改结果页后**两层都要验**：接口 `resultType` + SSR 文案断言（只验接口漏白屏，只验页面漏"渲染了错组件"）；第三层 zxing 反解 PNG。
- 🔴 **32 位码绝不手抄**，一律取 `qr-test/manifest.json`（别拿 HTML 字节数当页面指纹）。
- raw `mysql2` `conn.query()` 返回 `[rows,fields]`，项目封装 `db.ts query()` 返回行数组本身 —— 混用后 `if(row)` 对空数组为真，会静默走错分支。**临时脚本统一收口 `firstRow()`**（已踩三次）。

## 🔴 数据库与部署硬约定
- 真实库补列补索引一律 `node scripts/db-init.mjs --migrate-only`，**`--migrate-only` 不可省**（裸跑会 `seed()`：插演示企业/4 条码/admin123 账号）。三明治留证：`verify-db-migration.mjs dump` → 迁移 → `compare`（期望 PASS，判据 `bad=0`）。
- 服务器：① 绝不 `pm2 kill`/`delete all`（与 www.cynx.cn 共用 daemon，只能 `pm2 reload nz315`）② `nz315.conf` 绝不写 `listen 443 ssl default_server` ③ 绝不把本机构建的 `.output` 传上去 ④ 改 `.env` 必须重新 build（runtimeConfig 构建期内嵌）⑤ 顺序固定：补列→构建→reload ⑥ 静态资源清单构建期固化（工具包须在 build 前放进 `public/tools/`）。
- 三段 token（09-19 起）：旧两段被主动拒绝 ⇒ 每次部署后所有在线用户需重登（预期非故障）；**改他人凭证的写操作（改密/改角色/禁用）要顺带 `revokeUserSessions`**。
- Origin 校验**别退回 `startsWith`**（`host.evil.com` 可绕）；**无 Origin 的请求要放行**（API 客户端依赖）。

## 角色收口
- 写接口 `requireWritableUser`（非 viewer）；用户管理/企业信息仅 platform_admin / enterprise_admin；总部专属 `requirePlatformAdmin`；`requireBackendUser` 只给 GET。
- 前端新增写入口 = 两个动作：接口 `requireWritableUser` + 按钮 `v-if="canWrite"`。**别散落写 `role==='viewer'`**。
- 验收：「后端 403」与「看不到按钮」必须分开验（后者只能真浏览器或 SSR 提取可见元素）。`admin.vue` 的 `writeOnly:true` ⇒ viewer 侧栏 9 项（无「外部二维码核验」）。

## 接口形状与登录（断言前先看这条）
- `GET /api/admin/external-verifications` 返回 **`{total,page,pageSize,rows}`**（**不是裸数组**）——按 `Array/.list/.items` 解析会误报"列表 0 条"。
- 🔴 `POST /api/auth/login` 响应 **`{"ok":true,"user":null}`**，`user` **恒为 null**（写的是**响应** cookie，随即读**请求** header）⇒ 用户态只能从 `GET /api/auth/me` 取。
- **断言页面文案前去组件源码取真实字符串**（是「登记证**号**后六位」）；**断言响应前先 `Object.keys` 打印结构**，口径写错会伪装成"被测对象出错"。

## 外部二维码核验（ycdb）
- 拿别人的码 → 用国家登记库 `pesticide_reg`(97,471) 只判前 8 位。**码提取是硬前置**：需提取到 ≥32 位连续数字，否则 400。
- 天花板：后六位不唯一（同类别 15.8% 多候选，最多 4 个）⇒ 未给完整证号时产品名/持有人/证号三项 `insufficient`；8,914 条老证号（`PD91109-10` 形态）永不命中。
- 字段提取：过制表符/双空格/冒号内联/JS 引号键值/标签独占行+下行/别名；**不过单空格分隔**；「见瓶身喷码」会溜过占位词闸门被当生产日期。
- ⚠️ `normalizeProductName` 只剥 `\d+%` ⇒ 真实平台把剂型+序号写进产品名会被判 mismatch，并落 `risk_alert(alert_type=5)`。
- ⚠️ `external-verification.ts` 的 `PRIVATE_HOST` 正则末尾 `$` ⇒ 点分内网 IPv4（含 127.0.0.1）全放行，**SSRF 防护实际失效**。`NOISE_LABELS` 是死代码。

## 数量上限（`shared/utils/code-limits.ts`）
- 上限一律从该文件取（`MAX_CODES_PER_WRITE`=**50万**、`LARGE_BATCH_CONFIRM_THRESHOLD`=20万），**别在页面/接口就地写数字**。
- 四条硬边界：响应体积（50 万 `allCodes` 实测 19MB）/ nginx `proxy_read_timeout 120s` / MySQL 占位符上限 65535（`CHUNK=5000×11列=55000`，**只能减不能加**）/ 浏览器内存（+59MB）。
- ⚠️ 别在 dev 反复跑满 50 万（曾 OOM exit 134）。线上 PM2 `max_memory_restart` 仅 800M ⇒ **线上验收只跑 5 万**；要常态化 20 万+ 需调到 1200-1500M，而该字段 `pm2 reload` 不重读（需专门窗口，别顺手做）。

## 验证手法
- 改页面 `setup()` 先跑 **SSR 直出探针**：带 cookie `fetch http://127.0.0.1:3100/<页面>`，500 页面的 `<script>` payload 里内嵌 ReferenceError 堆栈（含文件名行号）。
- 真浏览器验证**必须同一浏览器实例内跑完**（会话 cookie 不跨实例）；`ui-shot.js` 固定「先 `--click` 后 `--js`」，需先设值再点击时把点击也写进 `--js-file`。
- 无摄像头验扫码回调：从 DOM 向上遍历 `__vueParentComponent` 取页面组件（dev 下 `setupState` 可达）直接调方法断言。

## 本机环境
- 无系统 Node（用托管 `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`）；dev 端口 **3100**（3000 被"农码查"残留占用）。`NZ315 Dev Server` 计划任务查无 ⇒ 后台进程，重启即失。判服务是否跑最新代码：带恶意前缀 Origin 登录 → 新版 403。
- 账号 `admin`/`lvfeng`/`codeop`/`viewer`（只读），密码统一 `admin123`。⚠️ `viewer` **只存在于本机库，线上没有**。
- 沙箱：`rm`/`tail`/`head`/`grep`/`find`/`wc` 多不可用 → 删文件用 node `fs`，长输出落盘再 Read；`schtasks`/`sc.exe` 被策略拉黑。
- 本机 git 写不了嵌套引用（分支名用平铺名，如 `ycdb`）；checkout/merge 后可能只落地差异文件（`git status` 报一堆 ` D`）—— 文件没丢，`git reset --hard HEAD` 全铺回。
- 启动日志里的 `[h3] Please prefer using message…` WARN ＝ `createError({statusMessage})` 触发的**既有告警、非故障**。

## 分支与部署状态（易漂移，**用前现测**）
- 工作副本在 **`ycdb`**（规模每次提交都在动，别背文档：`git rev-list --count master..ycdb` + `git diff --shortstat master...ycdb`），未合入 master、未推送；**带 DDL**（新表 `external_verification` + `risk_alert` 补列补索引），**依赖零变化** ⇒ 上线必须 `--migrate-only`。
- 🧭 路线已定（2026-09-22 用户裁定「走 ycdb」）：不回 master 收尾、**不动 `stash@{0}`**。
- 线上构建产物 = **2026-09-19 18:08:56**（`/_nuxt/builds/latest.json` 的 `timestamp`=`1789812536370`）⇒ **50 万上限与 ycdb 整条线都未上线**。
- 🚀 上线照 **`docs/handover/24-部署执行单-ycdb整线上线.md`**（新增，**取代 19 号**）。**ycdb 已含 19 号的 `68163bb`**（别单独再跑 19 号，同一份代码何必构建两遍）。
  - 包：`E:\software\workbuddy\文件存放处\2026-09-22-1819-ycdb整线上线\nz315-ycdb-1c6730a.tar.gz` = **875,337 字节** / SHA256 `5b6649c5309f95437b458280344b7f7fb06ee8cf50c4440186a8744166692495`（190 文件 + 57 目录，与 `git ls-tree` 双向核对：多 0 / 缺 0）。
  - ✅ 服务器 `AMAP_WEB_KEY` 已在线可用（实测 `GET /api/stores/nearby` → 200 + 真实 POI）⇒ P1-1 上线即生效。它**没写进 `.env.example`**（只记了 `NUXT_PUBLIC_AMAP_*`），别被误导。
- ✳️ **before/after 判据（同一条 URL）**：`https://www.nz315.cn/trace?code=10929272000000000000000000000000` —— 部署前 `not-found`（含「未查询到」），部署后应为 `external-reg`（含「不是农资315签发」「农药登记资料库」「PD20092927」）。
- ✅ **裸域名 `https://nz315.cn` 已修复**（301→www，路径/query 保留，严格校验通过）。**别再当待办。**
- `MP_verify_OUOoNSqTrpZkfWli.txt` 公网 200，但微信后台「网页授权域名」是否保存成功**必须问用户**。
- master 上挂着未提交的「厂家后台使用说明」：`stash@{0}` 只含 PROJECT_LOG 条目（**`stash pop` 必须在 master 上做**），`docs/厂家后台使用说明/`(30 项) + `scripts/generate-user-guide.mjs` 未跟踪；备份目录 `C:/shots/_master-uncommitted-backup-20260922` **已过时，别拿它盖工作区**。
- 🔴 **在 `ycdb` 上提交一律显式列出文件路径，绝不用 `git add -A` / `git add .`**：本工作区**常驻**两个属于 master 那条线的未跟踪项（见上条），`-A` 必然把它们卷进 `ycdb`；一旦卷进去，后续 `checkout master` 会把它们从工作区删掉。**已踩一次**（09-23，提交 `f4855d3` 误含 30 个文件，随即 `reset --soft HEAD~1` + `git restore --staged <两个路径>` 重提为 `b0dbdf3`）。
  - 误提交的标准回退动作 = **`git reset --soft HEAD~1`**：只移动 HEAD、把改动退回暂存区，**工作区零风险**（`--mixed`/`--hard` 都不合适）。
- **判断线上状态优先公网实测**，别信文档里的"应该"。

## 🔴 线上**已存在**的 6 条缺陷（26 号，2026-09-23 实测；**不是"待部署"**）
- **归属判定法（复用）**：`git diff --stat master..ycdb -- server/` **只有 7 个文件**在动（`external-verifications.get.ts`/`external-verify.post.ts`/`trace.get.ts`/`external-verification.ts`/`ip-geo.ts`/`registry-lookup.ts`/`risk-alert.ts`）⇒ **不在这 7 个文件里的问题，线上（09-19 master 产物）都已经存在**。⇒ 23 号的 P1-3/4/5 是"上线才引入"，而 N1–N6 是"现在就在线上"。
- **N1** 产品建档**不校验登记证号是否存在**（PRD 8类异常-3「建档时阻断」缺失）：实测不存在的 `PD99999999` 建档 → **200 `{"ok":true,"id":23}`** 且真落库（`products.post.ts` 只查非空+系统内重复，**从不查 `pesticide_reg`**）。
- **N2** 公众端「点此反馈」**入口不可达 + 功能是 stub**（类型 7 双失效）：`'mismatch'` 类型**声明了但 `trace.get.ts` 从不产出**，而按钮 `v-if` 门在该值上；`master` blob 实测同源。
- **N3** **「每日定时巡检」整体不存在**（全仓库无 cron/setInterval）⇒ 类型 3、6 无自动触发路径；`triggerAlert` 全项目**仅 3 处调用点**（类型 1、4 + 人工核验）。
- **N4** **「登记证过期⇒暂停绑定批次」未实现**：`registration_expire` 全仓库仅 3 处，**4 个绑定接口全无校验**。
- **N5** 🔴 **公众首页在展示伪造统计数字**：线上 `/api/stats` 硬编码 `{"totalQueries":128630,"abnormalClues":42}`，**公网首页输出里就有 `128630`**；`stats.get.ts` 全文 8 行、无鉴权无缓存。**合规上线前必须处理。**
- **N6** `/api/stores/nearby` **匿名可用**（无守卫）+ `cache` Map **无上限** + 坐标无范围校验 + **与 `ip-geo` 共用同一把高德 key** ⇒ 内存无界增长；配额被刷爆时 `ip-geo` 静默返 null ⇒ **又会把 P1-1 的「重复查询」打回死分支**（**P1-1 依赖一个可被匿名刷爆的外部配额**）。
- **N7（仅 ycdb，P2）** `registry-lookup.ts` 注释与实现相反（先 `LIMIT 20` 再按类别过滤）。**当前不构成故障**——真实库单个后六位最多 **6 行**。

## 验证手法（补充，2026-09-23）
- 🔴 **「上限/截断/唯一性」这类怀疑，必须用真实数据算边界，不能靠读代码定性**：`LIMIT 20` 先截断再过滤看着像真 bug，实测单组最多 6 行 ⇒ 直接否掉。
- 🔴 **失败命令的 fallback 输出绝不能当证据**：沙箱里 `grep` 不可用（`grep: command not found`），脚本里 `|| echo "结论"` 会**打印出看起来像结论的假话**。复核历史版本用 node `git show <ref>:<path>` + `String.includes()`。
- 顺带实测口径：`pesticide_reg` **97,471** 条 · 后六位重复 **13,010** 组 · 其中**双类别并存 4,389** 组（⭐ 这正是「必须先按类别过滤」的理由，双类别并存时不过滤会给出**错误类别的候选**）。
