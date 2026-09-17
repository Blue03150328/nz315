## 变更记录
### 2026-09-17 | 微信授权 502「未返回 openid」排查与修复（新增 15 号文档）
- **现象**：微信中打开 `http://www.nz315.cn` → 我的 → 微信一键登录 → **502 · 微信授权失败：未返回 openid**。
- **结论①：与 HTTPS 无关**。实测 `http://www.nz315.cn/` 200（标题「农资315 - 农药追溯查询」）、`/MP_verify_OUOoNSqTrpZkfWli.txt` 200（16 字节）、`authorize` 端点 302 且 `redirect_uri` 正确拼成 **http** 回调；**微信确实带着 code 回调到了服务器**（否则报的是 400「缺少 code」，而全仓库只有 `callback.get.ts` 一处会产生 502 那句文案）→ OAuth 第一步在 http 下是通的。同期复测 443：证书仍是 `CN=www.cynx.cn`、`https://www.nz315.cn/` 返回 cynx 首页、https 校验文件 **404**、**80 端口未做 301**（14 号文档第一段尚未执行）。
- **结论②：根因在代码层——失败详情被吞掉**。原实现 `tokenRes?.errmsg || '未返回 openid'` 有两个盲区：**(a)** ofetch 对**非 JSON 的 Content-Type** 会把响应原样返回成**字符串**（微信接入层历史上存在 `text/plain`），此时 `openid` 与 `errmsg` **全为 undefined**；**(b)** 只取 `errmsg` 不取 `errcode`，遇到只带 errcode 的响应同样退化成「未返回 openid」。盲区 (a) 已用实验坐实：本地 `text/plain` 接口喂给项目自带 ofetch → `typeof = "string"`、`openid = undefined`。
- **凭据与微信侧实测**：用项目真实 AppID/Secret 打微信（故意用假 code）→ `HTTP 200`、`Content-Type: application/json`、`{"errcode":40029,"errmsg":"invalid code, rid: …"}` → **这对凭据匹配有效**，且**微信失败响应必带 errmsg** → 反证「errmsg 为空」只可能来自非微信标准响应。
- **修复（`a372c7e` on master）**：`server/api/consumer/wechat/callback.get.ts` 新增 `callWechatApi()`（统一 `responseType:'text'` 取回后手动 `JSON.parse`，非 JSON/空响应保留 `__raw`）与 `describeWechatFailure()`（文案 = `errmsg（errcode=…）`，缺失时回落原始响应片段），失败详情同时 `console.error` 进 PM2 error log；`sns/userinfo` 同步改造。
- **验证（实测）**：用 esbuild 转译该路由 + 注入 mock `$fetch` 执行**真实路由逻辑**，6 场景全过——① text/plain 字符串含 openid → **登录成功（旧代码在此必失败）**；② JSON 对象 → 成功；③ `errcode=40163 code been used` → 报出真实原因（旧代码只会说「未返回 openid」）；④ HTML 异常响应 → 带原始片段；⑤ 空响应 → 明确提示；⑥ 对象字段缺失 → 带原始 JSON。
- **⚠️ 新发现的隐患（部署前必须核对）**：本机 `.env` 的 `WECHAT_APP_ID` = `wx9bd4bc120dea3f98`，而本机 `.output/server/chunks/_/nitro.mjs` **内嵌**的 `wechatAppId` = `wx1a6093c716310340`，**是两个不同的公众号**（用假 secret 请求均返回 40029 而非 40013，说明**两个 appid 都真实存在**）。因 `runtimeConfig` 构建期内嵌，**线上实际用哪个取决于服务器那份 `.output` 是用哪份 `.env` 构建的**。→ 已写入 15 号文档 §3/§4 的三条只读核对命令，**appid 口径未核准前不建议构建部署**（否则可能把线上 appid 换成另一个公众号）。
- **修改文件**：`server/api/consumer/wechat/callback.get.ts`（唯一代码改动）· 新增 `docs/handover/15-微信授权502排查与修复.md` · 本条目。**未部署服务器、未改数据库、未重启任何服务。**
- **给下一个 Agent 的提示**：① 先读 `docs/handover/15-微信授权502排查与修复.md`，按 §4 的三条只读命令定案（产物内嵌 appid / 服务器 `.env` / 出网 curl）；② **HTTPS 仍需配**（理由与优先级见 15 号 §5），但它修的不是这个 502；③ 14 号文档与 AGENTS.md 中「微信必抓 https 校验文件、不配 HTTPS 就配不上域名」的表述**与本次实测存在张力**（http 校验文件 200、https 404），下次核对公众平台域名配置状态时应重新验证该结论，勿直接沿用。
- **同日 14:14 用户回执 + 两处自纠**：① 服务器 `.env` 实测 `WECHAT_APP_ID=wx9bd4bc120dea3f98`（与本机一致）、secret 键存在；
  ② 服务器 `curl` 打微信返回 `{"errcode":40013,"errmsg":"invalid appid, rid: …"}` → **出网正常、微信正常回 JSON**，
  「服务器连不上微信」假设**已排除**；③ 🔴 我给的产物 appid 查询**返回空属假阴性**——模式应为
  `grep -rhoE 'wechatAppId"?[[:space:]]*:[[:space:]]*"[^"]*"'`（产物里是 `"wechatAppId": "wx…"`，**冒号后带空格**），
  已在 15 号文档 §4.1 修正并写明避坑；④ 🔴 我再次给 pm2 命令加了 `env PATH=` 前缀（终端报 `env: 'pm2': No such file or directory`）——
  该禁忌 09-16 已记录，现于 15 号 §4.5 再次高亮。⑤ 15 号新增 §4.4：**curl 通 ≠ Node 通**，
  应用跑在 Node 上，需用 `/usr/local/node22/bin/node -e "fetch(…)"` 再验一次，作为「应用/产物问题」与「Node 网络栈问题」的分水岭。
- **同日 14:18 用户回执（结果全绿，两条假设被排除）**：⑥ 服务器产物内嵌 **`"wechatAppId": "wx9bd4bc120dea3f98"`** ——
  与服务器 `.env`、本机 `.env` **三者一致**（本机 `.output` 里的 `wx1a6093c716310340` 属另一次构建，不参与上线）；
  node22 的 `fetch` 打微信 → `status=200` + `application/json` + `40013 invalid appid` → **Node 网络栈同样正常**。
  → 出网 / DNS / appid 口径 / 凭据有效性 / 微信回 JSON **五项全部排除**；
  剩余唯一可能：**产物里的 callback 代码与仓库源码不是同一版**。下一步判据：
  `grep -rho '微信授权失败.\{0,120\}' /var/www/nz315/.output/server/ | sort -u`
  （若文案是硬编码的「微信授权失败：未返回 openid」、不含 `+ errmsg` 拼接段 → 产物是旧代码，当场定案）。
- ⚠️ ⑦ **部署硬约束**：`runtimeConfig` 用的是**不带 `NUXT_` 前缀**的 `process.env.DB_HOST` 写法 → **运行期不会被环境变量覆盖**
  → **绝不能把本机构建的 `.output` 传上服务器**（本机 DB 连接信息会被内嵌进去，线上会连错库），
  只能传源码改动、在服务器上**原地 `npm run build`** 后再 `pm2 reload nz315`。

### 2026-09-17 | 修复已有产品编辑保存误报「请选择归属厂家」
- **原因**：总部编辑时厂家选择器被隐藏，`save()` 却对所有总部保存操作强制校验 `pickedCompany`；首次编辑该值为空，导致未发出 PATCH 就被拦截。
- **修复**：仅总部新增校验并提交厂家；编辑沿用后端产品原归属。打开编辑弹窗时回填 `enterprise_id` 并清除上次新增选择的厂家，生产类型切换核对同步使用当前产品企业编号，防止旧状态影响登记产品候选。
- **验证**：执行旧版真实页面脚本复现同一提示；修复后表单回归 4/4（直接编辑改商标、先新增后编辑及跨企业切换、总部新增必填与 POST、厂家账号编辑）；tsc 0 错误；生产构建成功（9.59 MB）。回归脚本 `scripts/_tmp-verify-product-edit.mjs` 为本地忽略的验证产物，网络请求隔离，未写业务数据；未进行浏览器端到端验证或服务器部署。
- **范围**：仅产品管理页面及项目记忆文档；后端接口、数据库结构和业务数据均未修改。

### 2026-09-16 | 新增 13 号「交接手册（新对话接续）」——用户要开新对话，把上下文全部落盘
- **结果一句话**：用户要求「写一个交接手册我要开新对话」→ 新增 `docs/handover/13-交接手册-新对话接续（部署进行中）.md`（**自包含**：读完这一份即可接手，不必翻别的文档），并在 `docs/handover/README.md` 索引中把它标为**首读（★）**，顺带补齐了 09–12 号一直缺失的索引条目。
- **13 号内容结构（12 节）**：给接手 AI 的 60 秒必读（含「用户不是工程师，命令会被逐条粘贴」+「本轮两次猜命令」的教训）· 本次目标与路线决策（为何走 ewm→master 而非直接部署 ewm）· 服务器现状**实测**表 + **同机共存对照表（cynx vs nz315，PM2 daemon 共用）** · **8 条铁律** · 两个上传件的路径 / 大小 / SHA256 / 包内容复核结果 · **服务器进度 + 下一步精确命令**（含用户已贴出的终端原文输出）· 后续第 3–10 步要点表 · 三级回滚 · 11 条卡点速查 · 踩坑清单（猜命令 + 猜输出形态 / 本机 git 同族坑 / Windows 沙箱限制）· 文档索引（明确标注 10 号有方向性错误）· 待办 6 条 · 一句话总结。
- **诚实标注**：13 号里 `/proc/<pid>/exe` 那条核对命令明确写了「**按标准做法推导、未在服务器上实测**」——不让下一个接手者再把它当成已验证事实（本轮已经因为「未标注的猜测」翻车两次）。
- **仓库状态**：`master` 领先 `origin/master` **11 个提交**（全部为 docs）；工作区干净；**零代码改动**。
- **给下一个 Agent 的提示**：① **新对话先 @ `docs/handover/13-交接手册-新对话接续（部署进行中）.md`**，接续所需上下文已全在其中；② 接手第一件事是让用户跑 13 号 §5.2 第 ① 块，确认 God Daemon 与 pm2 CLI 用同一个 node，再进第 2.2 步备份；③ 预期下一个卡点在第 3 步——**上传 EXE 前必须先 `mkdir -p /var/www/nz315/public/tools/`**。

### 2026-09-16 | 上线手册三处硬伤修复：pm2 命令写法 · public/tools 目录缺失 · ps 判据形态（均已实测确认）
- **结果一句话**：用户在宝塔终端实跑第 2 步报 `env: 'pm2': No such file or directory`，暴露出手册里一条**凭空猜的**命令（以及第一次「修正」时另一条更危险的猜测）；已全部改为有实测证据的写法，11 / 12 号两份手册同步修正。**服务器代码仍未改动一个字节**（用户只跑到第 2 步体检）。
- **硬伤①（pm2 写法）**：原手册写 `env PATH=/usr/local/node22/bin:/usr/bin:/bin pm2 ...`——这段 PATH 只为让 `node`/`npm` 落到 node22，却把 pm2 一起圈了进去，而 pm2 不在该目录 → 直接报错。第一次修复又改成绝对路径 `/usr/local/bin/pm2`（当时**纯属推测、无任何证据**）。**最终结论（实测）**：`which pm2` = `/usr/local/bin/pm2`、`pm2 -v` = **7.0.3**；pm2 命令一律**裸写**（或写绝对路径，二者是同一二进制），**唯一禁忌是加 `env PATH=...` 前缀**——PM2 CLI 的 Node 版本与 God Daemon 不一致时，PM2 会**杀掉并重建 daemon**，而 daemon 与 `cynx` 共用（同一台宝塔机），会把正式站一起干掉。反向规则：`node`/`npm` 类命令**必须**带 node22 的 PATH 前缀。
- **硬伤②（目录缺失）**：`/var/www/nz315/public/tools/` 在服务器上不存在（旧版不需要它，且 git 不跟踪空目录，`git archive` 包内也没有）→ 手册新增 `mkdir -p /var/www/nz315/public/tools/` 步骤，并明确顺序：**EXE 必须在第 7 步 `npm run build` 之前就位**（Nitro 是构建期把 `public/` 拷进 `.output/public/`）。
- **顺带补强体检段**：`node -v` 应为 `v22.22.2`（验证 node22 工具链可达，防第 7 步构建 command not found）；`ls public/tools/` **无输出属正常**（目录尚不存在）；`which pm2` = `/usr/local/bin/pm2`、`pm2 -v` = `7.0.3`。
- **🔴 二次纠正（同一天内第二处「猜输出形态」翻车）**：我原本写「用 `ps -eo pid,args | grep God Daemon` 看第 1 列拿到 daemon 的 node 路径」——**实测输出是 `244345 PM2 v7.0.3: God Daemon (/root/.pm2)`：第 1 列是 PID，而且 PM2 会改写进程标题，`ps` 里根本看不到 node 路径**。判据已改用 `/proc/<pid>/exe`：`DPID=$(ps -eo pid,args | grep -E 'God Daemon|Daemon[.]js' | grep -v grep | awk '{print $1}' | head -1); readlink -f /proc/$DPID/exe; $(readlink -f /proc/$DPID/exe) -v`，再与 `which node`（实测 = **`/usr/bin/node`**）比对，一致才动手。**教训：要写进手册的「命令 + 期望输出」组合，证明输出形态的那一半同样需要证据**——同一天连踩两次（pm2 路径靠猜、`ps` 输出形态靠想象），都是"命令是我编的、没人跑过"。
- **包内容复核（修正了我自己的假阴性）**：`tar tzf` 复核确认上传包**含** `deploy/`（未修正版 `ecosystem.config.cjs` 在包内 → 第 6 步「还原服务器修正版」**确有必要**）、**不含** `public/tools`、**不含** `.env`（只有 `.env.example`）、`docs/handover` 只到 10 号。**教训：列 tar 条目不要假设 `./` 前缀**（按 `/^\.\/deploy\//` 过滤时会得出「包里没有 deploy」的错误结论）。
- **仓库状态**：`master` 提交 `7e805ff` → `80c44a5` → `85f0116`（docs 修正连发），领先 `origin/master` **9 个提交**；工作区干净；**上传包无需重打**（改动全在 docs，不参与构建）。
- **给下一个 Agent 的提示**：① 手册里凡是「看起来合理」的路径/命令，**没有实测输出支撑的都算猜的**——写部署手册前先回头翻上一轮的真实命令输出；② 用户当前进度：第 2 步体检已跑出关键事实——`which pm2` = `/usr/local/bin/pm2`（v7.0.3）、`which node` = `/usr/bin/node`、daemon 进程标题 `PM2 v7.0.3: God Daemon (/root/.pm2)`；**下一步**是用 `/proc/<pid>/exe` 核对 daemon 与 CLI 同 node，再跑完 §2.1 其余项、进 §2.2 备份；③ cynx 隔离铁律不变（只 `pm2 reload`、只 `nginx -s reload`、不碰它的文件与进程）。

### 2026-09-16 | 把 feature/ewm 合入 master（主分支保持 master）并完成上线前本机验证（新增 11 号执行手册）
- **结果一句话**：按用户要求「主分支继续是 master」，把 `ewm` 合入 `master`（`8264bcb` → **`92445d3`**，ewm 原样保留），合并结果 24/24 断言通过；本机 tsc 0 错误、生产构建成功（9.59 MB）、实跑生产入口 9/9 全过；已产出上传包与全套服务器执行命令（`docs/handover/11-部署方案-新分支上线.md`）。**服务器仍未改动一个字节。**
- **🔴 纠正 10 号文档的方向性错误**：10 号称「feature/ewm 相对 master 删除了 deploy/、MP_verify、BatchDateInput.vue…」——用 `git merge-base` 三方比对后确认**方向相反**：这些文件是 master 侧分叉之后由 `ba770ca`/`e61e893`/`18c85da` 新增的，ewm 从未拥有；ewm 真正删除的只有 3 个服务端二维码文件。**严重后果**：master 线上独有的 `e61e893`（扫码结果页**三栏表格版式，覆盖 1049 六项必显字段**）与 `18c85da`（批次绑定弹窗分离 + 日期手输 + 合格证缺省）不在 ewm 上 → **直接部署 ewm 会造成合规版式与业务功能双重回退**。这正是本轮必须先合并的根本原因。
- **合并执行**：① 先补提交上一轮遗留（10 号交接文档 + 本文件条目，`92a68ff`）；② 打回退点 tag `pre-merge-master-20260916` / `pre-merge-ewm-20260916`；③ `git merge ewm` → **仅 3 个文档冲突**（`AGENTS.md` / `PROJECT_LOG.md` / `docs/handover/03-技术文档.md`），**代码文件零冲突**；三处均为「两分支各自追加的条目」，按**双侧保留 + 拼接**处理（node 脚本按冲突标记定位拼接，CRLF 保持，残留标记 0）；④ 合并提交 `92445d3`。
- **仓库级 git 身份**：历史 175 个提交均为 `Administrator <admin@nz315.cn>`，而本机此前无任何 user.name/email 配置 → 已写入**仓库级** `.git/config`（不动全局配置）。
- **验证（全部实测）**：合并结果断言 **24/24**——master 侧 `deploy/` 三件套 + `public/MP_verify_OUOoNSqTrpZkfWli.txt` + `BatchDateInput.vue` + `shared/utils/input-date.ts` 全在；ewm 侧 `OFFLINE_TOOL` 常量 / 备案号页脚 / `.gitignore` / 依赖移除全生效；`TraceResult.vue` 三栏版式与 `codes/index.vue` 批次绑定改动保住。`npm install` → up to date（35s）；`tsc --noEmit` → **0 错误**；`npm run build` → 成功（9.59 MB / gzip 2.4 MB，1m03s）；实跑 `.output/server/index.mjs`（临时端口 3155）**9/9 通过**——EXE 200 + `Content-Length 95030861` + 首字节 MZ、旧接口 `qrcode` / `qrcode-download` 均 **404**、`/MP_verify_*.txt` 200、首页含备案号、`/api/trace` 200；**EXE SHA256 三级一致**（源件 = `.output` 产物 = HTTP 响应体 = `df9cd9ea…f59a7`）。
- **上传件**：`git archive` 产出 `.tmp/nz315-master-92445d3.tar.gz`（159 文件 / 590,099 字节 / SHA256 `f28dfc48…8924`），已复制到工作目录；包内**不含** EXE（gitignore 排除）、`.env`、`node_modules`、`.output` —— EXE 必须单独上传（95,030,861 字节）。
- **🆕 本机 git 同族坑第 7 次复现（新增一条"防误判"要点）**：`git checkout master` 之后工作区**只落地"两分支差异文件"**，其余 7 个同内容文件未落盘，`git status` 报一堆 ` D`（极易误判成"仓库损坏/文件丢失"）。处置仍是 `git reset --hard` 全量铺回。**新增要点：判定"文件是否缺失"只能用 `git status`——`git ls-files` + `fs.existsSync` 会因 `core.quotePath` 把中文名转义成八进制而假阳性报缺失（本轮差点误判 12 个文件丢失）。**
- **本机环境副作用**：为构建而**停掉了 dev 服务**（PID 9716 / 18668 及子进程，3100 已释放）；顺带发现**计划任务「NZ315 Dev Server」已不存在**，项目文档里"计划任务常驻托管"当前处于失效状态，dev 服务实为会话内后台进程。`schtasks.exe` 与 `sc.exe` 同样被安全策略拉黑。
- **修改文件**：新增 `docs/handover/11-部署方案-新分支上线.md`（路线决策 + P0 实测记录 + P1–P4 可粘贴命令 + 回滚 + 风险 R1–R10 + 与 10 号文档差异表）· `PROJECT_LOG.md`（本条目）· 合并带入 `AGENTS.md` / `docs/**` 等。**代码零改动**。
- **给下一个 Agent 的提示**：① 部署照 `docs/handover/11-部署方案-新分支上线.md` 执行，**P1.4「还原服务器修正版 PM2 配置」与 P1.3「删 3 个二维码服务端文件」是最容易踩空的两步**；② 服务器只 `pm2 reload`、绝不碰 cynx、**不跑 `db-init`**（本次零数据库变更）；③ 部署完成后 `git push origin master`，并把合并结果同步进 `AGENTS.md` 进度段。
### 2026-09-16 | 新分支上线前置：本机拉全 `feature/ewm` 并跑通 · 离线工具 EXE 补齐 · 公网现状实测（新增 10 号交接文档）
- **结果一句话**：新分支代码已在 `E:\二维码管理` 完整拉取（147 文件）、依赖装好（780 包）、`.env` 建好、dev 服务 3100 跑通；缺失的离线工具 EXE 已按代码声明补齐并逐位校验通过；本地生产构建链路实测「可下载」。**服务器一个字没动——公网仍是 master，`/tools/nz315-qr-tool-v1.1.0.exe` 实测 404，且 HTTPS 还打着 cynx 的证书。**后续步骤全部写入新文档 `docs/handover/10-部署进度-新分支上线.md`。
- **本机可省事的三处发现**：① 本机**已有同项目旧副本** `E:\wokeplace\二维码管理`（含 `.env`/`node_modules`），新克隆的 `.env` 即参考它建立；② 本机 **MySQL 8.0.46 @3306 的 `nz315` 库已存在且数据齐全**（15 表、`pesticide_reg` 97,471 行）→ **无需 db-init、无需导 xlsx**；③ 项目自带 `node scripts/dev-start.mjs --check` 一次报出依赖完整性/`.env` 必需键/端口占用/缓存新鲜度，**启动类问题第一步就跑它**。
- **🆕 本机 git 写不了嵌套引用（同族第 6 次复现，本次首次定性到"目录创建"层）**：`refs/heads/a/b` 创建不出来，且 `git update-ref` / `git checkout -B` / `git symbolic-ref` **全部 exit 0 无报错**。连锁症状极吓人：HEAD 变 unborn、工作区 147 个文件只剩 27 个（恰好只落地"两分支差异文件"）、`git status` 报 120 个 ` D` —— 极易误判成"仓库损坏"。**真相是文件没丢**（`git reset --hard` 全量铺回）。绕过：本地分支用**平铺名**（`ewm` ← `origin/feature/ewm`）或 node `fs` 直写 loose ref；判定引用只看 `git rev-parse` 与 `.git/refs/heads/` 目录，**绝不信退出码**。
- **离线工具 EXE（本次关键交付）**：用户提供的微信临时目录文件，实测 95,030,861 字节 / SHA256 `df9cd9ea…f59a7`，**与 `generator/index.vue` 里的 `OFFLINE_TOOL.sha256` 逐位一致** → 官方发布件，常量无需改动。已落 `public/tools/nz315-qr-tool-v1.1.0.exe`（`.gitignore` 排除，**不入库**）。
- **⚠️ 推翻 09 文档的一条结论**：09 §5 第 8 条「离线工具 exe 本次不需要上传」**只对 master 成立**（master 生成页走服务端渲染、零引用 `OFFLINE_TOOL`）。**本次要上的是 `feature/ewm`，它改成了"下载离线工具本机出图"，EXE 必须随包上传，漏了即 404**，且需在**构建前**就位（Nitro 构建期才把 `public/` 拷进 `.output/public/`）。已在 10 号文档 §4.2 写明（`AGENTS.md` 第 90 行架构约定行已在 2026-09-15 提交里含同向限定，本轮无需再改）。
- **公网实测（HTTP 80 通、HTTPS 不通）**：`http://www.nz315.cn/` **200**（`server: nginx` + `x-powered-by: Nuxt`）· 裸域 200 · `/favicon.svg` 200 · `/tools/nz315-qr-tool-v1.1.0.exe` **404** · 首页不含 `nz315-qr-tool` 引用（确认公网跑 master）。**`https://www.nz315.cn` 报 `ERR_TLS_CERT_ALTNAME_INVALID`（证书 altnames 只有 `www.cynx.cn`）→ `nz315.conf` 仍未补 443 块，这是"工具在公网可下载"的前置阻塞项。**
- **手工验证（全部实测，可复现）**：`dev-start.mjs --check` 结论"环境正常"；dev 侧 `/`、`/login`、`/trace?code=<真实码>`、`/api/trace`、`/api/stores/nearby` 全 200；`/tools/nz315-qr-tool-v1.1.0.exe` **200 + Content-Length 95030861 + 首字节 `MZ`**；`npm run build` 退出码 0（64.8s）→ `.output/public/tools/` 内 EXE SHA256 与源件一致 → **实跑生产入口 `.output/server/index.mjs` 请求该 URL 返回 200 + Content-Length 95030861**（三级链路闭环）。
- **修改文件**：新增 `docs/handover/10-部署进度-新分支上线.md`（T1–T6 待办 + 铁律 + 可粘贴开场白）· `AGENTS.md`（补 09 那条结论的限定）· `PROJECT_LOG.md`（本条目）。**代码零改动**。本机新增的非受控产物：`.env`、`node_modules/`、`.output/`、`public/tools/nz315-qr-tool-v1.1.0.exe`（四者均在 `.gitignore` 内）。
- **给下一个 Agent 的提示**：① **先读 `docs/handover/10-部署进度-新分支上线.md`**，从 T1 签证书做起；② 部署到服务器时注意 **`deploy/ecosystem.config.cjs` 在 `feature/ewm` 里被删除**，而该文件含 master 上线的两处服务器侧修正（`PORT` 3000→3100、`interpreter` 指向 node22）——**重新部署必须确认 PM2 配置不被覆盖**；③ 服务器侧铁律不变：**只 `reload`、不碰 cynx、改 `.env` 必重建**；④ 别在服务器跑 `git clean -fdx`（会抹掉 gitignored 的 90MB EXE，git 不知情）。
### 2026-09-15 | 阿里云生产环境部署：应用层完整上线（建库/导数据/PM2/nginx），卡在 DNS 解析
- **结果一句话**：nz315 已在服务器 `8.163.107.137` 完整跑起来——独立 MySQL 8.0.43（3307）建库建号并导入 97,471 条登记数据 → PM2 托管（node22 / 端口 3100）→ nginx 反代 `nz315.conf` → 本机与域名 Host 两种入口实测 200、登录走真实数据库成功。**唯一阻塞项是 DNS 未解析（用户侧操作）**，其后是签证书与微信侧配置。
- **服务器共存隔离（全程未影响 cynx）**：宝塔生产机，正式站 `www.cynx.cn` 占 3000 / MySQL 5.7.44 占 3306。nz315 全部资源独立：目录 `/var/www/nz315`、Node 22.22.2（`/usr/local/node22`，系统 node 保持 v20 给 cynx）、MySQL 8.0.43（`/www/server/mysql80`，端口 3307，socket `/tmp/mysql80.sock`，systemd 单元 **`mysql80.service`**——**刻意不用官方 yum 包**，其服务名同为 `mysqld.service` 会覆盖宝塔的）、nginx 新建 `nz315.conf`（**未动 cynx.conf 一个字节**）、独立 PM2 app `nz315`。验证期间 `cynx` 始终 online（80→301、443→200）。
- **本轮完成（六项）**：
  1. **建库建号**：`skip-name-resolve` 已开 → **必须建两个身份**：`'nz315'@'localhost'`（socket 连接）与 **`'nz315'@'127.0.0.1'`（TCP 连接）**。只建前者时应用走 TCP 报 `ERROR 1130 Host '127.0.0.1' is not allowed to connect`。密码用 `mysql_native_password`（mysql2 在非 SSL 下对 `caching_sha2_password` 需额外 RSA 公钥交换，易出问题）。
  2. **建表 + 导数据**：`node scripts/db-init.mjs` → 14 张表；`pesticide_reg` 由 db-init 建表（**因此顺序是「先 db-init 建表、再导数据」**，与原交接文档 4.2/4.3 的顺序相反）→ 导入 97,471 条（3,637 家厂商），导入前 `md5sum` 与本地一致才执行。
  3. **PM2 配置修正**：`deploy/ecosystem.config.cjs` 的两处必改——① `PORT`/`NITRO_PORT` **3000 → 3100**（原值会直接撞 cynx）；② 新增 **`interpreter: '/usr/local/node22/bin/node'`**——PM2 God Daemon 挂在**系统 Node v20.20.2** 上且与 cynx 共用，**重启 daemon 会杀掉 cynx**，故只能 per-app 指定解释器。另需先 `mkdir -p /var/log/nz315`（PM2 配的 out_file/error_file 目录不存在会起不来）。`pm2 start` + `pm2 save`（opts 已 enabled）。实测 `readlink /proc/<pid>/exe` = `/usr/local/node22/bin/node`，`-v` = **v22.22.2**。
  4. **nginx 反代**：新建 `/www/server/panel/vhost/nginx/nz315.conf`（80 端口 · `server_name www.nz315.cn nz315.cn` · acme-challenge 通道 webroot=`/www/server/nginx/html` · 反代 `127.0.0.1:3100` · 传 Host/X-Real-IP/X-Forwarded-* · `client_max_body_size 100m` + `proxy_read_timeout 300s` 供追溯码文件上传）→ `nginx -t` 通过 → `nginx -s reload`。**当前是 HTTP 阶段配置，证书签好后须补 443 块 + 80 改 301。**
  5. **备案号页脚上线**（`f5fe93f`）：`app/layouts/default.vue` 新增 `footer`，展示 `桂ICP备2024035642号-5` 并链接 `beian.miit.gov.cn`（合规要求）；手机端 `pb-24` 避开底部固定导航。已随重新构建上线，实测首页与 `/profile` 均渲染出。
  6. **MySQL 8.0 root 空密码收紧**：`ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY '<32 位随机>'`，密码写入 `/root/.my.cnf`（600）供 CLI 免密。验证要用 **`--no-defaults`**：`mysql --no-defaults --socket=/tmp/mysql80.sock -uroot` → `ERROR 1045 … (using password: NO)` 即空密码已被拒。
- **两个必须记住的坑（都是本次踩到并定性的）**：
  1. **`.env` 的 `DB_PORT` 原值是 3306 = cynx 的 MySQL 5.7 生产库**。若直接跑 `db-init.mjs` 会在**潮优农选的库里**建出 `nz315` 库和 14 张表。**在建库前的安全检查中拦下**（确认 `.env` 的 DB_HOST/PORT 指向独立实例后才执行）。更隐蔽的是后续：改正为 3307 后应用仍报 `Access denied for user 'nz315'@'localhost'` —— 因为 **Nitro 的 runtimeConfig 是「构建时」从 `.env` 读取并内嵌进 `.output/` 的，运行期改 `.env` 不生效**。→ **改 `.env` 任何键后必须重新 `npm run build`**（本次已重建，重建后 `POST /api/auth/login` 立即 200）。
  2. **`/root/.my.cnf` 会压过 `MYSQL_PWD`**。MySQL 客户端取值优先级：**命令行 `-p` > 选项文件 `password` > 环境变量 `MYSQL_PWD`**。写入 `.my.cnf` 后，脚本里 `MYSQL_PWD="$DB_PASSWORD" mysql -h127.0.0.1 -P3307 -u nz315` 实际拿的是 **root 的密码**，报出极具误导性的 `Access denied for user 'nz315'@'127.0.0.1' (using password: YES)`（用户名/主机都对，只有密码错）。**误判排查过程**：先用 mysql2（与应用完全相同的驱动）连库成功（pesticide_reg=97471、user=3），再用 `--no-defaults` 与 shell/dotenv 密码长度对比（均 32、无引号、无 CR）逐项排除，最终定位到客户端优先级。→ **服务器脚本连库一律加 `--no-defaults`**。
- **实测验证（全部真实 HTTP/命令输出）**：`/login` 200（127.0.0.1:3100 与 nginx 两种入口）· `POST /api/auth/login`（admin/admin123）**200** `{"ok":true}` · `products`/`codes?page=1`/`regdata?keyword=氟虫腈`/`upload-batches` 全 200 · `POST /api/admin/codes/qrcode` 空参 → 业务 400「没有可生成的追溯码」（说明路由与 `qrcode`/`pngjs` 依赖在位）· `GET /`、`/trace?code=…`、`/MP_verify_OUOoNSqTrpZkfWli.txt` 全 200 · `pm2 list` 中 cynx 与 nz315 同时 online · `/var/www/nz315/.deploy-version` 记录部署基线。
- **重要修正：离线工具 exe 本次不需要上传**。原交接文档 4.4 写「必须单独上传 `public/tools/nz315-qr-tool-v1.1.0.exe`（90.6 MB）否则页面 404」——**该结论只对 `feature/ewm` 成立**。本次部署基线是 **master**，master 版生成页仍走服务端渲染（`qrcode.post.ts` / `qrcode-download.get.ts` / `server/utils/qr-image.ts` 均在），grep 确认 master 代码**零引用** `OFFLINE_TOOL` / `nz315-qr-tool`。已在 AGENTS.md 的架构约定行加限定，避免下次照抄。
- **剩余步骤（3 项，均依赖外部条件）**：① **DNS 解析（用户侧）**——域名 NS 在阿里云（`dns1/2.hichina.com`），需加 `www` 与 `@` 两条 A 记录指向 `8.163.107.137`；实测 `www.nz315.cn` 仍为 Non-existent domain、`nz315.cn` 无 A 记录。② **HTTPS 证书**——已预置 `/root/nz315-issue-cert.sh`（内含 DNS 前置校验 + `certbot certonly --webroot`，幂等）；注意 certbot **只装了 `standalone`/`webroot`，没有 nginx 插件**，必须走 webroot；签发后改 nz315.conf 补 443 + 80 跳转再 reload。③ **微信公众平台**「网页授权域名」填 `www.nz315.cn`（回调域名取自请求头 `Host`，代码零引用 `SITE_URL`，不要走改 SITE_URL 那条无效路径）。
- **另发现（非本次范围，已告知用户决定）**：cynx（别人在跑的生产站）的 `certbot-renew.timer` 状态为 **enabled 但 inactive**，且无 crontab 兜底，其证书 **2026-11-17 到期** —— 长期不激活则到期后 cynx 会掉 HTTPS。未擅自改动，交用户处置。
- **修改文件**：`app/layouts/default.vue`（备案号页脚）· `docs/handover/09-部署进度-阿里云.md`（按最新状态重写）· `AGENTS.md`（部署指引块 + 进度段 + 架构约定行校正）· `PROJECT_LOG.md`（本条目）· `.workbuddy/memory/2026-09-15.md`（补记）。**服务器侧改动不进仓库**：`/var/www/nz315/.env`（DB_PORT 3306→3307）、`.output`（两次重建）、`deploy/ecosystem.config.cjs`（3000→3100 + interpreter，**服务器版本已改，仓库版本待 cherry-pick 时同步**）、`/www/server/panel/vhost/nginx/nz315.conf`（新建）、`/root/.my.cnf`、`/root/nz315-issue-cert.sh`。
- **给下一个 Agent 的提示**：① **待 cherry-pick 到 master 的提交**：`e3d1015`（交接文档）与 `f5fe93f`（备案号）——服务器已用这两个文件，master 里没有，**不合并则下次从 master 部署会丢备案号**；`deploy/ecosystem.config.cjs` 的端口/解释器修正也同理（本次直接改在服务器上）。② 本机 git 分支引用静默失败**第 5 次复现**（`feature/ewm` 被删），既有恢复流程完全有效。③ 服务器操作两条铁律：**只用 `nginx -s reload`**、**绝不动 cynx 的进程与文件**。
### 2026-09-15 | 修复「dev 服务弹 Vite 解析错误」——根因是构建与 dev 争抢 `.nuxt`
- **现象**：用户看到浏览器弹窗 `[plugin:vite:import-analysis] Failed to resolve import "#app-manifest" from "node_modules/nuxt/dist/app/composables/manifest.js"`。**同时 `curl http://localhost:3100/login` 仍返回 200** —— 服务端（SSR）完全正常，只有客户端 Vite 管道挂了。
- **根因（我的操作失误，不是代码问题）**：上一轮改造中我**在 dev 服务（计划任务 `NZ315 Dev Server`）运行期间跑了两次 `npm run build`**。`nuxt build` 会清空并重写共享的 `.nuxt` 目录，而正在跑的 dev 服务依赖其中的虚拟模块与别名（`#app-manifest` 属其一）→ 目录被换掉后客户端模块解析全线失败。**与代码改动无关**：本轮页面/服务端改动已用 tsc、引擎回归、生产构建、SSR 抓页四重验证通过，仅 dev 客户端的运行时环境被我自己破坏。
- **处置（项目既有流程，实测 9 秒恢复）**：① `Stop-ScheduledTask -TaskName 'NZ315 Dev Server'` → 实测 `State=Ready`、端口 3100 释放、无残留 `dev-service.mjs`/`nuxt dev` 进程（剩余 node 进程均为无关的 MCP/Codex 运行时）；② 删 `.nuxt` + `node_modules/.cache` + `node_modules/.vite`；③ `Start-ScheduledTask` → 第 3 次探测（约 9 秒）即 200。
- **复核（真实浏览器，非 curl）**：新写 `scripts/_tmp-cdp-vitecheck.mjs`（Edge headless + 原生 CDP，沿用项目既有 `_tmp-cdp-*.mjs` 模式，零额外依赖）→ **10 项全过**：`vite-error-overlay` 不存在 · 控制台无 `Failed to resolve import` · 无未捕获异常 · 无 5xx · `/admin/generator` 未被守卫弹回 · Nuxt 已 hydration · 新卡片标题/下载按钮/版本/体积全在位 · 旧表单已消失。截图 `.tmp-shot/gen-page-after-fix.png`（人工核对排版正常）。
- **教训（已写进 AGENTS.md 踩坑表）**：① **不要在 dev 服务运行时构建**——要构建先停服务，构建完再启回来；② **「curl 200」不能当作 dev 健康的证据**——SSR 正常而客户端全挂是这套架构下的典型故障形态，必须用真实浏览器复核；③ 同族问题的另一半（`[optimizer] scanning dependencies...` / 全站 502）此前已记录，根因都是 `.nuxt` 与运行中的进程不匹配。
- **修改文件**：`AGENTS.md`（踩坑表新增 1 行）、`PROJECT_LOG.md`（本条目）、`.workbuddy/memory/2026-09-15.md`（补记）。**代码零改动**（本轮只动文档与缓存），故未重跑 tsc/构建。
### 2026-09-15 | 二维码图片输出改为「下载官方离线工具、本机生成」（下线服务端 PNG 渲染与 zip 打包）
- **背景与决策**：用户指着生成页「二维码图片输出」板块要求「改为放置一个下载链接，下载本地工具生成」。先出方案（含 3 种工具形态、服务端处置、下载权限、两点风险）经用户确认后执行；用户同时确认「服务端三个文件同轮删干净」+「下载放 public 公开」+「工具由我提供」。用户随后提供「农药追溯码生成工具 v1.1.0 便携版」EXE。
- **页面（`app/pages/admin/generator/index.vue`）**：删 `imgForm` / `imgResult` / `doGenImages` / `downloadZip` 与整块模板（原六个参数：码制 / 模块大小 / 静区白边 / 数量 / 文件名前缀 / 起始序号，**全部随之下线，改由工具内设置**）、删 `resetPage` 里对 `imgForm`/`imgResult` 的重置、删 `doGenerate` 里对 `imgResult` 的清空。新增「二维码图片输出（离线工具）」卡片：三步说明（导出 urls.txt → 双击运行工具 → 导入并导出 PNG）+ 未签名 SmartScreen 提示 + SHA256 校验值与 `certutil` 核对方法 + 下载按钮。**下载实现走 `fetch → Blob → 临时 a 标签`**，注释里写明原因（`<a href download>` 直链会被 SPA 客户端路由拦截，同 `specs/index.vue` 模板下载的既有踩坑记录）。工具元信息收敛到页面顶部单一常量 `OFFLINE_TOOL`（name/version/platform/size/fileName/url/sha256），换版本只改这一处。
- **服务端删除**：`server/api/admin/codes/qrcode.post.ts`、`server/api/admin/codes/qrcode-download.get.ts`、`server/utils/qr-image.ts` 三文件删除；`package.json` 移出 `qrcode`、`pngjs`（`npm install --package-lock-only` 同步 lock，`--offline` 会因未缓存的 optional 包失败，须联网）。**`@zxing/library` 保留**——`app/composables/useQrScanner.ts` 扫码兜底动态 import 它、`nuxt.config.ts` 又把它列入 SSR `inline`，删了会打断公众端扫码；**这一条与初始方案不同，是 grep 排查后才发现的**（原以为三个依赖都能删）。
- **连带清理（grep 排查出的 4 处副作用，不处理会留坏代码）**：① `server/types/cjs-modules.d.ts`——删 `qrcode` / `pngjs` / `archiver` 三段本地类型声明；② `scripts/test-code-generator.mjs`——该脚本直接 `import { renderCodePng } from '../server/utils/qr-image.ts'` 并测 zip 打包，删文件后必挂 → 移除第 5、6 两节用例与相关 import（`archiver`/`fs/promises`/`path`/`os`），改为注释说明用例已下线；③ `scripts/_tmp-gen-scan-test-qr.cjs`（用 `qrcode` 生成扫码测试图的临时脚本）删除；④ **顺带消除一个既存隐性依赖缺口**：`archiver` 从来没写进 `package.json`，一直靠 nuxt 的传递依赖 hoist 到 `node_modules` 才可用，随下载接口下线一并消失。
- **工具发布件**：源文件来自微信接收目录 `D:\WECHAT\xwechat_files\...\农药追溯码生成工具-v1.1.0-便携版(1).exe`，`cp` 到 `public/tools/nz315-qr-tool-v1.1.0.exe`（ASCII 路径；下载保存名走 `a.download` 保留中文「农药追溯码生成工具-v1.1.0-便携版.exe」）。**实测属性**：PE32（x86，7z 自解压 SFX，payload 压缩故字符串扫描无有效信息）、95,030,861 字节（≈90.6 MB）、拷贝前后 SHA256 一致 `df9cd9ea79cd67d545ee3f4161d1175c1197344c2dba3509e5b27a46347f59a7`、版本资源 ProductName=农药追溯码生成工具 / FileVersion=1.1.0 / CompanyName=CNYX / FileDescription=符合农业农村部1049号公告单元识别编码规则、**`Get-AuthenticodeSignature` → NotSigned（未做数字签名）**。
- **`.gitignore`**：新增 `public/tools/*.exe`、`public/tools/*.zip`（90.6 MB 的 EXE 绝不能进仓库）。**副作用须记住：`git clone` / 从仓库部署拿不到该文件，部署时必须单独拷贝 `public/tools/` 目录。**
- **口径变化**：`urls.txt` 从「可选导出之一」升级为**离线工具的唯一输入文件**——导出按钮标签改为「导出 urls.txt（离线工具输入）」，生成结果区说明同步改写，卡片刻意用「在**上方**生成结果区」指明位置（生成结果卡在该卡之前）。
- **验证（全部实测）**：`tsc --noEmit` **0 错误**；`scripts/test-code-generator.mjs` 回归 **140 通过 / 0 失败**；`npm run build` 成功（9.56 MB / gzip 2.4 MB）；dev 服务实测 `/tools/nz315-qr-tool-v1.1.0.exe` HEAD **200**（`Content-Type: application/x-msdos-program`、`Accept-Ranges: bytes`）；旧接口 `POST /api/admin/codes/qrcode` 与 `GET /api/admin/codes/qrcode-download` 均 **404**；带 `admin` 会话抓 `/admin/generator` SSR **200**，新卡片文案（标题/下载按钮/版本/90.6 MB/SHA256/certutil）全部命中、旧表单关键词残留 **0**。
- **踩坑**：① `npm run build` 首次被**沙箱的 safe-delete 保护**拦下（`[SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，本轮删除计数超阈值 50，拦的是 Nuxt 清 `node_modules/.cache`），**与代码无关**，非沙箱模式重跑即成功；② Git Bash 下 `curl -o /tmp/xxx` 写文件不落地（第二次调用直接 `No such file or directory`），改用项目内已被 gitignore 的 `.tmp/` 目录才正常；③ PowerShell 工具回显再次捕获不到（预期内，本项目已知），改为 `Set-Content` 写文件再读。
- **未验证项**：工具内部界面流程无法在不运行 EXE 的前提下确认，页面三步说明是**按预期流程撰写**（导出 urls.txt → 工具导入 → 导出 PNG）；若实际操作与此不符，需回来改文案。
- **修改文件**：`app/pages/admin/generator/index.vue`、`package.json`、`package-lock.json`、`server/types/cjs-modules.d.ts`、`scripts/test-code-generator.mjs`、`.gitignore`（+ 删除 3 个服务端文件与 1 个临时脚本；+ 新增 `public/tools/nz315-qr-tool-v1.1.0.exe`，该文件不入库）；文档 `docs/handover/{01,02,03,04,07,08}.md`（6 个）、`AGENTS.md`、`PROJECT_LOG.md`（本条目）。
- **给下一个 Agent 的提示**：① 工具版本/大小/SHA256 的**唯一维护点**是 `generator/index.vue` 顶部的 `OFFLINE_TOOL` 常量，换发布件改这里；② 别再往 `public/tools/` 里放大文件进 git，该目录已按后缀 gitignore；③ 若日后要让「32 位码生成」也能离线（P1-4 剩余部分），参考工程在 `E:\wokeplace\二维码生成离线软件`（**本机无 E 盘**），Web 侧引擎 `server/utils/code-generator.ts` 已与之对齐。
### 2026-09-15 | 分离新建批次绑定与整批修正
- 码库列表新增「新建批次并绑定」独立弹窗入口，原「修正」保留独立弹窗，移除模式切换复选框。
- 新建绑定合格证号选填，留空统一写入「见箱内质量合格证」，已有批次一致性校验与三处数据同步沿用原逻辑；整批修正留空仍不修改。
- 两弹窗生产日期/有效期至支持 YYYY-MM-DD 手输与右侧原生日历选择，前后端校验真实日期。其他入口及状态判定不变。
- 验证：TypeScript 检查通过、日期边界 9 项通过、生产构建通过（12 MB，沙箱 EPERM 后提权重跑）；未执行真实业务数据写入和浏览器交互验收。

### 2026-09-12 | 域名不可访问排查 + 阿里云上线方案（部署材料三件套 + 操作手册）
- **背景**：用户问「`https://www.nz315.cn/MP_verify_OUOoNSqTrpZkfWli.txt` 浏览器访问不了」，随后要求给出「让服务在公网可访问」的完整做法。已知条件：阿里云 ECS、Linux、2 核 4G、自建 MySQL 8、微信公众号**服务号已就绪**、代码尚未部署到服务器。
- **排查结论（域名与站点层，与校验文件无关）**：① `www.nz315.cn` 在 AliDNS(223.5.5.5) 与 114DNS 均返回 **Non-existent domain**；② 裸域 `nz315.cn` 只有 SOA 与 NS（`dns1/dns2.hichina.com` = 阿里云万网）**无任何 A 记录**；③ 本地侧完全正常——`public/MP_verify_OUOoNSqTrpZkfWli.txt` 16 字节，`http://localhost:3100/MP_verify_OUOoNSqTrpZkfWli.txt` **HTTP 200**；④ `docs/handover/08-待办清单.md` P0-2 记载**无服务器、无备案、无证书**，即站点从未上线到公网。→ **"不可访问"的真因是域名无解析 + 站点未部署，校验文件本身无罪。**
- **决定排期的关键约束**：微信「网页授权域名」**强制要求域名已备案**（微信后台对接工信部备案库校验，未备案直接拒绝保存），换中国香港/海外服务器**同样绕不开**；管局审核 1–20 个工作日且**无法加急**；未备案期间域名不能解析到大陆节点（阿里云拦截，备案期间网站无法访问），只能以 `http://<公网IP>:3000` 测试。距合规硬节点 2026-11-01 剩 **50 天**——结论是**备案是唯一关键路径，必须最先启动**。
- **交付物（4 个新文件）**：
  1. `deploy/setup-server.sh` —— 服务器环境一键初始化（幂等）：2G swap（2 核 4G 跑 `nuxt build` 防 OOM）、Node 22 走 **npmmirror 二进制**（国内直连，不走国外源）并切 npm 源、MySQL 8（utf8mb4 + `+08:00` + max_connections 200）、nginx、PM2、目录（`/var/www/nz315` 权限 750，因 `.output/` 内嵌明文凭据）、firewalld 放行 80/443。
  2. `deploy/nginx-nz315.conf` —— 80→443 全量跳转（并放行 `/.well-known/acme-challenge/` 供证书续期）+ **裸域名 `nz315.cn` 301 到 `www.nz315.cn`**（微信回调域名取自请求头 Host，白名单只登记 www，否则真机撞 **10003**）+ 反代 `127.0.0.1:3000`、透传 `X-Forwarded-Proto`、`client_max_body_size 60m`、SSR 不缓冲、超时 120s。
  3. `deploy/ecosystem.config.cjs` —— PM2 守护（`type: module` 项目必须用 `.cjs` 后缀）：仅监听回环、`max_memory_restart 800M`、`min_uptime 30s` 防重启风暴、日志落 `/var/log/nz315/`。
  4. `docs/上线操作手册-阿里云.md` —— 以备案为关键路径的操作序列，含：备案三个硬前置条件（包年包月≥3 个月 / 备案服务号 / 域名持有人与主体一致）、**企业主体 vs 个人主体的决策**（本平台属经营性质，个人备案有驳回与事后注销风险）、材料清单、备案等待期可并行项、备案通过后的解析/证书/微信校验/公安联网备案/备案号展示、上线验收 14 项、故障速查表。
- **本轮查出的两个项目侧缺口（已写入手册，属待办）**：① **前端无任何备案号展示**——`app/` 全目录搜 `备案`/`ICP` 零命中，而工信部要求首页底部标注备案号并链接工信部，备案通过后需补页脚（手册 §4.6）；② **农药登记数据源 xlsx 已不在项目根目录**（`.gitignore` 排除、不随仓库分发），而 `pesticide_reg`（97,471 条）是产品弹窗搜索/回填的必需数据 → 手册给出替代路径「本机 `mysqldump` 仅导出 `pesticide_reg` 单表 → `scp` → 服务器导入」，本机 `C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe` 已确认可用。另注：`backup/nz315_20260905085514.sql`（25 MB）虽含全部 15 表，但**落后于 2026-09-07「删 `system_setting` 表」的结构变更，已过时**，不宜直接用于生产恢复。
- **校验情况**：`bash -n deploy/setup-server.sh` 通过；`node --check deploy/ecosystem.config.cjs` 通过；nginx 配置花括号配平 7/7、server 块 3 个；三个文件换行符经 Python 逐字节实测 **CRLF=0 / 单独 CR=0（纯 LF）**。**未验证项：脚本未在任何 Linux 上实跑过，`rhel`/`debian` 分支与 `dnf`/`apt` 包名仅按官方文档与常见发行版推断，首次部署时须逐段观察输出。**
- **⚠️ 本轮我犯过一次误报并已自我更正（记录留痕）**：初检换行符时用 `grep -c $'\r'` 得出「三个文件全是 CRLF、共 412 行含 CR」，据此还执行了 `sed -i 's/\r$//'` 与 `tr -d '\r'` 两次「修复」；随后用 `od -c` 与 Python `read_bytes().count(b'\r\n')` 复核，**证明文件自始即为纯 LF、CR 计数为 0**——`grep -c $'\r'` 在 Git Bash（PortableGit）下对该模式不可靠，输出的是**假阳性**。当前文件状态正确，无需再转换。该工具陷阱已记入 `AGENTS.md` 踩坑表（判 CRLF 改用 `od -c` 或 Python 逐字节，勿用 grep）。
- **修改文件**：新增 `deploy/setup-server.sh`、`deploy/nginx-nz315.conf`、`deploy/ecosystem.config.cjs`、`docs/上线操作手册-阿里云.md`、`.gitattributes`（对 `deploy/*` 强制 `text eol=lf`，防后续在 Windows 编辑保存后变 CRLF）；`PROJECT_LOG.md`（本条）；`AGENTS.md`（进度段 + 踩坑表）。**代码零改动**，故未跑 tsc/构建。
- **给下一个 Agent 的提示**：① 上线这件事的瓶颈是**备案**而不是技术，任何「先把域名跑起来」的想法在大陆节点都会撞阿里云拦截；② 微信回调域名由**请求 Host** 决定，nginx 必须把非 www 的 Host 301 到 www（本配置已做），否则真机必撞 10003；③ 生产 `.env` 的 `SESSION_SECRET` 若保持默认值会导致登录 **500**（`nuxt.config.ts:50-52` 主动抛错拦截），且 runtimeConfig **构建时内嵌**——必须「先配 `.env` 后 `npm run build`」，顺序反了要重新构建；④ 手册中 `deploy/...` 是**仓库内相对路径**，部署到 `/var/www/nz315` 后即 `/var/www/nz315/deploy/...`。
### 2026-09-12 | 微信网页授权：回调域名机制澄清 + 文档校正 + 明文凭据脚本清理
- **背景**：用户问「公众平台把网页授权域名配成 www.nz315.cn 这一步该怎么做」，并要求删除含明文凭据的临时脚本、修正文档中「redirect_uri 取自 SITE_URL」的错误表述。
- **核心发现（文档与代码不符）**：`server/api/consumer/wechat/authorize.get.ts:15-17` 的 callback 由请求头 `x-forwarded-proto` + `host` **动态拼接**；全仓库 grep `SITE_URL` **只命中 4 处文档**（`docs/DEPLOYMENT.md:38`、`handover/03:131`、`08-待办 P0-4`、`AGENTS.md:148`），**代码零引用**。→ 原文档「改 `SITE_URL` 后重建」是一条**无效路径**；但也不必改代码，线上以 www.nz315.cn 访问时 Host 自动即白名单域名。
- **机制澄清**：微信网页授权**没有服务器回调**——微信仅校验 `redirect_uri` 域名是否在白名单（不在即报 **10003** 且不跳转），跳转由**用户浏览器**执行。原记录「本地 127.0.0.1 回调无法被微信服务器访问」表述不准；真因是白名单不接受 IP、不接受带端口，且手机上的 127.0.0.1 指向手机自身。
- **文档校正（4 处，采用删除线 + 更正标注，保留历史）**：`PROJECT_LOG.md` 2026-09-07 条目待办①②；`docs/handover/03-技术文档.md` §3.2 `SITE_URL` 行与头部复核行；`docs/handover/08-待办清单.md` P0-4 与头部复核行；`AGENTS.md` 待办段（第 4 处为主动补漏，用户未点名，但它是 AI 接手的第一入口）。
- **凭据清理**：删除 `scripts/_tmp-set-wechat-env.mjs`（内含**明文 AppSecret**）。删除前已做全仓库反向扫描（以 `.env` 各键实际值做 `includes` 比对，排除 node_modules/.git/.output/.nuxt/screenshots/backup/logs 及 `.env` 自身）：**AppSecret 仅命中该文件**；`DB_PASSWORD` / `SESSION_SECRET` / `AMAP_WEB_KEY` / `NUXT_PUBLIC_AMAP_JS_KEY` **全部零命中**。该文件**未被 git 跟踪**（`.gitignore:25 scripts/_tmp-*` 命中、`git log --all` 无历史），故**未泄漏**，删除亦不产生 git 变更。另一临时探针 `scripts/_tmp-probe-wechat.mjs` 仅含 AppID（**公开信息**，授权 URL 自带，非秘密），**保留**。
- **顺带发现与处置**：`public/MP_verify_OUOoNSqTrpZkfWli.txt`（用户自公众平台下载）此前**未提交**（`git status` 为 `??`）——不提交则生产构建不带此文件、微信抓取必失败，本轮**一并纳入提交**（`public/` 无 `.gitignore` 规则覆盖，可正常入库）。
- **测试情况**：① `curl http://127.0.0.1:3100/MP_verify_OUOoNSqTrpZkfWli.txt` → **HTTP 200**、`text/plain; charset=utf-8`、**16 字节**、内容 `OUOoNSqTrpZkfWli`，与本地文件 `cmp` **逐字节一致**、**无 BOM、无多余换行**（微信字节级校验的两个坑已排除）；② 全量凭据反向扫描（见上，零残留）；③ 文档为纯文本改动，**代码零改动**，故未跑 tsc/构建。
- **修改文件**：`PROJECT_LOG.md`（本条 + 2026-09-07 条目更正）、`docs/handover/03-技术文档.md`、`docs/handover/08-待办清单.md`、`AGENTS.md`（待办段 + 进度段）；新增 `public/MP_verify_OUOoNSqTrpZkfWli.txt`；删除 `scripts/_tmp-set-wechat-env.mjs`（未跟踪，无 diff）。
- **给下一个 Agent 的提示**：① 微信网页授权回调域名由**请求 Host** 决定，不是环境变量——排查「回调域名不对」先查 nginx 是否把非 www 的 Host 301 到 www，而不是去改 `.env`；② 公众号还须单独配「**JS 接口安全域名**」（与「网页授权域名」是两个独立入口，各限 2 个），将来用 JSSDK 分享/定位时才需要；③ 若公众号开启「IP 白名单」，服务器出口 IP 必须加入，否则 callback 换 openid 会报 **40164**；④ 本地/测试环境无法走通真实授权（白名单不收 IP 与端口），可走已备案子域名隧道或微信公众平台**接口测试号**（后者不要求认证服务号）；⑤ 域名备案 + 站点上线是本步骤的硬前置，微信保存域名时会**实时抓取**校验文件。
### 2026-09-12 | push 前安全审查（semgrep）+ 代码图谱审查（code-review-graph）+ 交接文档过时项校正
- **背景**：用户要求「直接 push、过时文档也改一下，push 前先用 semgrep 与 code-review-graph 两个技能审查」。属"推送前门禁 + 文档校正"一轮。
- **semgrep 安全审查（两轮，0 findings）**：安装于隔离 venv `C:\Users\27475\.workbuddy\binaries\python\envs\default`（semgrep 1.177.0）。① 首轮 `p/security-audit` + `p/secrets` + `p/typescript` + `p/javascript`：125 条规则 × 121 个 git 跟踪文件 → **0 findings**；② 补轮 `p/owasp-top-ten` + `p/sql-injection` + `p/command-injection` + `p/jwt` + `p/nodejs` + `p/expressjs` + `p/xss`：79 条规则 → **0 findings**。注意 `--config=auto` 在 `--metrics=off` 下会直接报错（"Cannot create auto config when metrics are off"），须用具体规则包。
- **人工复核（semgrep 之外的补充，因为扫描仅限 git 跟踪文件）**：
  - **SQL 注入面 = 0**：全 `server/` 目录仅 1 处模板字符串插值，是登录限流提示文案（`login.post.ts:22`），**无任何 SQL 语句用 `${}` 拼接**；`db.ts` 的 `query()`/`execute()` 分别走 `pool.query(sql, params)` / `pool.execute(sql, params)`，后者为预编译语句，参数一律 `?` 占位。
  - **认证/会话**：`auth.ts` 用 HMAC-SHA256 签名会话 + `timingSafeEqual` 恒时比较；会话 cookie `httpOnly`/`sameSite=lax`/HTTPS 下 `secure`；生产环境显式拒绝默认密钥 `dev-session-secret-change-me`；`assertSameOrigin` 对非 GET 请求做 Origin 同源校验（**允许无 Origin 请求**是刻意的 API 客户端兼容口径，已注释说明）。
  - **登录接口**：同账号+IP 5 次/分钟锁 15 分钟（进程内 Map）；用户名/密码错误返回同一文案（无用户枚举）；bcrypt 校验；成功/失败均写审计日志。
  - **公开端点** `server/api/trace.get.ts`：先 `^\d{32}$` 正则校验再查库，全部参数化；**唯一可提的风险是未加限流**——该接口公开且每次调用都会 `INSERT scan_log`，存在被刷日志/放大写入的可能（当前单实例、无防护，建议上线时在网关层限流）。另一处：登录限流用进程内 Map，**多实例部署时失效**（需外置存储），属部署注意事项而非当前缺陷。
  - **凭据**：`.env` 未被 git 跟踪（`.gitignore` 已含 `.env`/`.env.*`）；仓库内无生产密钥明文。`scripts/db-init.mjs` 内的 `admin123` 与 117 个 `_tmp-*.mjs` 里的 `admin123` 均为**演示/测试账号**，且 `_tmp-*` 已被 `.gitignore`（`scripts/_tmp-*`）排除，不会推送。
- **code-review-graph 审查**：MCP 服务未连接，改为直接读 `.code-review-graph/graph.db`（SQLite，123 nodes/788 edges/79 risk_index）。**注意该图数据构建于 2026-08-31 且路径全为另一台机器（`E:/wokeplace/...`），仅作参考、非本机现态**。安全相关节点 10 个，最高风险 `server/utils/db.ts::execute`（0.85，7 个调用方）、`server/utils/auth.ts` 系列（0.700，6 个函数）——三者已逐个人工复核，结论见上，无实际漏洞。次高 `auth.ts::requireBackendUser`（0.45）、`server/api/query/[code].get.ts::formatCode`（0.45，**该端点在本机不存在，属旧版路径**）。
- **交接文档过时项校正（8 个文件）**：`docs/handover/` 生成于 2026-09-10（`master@98a4a1c`/155 提交），多项已不实，按本机实测校正：
  1. **远程仓库**：由「无（`git remote -v` 为空）——最高优先级待办」改为已建立 `origin` = `https://github.com/Blue03150328/-----.git`（`master`/`feature--qd` 均已推送）。涉及 README 第 2 条、01 快照表与阻塞风险、03 §4.1、07 风险 1、08 P0-1 与 §6。
  2. **`tsconfig.json` 未跟踪**：已入库 → 07 风险 2、08 P2-2 标记 ✅。
  3. **dev 模式不可用**：已于 2026-09-11 实测推翻（`af33393` 修掉 xlsx 外置导致的裸盘符 ESM 500），改为 `scripts/dev-start.mjs` / `start-dev.cmd` 启动 + 计划任务 `NZ315 Dev Server` 托管；并强调「**服务自愈靠 `dev-service.mjs` 进程内守护循环，Task Scheduler 的失败后重启在本例不生效**」。涉及 01 §8/§9、03 §2/§8、04 依赖表、08 P2-1 与 P2-13。
  4. **环境实测值**：node `v24.18.0`→**v22.22.2**（WorkBuddy 托管、无系统级 Node、不在持久 PATH）、npm `11.16.0`→**10.9.7**、Windows `10.0.19045`→**10.0.26200**、工作副本路径 `E:\wokeplace\...`→`C:\Users\27475\Desktop\二维码管理`（旧机路径保留为"原始开发机"注记）。涉及 03 §3.1 与 §1 技术栈表、06 §6。
  5. **计数类**：提交 155→167、跟踪文件 128→148、`_tmp-*` 119→117、`PROJECT_LOG` 条目 64→70；07 §1 资产行、08 §三、02 头部同步。
  6. **npm wrapper「损坏」表述**：本机 npm 正常，旧记录 `E:\software\nodejs\...` 属另一台机器（本机无 E 盘，照抄必 `MODULE_NOT_FOUND`）→ 改为「直调 `node node_modules/nuxt/bin/nuxt.mjs` / `node node_modules/typescript/bin/tsc`，勿写死 npm-cli.js 绝对路径」。
- **修改文件**：`docs/handover/{README,01,02,03,04,06,07,08}.md`（8 个，仅文档）；`PROJECT_LOG.md`（本条目）；`AGENTS.md`（进度段）。
- **未改**：代码零改动（本轮为审查 + 文档），故未跑 tsc/构建；`scripts/` 未动。
- **给下一个 Agent 的提示**：① 交接文档是**快照**，`> 生成日期 …` 行保留历史口径，其下的「复核更新」行才是现态——改文档时请沿用这个双层写法，不要直接覆盖快照行；② semgrep 在 `--metrics=off` 时**不能用 `--config=auto`**；③ 该图 `.code-review-graph/graph.db` 路径属另一台机器、日期停在 2026-08-31，**引用前先确认是否需重建**。
### 2026-09-11 | 开发服务改为 Windows 计划任务常驻托管（根治「服务自己消失」）
- **背景与决策**：上一轮排查「合并后拉不起服务」时发现，用户的真实痛点是**服务没有任何守护**——由会话/终端派生的进程一结束服务就停（该项目历史里「建议用服务/计划任务托管」已被提过三次、一直未落地）。向用户列出 4 个方案（计划任务 / pm2 / 生产构建+反代 / 维持现状）后，用户选择**Windows 计划任务**。
- **架构（双层恢复，缺一不可）**：
  1. `scripts/dev-task-run.ps1` —— 计划任务的动作入口。**纯 ASCII**（PS 5.1 可能误读 UTF-8 中文脚本），所有路径从 `$PSScriptRoot` 推导；自己解析 node 绝对路径后调下一个脚本，并把拉起过程写入 `logs\dev-task-runner.log`。
  2. `scripts/dev-service.mjs` —— **常驻守护进程**（本轮恢复能力的真正实现）。内部 `for(;;)` 循环跑 dev 服务；子进程退出就重启，退避 3s→6s→…→30s；「存活 < 30s」计为快速失败，1 分钟窗口内达 5 次即放弃并退出 1（防重启风暴）；启动前主动清理跨版本残留缓存；端口已被占用则退出 0（不重复启动，避免与手动起的 dev 打架）。
  3. 计划任务「NZ315 Dev Server」—— 登录触发器（+30s 延迟）+ **1 分钟心跳触发器**，`MultipleInstances=IgnoreNew`、`ExecutionTimeLimit=PT0S`（无时限）、`Hidden`。心跳只在守护进程整个被杀时兜底；健康时任务实例一直 Running，心跳被 IgnoreNew 跳过、**不产生额外进程**。
- **三个必须记住的 Task Scheduler 陷阱（全部实测踩过）**：
  1. **`RestartOnFailure` 不覆盖本例**：它只在「任务计划程序启动不了任务」时生效。实测杀掉 dev 进程后 `LastTaskResult=0xFFFFFFFF`、`State=Ready`、`NextRunTime` 为空，服务一直没恢复 → 恢复能力必须做进进程内部。
  2. **省略 `-RepetitionDuration` → 重复永不触发**：导出 XML 是 `<StopAtDurationEnd>true</StopAtDurationEnd>` 且无 `<Duration>`，重复窗口长度为零（`NextRunTime` 恒空，极易误判「已配好」）。改用 `-RepetitionDuration (New-TimeSpan -Days 3650)`；`[TimeSpan]::MaxValue` 会被 schema 拒绝（HRESULT 0x80041318）。
  3. **重复拐在 LogonTrigger 上不排期**：登录触发器的重复从「登录那一刻」起算，注册任务时登录早已发生 → 窗口已过、`NextRunTime` 仍空。必须用**独立的 `-Once -At <近未来>` 触发器**做心跳。
- **环境关键事实（本机特有）**：`[Environment]::GetEnvironmentVariable('Path','User')` 与 Machine PATH **都没有 node**——只有 WorkBuddy 注入到它派生的进程里。所以计划任务**不能直接写 `node`**。`dev-task-run.ps1` 做三级兜底：PATH → 扫 `%USERPROFILE%\.workbuddy\binaries\node\versions\*\node.exe` 取最高版本（能扛住 node 升级换目录）→ `Program Files\nodejs`。实测解析结果：`C:\Users\27475\.workbuddy\binaries\node\versions\22.22.2-2\node.exe`。
- **验证（全部实测）**：
  - **进程归属**：从监听进程向上追 5 层 → `node(nuxt dev) → node(dev-service.mjs) → powershell → svchost → services`，**根在 Windows 服务**，不依赖任何终端/会话；任务 `State=Running`。
  - **心跳自愈**：把守护整个干掉、服务处于停止状态 → 心跳在排期的 **20:02:52 准点拉起**（`logs\dev-task-runner.log` 有对应时间戳），路由 `/`、`/login`、`/trace?code=1` 全 200。
  - **内部守护自愈**：只杀 dev 子进程（保留守护）→ **3 秒后**新进程接管，守护日志记 `dev 服务退出：code=4294967295 存活=29.8s` → `3s 后重启 dev 服务（连续快速失败 1 次）`。
  - **设置核验**：导出任务 XML 确认 `MultipleInstancesPolicy=IgnoreNew`、`ExecutionTimeLimit=PT0S`、`Hidden=true`、`StartWhenAvailable=true`、`RestartOnFailure(3/PT1M)`、双触发器（Logon +PT30S / Time `repInterval=PT1M repDuration=P3650D`）。
- **修改文件**：`scripts/dev-service.mjs`（新增）、`scripts/dev-task-run.ps1`（新增）、`scripts/install-dev-task.ps1`（新增，幂等可重跑，注册后自校验并在失败时明确报错而非假报成功）、`scripts/uninstall-dev-task.ps1`（新增）、`AGENTS.md`（常用命令段新增「服务托管」小节与 6 条操作命令；进度段新增本条；踩坑表新增 5 行——三个 Task Scheduler 陷阱 + node 不在 PATH + 「.ps1/.cmd 一律 ASCII」定规）、`PROJECT_LOG.md`（本条目）。
- **遗留问题/待办**：① 任务以「仅在用户登录时运行」（`InteractiveToken`）注册，**需用户登录后服务才可用**；若要求开机即可用（未登录也跑），须改为「不管用户是否登录都要运行」并保存密码，或改用 Windows 服务宿主（如 nssm）；② 本机**没有系统级 Node.js**，整套托管依赖 WorkBuddy 托管的 node——若日后卸载/迁移 WorkBuddy，需先装系统 Node 再重跑 `install-dev-task.ps1`；③ 心跳周期 1 分钟、时长 3650 天，十年后需重跑安装脚本（实际无影响）。
- **给下一个 Agent 的提示**：① **不要删掉 `dev-service.mjs` 的内部守护循环去「简化」成纯计划任务方案**——本轮已实测证明计划任务的失败重启不覆盖这个场景；② 排查「服务没了」先看 `logs\dev-guard.log`（守护与重启记录）与 `logs\dev-task-runner.log`（任务拉起记录），再 `Get-ScheduledTaskInfo` 看 `LastTaskResult`；③ 任何新增的 `.ps1`/`.cmd` 都遵守「ASCII + `$PSScriptRoot`/`%~dp0`」，这是本项目的路径含中文决定的硬约束。
### 2026-09-11 | 修正 dev-start.mjs 缓存新鲜度误报（不再拿 git 提交时间当参照）
- **背景**：上一条变更新增的 `scripts/dev-start.mjs` 用「缓存目录 mtime 早于参照时间」判定过期缓存，参照时间取了 `package.json`、`package-lock.json`、`nuxt.config.ts`、`.env` 与 `git log -1 --format=%ct` 的最大值。提交上一条修复后立刻复跑 `--check`，脚本报「无缓存残留」→「`node_modules/.cache` 早于**最近一次 git 提交**，属跨版本残留」。
- **问题**：这是**误报**。为了让 3100 端口服务恢复而重启 dev 时（缓存未做任何清理）实测：`Vite client built in 168ms`、`[nitro] √ Nuxt Nitro server built in 6010ms`，`/`、`/login`、`/trace?code=1` 全 200 —— 缓存完全正常。根因是**参照系选错了**：提交代码（尤其只改文档）根本不影响 Vite 依赖预构建的结果，拿 git 提交时间当参照会导致「每提交一次就报一次过期」，脚本会在使用者每次提交后被无意义地触发清缓存。
- **修复**：① `CONFIG_FILES` 收窄为 `package.json`、`package-lock.json`、`nuxt.config.ts` —— 只保留**真正决定依赖预构建结果**的文件；② **移除 git 提交时间作为参照**，并在代码注释中写明原因；③ `.env` 一并移出参照（它只影响运行时配置，改了重启即可、无需清依赖缓存）；④ 参照文件缺失（refTime 恒 0）时不做任何判定，避免误报。
- **验证**：① 修正后复跑 `--check` → `[OK] 缓存新鲜度正常`（误报消除）；② **反向验证检测能力未失效**——`touch -d "2026-05-01" node_modules/.cache` 后脚本仍正确报出「以下缓存早于「package.json」，属跨版本残留：node_modules\.cache」，随后 `touch` 恢复为正常。
- **修改文件**：`scripts/dev-start.mjs`、`AGENTS.md`（进度段与方法论处的逻辑描述同步改为「对比三个依赖/构建配置文件的修改时间，刻意不拿 git 提交时间当参照」）、`PROJECT_LOG.md`（本条目）。
- **给下一个 Agent 的提示**：**启发式判定的参照系必须与它要预测的失效原因同源**。这里要预测的是「Vite 依赖预构建缓存失效」，那就只能用依赖清单与构建配置当参照；把 git 提交时间混进去，等于把「所有代码变更」都当成「依赖变更」，必然误报。新增任何基于时间戳的启发式时，先问一句「参照物真的会导致这个缓存失效吗」。
### 2026-09-11 | 修复「合并后服务拉不起来」+ 新增启动体检脚本（scripts/dev-start.mjs + start-dev.cmd）
- **现象**：用户合并 PR #1（`56261b0 Merge pull request #1 from Blue03150328/feature--qd`）后，无法正常拉起服务。
- **排查过程（全部实测，非推测）**：
  1. 先看合并范围：`git diff 620261b 56261b0 --stat` → **只改 3 个文件**（`app/pages/admin/products/index.vue`、`server/api/admin/products.post.ts`、`server/api/admin/products/[id].patch.ts`，共 11 增 6 删）；`git diff ... -- package.json` **空**；12 个直接依赖全部存在于 `node_modules`。→ **合并本身不会导致拉不起来**。
  2. 复现启动失败：按 AGENTS.md 记录的 `node "E:\software\nodejs\install\node_modules\npm\bin\npm-cli.js" run dev ...` → `Error: Cannot find module 'E:\software\nodejs\install\...\npm-cli.js'`。查证 **本机不存在 E 盘**（`ls E:/software/nodejs` → No such file），该绝对路径属**另一台开发机**（交接文档记录的 Node v24.18.0 / npm 11.16.0 那台）；本机 `which node/npm` 指向 `C:\Users\27475\.workbuddy\binaries\node\versions\22.22.2-2\`，`npm --version` = **10.9.7 正常**。→ 照抄文档里的旧路径必然 MODULE_NOT_FOUND。
  3. 绕过 npm 直调 `node node_modules/nuxt/bin/nuxt.mjs dev --host 0.0.0.0 --port 3100` → 能起，但**卡死在 `i [optimizer] scanning dependencies...`**（等待 100s+ 无进展），此时 Nitro 端口已监听、上游 Vite 未就绪 → `curl /`、`/login`、`/trace?code=1` **全部 502**。
  4. 清理 `.nuxt` + `node_modules/.cache` + `node_modules/.vite` 后重启 → `√ Vite client built in 147ms`、`[nitro] √ Nuxt Nitro server built in 12288ms`，**`/` 200、`/login` 200、`/trace?code=1` 200、`/admin/products` 302（未登录跳转，符合预期）**，页面标题实测渲染正确（`登录 - 农资315`、`农资315 - 农药追溯查询`、`追溯查询 - 1... - 农资315`）。
- **根因（两条，均与环境/缓存有关，与合并无关）**：① **npm 路径照抄旧文档**（该文档路径机器相关，本机无 E 盘）；② **`.nuxt` / `node_modules/.cache` 是合并前旧世界的缓存**，与新的 vite 配置不匹配，Vite 依赖优化器卡死 → Nitro 已监听但上游未就绪 → **全站 502**。
- **顺带推翻两条长期过时记录**：① 文档原写「**dev 模式在本机不可用**（Nitro 2.13.4 + Node 24 + 中文路径），开发验证须退回生产构建 + node .output/server/index.mjs」——**实测 dev 模式完全可用**（Node 22.22.2 + 中文路径 `Desktop\二维码管理`），原 `file://E:/` 裸盘符 ESM 500 已由提交 af33393（xlsx 改内联依赖，Nitro 不再外置）修掉；② 认证链路复核通过：`POST /api/auth/login`（admin/admin123）→ **200 且签发 `Set-Cookie: nz315_user=...; Max-Age=604800; HttpOnly; SameSite=Lax`**，错误密码 → **401**，带该 Cookie 请求 `GET /api/auth/me` → **正确返回 `{id:1, username:"admin", role:"platform_admin", name:"系统管理员"}`**。
- **说明（非 bug）**：登录接口响应体里的 `user` 字段恒为 `null`——`login.post.ts` 先 `setAuthCookie` 再 `getCurrentUser(event)`，而 `setCookie` 只写响应头、不会回写 `event` 的请求 Cookie，故同一请求内读不到。**前端不受影响**：`app/composables/useUser.ts:41` 登录后立即 `await refresh()` 重新拉 `/api/auth/me` 拿用户态，响应体里的 `user` 仅作 refresh 失败时的兜底回填。属既有行为，本次未改动。
- **产出**：
  - `scripts/dev-start.mjs`（新增，一体两用）：`--check` **只读体检**——Node 版本 / npm 可用性 / **3100 与 3000 端口占用 + PID** / 12 个直接依赖完整性 / `.env` 键名（**只报键名与默认值，绝不打印任何值**）/ **缓存新鲜度**（用 `.nuxt`、`node_modules/.cache`、`node_modules/.vite` 的 mtime 对比 `package.json`、`package-lock.json`、`nuxt.config.ts`、`.env` 与 `git log -1 --format=%ct` 的最大值，早于参照即判「跨版本残留」）并输出「结论 + 修复建议」；无参则体检后**自动清理过期缓存并启动**；`--clean` 无条件清缓存；`--port` 换端口。退出码：有阻塞问题 = 1。
  - `start-dev.cmd`（新增，根目录双击即启）：**纯 ASCII 包装**，只做 `cd /d "%~dp0"` + `where node` 检查 + 调 `scripts\dev-start.mjs`，**中文提示全部交由 Node 输出**——刻意规避 cmd 读取 UTF-8 中文脚本文稿的编码风险（本项目路径本身含中文「二维码管理」，`.bat/.cmd` 内混写非 ASCII 有踩坑风险）。
  - `AGENTS.md`：常用命令表新增启动器与体检脚本两行；**修正 3 处过时记录**（npm wrapper 的 E 盘路径 → 标注机器相关并给出本机真实路径；dev 模式不可用 → 划删并写明实测结论与修复提交；npx/npm 备用命令 → 去掉写死绝对路径的写法）；**踩坑表新增 2 行**（「合并/切分支后卡 scanning dependencies / 全站 502」的完整解法；「npm 路径与启动类问题先跑 dev-start.mjs --check」）；项目进度段标题改 2026-09-11 并新增本条。
  - `PROJECT_LOG.md`：本条目。
- **验证情况**：`--check` 实跑输出完整结论；**过期缓存检测分支专项验证**——把 `.nuxt`、`node_modules/.cache` 的 mtime 用 `touch -d "2026-08-01 10:00:00"` 改旧后，脚本正确报出「以下缓存早于「package.json」，属跨版本残留：.nuxt、node_modules/.cache」，随后 `touch` 恢复并复查为「正常」；服务健康度在全部折腾后复测仍为 `/` 200、`/login` 200、`/trace?code=1` 200。
- **遗留问题/待办**：① 开发服务目前仍以**会话内后台进程**方式驻留（PID 见体检输出），会话结束即消失——如需长期驻留，建议用 Windows 服务或计划任务托管（旧记录 bc33660 条目也提过同一建议）；② 本机无系统级 Node（只有 WorkBuddy 托管版 22.22.2），若日后要在**普通 CMD 窗口**手动跑，需先确认 `node` 在 PATH 中；③ `.env` 有意不配 `DB_HOST`（代码默认 127.0.0.1），体检脚本已将其列为「可选键」而非缺失项。
- **给下一个 Agent 的提示**：① **启动类问题第一步永远是 `node scripts/dev-start.mjs --check`**，一次列全环境、端口、依赖、缓存四个维度，避免逐个试错；② **AGENTS.md 里的绝对路径都可能机器相关**（本项目经历过至少两台开发机：E 盘那台 Node 24 / 本机 Node 22），照抄绝对路径前先验证存在性；③ **「服务起不来」≠「代码坏了」**：本轮合并只动 3 个前端/接口文件却表现为「全站挂」，实为**缓存失配 + 错误路径**，排查时应先看进程是否监听、再 curl 真实路由拿状态码（502 = Nitro 活着但上游 Vite 没就绪，是缓存问题的特征码），而不是先怀疑业务代码。
### 2026-09-11 | 新增 UI 改版提示词手册（docs/UI改版提示词.md）
- **需求**：用户认为现有界面「不够简约舒适、AI 味有些浓」，希望得到**用于指导 AI 修改 UI 的提示词**（方法论 + 可直接复制的提示词），而非直接改代码。
- **调研方式（实测，非主观判断）**：① 通读 `app/assets/css/main.css` 全量令牌（`--ui-*` 映射 + `--b-*` 中后台设计语言，圆角 0.375rem、主色 hsl(142 32% 30%)）；② 逐张查看 `screenshots/` 下首页/扫码结果/登录/后台概览 4 张实况截图；③ 全库 grep 定位 AI 味写法的**具体出处**：`grep gradient` 命中 `index.vue:41`（`bg-gradient-to-br from-primary to-emerald-600` + `shadow-lg shadow-primary/30`）、`TraceAlert.vue:73`（`cfg.gradient` 三态各一套渐变）、`scan.vue:253`（扫描线动画，属功能性保留）；`grep 十六进制色值` 发现 `nearby-stores.vue` 自成一套色板（#f8f9f4/#2c5c3a/#e67e22）、`admin.vue` 硬编码侧栏 #283850 与内容区 #f0f2f5。
- **产出**：`docs/UI改版提示词.md` —— ① §1 诊断表（7 条病灶，每条附具体文件行号与「为什么像 AI 生成」）；② §2 提示词六要素方法论（角色参照系 / **负面清单** / 数值化约束 / 令牌唯一来源 / 变更红线 / 可验收产出）；③ §3 可直接复制的 5 段提示词（通用开场 + 公众端首页 + 扫码结果组件 + 后台 + 登录页），每段含问题描述、带数值的具体要求、红线、产出要求；④ §4 执行顺序表（令牌先行 → 登录页校准 → 扫码页 → 首页 → 后台 → 全局 grep 复查）与 3 条每轮必问 + 4 条可量化验收标准；⑤ §5 模型审美回潮的补救话术。
- **核心结论（供后续改版直接引用）**：后台已有 `.b-*`（Element Plus 口径）克制设计语言，**问题集中在公众端 H5 页面 + 令牌未被统一遵守**；「AI 味」可归纳为 7 类可枚举写法，其中渐变、彩色阴影、`rounded-2xl`、彩色圆底图标为头号特征。
- **修改文件**：`docs/UI改版提示词.md`（新增）、`PROJECT_LOG.md`（追加本条）
- **测试情况**：本文件为文档，无代码逻辑改动，未涉及构建与测试；文中所有文件路径与行号均已通过 grep/read 实测核对。
- **遗留问题/待办**：本次**未实际修改任何 UI 代码**，改版尚未执行；用户后续按手册提示词逐页推进时，需注意工作树可能存在的并行线未提交改动（`tsconfig.json` 未跟踪、`package.json` 的 @types/node 等），提交时遵循「不混合主题」契约。
- **给下一个 Agent 的提示**：① 改版**务必逐页**提交，且严格只动样式与模板结构——本项目接口契约变更频繁（见下方历史记录），UI 改版最易误伤字段名与 props 契约；② 令牌唯一来源为 `main.css`，改版第一步应是补齐令牌而非直接改页面；③ 改完用 `grep gradient` 与 `grep #[0-9a-fA-F]{6}` 做漏网复查。

### 2026-09-10 | 新增项目交接文档包（docs/handover/ 10 篇）+ 交接体检脚本
- **需求**：项目要交给另一位开发者对接，需要一份能让对方**快速了解项目现状**的资料：① 项目总览；② 最新需求；③ 技术文档（技术栈/架构/环境清单/Git 地址/分支规范/提交规范）；④ 第三方依赖（SDK、短信/OSS 等接口、版本号、坑点）；⑤ 数据库说明（核心表结构、关键字段、存储过程/触发器、重要业务表 ER 图）；⑥ 系统账号与资源清单；⑦ 项目资产清单；⑧ 待办清单。
- **产出**（全部落 `docs/handover/`）：`README.md` 索引（阅读顺序/5 分钟上手/必须知道的 6 件事）、`01-项目总览.md`、`02-最新需求.md`、`03-技术文档.md`、`04-第三方依赖.md`、`05-数据库说明.md`、`05-ER图.mmd`（Mermaid ER 图源码）、`06-账号与资源清单.md`、`07-项目资产清单.md`、`08-待办清单.md`；另新增可复用体检脚本 `scripts/handover-audit.mjs`（只读：打印 `.env` 键名与值长度、15 张表实际行数与占用、存储过程/函数/触发器/视图数量、业务数据基线）。总览与资产两份文档同步在根 `README.md` 文档索引表加了入口。
- **调研方式（全部实测，非文档转抄）**：① `git`：155 提交 / 128 跟踪文件 / HEAD `98a4a1c` / 单一分支 master / **remote 为空** / 工作树 3 改 1 未跟踪；② 运行态：3100 端口服务在跑（`/login` 200、`/trace?code=…1001` 200）、`.output` 12.2MB、Node v24.18.0 / npm 11.16.0 / MySQL 8.0.46（服务 MySQL80）；③ 数据库 `information_schema` 全量核对：表/索引/列/行数/占用、外键与例程统计；④ `package-lock.json` 逐包取实装版本；⑤ 代码走查：`server/utils/*`（11 个工具模块）、**62 个 API 端点**、11 个后台菜单、4 个设置 Tab、微信/高德端点。
- **实测发现（已写入交接文档，均为本次新识别）**：① **库内多一张遗留表 `agro_store`**（门店模块 557b13a 删除后表未清，3 条演示门店数据，零代码引用）——db-init 只建 14 张，实际库 15 张；② **`tsconfig.json` 未被 git 跟踪**（新克隆环境无法执行 tsc 类型检查）；③ **`git remote` 为空**——155 次提交零远程备份，属最高优先级风险；④ **数据库零外键、零存储过程、零函数、零触发器、零视图**（全部逻辑关联，一致性靠代码）；⑤ `.env` 有 10 个键、`DB_HOST` 未设（走代码默认 127.0.0.1）、`NUXT_PUBLIC_AMAP_SECURITY_CODE` 未配；⑥ **短信与 OSS 完全未接入**（全库 grep 关键字零命中，备份仅本地 mysqldump 且硬编码 Windows 路径）；⑦ README 与现状漂移（表数 13、后台 14 模块、H5 质检/查询记录展示等表述已过时）。
- **修改文件**：`docs/handover/`（新增 10 个文件）、`scripts/handover-audit.mjs`（新增）、`README.md`（文档索引表加一行）、`AGENTS.md`（进度段：标题日期改 2026-09-10 + 新增本条进度）
- **测试情况**：体检脚本实跑通过（输出 .env 键清单 10 项 / 15 张表行数与占用 / 0 触发器）；引用核对：`docs/handover/README.md` 内 10 条相对链接与文件名逐一对应；`README.md` 新增链接指向存在的文件；Mermaid ER 图语法按 `erDiagram` 规范书写（实体属性 `type name [PK|FK|UK] "注释"`、关系 `||--o{` 与 `}o..o{`），可在 VS Code / GitHub / mermaid.live 渲染
- **遗留问题/待办**：见 `docs/handover/08-待办清单.md`（P0 上线阻塞 9 项：建远程仓库、生产环境/备案/证书、D1 亿级方案决策、微信网页授权域名、高德 key 白名单、安全清单、真机扫码验证、备份自动化+OSS、上线验收）；本次**未**提交并行工作线的工作树改动（`package.json`/`package-lock.json` 的 `@types/node`、`alerts/[id].patch.ts` 空行、未跟踪的 `tsconfig.json`），遵循「不混合主题」提交契约
- **给下一个 Agent 的提示**：① 接手请按 `docs/handover/README.md` 的顺序读（AGENTS.md → 8 篇交接文档），**该目录是「现状快照」，随代码演进需同步更新**；② `node scripts/handover-audit.mjs` 可随时复跑核对环境与数据基线；③ 交接文档中的「差异清单」（02 文档 §5）列出 PRD 与现状不一致的全部条目，**照 PRD 原文实现前先看这一节**

### 2026-09-10 | 修复修正弹窗「批号已存在必 500」（用户实测修正一直失败）
- **现象**：用户在码库管理上传批次列表点【修正】，想把「生成入库」的码绑定生产批次，一直提示修正失败（页面 toast 为 Server Error / 修正失败）。
- **排查**：先确认服务状态（诊断时 3100 无监听、无服务进程——已一并重启）；再用临时批次复现修正弹窗的全部提交路径：新建批次(新批号) 200 / 绑定已有批次 200 / 仅字段修正 200 / 空 body 400（预期）/ **批号已存在 → 500**。服务端日志给出铁证：H3Error: Duplicate entry '1-2026080101' for key 'batch.uq_product_batch' + sql: INSERT INTO batch ...——本应命中「批号已存在 → 校验一致则归并」分支，却执行了 INSERT。
- **根因**（提交 bc33660）：correct.post.ts 第 71 行 const [exist] = await query(...)——项目封装 query() 返回**行数组本身**（utils/db.ts: query() { const [rows] = await pool.query(); return rows }），解构后 exist 是**首行对象**；随后 if (exist && exist.length > 0) 中 exist.length 恒为 undefined → 条件恒 false → **批号已存在也走「自动建档」INSERT → 唯一键冲突 → 500**。该写法是从 import.post.ts 抄逻辑时把 conn.query（返回 [rows, fields] 二元组，解构正确）换成了封装 query() 而未同步调整解构方式。
- **修复**：①const exist = await query(...) 整体接收行数组（命中分支恢复：一致→归并绑定；不一致→400 中文提示回显库内值）；②自动建档 INSERT 增加 ER_DUP_ENTRY 兜底 → 并发竞态下返回中文 400 而非 500 堆栈；③**全库扫描同类风险**（脚本按「const [x] = await query 后把 x 当数组用」模式扫描 server/）：仅此 1 处，其余 60+ 处均为正确的「解构取首行后访问字段」。
- **验证**：tsc 0；构建 12.2MB；**API 5/5**（新批号建档 200 batchCreated=true / 批号已存在+要素不一致 400「批次 X 已存在，生产日期/合格证号不一致（库内 …），请核对」 / 批号已存在+要素一致 200 batchCreated=false rebound=5 且 batch 表无重复行 / 码 status 置 2）；**CDP 6/6**（修正弹窗打开→开启「新建批次并绑定」→填已存在批号见中文提示且页面无 Server Error→改填新批号「绑定完成…绑定 3 条」→库核验）；验证数据清理恢复基线 104。脚本 scripts/_tmp-verify-correct-fix.mjs、scripts/_tmp-cdp-correctfix.mjs 可复用。
- **遗留问题/待办**：①批量修正工具（batch-correct.post.ts，勾选码走 batchId 通道）与单行修改（[id]/correct.post.ts）经复核为 const [x] = await query 取首行的正确用法，无同类问题；②诊断时发现 3100 服务未运行（本轮已启动），如需长期驻留建议用服务/计划任务托管，避免用户操作时后端不可用。
- **给下一个 Agent 的提示**：①**本文件与 import 的差异点就是踩坑源头**：import 用 conn.query（[rows,fields]）而本文件用封装 query()（行数组），抄逻辑换 DB 封装时必须同步改解构方式；②排查「页面操作失败」先看**服务端日志堆栈**（前端 toast 往往只有「Server Error/失败」无信息量），再按提交路径逐一复现（本次 5 条路径一次定位）；③query() 取单行用 const [row] = await query(...)，取多行**不要解构**。

---
### 2026-09-10 | 清零 tsc 存量类型错误 9 处（企业删除断言 + 规格导入 8 处）
- **背景**：AGENTS.md 待办记录「并行线遗留 9 个 tsc 存量错误待处理」——全量 typecheck 复现 9 处错误（1 处在企业删除 API、8 处在规格 Excel 导入 API），均为 `noUncheckedIndexedAccess` 与 mysql2 `QueryResult` 联合类型所致，构建与运行不影响但破坏 tsc 0 基线。
- **修复**：
  ① **enterprises/[id].delete.ts（TS2339）**：`conn.query` 返回 `QueryResult` 联合类型（`RowDataPacket[] | ResultSetHeader`），DELETE 运行时实为 ResultSetHeader，补 `as unknown as [{ affectedRows: number }, unknown]` 断言取 affectedRows（与 `upload-batches/[id].delete.ts` 同范式）。
  ② **specs/import.post.ts（8 处）**：`wb.SheetNames[0]` 可能 undefined → `?? ''` + **空工作表守卫**（新增「Excel 中没有工作表」400，比断言更健壮）；正则捕获组 `m[1..3]` 可能 undefined → `?? 0` / `?? ''` 兜底；`maxSpecCodeNum(fid)` 参数 `fid: number | null` → `as number` 断言（上游 38-40 行已校验非空）；`finalOk[i]` 数组索引可能 undefined → `!` 断言（循环条件已保证 i < length）。
- **修改文件**：server/api/admin/enterprises/[id].delete.ts、server/api/admin/specs/import.post.ts
- **测试情况**：**tsc 0 错误**（`.nuxt/tsconfig.json` 与根 `tsconfig.json` 双配置均通过）；生产构建 12.2MB 成功；运行时回归脚本 `scripts/_tmp-verify-tcfix.mjs` **7/7 全过**——构造 xlsx（2 合法 + 1 格式错）上传，返回 success=2/failed=1 且失败明细行号=4、原因精确；新建规格查得并全部清理（库内无残留）。提交 2f58241
- **遗留问题/待办**：工作树存在**并行线未提交改动**（`package.json`/`package-lock.json` 新增 `@types/node`、根 `tsconfig.json`、`alerts/[id].patch.ts` 空白行）——按提交契约「不混合主题」未纳入本次提交，由并行线自行提交
- **给下一个 Agent 的提示**：①mysql2 事务内 `conn.query` 取 affectedRows 必须断言（`conn.execute` 同样适用）；②`noUncheckedIndexedAccess` 下正则捕获组与数组索引均可能 undefined，项目范式是 `?? 兜底`（见 useQrScanner）或守卫；③修复含反引号转义的 SQL 行时，`old_string` 必须含文件里真实的反斜杠（grep 的 JSON 输出可确认）；④类型检查命令：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
### 2026-09-10 | 追溯码上传支持扫码链接与 CSV 清单（智能提取 32 位码，提交 36536c2）
- **问题**：用户拿桌面 `PD20040767_25%多·酮可湿性粉剂_100_20260910_urls.txt`（生成页导出的 urls 文件，每行 `https://www.nz315.cn/trace?code=32位码`）上传「追溯码上传」页必解析失败——该页只认纯 32 位数字码；而生成页导出三种文件（纯码 TXT / urls 链接 / sn 清单 CSV），用户根本不知道该挑哪一种，属高频易用性障碍。
- **修复**（`server/utils/code-validator.ts` 的 cleanLine 升级为「智能提取」，parse / import / stock-in 三入口同源生效）：
  ① 优先取链接中的 code 参数（兼容 `?code=` / `&code=` / `#code=`，大小写不敏感）；
  ② 整行剥离引号/逗号/空白/BOM 后为 32 位纯码；
  ③ 行内独立 32 位数字串（CSV sn 清单首列、带前后缀表格导出），边界断言 `(?<![0-9])…(?![0-9])` 防从更长数字串截取；
  ④ 表头行（含 `sn`/农药名称/登记证号等关键词且提取不到码）静默跳过，不计入失败——避免上传 CSV 时看到「1 条失败」；
  ⑤ 失败文案「非32位数字」→「未识别到 32 位追溯码」；
  ⑥ 采集页格式说明/输入占位符/校验规则 note 同步更新（明示支持链接与 CSV）。
- **修改文件**：server/utils/code-validator.ts、app/pages/admin/collection/index.vue
- **测试情况**：tsc（本文件）0 错误；构建成功 + 重启 3100；**用户真实 urls 文件 100 行**解析 total=100 且提取正确（其码已在库 → 100 条「重复码」，恰证明格式识别成功而非格式错误）；**混合格式文件 8 行**（纯码 / 无 s 链接 / 参数在后 / 引号包裹 / CSV 行含 URL / CSV 表头 / 非法链接 / 无码文本）→ 5 通过、表头静默跳过、2 条非法如实失败；**urls 变体 5 条 import 全链路**（含完整链接的行直接导入 → 自动建档 T09261002 + 绑定 status=2）后清理恢复；**CDP 页面级 5/5**（真实文件识别为 100 条重复码、变体文件 10/10 通过并自动匹配产品、页面文案已更新）
- **遗留问题/待办**：①用户那 100 条码今天 13:52 已通过「入库留档」入库（upload_batch id=20「生成入库 2026-09-10 13:52」、状态未绑定），后续正确操作是码库管理该行【修正】→「新建批次绑定」；②**并行工作线遗留 9 个 tsc 存量错误**（server/api/admin/enterprises/[id].delete.ts affectedRows 类型、specs/import.post.ts 多处 noUncheckedIndexedAccess）——非本轮引入，未擅自修改，待并行线处理；③当前演示/测试基线：trace_code=104（用户 100 条生成入库 + 演示 4 条）、batch=1（2026080101）、upload_batch=2
- **给下一个 Agent 的提示**：cleanLine 是 parse/import/stock-in 三入口共用的码提取器，任何格式扩展都改这一处即可三端生效；表头跳过依赖 HEADER_HINT 关键词，新增导出格式若带新表头词需同步补充；用户上传"解析失败"类反馈先抓真实文件看格式（本次即 urls 链接格式）

---


### 2026-09-10 | 修复操作日志筛选变化后组内明细缓存未失效（展示旧筛选口径数据）
- **问题**：`logDetailMap` 缓存仅按 entId 索引、**不含筛选签名**。复现路径——筛选 module=系统设置 → 查询（filtered 态自动展开命中组并缓存该口径明细）→ **清空筛选再查询**（filtered=false 不触发自动展开 watch）→ 已展开组继续展示**旧筛选口径**的明细，与全量列表口径不一致（用户会看到「列表是全量、明细却只有系统设置」）。
- **修复**：新增 watch 监听全部筛选条件（keyword/module/action/result/dateFrom/dateTo），条件变化即 `logDetailMap = {}` 并折叠展开态（与【重置】行为一致，避免「缓存已清但组仍展开」的空白中间态）；查询后筛选态仍按原逻辑自动展开命中组。
- **修改文件**：app/pages/admin/settings/index.vue
- **测试情况**：tsc 0 错误；生产构建 12.1MB；**CDP 14/14 全过**（初始无展开明细 → 手动展开出现子表 → 改筛选项即失效 → 查询后自动展开命中组 → 清空筛选后折叠 → 再筛选「系统设置」时明细仅含系统设置（口径正确）→ 清空后重新展开为全量口径（含登录等其它模块，证明缓存已失效）→ 零 JS 异常）；脚本 scripts/_tmp-cdp-logs-cache.mjs 可复用。提交 7f852fa
- **遗留问题/待办**：见 AGENTS.md 待办段；同面板 users 分组无此问题（用户明细随分组行一次性返回，无独立缓存）
- **给下一个 Agent 的提示**：①嵌套明细类缓存（按 id 索引）必须在筛选条件变化时失效——否则「筛选→展开→清空筛选」会残留旧口径数据；②CDP 验证日志面板时，「最新 10 条恰好全是某模块」属正常数据分布，断言口径应看「明细是否发生切换」而非固定模块关键词
### 2026-09-09 | 操作日志按厂家/平台分组（一行=分组；展开明细；组内可独立分页）
- **需求**：①日志按厂家分组展示（一行=一个厂家，平台日志单独一组并标注）；②分组行=厂家名+日志总条数；③点行展开/折叠明细（操作时间/操作人/模块/操作/内容/IP/结果全保留）；④筛选区全部保留（操作人/模块/内容、模块下拉、操作类型、结果、日期起止），检索命中分组自动展开；⑤外层分页=分组分页、展开明细内部可分页、风格一致；⑥前后端同步。
- **后端**（logs.get.ts 重写，双模式）：①分组列表（无 entId）——{ total(组数), totalLogs(过滤后总条数), filtered, page, pageSize, rows:[{ id(0=平台), name(平台组='平台操作'), log_count(全量口径=该厂家日志总条数), hit_count(过滤口径) }] }：无条件=enterprise 全量+平台组（platform_admin）；筛选=GROUP BY 命中组（keyword/module/action/result/日期与改造前完全同口径）；外层分页=组。②组内明细页（entId & dPage & dPageSize）——该组过滤后明细 ORDER BY id DESC 分页，**内部可分页**；企业账号请求他组明细由企业过滤 conds 兜底（空）。踩坑修复：GROUP BY 多行被 [x] 解构成单行 → not iterable；COUNT 单行 [cnt] 后又用 cnt[0].c → 0。
- **前端**（settings 操作日志面板）：外层表 3 列（分组名+平台 tag/日志总数/展开收起）与用户权限页同构；展开行内嵌 b-table 7 列明细（原行渲染）+ **组内独立分页条**（每页 10，每组 logDetailMap 缓存、请求序号防旧响应覆盖）；expandedLogEnts Set 展开态；watch(logData) filtered 自动展开全部命中组并拉各自明细首页；重置=清筛选+全折叠+清明细；统计『N 个分组 · M 条日志』+『已筛选/命中 N 条』徽标；buildLogQuery() 公共参数构造（分组列表与明细分页同筛选口径）。
- **修改文件**：server/api/admin/logs.get.ts（重写）、app/pages/admin/settings/index.vue（日志面板 +213/-51）
- **测试情况**：tsc 0；构建 12.1MB；API 8 场景——无条件 3 组（企业1 123/企业2 0/平台操作 451+）、module=系统设置 命中 2 组 totalLogs 27、明细 total 123 p1/p12 各 10 行、平台组明细 451、keyword=admin 平台组 413、厂家仅本企业、lvfeng 越权查企业2 空、entId 非法 400；CDP 16/16——分组行与平台 tag/统计文案/展开明细 10 行字段齐全（操作时间/操作人/模块/操作/内容/IP/结果）/组内翻到第 2 页/模块下拉筛选命中两组自动展开+命中徽标/重置折叠还原 3 组/厂家视角仅本企业+明细加载/零 JS 异常。提交 1d68190
- **遗留问题/待办**：①日志分组无条件含 0 条企业组（企业2），如需仅显示有日志分组可加参数；②其余待办不变
- **给下一个 Agent 的提示**：①logs 接口契约已变：无参=分组结构；entId&dPage 参=组内明细分页，消费方注意区分；②明细页每页 10（LOG_DETAIL_SIZE 前端常量），后端 dPageSize 上限 100；③平台组 id=0 语义与 users 接口一致（enterprise_id IS NULL）；④label 定位用严格 ===（复合 label『操作人 / 模块 / 内容』含模块二字会干扰 includes 匹配）；⑤CDP 脚本 scripts/_tmp-cdp-logs-grp.mjs 可复用

---
### 2026-09-09 | 厂家续费状态与删除厂家（用户权限页）：续费到期禁登录 + 删除厂家级联清账号
- **需求**：①厂家分组行【删除厂家】（二次确认 + 级联清除该厂全部账号）；②厂家行【续费状态】字段（有效期内/到期未续费）；③续费到期未缴费→该厂全部账号禁止登录与使用系统；④默认折叠/筛选保留/原有账号操作不变；⑤前后端同步。
- **数据**：enterprise.renew_expire DATE（续费到期日；NULL 或早于今天=到期未续费）——db-init DDL、migrate() 幂等补列（AFTER qualification_expire）、seed 企业2 过期值演示；存量库 ALTER+赋值（企业1=2027-12-31 演示有效、企业2=2026-08-01 到期）。
- **后端**：login.post.ts——厂家账号（enterprise_id 非空）登录校验所属企业 status=1 且 renew_expire>=CURDATE()（SQL CURDATE 口径防时区漂移），否则 403（区分『企业已被平台停用』/『服务已到期未续费』文案，限速计数不触发）；auth.ts requireBackendUser 同步校验（7 天会话可能跨到期点，保证『到期即不可用』对已登录会话同样生效）；users.get.ts——组行返回 renew_expire/renew_status/renew_label/can_delete + keyword 双通道（账号信息 OR 厂家名称 LIKE，名称命中整厂返回，组内明细仍按 role/status 过滤）；新增 DELETE /api/admin/enterprises/:id（requirePlatformAdmin；5 张业务表 product/product_spec/batch/upload_batch/trace_code 引用 UNION 检查→有数据 400 防孤儿；事务级联 DELETE user+enterprise；logOperation 审计）与 PATCH /api/admin/enterprises/:id/renew（platform_admin 登记/清空到期日；格式校验；审计）。注意：[id]/ 子目录路由端点 import 需 4 级 ../（rollup 构建期报 UNRESOLVED_IMPORT，tsc 查不出）。
- **前端**（settings 用户权限页）：外层表新增【续费状态】列——active=b-tag-success『有效期内』(title 续费至 X)/expired=b-tag-danger『到期未续费』(title 到期日)/平台组 '—'；厂家行操作列=展开收起+（总部非平台）续费设置+删除厂家；删除按钮 can_delete=false 置灰（外层 span title 提示业务数据），删除确认弹窗（trash-2 + 警示『级联清除 N 个账号不可恢复』+业务数据限制说明）确认后 DELETE+清展开态+空页回退+refresh；续费设置弹窗 date 输入（回填现值，清空=到期未续费）+保存 PATCH；平台组无管理按钮；厂家视角仅展示本企业状态只读。
- **修改文件**：server/api/auth/login.post.ts、server/utils/auth.ts、server/api/admin/users.get.ts、server/api/admin/enterprises/[id].delete.ts（新）、server/api/admin/enterprises/[id]/renew.patch.ts（新）、app/pages/admin/settings/index.vue、scripts/db-init.mjs（另建即弃 utils/ent-renew.ts 已删）
- **测试情况**：tsc 0；构建 12.1MB（首次构建失败=renew.patch.ts import 层级错，修复后过）；API 14 项——lvfeng 正常登录/组行续费字段（企业1 active、企业2 expired、平台 null、can_delete=false×2）/keyword=绿丰生物 厂家名命中/删除有数据企业 400 文案/续费设置 200 状态翻 active/还原/404/非总部 403/非法日期 400/临时过期 lvfeng 登录 403 文案精确/已登录会话业务接口 403/自建企业+账号删除 200 级联残余 0/0；CDP 28/28——状态 tag 双态/删除置灰与可点/删除弹窗警示确认级联+DB 复核/续费弹窗回填设期翻转 tag/清空还原/平台无按钮/厂家视角只读/零 JS 异常；上轮厂家分组回归 23/23。提交 b84844e
- **遗留问题/待办**：①续费到期提醒（到期前站内信/预警）未接，可与自动备份调度一并规划；②企业 status 禁用与 renew_expire 双开关并存（登录校验二者都拦）；③到期被拦的已登录会话，续费恢复后即自动可用（无需重登）；④演示数据基线偏差与 agro_store 残留表仍待用户拍板
- **给下一个 Agent 的提示**：①厂家账号登录/请求校验企业启停是两处（login.post.ts 与 auth.ts requireBackendUser），改动判定口径必须同步；②判定统一 SQL CURDATE()（dateStrings 下 'YYYY-MM-DD' 字典序可比），勿用服务器 UTC 日期（东八区凌晨差一天）；③删除厂家只拦 5 张业务主表（日志/消息等历史记录允许保留）；④users.get.ts 与 [id].delete.ts 的 ENT_REF_TABLES 同口径，加表需同步两侧；⑤CDP 脚本 scripts/_tmp-cdp-renew.mjs 可复用（自建企业3+用户后删除自清理）

---
### 2026-09-09 | 用户权限列表改为按厂家分组（一行=厂家 + 展开明细；筛选自动展开命中厂家；后端分组结构）
- **需求**：①列表按企业（厂家）分组，一行=一个厂家；②厂家行=厂家名称+用户总数；③点击行展开/折叠该厂家用户明细（登录名/姓名/手机号/角色/状态/操作按钮，即原平铺行信息）；④筛选查询区保留（登录名/姓名/手机号、角色、状态），跨全部厂家与下属用户检索，命中厂家自动展开；⑤【新增用户】保留且可选归属厂家；⑥重置密码/启用禁用逻辑不变；⑦外层分页=厂家分页、明细不单独分页、样式统一；⑧前后端同步改造。
- **后端**（server/api/admin/users.get.ts 重写）：返回 { total(厂家组数), totalUsers, filtered, page, pageSize, rows:[{ id(企业id), name, user_count(全量口径), users(带 roleLabel) }] }——权限不变（platform_admin 全量、可 ?enterpriseId= 限定单企业；enterprise_admin/code_admin 仅本企业一组）；**平台总部虚拟组 id=0**（enterprise_id IS NULL 的总部账号，如 admin，仅 platform_admin 视图出现、排最后）；无条件=enterprise 表全量（含 0 用户企业）；筛选态=命中用户所在企业去重、组内仅命中用户（keyword 内存过滤兼容原 LIKE ci 语义）；企业名/全量用户数一次查询映射；组内明细不分页。规模假设注释：初期用户量级小内存分组足够，量大改 SQL GROUP BY。
- **前端**（settings/index.vue 用户权限面板）：外层 b-table 改 3 列（厂家名称/用户总数/明细），厂家行整行可点（chevron 旋转）+ 右侧 展开/收起 按钮（@click.stop）；展开行 td(colspan=3, p-0) 内嵌 b-table 子表 7 列明细（平台账号行仍显示『总部账号』禁操作）；expandedEnts Set 管理展开（翻页/刷新/操作后保留）；watch(userData) 于 filtered 响应自动展开命中组（无条件不干扰手动展开）；重置按钮清筛选+清展开；筛选卡统计文案『共 N 个厂家 · M 个账号』+『已筛选』『命中 N 人』徽标。
- **修改文件**：app/pages/admin/settings/index.vue（+151/-64 用户面板）、server/api/admin/users.get.ts（重写 +111）
- **测试情况**：tsc 0；构建 12.1MB；API 7 场景——无条件 3 组（企业1×4/企业2×0/平台总部×1 admin）、keyword=王 命中企业1(lvfeng) filtered、role=code_admin 命中 3 人、status=0 命中禁用 op2、厂家 lvfeng 仅本企业 4 人、enterpriseId=2 仅企业2；CDP 23/23——3 厂家组渲染/行=名称+用户总数/默认折叠/展开显示 4 用户明细（角色状态操作齐全）/折叠展开往返/平台组 admin 只读无操作钮/筛选 codeop 命中自动展开仅 codeop+『命中 1 人』徽标/清空查询还原 3 组/op2 启用-禁用往返（toast+刷新后展开保留）/新增用户弹窗含两企业归属/厂家视角仅本企业组/零 JS 异常；DB 复核 op2 还原禁用。提交 5cdcf0c
- **遗留问题/待办**：①code_admin 也可访问用户列表（本企业只读语义注释但代码无 role 拦截、操作端点同样未禁 code_admin——既有权限边界未在本轮收紧，如需可另立任务）；②演示库含残留账号 op2（禁用）/lvop（测试改名）；③数据基线偏差与 agro_store 残留表仍待用户拍板
- **给下一个 Agent 的提示**：①用户列表接口契约已变：rows 从用户平铺 → 厂家分组（id=0 为平台虚拟组），任何消费 /api/admin/users 的地方需按新契约；②keyword 在内存过滤（原 SQL LIKE）——若未来用户量大（>数万）改回 SQL 侧过滤+分组分页；③CDP 计数厂家行按 innerText 含『个账号』特征过滤（展开子表用户行同为 tbody 直行，勿按 !querySelector(table) 判断）；④脚本 scripts/_tmp-users-api-grp.mjs（API）/ _tmp-cdp-users-grp.mjs（CDP，自还原 op2）可复用

---
### 2026-09-08 | 企业基本信息板块精简：删 官网/注册地址/简介 三项 + 落实 7 项必填（前后端同口径校验）
- **需求**：系统设置→企业信息（厂家单企业表单 + 总部入驻企业编辑弹窗两处）：①删输入项 企业官网/注册地址/企业简介（含后端对应代码）；②必填（带*）＝企业名称/统一社会信用代码/联系人/联系电话/法定代表人/农药生产许可证号/资质到期日，保存时前端+后端非空校验（为空禁提交并提示）；③单元识别码保留可空；④保存按钮保留，其余逻辑不变。
- **实现**：前端 settings/index.vue——entForm/watch 回填/openEntEdit 映射删三键；两处表单模板删三块输入并给 6 个 label 加红 *（企业名称原有）；新增 checkEntRequired（ENT_REQUIRED 常量，7 项 trim 判空）供 saveEnterprise/saveEntEdit 共用，缺失 toast「请填写：XXX」拦截。后端——enterprise.get.ts 与 factories.get.ts（列表显式列清单，此前 SELECT e.*）不再返回三列；[id].patch.ts：7 项必填校验（400「请填写：XXX」防绕过，厂家与总部同口径）+ UPDATE SET 去掉 website/address/description 三列（**DB 列保留**——存量值不受影响、前端不再提交故不会误清空）；**注意：PATCH 是全列覆盖式 UPDATE，删列≠删值——删列后这些列不再被写**。db-init 企业2 种子 INSERT 扩列（legal_person/license_no/qualification_expire）供新环境；存量库直改补齐：企业1 credit_code=91370100MA3C1KXQ3R，企业2 全部必填（=种子同值 李建国/农药生许(鲁)0061/2029-06-30）。
- **修改文件**：app/pages/admin/settings/index.vue（-3 输入块×2 表单 + 星号 + 校验函数）、server/api/admin/settings/enterprise.get.ts、server/api/admin/settings/enterprise/[id].patch.ts、server/api/admin/factories.get.ts、scripts/db-init.mjs
- **测试情况**：tsc 0；构建 12.1MB；重启 3100；API 8 项——GET/factories 行 keys 均不含三列、7 缺项逐一 PATCH 400 且 statusMessage 精确（请填写：统一社会信用代码/联系人/联系电话/法定代表人/农药生产许可证号/资质到期日/企业名称）、完整保存 200、带三字段 body 保存 200 且 DB 复核三列保持 NULL；CDP Edge headless 19/19——厂家表单无三字段标签与输入框（placeholder 校验）、必填 label 恰 7 个名单精确、单元识别码保留无星、空信用代码点保存 toast 拦截且无成功提示、恢复后保存成功；总部列表行信用代码新值显示、编辑弹窗同口径（必填 7/无三字段/含状态）、清空电话保存拦截且弹窗不关、恢复保存成功弹窗关闭；零 JS 异常；截图 .tmp-shot/settings-ent-req-lvfeng.png / settings-ent-req-admin.png。提交 bae1067
- **遗留问题/待办**：①DB 的 enterprise.website/address/description 列保留但不再维护（历史值不清）；②「扫码页展示的企业资料以此为准」文案仍在表单头（企业资料=必填 7 项+单元识别码）；③演示数据基线偏差与 agro_store 残留表仍待用户拍板
- **给下一个 Agent 的提示**：①企业资料现 8 字段：必填 7（名称/信用代码/联系人/电话/法人/许可证号/资质到期日）+ 可空 单元识别码；改必填口径须同步 settings 页 ENT_REQUIRED 与 [id].patch.ts requiredFields 两处；②PATCH 全列覆盖 UPDATE——未来若新增企业字段且非必填，前端不提交会置 NULL，需显式处理；③新增/编辑企业弹窗仍无【新增企业】入口；④CDP 脚本 scripts/_tmp-cdp-ent-req.mjs 可复用

---
### 2026-09-08 | 系统设置企业信息 Tab 按角色分流——总部=入驻企业列表+行内编辑弹窗；厂家保持编辑本企业资料
- **问题**：管理员（platform_admin，enterprise_id=NULL）打开 系统设置→企业信息 看到并可直接编辑的是「山东绿丰农药有限公司」（enterprise_id=1）的资料——根因 GET /settings/enterprise 对总部无 id 时回退 `user.enterprise_id || 1`（历史取巧），管理员误把某家租户当「自己」编辑。用户原话：该页应展示/编辑「使用我这套系统的企业（租户）」信息。
- **方案**（确认弹窗无应答，按推荐默认落地）：前端按角色分流，后端零改动（复用 `/api/admin/factories`=enterprise 表企业列表（platform_admin 专用，含 user_count 子查询）与既有 `PATCH /settings/enterprise/:id`（本就允许总部改任意企业含 status））。
  - **总部视角**（app/pages/admin/settings/index.vue）：渲染「入驻企业列表」卡（列：企业名称/统一社会信用代码/联系人/联系电话/状态 tag/账号数/入驻时间/操作），行【编辑】开弹窗（标题含企业名，表单=既有 11 字段全量回填 + 状态 USelect 启用/禁用），保存 PATCH 对应 id + 关弹窗 + refresh 列表；新 useFetch key `settings-ent-admin-list`（immediate: isPlatformAdmin，厂家不发请求）；行字段 snake_case→表单 camelCase 映射在 openEntEdit。
  - **厂家/码管理员视角**：原「企业基本信息」单企业编辑表单原样保留（含 resetPanel 回填语义）；重置按钮总部态改为刷新列表。
- **修改文件**：app/pages/admin/settings/index.vue（+237/-54）
- **测试情况**：tsc 0；生产构建 12.1MB；API 冒烟（factories 2 家含 user_count、lvfeng 单查=绿丰农药、admin PATCH 企业2 200）；CDP Edge headless 34/34——总部列表渲染 2 行/列头/行数据（电话 0531-88888888/王经理/启用/账号 4）、行编辑弹窗标题与全字段回填、状态下拉展开选「禁用」（中心坐标 Input.dispatchMouseEvent，reka 不吃合成事件）、改电话 13900001111+保存 toast+列表行实时更新（电话新值/状态禁用）、接口落库核验、API 还原企业1（0531-88888888/启用）后 DB 复核一致；lvfeng 本企业表单回填正确（input value=山东绿丰农药有限公司）；用户权限 Tab 新增用户-所属企业下拉展开含两家企业（回归）；全程零 JS 异常；截图 .tmp-shot/settings-ent-edit.png、settings-ent-lvfeng.png。提交 9df421f
- **遗留问题/待办**：①企业信息 Tab 无【新增企业】入口（入驻开通流程未做，如需另立）；②enterprise.status 禁用目前仅展示性（登录校验走 user.status，禁用企业不联动冻结其账号——如需要另设计）；③其余待办不变（数据基线偏差与 agro_store 残留表待用户拍板，见自检报告）
- **给下一个 Agent 的提示**：①总部列表数据源=/api/admin/factories（命名历史遗留，实际是 enterprise 表列表+user_count，勿误当 pesticide_reg 厂家接口）；②GET /settings/enterprise 总部回退 id=1 的老逻辑仍在后端（厂家分支依赖它，总部 UI 已不再消费，勿删以免厂家视角 404）；③CDP 验证脚本 scripts/_tmp-cdp-ent-tab.mjs 可复用（改企业1电话/状态后自还原）；④页面内执行函数序列化（expr）时禁止引用 Node 上下文闭包，全部自包含

---
### 2026-09-07 | 新增产品弹窗移除 5 段辅助说明小字（仅删说明文字，控件零动）
- **工作内容**：用户需求——产品管理「新增产品」弹窗只保留表单输入控件/label 标题/红色 * 必填标记，删除 5 段辅助说明小字：①弹窗标题（新增产品）下 b-modal-sub『选择登记产品自动带出登记信息（可修改）· 登记证号全局唯一 · 原药信息多行（复配多原药）』；②生产类型 USelect 下 b-help『持有人生产：登记产品仅显示归属企业本厂登记…』；③归属企业 EnterprisePicker 下 b-help『选择归属厂家后，持有人生产时登记产品仅显示该厂家的登记产品…』（①②③在 products/index.vue 弹窗内）；④RegProductPicker 搜索框下提示『按登记证号精确匹配登记数据源，选中后自动回填登记信息（只读）』；⑤RegProductPicker noEnterprise 空态提示『持有人生产需要归属企业才能过滤本厂产品，请先选择「归属企业」（总部管理员）』。输入框/下拉框/label/必填 * /标题【新增产品】全部保留；其余空态（noOwn/无结果/错误/选中规格净含量）不在清单不动；后端零改动（regdata.get.ts emptyReason/hint 契约保留，组件仍赋值 emptyReason 只是无专属 UI）
- **修改文件**：app/pages/admin/products/index.vue（-3 行）；app/components/RegProductPicker.vue（-6 行）
- **测试情况**：tsc 0；构建 12.1MB；CDP 13/13（admin 登录 → 产品页 → 新增弹窗：标题在/5 段文案全无/label 生产类型·归属企业·登记产品·农药名称·登记证号在/必填 * 9 个/输入框+下拉 16 个）+ SSR products 200；截图 .tmp-shot/prod-modal.png
- **遗留问题/待办**：其余待办不变
- **给下一个 Agent 的提示**：产品弹窗说明层已精简；RegProductPicker 内 emptyReason='noEnterprise' 分支仍保留赋值（删的只是提示 UI）；若后续要把某段说明加回，位置与文案见 git show 712ee15

---

### 2026-09-07 | 修复批量导入模板下载 404（a 直链被 SPA 客户端路由拦截 → Blob 程序化下载）

- **问题**：用户反馈「点击下载后返回 404」。CDP 真实点击复现：弹窗下载链接 <a href=/templates/spec-import-template.xlsx download>（UButton tag=a）点击后被 **Nuxt 客户端路由拦截为站内导航**——URL 变为 /templates/... 但无对应页面路由 → 渲染 Nuxt 404 错误页，全程**零网络请求**（Network 事件为空铁证）；服务器直连模板 200 正常（.output/public 产物完好、MIME 正确），非服务端问题。
- **修复**：下载改程序化 Blob——$fetch 模板 responseType blob → URL.createObjectURL → 临时 a[download=农药产品规格模板.xlsx].click() → 清理释放；失败中文 toast。页面不离开、不触发路由导航。
- **修改文件**：app/pages/admin/specs/index.vue（downloadTemplate 函数 + 下载按钮由 tag=a 改 @click）
- **测试情况**：tsc 0；构建成功；CDP 复测 6/6——点击后 URL 停留 /admin/specs 无 404、downloadWillBegin（blob URL + suggested 文件名正确）与 downloadProgress completed 触发、文件落盘 20525 字节与源一致。提交 f244970
- **遗留问题/待办**：①本机 3100 服务器已重启至含修复的构建（用户可直接复测）；②其余待办不变
- **给下一个 Agent 的提示**：**Nuxt SPA 内任何 <a href download> 直链点击都会被客户端路由拦截导航成 404（无网络请求）**——文件下载一律用 fetch→Blob→临时 a 的 downloadTemplate 模式（specs/index.vue 有现成实现可抄）；验证脚本 scripts/_tmp-cdp-tpl-dl2.mjs（Edge CDP 监听 Page.downloadWillBegin + 落盘校验）可复用

---

### 2026-09-07 | 删除通知配置功能（系统设置 Tab 整体下线 + 通知开关/阈值/日报配置全清）
- **工作内容**：按用户指示完整删除「通知配置」相关功能（前后端全清），系统设置仅保留企业信息/用户权限/操作日志/数据备份四 Tab。删除前经澄清确认：①**消息中心模块保留**（站内信 sendMessage/message 表/风险预警与导入完成站内信逻辑不动）；②**数据概览「码库存预警」卡一并删除**（该卡唯一消费通知配置里的 stockThreshold 阈值）。
  - **前端**：settings/index.vue 删除「通知配置」Tab 项、desc 文案中「通知配置」、notifyForm/notifySaving/notifyData/refreshNotify/watch/notifySwitches/saveNotify 全部脚本、resetPanel 的 notify 分支、整个「消息通知配置」面板块（开关/码库存阈值/日报时间/保存按钮）；数据概览 index.vue 删除「码库存预警」整卡与 stockAlerts/stockThreshold/pct 计算（产品分布卡 lg:col-span-2 独占整行）；
  - **后端**：删除 `server/api/admin/settings/notify.get.ts` 与 `notify.put.ts`（GET/PUT 均 404）；stats.get.ts 删除 stockThreshold 查询与 stockRows/stockAlerts 整段、返回字段（lowStock/voidAbnormal 判定一并下线）；
  - **数据库**：`system_setting` 表整体下线（唯一消费者即 notify 配置与 stats 阈值）——db-init DDL 删除（14 张表）、存量库 DROP TABLE 已执行；
  - **全项目复查**：app/server/scripts 零残留（唯一命中为数据概览注释自述删除）；README/AGENTS 同步（表数 15→14）。
  - 说明：5 个通知开关（notifyCodeStock/notifyUpload/notifyRisk/notifyAccount/notifyDaily）与日报时间原本即无任何消费逻辑（死配置），删除零业务影响；历史操作日志中「修改通知配置」action 为历史数据保留不动。
- **修改文件**：删除 `server/api/admin/settings/notify.get.ts`、`notify.put.ts`；修改 `app/pages/admin/settings/index.vue`、`app/pages/admin/index.vue`、`server/api/admin/stats.get.ts`、`scripts/db-init.mjs`、`README.md`、`AGENTS.md`
- **测试情况**：tsc 0 错误；生产构建成功（12.1MB）；存量库 DROP system_setting + db-init 重跑（14 张表创建、幂等无报错）；SSR 冒烟——settings 页含企业信息/用户权限/操作日志/数据备份、**无任何「通知配置/notify」字面**；数据概览无「码库存预警/低库存」、产品分布/状态分布保留；`/api/admin/settings/notify` GET **404**；保留模块 API 全 200（settings/enterprise、users、logs、backup、stats、messages、alerts、codes、statistics、trace）；**CDP 真实鼠标点击 5/5**（四个 Tab 逐个点击 aria-selected 正确跟随、面板关键词命中、控制台零 JS 异常——注意合成 click/pointer 事件不被 reka-ui Tabs 接受，须 Input.dispatchMouseEvent）
- **遗留问题/待办**：①「码库存预警」卡随通知配置删除后，数据概览只剩 5 张统计卡 + 状态/异常/产品分布（PRD 5.5.8 差距项记录随功能下线，如后续需要库存预警须另立阈值入口）；②其余待办不变（真机验证 /scan、微信网页授权域名配置、高德白名单、D1-D4 等）。
- **给下一个 Agent 的提示**：①通知配置已全量下线：不要新增 system_setting 表引用（该表已从 DDL 与存量库删除，14 张表）；②消息中心（message 表/sendMessage）仍保留且与通知配置无关，勿误删；③reka-ui（含 UTabs）不接受合成 click/pointer 事件，CDP 点击必须用 Input.dispatchMouseEvent 按坐标派发。

### 2026-09-07 | 规格批量导入（Excel）：右上角按钮 + 弹窗（模板下载/选企业/选文件/结果明细）
- **工作内容**：用户需求——规格列表页【新增规格】旁加【批量导入】按钮（样式统一）；弹窗：①模板下载入口（模板位置：桌面「农药产品规格模板.xlsx」）②选本地 Excel 上传③结果展示成功/失败条数与失败错误提示；筛选/列表/分页不动。**模板清理**：桌面模板仅一列「规格」116 行，其中 36 行（50瓶/盒、60瓶、40套、10毫升/包 等）无法映射系统「净含量+含量单位+包装单位」——按用户指示「将无法解析的删除，先保证模板格式一定正确」：从模板删除 36 行（原文件先备份到系统临时目录），标准行 80 条为导入基准（格式：净含量数值+中文含量单位(毫升/升/克/千克)+斜杠+包装单位(瓶/袋/桶/盒/罐/支/箱)，如 200毫升/瓶）；桌面原文件被 Excel 占用（EBUSY），标准版写为同目录「农药产品规格模板-标准版.xlsx」供用户关闭后自行替换；项目内置同构模板 public/templates/spec-import-template.xlsx（下载源，入库 20KB）。
  - **后端**（新增 server/api/admin/specs/import.post.ts）：multipart 上传（file + enterpriseId 字段）→ 归属企业（平台管理员必传、企业角色自身）→ xlsx 解析（取首个工作表；xlsx 库随产物打包，.output 10.5→12.7MB）→ 表头行（规格/规格名称）跳过 → 逐行正则解析 → 文件内 Set + 库内 IN 查重 → 事务内入库；**规格码在事务外取基线 MAX 后内存递增**（规避 InnoDB REPEATABLE READ 事务快照读看不到自插行、逐行查 MAX 会全撞同一码）；返回 { success, failed, errors:[{row,value,reason}] }；logOperation 审计（统计+失败前 10 条）；上限 5000 行/10MB、仅 .xlsx/.xls、坏文件 400。规格码分配抽共享 server/utils/spec-code.ts（nextSpecCode 与 specs.post.ts 共用）；cjs-modules.d.ts 补 xlsx 类型声明。
  - **前端**（specs/index.vue）：标题区【批量导入】（outline，与新增规格同高）；导入弹窗（sm:max-w-2xl）= 格式说明 note + 模板下载条（a download 静态 public）+ 归属企业下拉（仅 platform_admin，数据源 /api/admin/factories，打开弹窗列表空则 refresh 双保险）+ 文件选择（accept .xlsx/.xls，未选禁用开始导入）+ 导入结果区（共处理/成功绿/失败红计数 + 失败明细表：Excel 行号/内容(截断 title 全显)/原因，max-h-56 滚动）；成功 toast + 列表 refresh。
- **修改文件**：app/pages/admin/specs/index.vue、server/api/admin/specs/import.post.ts（新增）、server/utils/spec-code.ts（新增）、server/api/admin/specs.post.ts（引用共享分配）、server/types/cjs-modules.d.ts（xlsx 声明）、public/templates/spec-import-template.xlsx（新增，模板下载源）
- **测试情况**：tsc 0 错误；生产构建成功（12.7MB 含 xlsx）；API 冒烟 7/7——混合文件（20 标准+2 坏格式+1 文件内重复）导入 success=20 failed=3 且明细 row 22/23/24 与原因精确、二次导入同文件 23 行全失败（库内重复）、20 行落库规格码连续（基线 5 → 6-25）、字段解析正确（1毫升/瓶 → net 1/毫升/瓶）；平台管理员场景 3/3——不带企业 400「请指定有效的企业ID」/带 enterpriseId=2 成功 2 行且归属正确；SSR specs 200 含「批量导入」按钮；模板下载 200（20KB）；CDP 真实浏览器 9/9（按钮可见、弹窗标题、下载链接 download 属性、未选文件禁用、选文件后文件名显示、导入结果「成功 8 条 失败 1 条 共处理 9 条」、失败明细含内容、8 行落库后清理、控制台零错误）。提交 f039beb
- **遗留问题/待办**：①桌面原模板（116 行）仍被 Excel 占用未覆盖——标准版在桌面「农药产品规格模板-标准版.xlsx」，用户关闭 Excel 后自行替换或删除原文件；②导入以「规格」单列名称为源，无法解析行（原 36 类）不再支持——如需导入 计数型规格（60瓶/40套）或 包 包装（10毫升/包）需先扩展 UNITS/PACKS 口径与模板；③其余待办不变
- **给下一个 Agent 的提示**：①导入 API multipart 文件 part 判据 = filename 存在（h3 Part 无 type:'file'）；②query() 返回行数组勿数组解构（查重曾 500）；③规格码分配共享 util = server/utils/spec-code.ts，事务内勿逐行查 MAX（REPEATABLE READ 快照）；④模板文件 public/templates/spec-import-template.xlsx 与桌面标准版同构，模板口径改动需同步导入正则（import.post.ts SPEC_RE）与用户桌面文件；⑤验证脚本 scripts/_tmp-verify-import.mjs、_tmp-cdp-specs-import.mjs、_tmp-verify-import-admin.mjs 可复用（会生成/清理测试行）

---
### 2026-09-07 | 规格列表操作列改造：移除停用/启用，新增删除（被引用 >0 置灰 + 确认弹窗 + 最小 DELETE 接口）
- **工作内容**：用户五项要求——①操作列移除「停用/启用」按钮只留编辑；②编辑后新增【删除】；③被引用（ref_count）>0 时删除置灰禁点、=0 可点；④点击弹确认框、确认后执行删除；⑤其余列/分页/数据逻辑/样式原样、后端既有接口不动。澄清确认：规格模块后端原无 DELETE 端点（仅 PATCH），经用户拍板新增最小 DELETE 接口（前端置灰与服务端校验同语义防绕过）。
  - **前端**（specs/index.vue）：删除 toggleStatus 函数与操作按钮；操作列 = 编辑 | 删除（b-sep 分隔不变）；被引用>0 分支以外层 span 包裹 disabled 按钮承载 title「已被 N 个产品引用，不可删除」（disabled 按钮自身不触发 title，AGENTS 既有踩坑）；删除确认 UModal 对齐码库删除弹窗骨架（trash-2 红图标 + shield-alert 警示 + 取消/确认删除 error solid）；成功 toast + refresh。状态列 tag 与编辑弹窗启用开关保留（停用语义入口收敛到编辑弹窗，产品建档下拉仍只取启用规格）。
  - **后端**（新增 server/api/admin/specs/[id].delete.ts）：requireWritableUser + 企业归属校验（厂家仅本企业、platform_admin 全量）→ 404；被产品引用（product.spec_id）>0 → 400「已被 N 个产品引用，不可删除（请先调整产品规格）」；物理删除 + logOperation 审计（module 规格管理/action 删除规格）。规格码不经码表直连（码经产品引用规格），被引用=0 即无有效码依赖，无需 trace_code 额外扫描。既有 specs post/patch/get 零改动。
- **修改文件**：app/pages/admin/specs/index.vue、server/api/admin/specs/[id].delete.ts（新增）
- **测试情况**：tsc 0 错误；生产构建成功；API 冒烟 5 场景——被引用(id=1 ref=2)删除 400 拦截（响应体含原因文案）、无引用新增规格删除 200、重复删除 404、不存在 id 404、删除后列表与库核验零残留；CDP 真实浏览器 12/12 全过（操作列仅 [编辑,删除] 三行、001 删除按钮 disabled+title 原因、Z8 可点击、确认弹窗出现/含不可恢复警示/取消关闭、确认删除 toast「规格已删除」+ 行消失 + DB 零残留、控制台零错误）。提交 a1a81a3
- **遗留问题/待办**：①规格停用入口现仅剩编辑弹窗开关（列表行内停用按钮已按用户要求移除）；②其余待办不变
- **给下一个 Agent 的提示**：①规格删除端点 = server/api/admin/specs/[id].delete.ts（文件名法放 specs/ 目录，勿写成 [id]/delete.ts 目录结构——Nitro 会映射成 /:id/delete 404，AGENTS 已记录同坑）；②删除确认弹窗与码库删除弹窗骨架一致（b-note + shield-alert + error solid 确认按钮），新删除类交互照此对齐；③规格删除不做 trace_code 检查是有意设计（码经产品引用规格，无产品即无有效码），若未来产品支持删除需补链式校验；④验证脚本 scripts/_tmp-cdp-specs-del.mjs 可复用（API 预建无引用规格 → 页面删除闭环）

---
### 2026-09-07 | 批次三字段行常驻基础信息表（修复未绑定码看不到字段行）
- **工作内容**：用户反馈「生产批次号/生产日期/有效期至三个字段行没见到」——根因：上一轮 9d2e9f2 把三行包在 `v-if="isBound && batch"`（仅已绑定显示）内，而演示码全是未绑定态，页面自然看不到行。用户意图是这三个字段行作为基础信息表的**固定成员**保留（上轮原话“保留到基础信息表中”）。修正：三行改为无条件渲染，值取 `batch?.xxx || '-' `（无批次数据显示 '-' 占位，与其它基础字段 holderName 等 '-' 风格一致）；已绑定码显示批次真实值。同步删除无消费的 isBound computed（脚本残留）
- **修改文件**：app/components/TraceResult.vue（-17/+14，纯模板+script 清理）
- **测试情况**：tsc 0；构建 10.7MB；重启 3100；SSR 双场景——未绑定（…1001）：三行全在、值均为 '-';已绑定（临时绑 …1002→批次21，验证后已还原未绑定）：2026080101 / 2026-08-20 / 2028-08-19。提交 94b1aca
- **遗留问题/待办**：其余待办不变
- **给下一个 Agent 的提示**：TraceResult 基础信息区 = productFields v-for（7 项）+ 批次三行常驻（batch?.xxx || '-'）；若再收到「字段看不到」类反馈先确认码的绑定态（演示码全未绑定，未绑定码无批次数据只显示 '-'），勿再按绑定态条件隐藏字段行

---
### 2026-09-07 | 溯源结果页删除「批次信息」区块，批次三字段并入基础信息行

- **工作内容**：用户反馈（续上轮提示删除）——①「批次信息」标题四字及其整个区块也要删除（DOM 删除）；②生产日期/有效期至字段不能消失，需保留展示在基础信息中（经澄清确认：生产批次号+生产日期+有效期至**三个字段一起**并入）。实现：TraceResult.vue 删除批次小节整体（标题行 i-lucide-boxes + v-if 内容 + 注释），改为在基础信息字段行（productFields v-for）之后紧跟 `v-if="isBound && batch"` 三行（生产批次号/生产日期/有效期至），样式与基础字段行完全一致（divide-y 分隔、label-value 两端对齐），视觉上与基础字段融为一体；未绑定码无批次数据 → 三行不渲染、无任何占位，下方直接接原药信息小节。后端接口/数据零改动
- **修改文件**：app/components/TraceResult.vue（-27/+17，纯模板）
- **测试情况**：tsc 0；构建 10.7MB；重启 3100；SSR 双场景——已绑定（临时绑 …1002→批次21，验证后已还原未绑定）：无「批次信息」标题/三字段全在/顺序 净含量→生产批次号→生产日期→有效期至；未绑定（…1001）：无标题、无批次字段、无提示残留。提交 9d2e9f2
- **遗留问题/待办**：其余待办不变
- **给下一个 Agent 的提示**：TraceResult 现结构 = 产品基本信息卡（基础字段行 v-for + 批次三行 v-if + 原药小节 + 图片小节）；「批次信息」字面/图标已全删（TraceAlert 异常页产品卡一直无批次标题，勿混）；扫码展示仍 JOIN batch 实时取数，API 未动

---
### 2026-09-07 | 溯源结果页移除批次信息下未绑定橙色提示（仅删提示 DOM，保留模块标题）

- **工作内容**：用户需求——删除批次信息区块下的提示文本「该码尚未绑定生产信息，请联系企业（生产厂家）」及其前方警告图标；【批次信息】标题模块本身保留不删；已绑定码正常展示三字段，未绑定码该区域直接留空不再输出橙色提示；后端逻辑不动，仅前端移除该提示 DOM，其余布局样式全部维持不变。实现：TraceResult.vue 批次小节删除 v-else 提示块（1 行警告图标 + 1 行文案共 4 行），已绑定 v-if 分支模板原样保留
- **修改文件**：app/components/TraceResult.vue（-4/+1，纯模板删除）
- **测试情况**：tsc 0；生产构建 10.7MB；重启 3100；SSR——未绑定演示码 …1001：无提示文本残留/「批次信息」标题在位/无批次字段输出/横幅·32位码·返回齐全 200；冻结演示码 …0004（「追溯码暂不可用」分支）不受影响；已绑定分支 v-if 模板零改动。提交 92e437b
- **遗留问题/待办**：其余待办不变（说明：PRD/README 中「已生成码展示未绑定提示」描述为历史需求原文，本需求已按用户最新决策覆盖）
- **给下一个 Agent 的提示**：批次小节现结构 = 标题行 + 仅「已绑定」v-if 内容；未绑定直接空。提示文案已从 UI 移除但 API 字段未动；若后续需求恢复提示需重建 v-else 块

---
### 2026-09-07 | 溯源查询结果页单卡片布局重组（产品基本信息收拢批次/原药/图片；质检与查询记录整体移除）
- **工作内容**：用户需求——溯源结果页前端布局重组，后端接口/业务逻辑零改动。①【产品基本信息】成为唯一业务卡片：批次小节（生产批次号/生产日期/有效期至，未绑定提示行）、原药（母药）小节（单原药 1 组/复合多原药循环分组完整展示）、产品图片小节全部并入卡内（卡内顺序：基础字段→批次→原药→图片），删除原独立「原药(母药)信息」「批次信息」卡片；②DOM 删除（非隐藏）：质检信息模块（质量检验结果/合格证号/报告号）、查询记录模块（累计查询/最近扫码列表）、「信息有误，点此反馈」按钮（handleFeedback 同步清理）；③横幅副行由「首次查询/第 N 次查询」改中性文案（次数属已移除的查询记录语义）；④保留：横幅/32 位码+复制/顶部返回箭头/底部【返回】（单按钮全宽）/页脚提示文案
- **修改文件**：app/components/TraceResult.vue（-134/+76，纯模板与脚本清理，API/类型零改动）
- **测试情况**：tsc 0；构建；CDP bound 场景 10/10——页面业务卡仅 1 张（+32 位码卡共 2 卡）、批次三要素在卡内、无质检/查询记录字样、原药 2 组分循环完整（组分1 PD20080708 江苏原药化工/组分2 PD20040044 黄龙生物科技）、无反馈按钮、保留项齐全（横幅/复制/返回×2/页脚）、卡内顺序基础→批次→原药；未绑定场景 3/3（提示行在卡内/各小节标题唯一/无移除项残留）；SSR 200；演示码 bound 验证后已还原未绑定态。提交 dce8a8d
- **遗留问题/待办**：其余待办不变
- **给下一个 Agent 的提示**：溯源页（TraceResult）现为单卡片结构；后续扫码展示类改动集中在组件内小节；质检字段（batch.qcResult/qualityCertNo/qcReportNo）与查询记录（queryCount/recentScans/firstQuery）数据接口仍返回（后端不动），页面不再消费——勿因「无消费」误删接口字段

---
### 2026-09-07 | 扫码结果页完整展示复合（多原药）产品的全部原药组分（多行循环渲染）
- **工作内容**：用户需求——复合农药扫码页须把录入的全部原药登记证号与生产厂家完整展示（不能只展示一条），单原药保持原逻辑。排查发现：产品原药多行化（product_original + trace API product.originals 数组）已就绪，但 **TraceResult 组件仍渲染已删除的单值字段（originalRegNo/originalCompany）——hasOriginalInfo 恒 false，扫码页原药区块自 V1.0 起实际从未显示**。修复：组件改读 originals——单条保持原两行样式；多条循环分组「原药组分 N」每组完整两行（证号+企业），组间分隔不合并；标题右侧「共 N 个原药组分」。演示数据：25%多·酮（复配）补真实第二原药行（三唑酮 PD20040044 黄龙生物科技（辽宁））作复合扫码演示样本
- **修改文件**：app/components/TraceResult.vue（原药区块多行化）；演示数据 product_original 补行（不入库提交）
- **测试情况**：tsc 0；构建；CDP 7/7——复合 2 组分（计数标题/组分1 PD20080708 江苏原药化工/组分2 PD20040044 黄龙生物科技各自完整/无多余组分/分组 DOM）；临时删行单原药回归（原样式 1 组、无计数与组分标签）；演示样本恢复；SSR trace+全后台 200。提交 8b64064
- **遗留问题/待办**：其余待办不变
- **给下一个 Agent 的提示**：①扫码页原药数据源 = trace API product.originals 数组（product_original 表按录入序）；TraceProduct 类型只有 originals（单值字段已删，勿回写）；②改造扫码类组件后除 SSR 外务必 CDP 真机渲染验证（本类「组件引用已删字段静默 '-'」问题纯 tsc 查不出——vue 模板类型检查不在项目 tsc 范围）

---
### 2026-09-07 | 归属企业候选改为登记数据源全部厂家（3,637 家远程搜索 + 按厂家名过滤登记产品）
- **工作内容**：用户澄清「归属企业下拉应展示存入数据库【农药登记全量数据_完整详情】中所有厂家」——候选源从系统 enterprise 表（演示仅 2 家）改为 pesticide_reg 全量生产厂家（DISTINCT company 3,637 家）：①新 API /api/admin/regdata/factories（去重厂家分页+关键字模糊，后台账号可用）；②regdata 候选 API 支持 company 参数——持有人生产直接 company=厂家名精确过滤（与数据源同源零归一化损耗），厂家账号无 company 保留 enterpriseId→企业名称归一化老路径；③EnterprisePicker 重写为远程搜索组件（modelValue=厂家名；输入防抖请求/默认首批/选中回显/清除）；④RegProductPicker 增加 company prop；⑤products POST 总部 body.company → 服务端按企业名称归一化相等解析为已入驻系统企业；**厂家未入驻（无系统企业账号）400 提示**（product.enterprise_id NOT NULL 完整性护栏，不做假归属，不降级）
- **修改文件**：server/api/admin/regdata/factories.get.ts（新增）、server/api/admin/regdata.get.ts（company 参数）、server/api/admin/products.post.ts（归属解析+入驻护栏）、app/components/EnterprisePicker.vue（重写远程）、app/components/RegProductPicker.vue（company prop）、app/pages/admin/products/index.vue（接线/文案）
- **测试情况**：tsc 0；构建；API 8/8——厂家总数 3637、关键字搜索（绿丰系多厂）、company 过滤仅该厂家（氟虫腈 3 条）、exact 厂家范围核对、POST company=已入驻厂家（山东绿丰农药→id1）成功、未入驻厂家（江苏托球）400 提示入驻；CDP UI 5/5——归属字段新文案、远程搜索候选含数据源全部绿丰系厂家、选中回显、持有人生产登记产品按厂家过滤（PD20110204 山东绿丰农药）、保存成功；厂家账号（lvfeng）本厂产品 38 条 enterpriseId 老路径回归正常 + SSR 全站 200；测试数据已清理。提交 4fffd75
- **遗留问题/待办**：①总部只能为「已入驻平台（有系统企业账号）且企业名与登记证持有人一致」的厂家建档——系统企业名称应与登记证持有人全称一致（演示 id1=山东绿丰农药有限公司 已对齐，lvfeng 演示登录账号即该企业）；②登记产品「持有人生产」过滤语义：厂家账号=本企业名匹配数据源；总部=所选数据源厂家名；委托加工/分装=全部厂家；③其余待办不变
- **给下一个 Agent 的提示**：①归属企业=数据源厂家（company），勿回退系统 enterprise 表作候选；②公司候选接口 /api/admin/regdata/factories（全量去重，含历史过期登记证厂家，与用户口径一致）；③保存归属由服务端 resolveEnterpriseByCompany（normalizeOrgName 相等）解析，未入驻 400——需为厂家建档时先在系统设置创建企业并把企业名称设为登记证持有人全称；④厂家账号路径（无 company）走 regdata enterpriseId 老逻辑，勿破坏

---
### 2026-09-07 | 修复归属企业下拉在持有人生产下不展示厂家列表（面板展开 + 数据加载双修复）
- **工作内容**：用户反馈「选择生产类型=持有人生产时归属企业下拉框未全部展示完整厂家列表」。排查结论与修复：①**面板展开路径不可靠**——EnterprisePicker/RegOrigCombobox 原依赖 UInput @focus 透传开面板，实测点击输入框聚焦后面板不开（Nuxt UI 事件透传链问题）；两组件根容器改 @click 展开面板（点击组件任意区域即展开，与输入事件双保险），候选面板容器加 @click.stop 防选中后冒泡重新展开；②**数据加载健壮化**——products 页 factoryData 原为条件 immediate（!!isPlatformAdmin.value）依赖 SSR/会话时序，在缓存/keepalive/特定产物路径下可能未加载导致 items 为空；改为「SSR 预取 + 打开新增弹窗时若列表为空客户端实时 refreshFactories()」双保险。验证：CDP——持有人生产点击企业输入框展开完整厂家列表（2 家）、关键字实时过滤、点击选中回显、切委托加工仍完整展示；原药组合框同款修复后点击聚焦即出候选。
- **修改文件**：app/components/EnterprisePicker.vue、app/components/RegOrigCombobox.vue（root @click 展开 + 面板 @click.stop）、app/pages/admin/products/index.vue（factoryData 双保险加载）
- **测试情况**：tsc 0；生产构建；CDP 复验 4 项核心全过（两种生产类型下点击企业框均全量 2 家 + 过滤 + 选中回显）。提交 f1b74f6
- **遗留问题/待办**：验证期间一度出现空候选假象——根因是测试脚本用 input.closest('.relative') 命中了 UInput 内部容器（非组件根），面板查询应全局/精确锚定组件根；其余待办不变
- **给下一个 Agent 的提示**：①自绘组合框（EnterprisePicker/RegOrigCombobox）展开面板勿依赖 UInput @focus（透传不可靠），用根容器 @click；②DOM 自动化定位自绘组件容器时勿用 closest('.relative')（UInput 内部同名类干扰），锚定组件根或全局查询+文本过滤；③归属企业候选=factories API 全量（platform_admin），厂家账号无企业选择器

---
### 2026-09-07 | 微信网页授权凭据配置到位（.env，不入库）
- **工作内容**：用户提供微信公众号 AppID/AppSecret（服务号，网页授权用）→ 追加到 .env（WECHAT_APP_ID/WECHAT_APP_SECRET，仅存本机，gitignore 已保护）；runtimeConfig 构建时内嵌，已重新生产构建 + 重启 3100。
- **测试情况**：GET /api/consumer/wechat/authorize → 302 Location=https://open.weixin.qq.com/connect/oauth2/authorize?appid=wx1a6093c716310340&redirect_uri=https%3A%2F%2F127.0.0.1%3A3100%2Fapi%2Fconsumer%2Fwechat%2Fcallback&scope=snsapi_userinfo&state=%2Fprofile#wechat_redirect —— appid/scope/state 全部正确（配置前该端点 503「微信登录尚未配置」）；callback 端点需真实 code 才能全链路验证（不伪造，遵循「未配置凭据禁止假登录」同源原则）。
- **遗留问题/待办**：①**用户操作**：微信公众平台「网页授权域名」配置为 www.nz315.cn（~~本地 127.0.0.1 回调无法被微信服务器访问~~ → **2026-09-12 更正**：网页授权**没有服务器回调**，微信只校验 `redirect_uri` 的域名是否在白名单，通过后由**用户浏览器**带 code 跳回；127.0.0.1 测不通的真因是白名单不接受 IP 与带端口，且手机上的 127.0.0.1 指向手机自身）；②~~生产环境 SITE_URL 改 https://www.nz315.cn 后重建（redirect_uri 取自 SITE_URL，见 authorize.get.ts）~~ → **2026-09-12 更正**：`redirect_uri` **取自请求头、非 `SITE_URL`**——`server/api/consumer/wechat/authorize.get.ts:15-17` 用 `x-forwarded-proto` + `host` 动态拼接，全仓库 grep `SITE_URL` **仅命中 4 处文档、代码零引用**，改它再重建不产生任何效果；改为**线上须确保唯一入口为 www.nz315.cn**（回调域名由 Host 决定，用 IP 或其他域名访问会撞微信 10003）；③真机验证授权回调（微信内打开 → 授权 → 落库 consumer → /profile 展示）；④其余待办不变
- **给下一个 Agent 的提示**：凭据不在代码/文档/提交中；验证授权端点用 redirect:'manual' 的 fetch 检查 302 Location 即可，勿真调微信接口（需要真实用户 code）；consumer 会话 cookie nz315_consumer 与后台 nz315_user 不可互换

---
### 2026-09-04 | 产品弹窗：归属企业可搜索全量选择器 + 原药（母药）信息多行化（复配多原药，product_original 表）
- **工作内容**：第四轮需求两项：
  ① **归属企业选择框**：去掉按生产类型对企业列表的限制（三种生产类型下均展示完整厂家列表）；组件从 USelect 改为**可输入搜索选择器**（EnterprisePicker：输入关键字实时过滤候选厂家、点击选择，本地过滤）；归属企业帮助文案移除「持有人生产时按该企业名称过滤本厂登记产品」并改为「登记产品搜索框按该企业过滤」（登记产品过滤联动不变，切换企业仍清空已选产品）
  ② **原药（母药）信息多行化**：新增 product_original 表（product_id/ingredient/reg_no/company）；产品表单原药区从单行改**行列表**——「添加行/删除行（至少保留 1 行、删除按钮单行禁用）」，每行两字段均为 RegOrigCombobox（下拉选择+手动输入，候选=登记产品**全有效成分候选池** findOriginalPool 合并去重，复配任意成分可下拉选），**同行双向联动**（命中候选带出对方/不匹配清空对方）；切换登记产品**清空全部原药行并按新数据源成分初始化首行**（原药/母药自身回填；制剂池 0=提示手填、1=自动回填、>1=待选必填）；标题右侧提示文案「有效成分匹配到 N 家原药登记，可下拉选择或手动输入（保存必填，多原药请点击添加行）」；复配黄条文案改「本产品为复配制剂，请核对每个有效成分对应的原药信息」；保存校验：**至少 1 行且每行两字段必填**（服务端同口径 400）
  ③ **存量迁移**：db-init migrate 把 product.original_reg_no/original_company 单值迁入 product_original 后条件删列（幂等，本地实测 2 行迁入、列已删）；product DDL 去两列；seed 补演示原药行
  ④ **服务端链路**：products post/patch 校验 originals 数组并事务写入（先删后插）；products.get 行聚合 originals（JSON_ARRAYAGG）；regdata findOriginalPool + originals API ?regNo= 产品级模式（?ingredient= 保留兼容）；trace.get 原药改读 product_original（扫码返回 originals 多行）；shared/types TraceProduct.originals
- **修改文件**：app/pages/admin/products/index.vue（弹窗重构）、app/components/EnterprisePicker.vue（新增）、scripts/db-init.mjs（+product_original DDL/迁移/seed）、server/api/admin/products.{get,post}.ts + products/[id].patch.ts、server/utils/regdata.ts（+findOriginalPool）、server/api/admin/regdata/originals.get.ts（?regNo=）、server/api/trace.get.ts、shared/types/trace.ts
- **测试情况**：tsc 0 错误；生产构建 10.7MB；db-init 迁移（15 张表/存量 2 行迁入/两列删除/幂等重跑）；API 冒烟——产品列表 originals 聚合、原药池（PD20211687 复配联苯肼酯+乙螨唑 22 家、EX20210082 敌草隆+环嗪酮 27 家、EX20200002 母药池含自身）、保存 2 行（含手输自定义）落库、空数组/行内空 400、编辑替换读回 2 行、trace originals 多行返回；**CDP v6 20/20**（A：企业搜索过滤/点击回显/切委托加工候选仍全量/文案更新；B：复配初始化 1 行/标题提示 22 家/黄条新文案/单行删除禁用/空行保存拦截/添加行 2 行/行 2 下拉候选 22 家联动成对/手输候选证号带出企业/保存落库 2 行/编辑回显一致/删除行/切换产品重置回填）；SSR 全站 22 页 200。提交 4a67502
- **遗留问题/待办**：①复配多行的行-成分未做绑定（添加行不选成分，候选池为全成分合并——用户自选即可，扫码页展示按录入顺序）；②扫码页（trace.vue）尚未渲染多行原药（trace API 已返回 originals，UI 展示待后续/如需 1049 原药展示补齐另提）；③编辑页历史产品（product_original 无行）打开显示空行提示补充，保存会被必填拦截——老产品如需保留空原药需先补行；④其余待办不变
- **给下一个 Agent 的提示**：①原药信息唯一存储在 product_original；product.original_* 列已删，任何代码不得再读/写（grep 全库已清零）；②新增/编辑产品 body 用 originals 数组；③findOriginalPool 按 pesticide_reg.ingredient_all 全成分合并候选（含自身），行内联动候选池为空时不联动（自由输入）；④添加行不限成分，多成分原药候选混在一个池（同一登记证去重）；⑤验证样本：复配 PD20211687（22 家池）/单成分 EX20200001 制剂（21 家）/母药 EX20200002；手动输入命中候选靠 registration_no/company 精确匹配

---
### 2026-09-04 | 侧栏菜单两项改名：生产采集→追溯码上传、批次管理→效期预警（仅展示文字）
- **工作内容**：按用户要求改 MENU_READY 数组两处 label：生产采集→追溯码上传（/admin/collection）、批次管理→效期预警（/admin/batches）。路由/图标/权限/后端零改动；页面内部标题（h1）未在本次要求内保持原样。
- **修改文件**：app/layouts/admin.vue（MENU_READY 两行 label）
- **测试情况**：生产构建 + 3100 重启 + CDP 实测：直达 /admin/batches 菜单显示「效期预警」且高亮、href=/admin/batches 不变；点击「追溯码上传」跳 /admin/collection 并高亮；旧名「批次管理/生产采集」已从菜单消失
- **遗留问题/待办**：无（若需同步改页面内 h1 标题可后续一行改动）
- **给下一个 Agent 的提示**：菜单文案唯一来源 MENU_READY 数组；Keep-Alive 页面 name 由路由生成不受菜单 label 影响

---

### 2026-09-04 | 数据概览页下线「快捷入口」板块（仅前端删除，其余板块不动）
- **工作内容**：按用户要求删除数据概览页快捷入口板块——script 中 quickLinks 定义（8 个入口：生产采集/追溯码生成/码库管理/产品管理/生产批次/扫码统计/风险预警/消息中心）+ template 中整块卡片（标题条「快捷入口」+ 8 宫格 NuxtLink 卡片）一并移除；删后指标卡下方的「近 30 天扫码趋势」等板块随流式布局自然上移。其余板块（6 指标卡/趋势图/码状态分布/异常标记分布/产品追溯码分布/码库存预警）与页面脚本逻辑零改动。
- **修改文件**：app/pages/admin/index.vue（quickLinks 定义 + 快捷入口卡片块 + 顶部注释）
- **测试情况**：生产构建 10.7MB + 3100 重启 + CDP 实测：主体区无「快捷入口」标题（false）、无任何快捷链接残留（mainQuickLinkHits 空，此前误报命中词全部来自侧栏菜单）、剩余 b-card 标题 = 近 30 天扫码趋势/码状态分布/异常标记分布/产品追溯码分布/码库存预警 五张齐全、6 个指标卡数值正常渲染、无 500 错误
- **遗留问题/待办**：无（PRD 5.2 P2 快捷入口为增强项，下线不影响合规；若日后恢复可 git 历史找回）
- **给下一个 Agent 的提示**：快捷入口入口链接指向的模块路由未变（侧栏菜单可直达）；验证「板块删除」类改动时区分侧栏菜单文字与主体内容（body innerText 会同时包含两者）

---

### 2026-09-04 | 追溯码生成支持入库留档——「已生成（未绑定）」状态恢复业务意义（方案 A，提交 4918fb8）
- **需求背景**：用户质疑——生产采集强制三要素绑定后码必然已绑定，保留「未绑定」状态意义何在。经解释 PRD 两状态模型（已生成=已印码/入档未生产，可先入档后绑定；修正工具重绑/解绑回退依赖它）后，用户拍板方案 A：**生成页支持入库留档**，让已生成态可自然产生。
- **工作内容**：①新 API POST /api/admin/codes/stock-in——生成码入库为已生成：结构校验/归属校验/查重（import 同口径，防绕过直灌）、事务内建 upload_batch 行（file_name=「生成入库 YYYY-MM-DD HH:mm」，码库聚合列表按行可见、可整批操作）、分块 5000/批插码 status=1；②生成页结果卡新增「入库留档（状态：已生成）」按钮（成功置已入库态防重复，说明文案同步）；③**码库整批修正弹窗新增「新建批次绑定」模式**（UCheckbox 切换，与「绑定已有批次」互斥）：填 生产批次号/生产日期/质量合格证号（质检默认合格、报告号/效期选填）→ 服务端自动建档或归并批次（与 import 同规则：同产品同批号命中校验一致、不一致 400、质检不合格拒绑）→ 绑定本行全部已生成码（status=2）+ 同步 upload_batch 快照——**生成入库 → 码库绑定 → 扫码完整展示的闭环打通**；④修复 db.ts execute（返回 ResultSetHeader）被数组解构导致的 500（correct 新建分支曾 500，批次已 INSERT 码未绑）。
- **修改文件**：server/api/admin/codes/stock-in.post.ts（新）、server/api/admin/codes/upload-batches/[id]/correct.post.ts、app/pages/admin/generator/index.vue、app/pages/admin/codes/index.vue
- **测试情况**：tsc 0；构建 10.7MB；重建重启 3100；**API 8 项全过**——stock-in 100 条（已生成/0 跳过/uploadBatchId）→ 聚合行可见（codeTotal=100/boundCount=0/canDelete=true）→ 库内 status 全 1 → correct 新建批次绑定（rebound=100/batchCreated）→ 批次建档（qc=1/报告号/效期）+ 码全 status=2 + 行快照同步 → 扫码页展示生产日期/批号/合格证 → 重复绑定 400「无已生成码」→ 清理恢复基线（trace_code 4/batch 0/upload_batch 1）；**CDP 12 项全过**——生成页：选产品→生成 5 条→「入库留档」→ toast 已入库 → 按钮已入库态 → 库内 5 码 status=1（验证后清理）；修正弹窗：模式切换 6/6（勾选显示新建表单/隐藏下拉/质检禁用/取消恢复）
- **遗留问题/待办**：①生成入库的码在码库聚合行可按【修正】→「绑定已有批次」或「新建批次绑定」归批；批次管理页仍保留为效期预警/质检治理台；②演示库基线维持 4 条未绑定码 + batch 0——方案 A 演示路径：生成页生成 → 入库留档 → 码库修正新建批次绑定；③其余待办不变
- **给下一个 Agent 的提示**：①stock-in 与 import 互为入库双通道（留档 vs 绑定），校验上下文与 upload_batch 建档逻辑同构，改动需两侧同步；②**db.ts execute/query 返回 ResultSetHeader/行数组，不可数组解构**（conn.execute 才是 mysql2 二元组）——新代码引用时注意；③UCheckbox 渲染为 button[role=checkbox]（无原生 input），CDP 勾选用 aria-checked 判定；④并行工作线可能改动同一批文件（codes/generator/import），开工前 git log 确认 HEAD

---

### 2026-09-04 | 数据维护：清理测试批次与残留验证数据，修复演示数据完整性
- **背景**：向用户讲解「批次数量/码数」列含义时发现批次列表有两行并行工作线验证残留（20260904/2026090417，各 100 条码、数量 0）；用户确认清理，并追加要求删除演示批次 2026080101。
- **清理内容**：①删除测试批次 20260904(id10)/2026090417(id17) 及其 200 条追溯码（事务，含关联 scan_log 同步清理）与空壳上传批次行（upload_batch id14）；②删除演示批次 2026080101——其 2 条已绑定演示码（1001/…0004）解绑转「未绑定」保留（防既有扫码链接失效，trace 页合法展示"尚未绑定生产信息"）；③修复并行线验证造成的演示数据缺口——补回演示码 …1005（未绑定），1002 补挂「历史数据（码库聚合改造前导入）」上传批次行。
- **结果**：trace_code = 4 条演示码（1001/1002/…0004/…1005，全部 status=1 未绑定、挂 upload_batch id1）；batch 表 = 0（批次页空态，采集导入即自动建档）；upload_batch = 1 行；扫码 4 条 200、/admin/batches 与 /admin/codes SSR 200
- **遗留提示**：演示库已无「已绑定」状态的码——需要扫码完整展示对比时可用桌面码文件（1_25%多·酮…）在生产采集导入（自动建档 + 绑定）；批次页与码库聚合页均已无测试残留
- **给下一个 Agent 的提示**：并行工作线可能留下验证数据（码/批次/上传批次行），演示环境基线请以本节为准；清理带关联的批次前先查 trace_code/upload_batch/scan_log 引用面

---

### 2026-09-04 | 修复 3 处 PATCH 接口状态字段未传时静默翻转（批次质检/用户状态/企业状态）
- **工作内容**：code-review 全量审查发现同一缺陷模式三处——`body.x === 0 ? 0 : 1` 在字段**未传**时 `Number(undefined)` 不等于 0 被判为默认值 1：
  ① **batches/[id].patch.ts**：编辑批次未携带 qcResult 时，不合格批次（qc_result=0）被**静默改为合格**——绕过「质检不合格码不可绑定」防线（import 有拦截，编辑页却可翻）；
  ② **users/[id].patch.ts**：编辑被禁用用户（status=0）只改名字/电话未传 status 时被**静默复活为启用**——账号状态安全缺陷；
  ③ **settings/enterprise/[id].patch.ts**：平台管理员编辑停用企业未传 status 时被**静默启用**。
  修复模式统一：status/qcResult 为 undefined/null 时从库内当前行取值保留，显式传值才覆盖（与 2026-09-04 早些时候 specs/[id].patch.ts 状态保留修复同款）。
- **修改文件**：server/api/admin/batches/[id].patch.ts、users/[id].patch.ts、settings/enterprise/[id].patch.ts
- **测试情况**：tsc 0 错误；生产构建 10.7MB；E2E 三场景全过并恢复原状——①禁用用户 lvop 改名（无 status）后保持 0；②停用企业 id=2 改名（无 status）后保持 0；③批次 id=10 置 qc=0 后编辑（无 qcResult）保持 0。提交 88edf95
- **遗留问题/待办**：全库复查同类模式已收敛（新增类接口 batches.post/products.post/specs.post 无原值可保留，默认值语义合理保留）；其余 PATCH 状态字段均有显式守卫
- **给下一个 Agent 的提示**：PATCH 接口凡「body.x 缺省有默认值」的三元表达式先问一句：这个字段是否有存量行值需要保留？修复模式 = `body.x === undefined ? 原值 : 新值`
### 2026-09-04 | 批次码明细弹窗单行操作列新增【删除】（仅删除当前这一条码）
- **需求**：批次码明细（批次列表【详细】弹窗）单行操作列在【冻结】【作废】【修改】后新增【删除】；确认弹窗（「确认删除该条追溯码？删除后数据不可恢复，请谨慎操作。」）后**仅删除当前这一条码明细**，不影响同批次其他码与上传批次行，成功后刷新当前明细表格；**禁用约束：码状态为已绑定（status=2）时按钮置灰不可删**，hover 提示「该追溯码已绑定，不允许删除」；未绑定码可删。
- **工作内容**（提交 5032f8d）：
  ① 新 API DELETE /api/admin/codes/:id（server/api/admin/codes/[id].delete.ts，与 [id].patch.ts 同目录同模式）——归属校验 404 + **已绑定保护 400（服务端强制，与前端置灰同语义防绕过）** + logOperation（含码值/异常标记）+ 生产批次/扫码历史不随删；
  ② codes/index.vue 明细弹窗三个行态分支（正常=冻结/作废/修改、冻结=恢复正常/修改、作废=修改置灰+已终态）操作列尾部统一追加【删除】（error 链接 + trash-2 图标）：status=2 置灰 + **外层 span 承载 hover 提示（disabled 按钮自身不触发 title，与批次删除按钮同模式）**；status=1 可用点击；
  ③ 单行删除确认弹窗（危险样式、显示码值）+ submitRowDelete：成功后 **loadDetail() 刷新明细 + refresh() 同步主列表汇总**，当前页删空且非第一页时回退一页防空页。
- **验证**：tsc 0；构建 10.7MB；**API 冒烟 9/9**（未绑定码删 200 且仅删 1 条/同批其余码与 upload_batch 行保留/已绑定码 400 且未删/404）；**CDP 8/8**（未绑定批 3 行删除可用→确认弹窗文案→取消仍 3 行→确认后剩 2 行仅删当前行→库核验→已绑定行删除置灰+hover 提示→操作列顺序 冻结/作废/修改/删除）；SSR 200；验证数据清理恢复基线 104。脚本 scripts/_tmp-verify-rowdel.mjs、scripts/_tmp-cdp-rowdel.mjs 可复用。
- **遗留问题/待办**：①删除未绑定但已被扫码过的码后，历史 scan_log 仍按码值留存、扫码页变「查无此码」——产品已接受（物理删除语义），如需保留墓碑可后续加 deleted 软删列；②其余待办不变。
- **给下一个 Agent 的提示**：①明细行操作列三种行态分支各自维护按钮组，新增行操作要三处同步（或重构为渲染函数）；②「可删除」判定=status=1（未绑定），与 abnormal_flag 正交——作废但未绑定的码也可物理删除（需求如此）；③单条删除走 DELETE /api/admin/codes/:id（与 /upload-batches/:id 的批次删除是两回事，勿混）。

---
### 2026-09-04 | 上传批次列表操作列新增【删除】（删除批次及批次下全部追溯码）
- **需求**：码库管理-上传批次列表操作列在【详细】【冻结】【修正】后新增【删除】；点击二次确认（文案「确认删除该批次以及批次下全部追溯码数据？删除后数据不可恢复，请谨慎操作。」）后删除批次记录与批次下全部追溯码；**置灰约束：批次内任意一条码为已绑定（status=2）即置灰不可删**，全部未绑定才可删，hover 提示「该批次存在已绑定追溯码，无法删除」。
- **工作内容**（提交 81a155e）：
  ① upload-batches.get.ts 聚合 SQL 新增 COALESCE(SUM(t.status = 2),0) AS bound_count → 行返回 boundCount/canDelete（boundCount===0；空批次孤儿行也可删）——异常标记（冻结/作废）与码状态（已绑定）正交，置灰判定必须按 status 而非 abnormal_flag（演示码即存在 已绑定+冻结 组合）；
  ② 新 API DELETE /api/admin/codes/upload-batches/:id（upload-batches/[id].delete.ts，注意命名：文件放 upload-batches/ 目录名为 [id].delete.ts，放 [id]/delete.ts 会映射成 /:id/delete 404 踩坑一次）——归属校验 404 + **已绑定保护 400（服务端强制，与前端置灰同语义防绕过）** + 事务内先删 trace_code 再删 upload_batch 行（失败回滚）+ logOperation 审计 + 生产批次 batch/扫码历史 scan_log 不随删（独立概念）；
  ③ codes/index.vue 操作列第 4 按钮【删除】（error 链接 + trash-2 图标）：**disabled 按钮自身不触发 title 悬浮提示（浏览器行为），由外层 span 承载 title**；删除确认弹窗（危险样式、显示码总量），成功 toast 显示删除码数并 refresh。
- **验证**：tsc 0；构建 10.7MB；**API 冒烟 10/10**（SQL 造全未绑定批 A：canDelete=true→DELETE 200 码 2 条连带删除；import 造已绑定批 B：canDelete=false boundCount=2→DELETE 400 且数据未动；404）；**CDP 页面 7/7**（未绑定行删除可用/历史批次（102 条已绑定）删除置灰/hover 提示文案/确认弹窗/取消不删/确认后行消失/库核验码与批次行删除干净）；SSR 200；验证数据清理恢复基线 104。脚本 scripts/_tmp-verify-del.mjs（API 10 场景）、scripts/_tmp-cdp-del.mjs（CDP 7 场景）可复用。
- **遗留问题/待办**：①删除是大表 DELETE，单批上限 10 万码（import 约束）单条 DELETE 可接受；亿级后按 D1 评估；②删除的是文件维度行，若后续需要删除后对应生产批次被清空重建等联动需另行决策（当前明确不联动）；③其余待办不变。
- **给下一个 Agent 的提示**：①**Nitro 路由文件命名**：upload-batches/[id].delete.ts（方括号文件名在 upload-batches/ 目录下）= DELETE /upload-batches/:id；而 [id]/delete.ts = DELETE /upload-batches/:id/delete（多一段，404 踩坑）；②PowerShell Move-Item/Get-ChildItem 对含 [id] 的路径会把方括号当通配符——必须 -LiteralPath；③**disabled 按钮不触发原生 title tooltip**（浏览器规范），hover 提示需求用外层 span 承载 title；④可删除判定=无已绑定码（status=2），与冻结/作废（abnormal_flag）无关——两维度正交勿混。

---
### 2026-09-04 | 批次码明细单行【修改】（仅作用于当前码，不影响同批其他码）
- **需求背景**：批次码明细弹窗（批次列表【详细】）操作列新增【修改】——已作废码置灰不可点、冻结码允许修改；表单字段复用批量修正（重绑批次/生产日期/有效期至/质检结果/合格证号）；修改仅作用于当前这一条码，完成后刷新明细行。
- **架构决策（数据模型约束）**：扫码页展示数据取自 batch 表（批次级共享），单码字段修正若写 batch 会波及同批其他码——故 trace_code 新增 **expire_date/qc_result 单码覆盖冗余列**（db-init DDL + migrate() 幂等加列，已实测），扫码页 trace.get.ts batchInfo 改 **COALESCE 优先码级值**（produce_date/quality_cert_no 复用既有冗余列）；字段修正只写本行、不触碰 batch。重绑批次：校验新批次与码产品一致（防跨产品串绑）、冗余随新批次带出（可被表单字段覆盖）、状态自动流转已绑定（bound_at 刷新）。
- **实现**：新 API `server/api/admin/codes/[id]/correct.post.ts`（作废终态 400/冻结放行/企业隔离/审计日志）；前端 codes/index.vue 明细操作列三分支均加【修改】（作废行 disabled+已终态保留）、新增单条修改弹窗（复用批量修正表单字段与批次候选）提交后 loadDetail 刷新。
- **修改文件**：`server/api/admin/codes/[id]/correct.post.ts`（新增）、`server/api/trace.get.ts`、`app/pages/admin/codes/index.vue`、`scripts/db-init.mjs`；提交 f45c4e3
- **测试情况**：tsc 0 错误（-p .nuxt/tsconfig.json）；全权构建 15:57 产物（80 chunks）；端到端 API 实测——字段修正 corrected=1 且扫码页展示新值（COALESCE 生效）、重绑 rebound=1（888 换批成功）、作废码 400 终态拒绝、冻结码修正放行、空字段 400；测试数据已恢复原状
- **给下一个 Agent 的提示**：另一 DSH 会话并行构建会清空/混合 .output（chunk 404），验证前确认无并行构建或构建后立即启动；单码覆盖列扫码生效依赖 trace.get.ts COALESCE，勿改回纯 batch 取值

### 2026-09-04 | 码库管理改为按上传文件批次聚合展示（详细弹窗/整批冻结/整批修正）
- **需求背景**：码库管理页面直接展示每条独立追溯码，数据量大操作繁琐。用户要求改为**按上传文件批次维度聚合**：生产采集每上传一份追溯码文件 = 一个批次记录 = 码库一行；删除勾选框与底部批量操作条；操作仅【详细】【冻结】【修正】三按钮；整批作废/整批恢复正常暂不提供（仅明细页单行作废/恢复）。
- **数据模型（关键架构决策）**：原 trace_code 无「上传文件」维度（import 一次调用=一个文件但文件名未落库），聚合必须新增维度：**新表 upload_batch（上传文件批次）**（enterprise_id/file_name/product_id/batch_id/batch_no 快照/created_by/created_at）+ **trace_code.upload_batch_id 列**（含索引）。import.post.ts 事务内批次确定后建档 upload_batch（fileName=生产采集页原始文件名，粘贴导入缺省自动命名「手动导入 时间」），插码带归属，失败整体回滚；响应新增 uploadBatchId。db-init DDL 加表 + migrate() 幂等补列补索引 + **backfillUploadBatches() 历史码兜底**（seed 后执行，按企业把 upload_batch_id IS NULL 的存量码归并到「历史数据（码库聚合改造前导入）」批次，本库 104 条已迁移，原文件信息不可考）。生成器 generate 不入库（与采集闭环），无可见性盲区。
- **后端新 API**：①GET /api/admin/codes/upload-batches——聚合列表（LEFT JOIN trace_code 实时 COUNT + 按 abnormal_flag 分组汇总，返回 normalCount/frozenCount/voidedCount/codeTotal/summary/flagableCount；汇总判定：全部作废>部分作废>全部冻结>部分冻结>正常，作废优先；筛选 fileName/productId/batchNo/上传时间范围）；②POST …/upload-batches/[id]/flag——整批异常标记（flag 0恢复/1冻结/2作废，作废必填原因且为终态；冻结/恢复不动作废码；**执行前按真实状态计数判 400**——mysql2 affectedRows 是「匹配行数」语义，同值更新也返回匹配数，UPDATE 后判 0 会漏判，实测重复冻结/恢复曾 200 假成功）；③POST …/upload-batches/[id]/correct——整批修正（字段复用 batch-correct：批次重绑仅 status=1 码生效+同步 upload_batch 快照/生产日期/有效期/质检/合格证号按所属生产批次分组更新 batch 并同步 trace_code 冗余列；含冻结/作废码整批拒绝，与批量修正工具同语义）；codes.get.ts 加可选 uploadBatchId 过滤（明细弹窗复用，单条逻辑零改动）。
- **前端改造**：app/pages/admin/codes/index.vue 整页重写——批次列表 7 列（批次名称/关联产品/码总数量/码状态汇总标签+分解计数 title/生产批号/上传时间/操作），勾选框、全选、吸底批量条整体删除；筛选按批次文件名/关联产品（下拉）/生产批号/上传时间；【冻结】确认框（提示影响范围 normalCount，全部冻结/全部作废后按钮 disabled 置灰）；【修正】弹窗复用批量修正表单字段（批次重绑下拉+生产日期+有效期+质检+合格证号）；【详细】大弹窗（max-w-6xl）展示本批次单条明细（复用 /api/admin/codes 接口+uploadBatchId），支持码值/批号/状态/标记筛选与分页，行操作保留单行冻结/作废/恢复正常（PATCH /api/admin/codes/:id），无批量组件，作废码行显示「已终态」；行操作后同步刷新明细与主列表汇总。collection/index.vue doImport 请求体补 fileName（码库批次名称来源）。Keep-Alive/重置按钮保留。
- **验证**：tsc 0 错误；生产构建 10.6MB；db-init 迁移成功（14 表 + 补列索引 + 104 条历史码归并）；**API 冒烟 31/31**（导入建档 100 码→汇总正常→整批冻结→重复冻结 400（修复后）→整批恢复→含冻结码修正拒绝 400→单行恢复→整批修正 corrected=100 且码冗余列同步→单行作废→部分作废汇总（作废优先）→混合态冻结 99（作废保护）→筛选命中→清理恢复）；**CDP 页面 15/15**（无复选框/无批量条/聚合列齐全/全冻结批次冻结按钮置灰/部分作废批次可用/明细弹窗仅查看+单行恢复→行操作切换/关闭弹窗主列表在/文件名筛选）；SSR /admin/codes 200。脚本 scripts/_tmp-verify-uploadbatch.mjs（API 31 场景）与 scripts/_tmp-cdp-codes-agg.mjs（CDP 15 场景）可复用回归。
- **遗留问题/待办**：①整批作废/整批恢复正常按钮暂未上（需求弹性保留），flag API 已支持 flag=0/2，需要时操作列加按钮+确认框即可；②upload_batch 聚合列表 JOIN trace_code 实时 COUNT，亿级码量时需按 D1 方案评估（idx_upload_batch 索引已建）；③明细弹窗一次加载当前页 20 条，翻页走接口无压力；④历史数据批次（改造前 104 条）原文件信息不可考，展示为「历史数据（码库聚合改造前导入）」。
- **给下一个 Agent 的提示**：①「上传批次」（upload_batch，文件维度）与「生产批次」（batch，三要素）是两个正交概念：一份文件一次导入归并到唯一生产批次，但补采是不同上传批次行；改 import 别混两者；②**mysql2 affectedRows 是匹配行数语义**（同值 UPDATE 也返回匹配数），凡「无实际变化时 400」的判定必须 UPDATE 前按状态 COUNT，勿用返回值；③**edit 工具改写含反引号的多行模板字符串易丢闭合反引号**（本次 pesticide_reg DDL 尾行反引号丢失导致解析器一路吞到下一模板才报错，错误行号远离真实位置），改完立即 esbuild/node 语法验证；④node --check 在本机对含中文多行模板字符串的 ESM 文件误报（报错回显与文件字节不符），语法验证用 esbuild transform 或直接运行；⑤cd codes 页 Keep-Alive 生效，从采集页导入后切到码库页看到新批次需下拉刷新（页面缓存不会自动感知外部变化——业务上采集完成消息中心有通知）。

---
### 2026-09-04 | 侧栏菜单排序调整与改名（仅前端展示，路径/图标/权限/后端零改动）
- **工作内容**：按用户指定重排后台左侧菜单顺序并改两处名称：产品规格管理→规格管理、生产批次→批次管理。新顺序：数据概览→产品管理→规格管理→追溯码生成→生产采集→码库管理→批次管理→扫码统计→风险预警→消息中心→系统设置。仅改 app/layouts/admin.vue 的 MENU_READY 数组（label 与顺序），path/icon 全部不变，菜单高亮 isActive 逻辑（上轮 de4348e 修复）不受影响。
- **修改文件**：app/layouts/admin.vue（MENU_READY 数组）
- **测试情况**：生产构建 10.6MB + 3100 重启（注意：node .output/server/index.mjs 默认监听 3000，需 PORT=3100 环境变量）+ CDP 实测：菜单 11 项顺序/名称与需求逐项一致、图标 class 全部保留（layout-dashboard…settings）、点击码库管理/追溯码生成高亮正确跟随且数据概览不高亮（DOM 客观测量）
- **遗留问题/待办**：无
- **给下一个 Agent 的提示**：本机启动服务必须显式 `$env:PORT=3100`（node .output/server/index.mjs 默认 3000，会与农码查残留实例撞端口）；菜单顺序只由 MENU_READY 数组决定，新增模块记得插入合适位置

---

### 2026-09-04 | 恢复导入接口安全防线（合并并行提交 0a40d76，防重写回退）
- **背景**：采集三要素自动建档重写（fe8db86）期间，另一条工作线提交了 0a40d76（import 接口补结构校验/归属校验/分块写入），重写基于旧版本全文覆盖，**误将并行修复回退**——重写版仅查重不校验结构，任意错构码可绕过解析直接灌库且自动建批绑定（合规风险高于回退前）。
- **修复**（提交 0e31394）：将 0a40d76 能力并入三要素事务版——①逐条 cleanLine+validateCode 结构校验（与 parse 同口径，AND 前缀企业过滤加载校验上下文）；②码归属产品校验（matchedProductId 须等于所选 productId）；③分块 5000/批写入（事务内）；④返回体区分 skippedInvalid/skippedDup，页面提示恢复（多产品文件跳过不静默、校验/归属不符提示核对产品）。
- **验证**：tsc 0；重建重启；防线四场景——垃圾码 400、混入错构码 imported=1/skippedInvalid=2、无匹配产品码 400、重复码 400；批次仅合法码入库；清理恢复基线 4
- **给下一个 Agent 的提示**：**改 import/parse 等公共接口前先 git log 看最近提交**——并行工作线可能已修改同一文件（本次教训：基于旧版本全文重写覆盖了并行提交）；多 Agent 协作时改动核心接口前先 git pull/查看最新 HEAD 版本

---

### 2026-09-04 | 生产采集直接填写批次三要素自动建档（流程改造，用户决策 B）+ 批次新建入口收敛
- **需求背景**：用户先提出「删除生产批次板块」，经概念讲解（批次=扫码页生产日期/批号/质检的数据源，1049 公告第五条合规依赖；码库改码改不出生产信息）后澄清真实诉求是「流程绕」；随后确认改造方案 **B：生产采集强制填写三要素（生产日期/生产批号/质量合格证号），系统自动建档/归并批次**，质检默认合格+报告号选填，有效期至选填可后补。
- **工作内容**（提交 fe8db86）：
  ① **import API 重构**（server/api/admin/codes/import.post.ts）：契约由「可选 batchId」改为「三要素必填自动建批」——按 同产品+同批号 查批次：未命中自动 INSERT（质检默认合格、quantity=0 可后补）；命中则校验生产日期/合格证号一致后归并（**天然支持分次补采**），不一致 400 并回显库内值防串批；qc_result=0 拒绑（PRD 5.6）；自动建批+批量插码在同一连接事务（getPool().getConnection + beginTransaction/commit/rollback），失败整体回滚不留孤儿批次；码一律 status=2 已绑定
  ② **生产采集页**（app/pages/admin/collection/index.vue）：第 3 步「绑定批次下拉 + 不绑定哨兵值」整体替换为必填三要素表单（生产日期/生产批号/质量合格证号 * + 质检报告号/有效期至 选填），附自动建档规则说明 note；前端逐级拦截校验（无请求即提示）；成功 toast 区分「已新建批次 xx」/「已绑定批次 xx」并如实提示重复跳过数；移除对已下线 skippedInvalid 幽灵字段的引用
  ③ **批次页**（app/pages/admin/batches/index.vue）：移除「新建批号」按钮与 openCreate（新建入口收敛至生产采集），弹窗仅编辑语义；页面描述更新；空状态文案提示「在生产采集导入时自动建档」；save 移除有效期至必填
  ④ **批次 PATCH**（batches/[id].patch.ts）：有效期至放开为选填（采集建档可留空、此处补填，空值存 NULL）；**三要素更正同步到已绑定码冗余列**（trace_code.batch_no/produce_date/quality_cert_no，码库列表按冗余展示；扫码页本身实时 JOIN batch 无需同步）
- **修改文件**：server/api/admin/codes/import.post.ts、server/api/admin/batches/[id].patch.ts、app/pages/admin/collection/index.vue、app/pages/admin/batches/index.vue
- **测试情况**：tsc 0 错误；生产构建成功（10.6MB）；重建重启 3100；**API 五场景全过**——①新批号导入自动建档（batchCreated=true、50 条 status=2）；②同批号补采归并（batchCreated=false 复用同批次）；③生产日期/合格证号不一致 400（回显库内值）；④缺三要素 400；⑤批次改质检不合格后再导入 400 拒绑；事务回滚无孤儿数据；**CDP 真实浏览器终验 12/13**——新表单五字段齐备、旧「不绑定」移除、解析 100/100、缺日期/缺合格证号逐级拦截（无请求发出）、全填导入请求发出+自动建档+100 码全部已绑定、新码扫码页展示生产日期/批号/质检、批次页无新建按钮且编辑可用（唯一 FAIL 为 toast 检查晚于消失时机的脚本问题，落库与扫码证据链完整；另 stepdiag 实测同路径成功 toast「已新建批次」）；验证数据全部清理，trace_code 恢复基线 4
- **遗留问题/待办**：①验证中发现 batch 表 quantity 由采集自动建档记 0，批次状态列显示「已上传」而非「已完成」（需在批次页编辑补填生产数量后流转），语义已注释说明；②扫码页「已生成」状态与「不绑定导入」在采集页已无入口（方案 B 收敛），历史已生成码不受影响；③产品保质期字段已下线为空，效期自动计算无数据源，采集建档有效期至靠人工选填——若后续恢复保质期录入可加自动算（autoExpire 逻辑在批次页编辑弹窗仍保留）；④其余待办不变
- **给下一个 Agent 的提示**：①import API 新契约（三要素必填自动建批）唯一调用方是生产采集页；码库「批量修正」走独立的 batch-correct API（batchId 通道）不受影响；②批次页 POST /api/admin/batches 已无页面调用方但接口保留（防御/未来扩展）；③事务写法参考 import.post.ts：getPool().getConnection → beginTransaction → conn.execute → commit/rollback/release，业务 400 在 catch 中靠 e.statusCode 原样抛出；④CDP 页面自动化注意：真实鼠标坐标点击在视口外元素/被 toast 遮挡时会静默无效，稳妥用元素 el.click()；toast 检查要在显示窗口期内（<4s）或直接查库验证结果

---

### 2026-09-04 | 修复导入接口缺结构校验（可绕过 parse 灌任意码）+ 10 万码单 INSERT 超包风险
- **工作内容**：code-review 全量审查 import.post.ts 发现两处缺陷：
  ① **导入接口无结构校验**：import 只查重不校验码结构——它是公共接口（requireBackendUser 即可），客户端可绕过 parse 直接 POST 任意字符串/错构码入库（实测 abc、规格码 999 的假 32 位码在修复前会 200 写入），污染 trace_code 数据完整性与 1049 合规。修复：补 validateCode 逐条校验（与 parse 的 validateBatch 同口径：32 位数字/登记类别/生产类型/规格码登记/登记证后 6 位匹配）+ **码归属产品须与所选 productId 一致**（跨产品错码拒绝）。
  ② **10 万码单条 INSERT 超 max_allowed_packet**：100000 码 × 10 占位符拼单条 INSERT（约百万占位符），可能超 MySQL 包上限致 500。修复：分块 5000/批循环写入。
  ③ 返回体语义拆分 skippedInvalid（结构/归属不符）与 skippedDup（系统已存在），页面 toast 明确提示跳过原因——多产品文件导入其余码被跳过不再静默丢码。
- **修改文件**：server/api/admin/codes/import.post.ts、app/pages/admin/collection/index.vue（toast 提示）
- **测试情况**：tsc 0 错误；生产构建 10.6MB；E2E 三场景——垃圾码（abc/123）400 拒绝、错构 32 位码（规格码 999）400 拒绝、合法码 200 导入并落库核验；测试码已作废清理。提交 0a40d76
- **遗留问题/待办**：parse 响应 validCodes 仅含码无 matchedProductId，多产品文件需分次导入（UI 已提示 productGroups 标签与跳过提示）；可后续优化为 parse 按产品分组返回码清单
- **给下一个 Agent 的提示**：①任何入库接口必须与 parse 同口径结构校验（import 是公共接口，勿假设调用方已校验）；②大批量 INSERT 分块写入（5000/批）；③接口返回 skippedInvalid/skippedDup 已拆分，前端勿再按旧语义合并
### 2026-09-04 | 修复生产采集「校验成功但导入必失败」（契约断裂）+ 厂家账号解析 500（双重 WHERE）
- **问题现象**：用户在 /admin/collection 上传桌面码文件（1_25%多·酮可湿性粉剂_200ml_瓶_20260904 (1).txt，100 条），「解析校验」100/100 通过，点「导入 100 条有效码」提示失败。文件码经库内核对 0/100 存在（从未入库），INSERT 手工复现正常——问题不在数据与 SQL 层。
- **排查过程**：API 直测三账号（admin/lvfeng/codeop）× parse/import 组合——意外发现 **parse 厂家账号恒 500**（此前仅总部账号验证未暴露）；import 直传 codes 数组恒 200，与用户现象相反；最终 **CDP 真实浏览器（Edge headless）页面级复现**（DOM.setFileInputFiles 真实文件 → 解析 → 点导入 + Network 请求/响应观测）才暴露真凶：import 请求发出了，响应 400「没有可导入的码」。
- **根因 1：parse 响应缺完整码清单 → 页面构造空数组（提交 7fe926f，用户问题主因）**——parse.post.ts 响应只返回前 20 条 preview（完整 results 从未返回），页面 doImport 却从 `parseResult.results.filter(r => r.valid)` 构造导入码数组 → 恒为空 → import 400「没有可导入的码」。**该契约断裂使生产采集「解析→导入」完整链路自 V1.0 起即不可用**，此前验证均 API 直测（绕过页面构造逻辑）未暴露。修复：parse 响应新增 `validCodes`（全部有效码）；页面改读 validCodes（保留 results 过滤兜底防版本错配）。
- **根因 2：parse 企业过滤双重 WHERE（提交 858fbe7）**——prodCond 前缀误用 `' WHERE enterprise_id = ?'`，拼出 `WHERE status = 1 WHERE enterprise_id = ?` / `WHERE 1=1 WHERE ...` 双重 WHERE 语法错误 → 厂家账号（lvfeng/codeop）解析文件必 500 Server Error。改为 `' AND ...'` 与全库范式一致。全库 grep 复查：generate.post.ts 同款写法但基底无 WHERE（`SELECT code FROM trace_code` + WHERE）实际正确，未动；其余接口均为正确范式。
- **附带修复（提交 aee5f70）**：tsc 报存量错误 nearby.get.ts `String().split(';')[0].trim()`（noUncheckedIndexedAccess 下索引访问为 string|undefined → TS2532），加空串兜底，恢复 tsc 0 基线。
- **修改文件**：server/api/admin/codes/parse.post.ts（validCodes + AND 前缀）、app/pages/admin/collection/index.vue（doImport 取码逻辑）、server/api/stores/nearby.get.ts（TS 类型）
- **测试情况**：tsc 0 错误；生产构建成功（10.5MB）；重建并重启 3100 服务器（现跑修复版）；API 验证——lvfeng parse 200（修复前 500）、validCodes 100 条齐全、import 200；**CDP 页面级全流程 PASS**——admin 登录 → /admin/collection → 真实文件选择（3299 字符）→ 解析 toast「有效 100 / 无效 0」→ 点击导入 → import 请求 200 → **落库 100 条**（验证后清理恢复，trace_code 回到基线 4 条）；Edge headless 需要在全权环境启动（沙箱内 Edge 崩溃退出码 21/-2147483645，临时目录被沙箱重定向所致）
- **遗留问题/待办**：①生产采集页面级完整导入链路建议纳入常规回归（本次暴露 V1.0 起即坏的页面流程，说明验证偏重 API 直测）；②CDP 复现脚本 scripts/_tmp-repro-cdp-import.mjs 保留（_tmp 前缀不入库），复用需全权环境跑 Edge；③其余待办不变
- **给下一个 Agent 的提示**：①**前端依赖 API 响应字段时以接口契约为准，改动 API 返回体前先 grep 前端消费字段**（本次 parse 响应无 results、页面却 filter results，静默空数组 + 400，页面与接口各自看起来都正常）；②**厂家账号路径是验证盲区**——多租户企业过滤 SQL 条件前缀必须用 `' AND ...'`（基底已有 WHERE 时 `' WHERE ...'` 拼出双重 WHERE 必 500），新写接口后至少用 lvfeng/codeop 账号冒烟一次；③验证「页面操作类功能」优先 CDP 真实浏览器而非 API 直测；④Edge headless 启动需全权（无沙箱）环境，profile 目录独立；DOM.setFileInputFiles 前必须先 DOM.getDocument 拿 root nodeId

---


### 2026-09-04 | 后台业务页面 Keep-Alive 缓存（菜单切换保留页面状态）+ 各页重置按钮
- **工作内容**：需求——用户在业务页填表单/筛选后切换左侧菜单再切回，页面保持离开时状态（表单/下拉/筛选/页码），无需重复填写。落地三块：
  ① **缓存基建**（提交 94572ca）：
  - nuxt.config 开启 `experimental.normalizePageNames: true`——页面组件 name 对齐路由名。**机制关键**：NuxtPage 的 Keep-Alive include 按组件 name 精确匹配（源码 page.js：componentName = type.name || __name）；后台页面全是 admin/*/index.vue，不开此开关则组件名全为 'index'，include 会误命中公众首页（同为 index.vue）等一切 index 页面
  - 11 个业务页（数据概览/追溯码生成/码库管理/产品规格/产品/批次/采集/扫码统计/系统设置/风险预警/消息中心）definePageMeta 加 `keepalive: true`——经 NuxtPage 内部 keepAliveInclude 集合自动按组件 name 缓存；登录页（layout:false）/门户首页/404/公众端页面无此 meta → 不缓存，每次进入全新初始
  - **登出清缓存双保险**：①页面 Keep-Alive 实例随布局切换销毁——NuxtLayout 以 layout 名为 key 渲染（源码 nuxt-layout.js：h(LayoutLoader,{key:name})），admin→登录页（layout:false）切换必然卸载 NuxtPage 与其全部缓存实例；②useUser.logout() finally 补 `clearNuxtData()`——清空全部 useFetch/useAsyncData 内存缓存，防切换账号后旧账号接口数据被同 key 缓存复用（数据串号）
  ② **重置按钮补齐**（提交 400daa4）：generator/collection 新增 resetPage（清表单+结果+预览，按钮在页面标题区右侧）；settings 新增 resetPanel（按当前激活 tab 重置：企业信息/通知配置回填已保存值=放弃草稿，用户/日志清空筛选刷新，数据备份提示无表单）；messages 补筛选重置按钮（与其他列表页一致放筛选卡查询旁）；codes resetSearch 补清空批量勾选。既有 6 个列表页（codes/specs/products/batches/alerts/statistics）本就有筛选重置按钮，语义已是「仅重置当前页」
  ③ **数据概览激活静默刷新**（提交 4424688）：概览为纯数据面板（无表单/筛选类用户状态），被缓存后切回沿用旧数字会误导操作；onActivated 首帧守卫跳过（首次进入 useFetch 已取数），缓存激活时静默 refreshStats——onActivated/onDeactivated 用法示例（开发备忘要求的生命周期规范）
- **修改文件**：nuxt.config.ts、app/composables/useUser.ts、app/layouts/admin.vue（注释）、app/pages/admin/ 下 11 个业务页（meta + 重置按钮）
- **测试情况**：tsc 0 错误；全权模式生产构建成功（11.1MB，967 文件）；**CDP 真实浏览器验证 25/25 全过**（Edge headless，脚本 scripts/_tmp-verify-keepalive.mjs，8 场景）——S1 生成页表单（数量 5000 + 产品下拉）菜单切换保留且切回不重复请求列表接口（组件缓存命中未重建，codes 接口仅 1 次）、S2 码库筛选（关键字 + 状态「已绑定」）切换保留、S3 重置按钮只清当前页（码库/生成页互不影响）、**S4 弹窗打开时切菜单无残留遮罩**（keep-alive + UModal teleport 风险点已实测解除）、S5 F5 刷新缓存全清回初始、S6 登出跳登录页 + 重登换账号无残留（7777→100）、S7 数据概览激活时 stats 静默刷新（0→1 次）、S8 登录页重进为空不缓存；SSR 回归 14 页 200（login/首页/trace + 11 后台页带会话）
- **遗留问题/待办**：①CDP 运行时验证已完成（构建曾在沙箱 EPERM + 全权审批无人应答下阻塞数小时，审批策略改 never + 全权后一次通过，耗时约 6 分钟）；②跨布局跳转（后台→门户首页/登录页）会清空全部后台缓存（NuxtLayout key 机制所致）——属设计内行为（需求仅要求左侧菜单切换保留），如需跨布局保留需另行重构布局层级；③验证脚本 scripts/_tmp-verify-keepalive.mjs 保留在 scripts/（_tmp- 前缀不入库），回归可直接复用；④其余待办不变
- **给下一个 Agent 的提示**：①Keep-Alive 机制 = NuxtPage 源码（node_modules/nuxt/dist/pages/runtime/page.js）：页面级 `definePageMeta keepalive:true` 会把该页组件 name 加入 include；**新增缓存页只需加 meta，勿手写 include 列表**；②页面组件 name 依赖 normalizePageNames（开启后 name=路由名），此配置勿删，否则 'index' 同名会让公众首页也被缓存；③业务页状态全部在组件内部 ref/reactive（本项目页面零 onMounted/零 route.query 依赖），keepalive 缓存组件实例即可 100% 保留，无需其它持久化；④F5/关标签为内存级缓存天然清空（JS 不可拦截，开发备忘已确认属设计行为）；⑤沙箱内 nitro 构建/dev 均 EPERM 且全权审批可能无人应答——验证前先确认审批人在线，或让用户手动构建；⑥3100 有历史遗留旧构建服务器进程（脱离 job 常驻），验证新代码前先 taskkill 旧进程

---

### 2026-09-03 | 修复规格编辑状态丢失 + 产品规格下拉停用规格回显两处 bug
- **工作内容**：按 code-review 全量审查（crg + semgrep + tsc + 真机 E2E）发现并修复 2 处规格/产品模块缺陷：
  ① **规格编辑静默停用缺陷**（specs/[id].patch.ts）：常规编辑 UPDATE 中 status 取值 `Number(body.status) ? 1 : 0`——请求体未携带 status 时 Number(undefined)=NaN，NaN 为 falsy 被判为 0（停用），启用中的规格只要编辑时没传 status 就被静默停用（前端现恒传 status 未触发，但 API 缺防御，任何客户端漏传即中招）。修复：未传 status 保留原值（与 products/[id].patch.ts 的 prod.status 语义一致），显式传才覆盖。
  ② **产品编辑规格下拉空白缺陷**（products/index.vue）：规格下拉只查 status=1（启用），但「已被产品引用的规格仅可停用不可删除」（AGENTS.md 规则），编辑绑定停用规格的产品时 USelect 无匹配项显示空白（看似未选规格）。修复：下拉改查全量规格，停用项 label 标注「（已停用）」且 disabled 禁选（新产品只能绑启用规格，历史绑定可正常回显）。
- **修改文件**：server/api/admin/specs/[id].patch.ts、app/pages/admin/products/index.vue
- **测试情况**：tsc 0 错误；生产构建 10.5MB 成功；E2E——不带 status PATCH 启用规格后状态保持 1（修复前会变 0）、显式 status:0 正确停用、恢复 status:1 正常；SSR /login /admin/products /admin/specs 全 200。提交 a0114ce
- **遗留问题/待办**：见 AGENTS.md 待办段；另复查发现规格列表「被引用计数」为全局口径（spec 全局唯一，企业间规格码可重复但 id 唯一），语义正确无需改
- **给下一个 Agent 的提示**：①PATCH 类接口的布尔/状态字段凡有「未传保留原值」语义的，一律先判 `body.x === undefined` 再取 `Number(body.x)`（NaN 陷阱）；②产品规格下拉数据源已含停用项（disabled），新增校验勿改回 status=1 过滤；③规格码企业内唯一可跨企业重复（001 在不同企业并存是正常的）

---
### 2026-09-03 | 追溯码生成自定义段配置固定为平台标准参数（去掉三个下拉框，仅展示不可修改）
- **工作内容**：用户决策——追溯码生成模块的「自定义段配置（码第 12 位后，共 21 位）」全部固定死，防止客户乱配置导致追溯码出错。固定参数：时间戳段=毫秒级、随机数字段=6位随机+2位校验、校验位段=MD5取后2位；用户不可选择修改，只做展示。引用面核查：三个配置项仅存在于 3 个文件（页面 generator/index.vue form + 三个 USelect 下拉、API generate.post.ts body 取值、引擎 code-generator.ts），引擎与其它消费方零关联。
  ① **页面**（app/pages/admin/generator/index.vue）：删除时间戳段/随机数字段/校验位段三个下拉框（旧选项：毫秒级/秒级/年月日/不使用、不使用/8位随机数字/6位随机+2位校验、MD5取后2位/CRC16取后2位/不使用），改为三列只读徽标展示（FIXED_SEGMENTS 常量 + lock 图标 + 浅底只读块，样式对齐规格码只读回显先例）；区块说明文案改「平台已固定，仅展示不可修改」；结构说明同步固定口径「毫秒时间戳 13 位 + 随机 6 位，共 19 位内容 + 末 2 位 MD5 校验位」；form 不再携带配置字段
  ② **服务端**（server/api/admin/codes/generate.post.ts）：FIXED_CONFIG 锁定 { ms, rand6c2, md5 }，生成接口不再读取客户端 timestampType/randomType/checksumType（防绕过乱配）；清理 DEFAULT_CONFIG/TIMESTAMP_TYPES/RANDOM_TYPES/CHECKSUM_TYPES 引用
  ③ **引擎**（server/utils/code-generator.ts）：**零改动**（底层生成逻辑不变，多选项能力保留供离线工具等复用）
- **修改文件**：app/pages/admin/generator/index.vue、server/api/admin/codes/generate.post.ts
- **测试情况**：tsc 0 错误（-p .nuxt/tsconfig.json）；生产构建成功 10.5MB（全权模式——沙箱 partial 下 nitro 打包 EPERM 已复现）；引擎冒烟 300 条——全部 32 位纯数字、唯一，结构=11 头 + 13 位毫秒时间戳 + 6 位随机 + 末 2 位 MD5 校验，校验位按同规则可重算比对；端到端 17/17 全过——登录→生成接口**故意传旧配置值 sec/rand8/crc16 被忽略**、返回 cfg 固定 ms/rand6c2/md5、SSR /admin/generator 200 含三项固定值与「不可修改」提示、旧下拉选项「8位随机数字/CRC16」已从 HTML 消失。提交 16b7efc
- **遗留问题/待办**：①固定参数为平台级写死（非 system_setting 可配），后续若需按租户放开须另行设计；②注意本机曾检出 3100 端口旧构建残留服务器（懒加载 500），冒烟一律用刚构建的服务器；③其余待办不变
- **给下一个 Agent 的提示**：①自定义段配置唯一入口 = generator/index.vue 的 FIXED_SEGMENTS（展示）与 generate.post.ts 的 FIXED_CONFIG（生效），两处必须同步修改；②引擎 code-generator.ts 的 DEFAULT_CONFIG/TIMESTAMP_TYPES/RANDOM_TYPES/CHECKSUM_TYPES 已无 API 引用但保留导出（离线工具/测试可能复用），勿删；③「随机数字段=6位随机+2位校验」选项在启用末 2 位校验位时其内嵌 2 位校验会被 19 位截断规则丢弃（引擎既定行为，与离线工具一致），页面说明按固定口径描述即可

---

### 2026-09-03 | 规格含量单位中文化：下拉选项与存储英改中（仅含量单位，存量由用户自行迁移）
- **工作内容**：用户决策——含量单位下拉选项由「ml、L、g、kg、片、包、粒」改为「毫升、升、克、千克、片、包、粒」，包装单位不受影响；后端存储即为所选中文文本；存量英文缩写数据由用户自行在库中修改（不做迁移）。引用面核查：单位选项唯一定义在 app/pages/admin/specs/index.vue 的 UNITS 常量（筛选下拉与新增/编辑表单下拉共用，单点改动全覆盖）；后端 specs post/patch 仅非空校验、值透传存储，无需改校验；列表/产品建档/扫码页均为展示存储值，存量由用户迁移后自然显示中文。
- **修改文件**：app/pages/admin/specs/index.vue（UNITS 常量中文 + 新增默认单位「毫升」+ 名称占位示例 200毫升/瓶）、scripts/db-init.mjs（content_unit 列注释同步中文口径 + 演示 seed 名称/单位中文化——仅新环境生效，幂等不动存量行）
- **测试情况**：tsc 0 错误；生产构建成功；API 冒烟——新增 contentUnit=毫升 落库（DB HEX E6AFABE58D87 核验 UTF-8）、contentUnit=毫升 筛选命中新增行、contentUnit=ml 筛选仅命中 2 条存量英文行（迁移前预期行为）；SSR /admin/specs 200。提交 ee803d4
- **遗留问题/待办**：①存量英文单位行（本机 id=1/5/7 等 content_unit=ml/L）由用户自行 UPDATE，规格名「200ml/瓶」「1L/桶」如需中文化一并由用户处理；②其余待办不变
- **给下一个 Agent 的提示**：①含量单位唯一选项源 = specs/index.vue 的 UNITS 常量（中文集合），新增其它单位选项勿另起常量；②规格下拉/扫码页展示单位均为数据透传，无需映射层；③本机演示库存量单位仍是英文（用户声明自行迁移），冒烟/演示若需中文先改库

---

### 2026-09-03 | 规格字段精简：规格码企业内自动分配 + 下线「适用剂型」（用户决策：规格不限定剂型，产品建档全量可见）
- **工作内容**：用户提出「新增规格页面的企业合规码与适用剂型能否去掉」。核查澄清：系统中不存在「企业合规码」，实际为「企业规格码」（32 位追溯码第 9-11 位，1049 结构强制段，不可物理删除）——按用户意图将其从人工录入改为**系统自动分配**（界面不再出现录入框，概念上对用户透明）；「适用剂型」（product_spec.dosage_forms）经全库核查**零下游消费**（PRD 5.3 设想的「产品建档按剂型过滤候选规格」从未实现，产品页规格下拉本就全量启用可见），按用户确认整体下线：
  ① **规格码自动分配**（specs.post.ts）：删除 specCode 入参与 3 位数字校验，新增 nextSpecCode()——企业内 MAX 规格码数值 +1 补零 3 位（首个 001、上限 999 报错）；并发撞唯一键 uq_enterprise_spec_code 自动换码重试（最多 5 次）；返回体带 specCode 供前端提示
  ② **编辑不再改码**（[id].patch.ts）：删除规格码修改路径与 dosage_forms；顺带修复既有缺陷——常规编辑 UPDATE 补 status 落库（此前编辑弹窗的启用开关保存不生效，仅列表行内按钮可切状态）
  ③ **列表 API**（specs.get.ts）：移除 dosage_forms JSON 解析映射（列删后 SELECT * 天然无键）
  ④ **页面**（specs/index.vue）：删「适用剂型」多选字段、列表列与 FORMS 常量；规格码输入框改为「保存后系统自动分配（001 起，对应 32 位追溯码第 9-11 位）」提示，编辑模式只读回显（displayCode，细边框浅灰底块）；产品建档规格下拉 label 去掉「（码 xxx）」后缀（码为系统内部概念）
  ⑤ **数据库**（db-init.mjs）：product_spec DDL 删 dosage_forms 列；migrate() 新增幂等删列（information_schema 探测，仿 outer_box_code 先例，已实测执行）；seed INSERT 同步
- **修改文件**：server/api/admin/specs.post.ts、specs.get.ts、specs/[id].patch.ts、app/pages/admin/specs/index.vue、app/pages/admin/products/index.vue（label 一处）、scripts/db-init.mjs
- **测试情况**：tsc 0 错误（fid 类型收窄修复：platform_admin 必传 enterpriseId、企业角色必有绑定企业，两端均显式校验）；生产构建 10.5MB 成功（全权模式——沙箱内 nitro esbuild spawn EPERM）；db 迁移日志「product_spec 删除列 dosage_forms」；API 冒烟全过——列表无 dosage_forms 键、lvfeng 新增自动分配 006（企业已有 001/005，max+1）、编辑改名+停用 status=0 落库、重复名称 400、停用规格退出 status=1 列表；SSR /admin/specs 与 /admin/products 200 无旧字段文案；DB 中文 HEX 核验正常（pwsh 控制台乱码为 GBK 显示层问题）。提交 2e44d16
- **遗留问题/待办**：①总部 admin（platform_admin）在规格页新增仍须指定企业（API 400 提示）——页面无企业选择器为**既有 UX 缺口**（本轮未扩范围，若总部需建规格应补企业下拉）；②历史规格的 dosage_forms 值已随删列丢弃（仅演示数据，无真实损失）；③其余待办不变
- **给下一个 Agent 的提示**：①规格码现在是**系统自动分配**（企业内自增），任何人不要再实现「手填规格码」UI；DB 层唯一键与「规格码=码第 9-11 位」规则不变，code-generator/code-validator 无需感知变化；②migrate 删列先例在 db-init.mjs migrate()（information_schema 探测 + DROP COLUMN，勿用 IF EXISTS——MySQL 8 不支持）；③沙箱内跑生产构建会在 nitro 打包阶段 spawn EPERM 失败，且失败构建会**清空 .output/server/chunks** 使正在运行/后续启动的服务器页面懒加载 404——构建务必全权模式，失败后要重跑完整构建再启服务器；④本机 3100 服务器进程独立于 DSH job 存活（job 显示 completed 但 node 常驻），收尾需 taskkill 对应 PID

---

### 2026-09-03 | 修复数据概览「产品分布」SQL 企业过滤歧义（厂家账号访问仪表盘 500）
- **工作内容**：三轮产品弹窗改造验证期间（lvfeng 全站 SSR 回归）发现既有 bug：stats.get.ts 产品分布查询 `trace_code t LEFT JOIN product p` 后企业过滤条件未限定表名（`enterprise_id = ?` 两表同名）→ MySQL errno 1052 ambiguous 500。历史验证多用 admin（platform_admin 无企业条件）未暴露；厂家账号打开数据概览即报错。修复：与同文件 stockRows 既有处理一致改用 `fidSql.replace('enterprise_id', 't.enterprise_id')` 限定 trace_code；全库 grep 复查无同类隐患（logs.get.ts JOIN 的 ON 子句已限定 l.enterprise_id）。
- **修改文件**：server/api/admin/stats.get.ts
- **测试情况**：tsc 0 错误；生产构建；lvfeng stats 200（productDist 正常）+ /admin SSR 200 + 全后台 11 页 200。提交 3fd51b3
- **遗留问题/待办**：无（其余待办不变）
- **给下一个 Agent 的提示**：凡 `trace_code/scan_log JOIN 其它表` 后追加企业过滤的 SQL，一律显式限定主表别名（t./s.），MySQL 8 对同名列不猜测；stats.get.ts 内 productRows 与 stockRows 两处均已处理

---
### 2026-09-03 | 产品弹窗原药字段升级「下拉+手输」双通道组合框（第三轮需求：双向联动 + 场景化必填）
- **工作内容**：用户第三轮迭代需求：原药登记证号/原药生产企业名称两字段行为重构——①制剂匹配多条原药候选：下拉选项（「证号 | 持有人（原药企业）」）与手动输入两种方式都支持，该场景两字段保存必填（非空即可，自定义内容允许）；②双向联动：修改任一端命中候选自动带出另一端，输入不匹配内容清空另一端并允许自由录入自定义内容；③剂型=原药/母药：回填自身登记信息后保留下拉+手输（候选=同有效成分原药含自身，服务端 originals 接口按成分查询天然返回）；④无匹配场景：候选为空、两字段纯手动（不做联动）
- **实现**：新增 app/components/RegOrigCombobox.vue（组合框：UInput 自由输入 + chevron/聚焦展开候选面板、输入实时过滤、点击候选回填；@mousedown.prevent 防输入框失焦）；products/index.vue 的 computeOriginal 统一按有效成分拉候选（原药产品自身必在候选内），mode 收敛为回填动作+hint+必填标记；新增两个 watch 双向联动（命中带出/不匹配清空），**候选为空（manual/编辑回显 idle）时跳过联动保证两字段自由输入**（修复 v5 C3 实测发现：无候选时清空逻辑误伤自由录入）；保存校验 select 模式两字段均必填（原只查证号）
- **修改文件**：app/components/RegOrigCombobox.vue（新增）、app/pages/admin/products/index.vue
- **测试情况**：tsc 0 错误；生产构建；CDP v5 17/17 全过——A 多匹配（PD20211687 联肼·乙螨唑 10 候选）：面板展开 10 项、下拉选择联动（PD20110598|绍兴上虞新银邦）、手输不匹配证号→企业清空、手输自定义企业保留、手输候选企业名→证号反向带出、两字段空保存拦截、手输命中候选证号保存落库成对；B 母药（EX20200002 百草枯）：自身回填+同成分候选 11 家含自身（输入过滤下先清空再展开）、字段可手改；C 无匹配（PD20211835 苦皮藤素）：manual 提示+纯输入、两字段自由录入互不清空（修复后）；SSR 全站 13 页 200。提交 b56c365
- **遗留问题/待办**：①双向联动规则为字面实现（命中带出/不匹配清空对方）：多匹配场景若用户想两字段都填自定义不匹配内容，后输入的一方会清空先输入方（需求口径如此，自由自定义建议在无匹配或单边场景使用）；②CDP 自动化对 @mousedown.prevent 按钮坐标点击不合成 click，验证脚本需合成 PointerEvent 序列（真实用户无影响）；③其余待办不变
- **给下一个 Agent 的提示**：①原药控件现统一为 RegOrigCombobox（任何模式），不要再加 USelect/只读输入框；②联动 watch 在 candidates 空时必须跳过（否则 manual 自由录入被互清）；③组合框候选=服务端 originals?ingredient=主成分 结果，原药产品自身必在列；④面板有「输入实时过滤」行为（输入框有值时面板只显示匹配项），验证时先清空输入再断言全量候选

---
### 2026-09-03 | 产品弹窗迭代：登记信息回填放开手动编辑（第二轮需求）+ 产品类别回填 + 复配首成分匹配提示
- **工作内容**：用户对上一轮「数据源自动回填」提出迭代：①回填字段（农药名称/登记证号/有效期至/登记类别/持有人/**产品类别(新增)**/剂型/毒性/总含量）全部由「只读锁定」改为「数据源默认值 + 可手动修改」，切换登记产品时以数据源覆盖刷新（用户手改被覆盖）、清空登记产品同步清空登记信息；②产品类别从数据源「农药类别」原值回填，非标值（卫生杀虫剂/杀螨剂/杀螨剂 等）动态并入下拉选项可保留可切换；③原药两字段回填放开编辑（原药/母药自身回填、制剂单匹配回填均可改），多匹配场景登记证号与企业名称均为下拉（同一候选集 v-model 同源双向联动，必填）；④**复配制剂明确取首个有效成分匹配原药**并显示警示文案「本产品为复配制剂，仅基于第一个有效成分匹配原药，请仔细核对」（数据源成分数组>1 判定）；⑤服务端 products POST/PATCH 补产品类别必填 400，空值文案回归通用
- **修改文件**：app/pages/admin/products/index.vue（回填区去掉 disabled/只读标签、类别并入回填区、categoryOptions 动态并入、computeOriginal 三态升级+compound 提示、clearRegFields 含类别）、server/api/admin/products.post.ts + products/[id].patch.ts（+产品类别必填校验）
- **测试情况**：tsc 0 错误；生产构建成功；CDP 30 项全过——回填 9 字段 0 个 disabled（全可编辑）、类别回填标准值（杀虫剂）与非标值（卫生杀虫剂/杀螨剂落库保留）、手改名称后切产品被数据源覆盖、母药自身回填可编辑+新提示文案、复配警示文案显示+首成分（联苯肼酯 10 家）select 模式、双下拉联动一致、多匹配未选保存拦截、复配产品落库（类别杀螨剂/原药成对 PD20110598|绍兴上虞新银邦）、编辑回显 0 disabled、auto 单匹配（2,4-滴丁酸→辽宁先达）回填可编辑、保质期仍无 DOM；SSR 全站 13 页 200 + 新 API 401。提交 434903d
- **遗留问题/待办**：①复配制剂按首个有效成分匹配（PRD 单原药模型限制，多原药完整支持需改模型另议）；②登记证号手动改后服务端按新证号重算多原药必填校验（前端不重算，属预期：仅「切换登记产品」才触发整套重算）；③其余待办不变（真机验证 /scan、微信凭据、D1-D4 等）
- **给下一个 Agent 的提示**：①回填字段现为「默认值可编辑」语义，勿再加 disabled；②验证样本务必用**有效期内**登记证（EX20210082 等 2026-07 前过期的会被候选接口正确过滤，曾造成测试假阳性——v4 误在残留的 WP20110186 电热蚊香片状态上操作）；③复配判定读 row.ingredient_all 长度（服务端候选接口已返回）；④原药多匹配双下拉共用 form.originalRegNo（v-model 同源天然联动），企业名由 origCompanyOf 带出

---
### 2026-09-03 | 产品弹窗接入农药登记数据源自动回填（选择登记产品 → 8 字段只读回填 + 原药三态联动 + 保质期移除）
- **工作内容**：按用户需求改造【新增/编辑产品】弹窗表单。业务背景：以「2026农药登记证大全2.xlsx」（中国农药信息网登记全量数据，97,471 条）为数据源，登记证号为主键匹配，选产品自动回填登记信息减少人工录入：
  ① **数据源入库**：db-init 新增 pesticide_reg 字典表（13 张表）；新增 scripts/import-regdata.mjs 导入脚本（TRUNCATE 重灌幂等、表头核对、Excel 序列号转 DATE、毒性归一化去括号注释、有效成分提取[主成分+成分数组]、登记类别前缀推导）；本地库已导入 97,471 条（原药/母药池 8,831 条，复配 35,716 条）；xlsx ^0.18.5 入 devDependencies；数据源 xlsx 加入 .gitignore（6.9MB 不入库）
  ② **服务端**：server/utils/regdata.ts（企业名归一化匹配/regCategoryOf/findOriginalCandidates）+ GET /api/admin/regdata（候选搜索：持有人生产=按企业名称归一化过滤本厂、委托加工/委托分装=全部；仅有效期内记录；exact 模式供切换生产类型核对）+ GET /api/admin/regdata/originals（有效成分→有效期内原药/母药候选）；products POST/PATCH：保质期不再写入（编辑保留历史值），制剂匹配多家原药时原药登记证号空值 400 拦截（服务端强校验）
  ③ **前端**（products/index.vue 重构 + 新增 RegProductPicker.vue）：生产类型（1 本厂/2、3 全部）→ 归属企业（仅总部，代选决定本厂口径）→ 登记产品远程搜索选择器（防抖，选中回填）；8 个回填字段（农药名称/登记证号/有效期至/登记类别/持有人/剂型/毒性/总含量）只读锁定；原药两字段三态：产品剂型=原药/母药 → 自身回填只读；制剂 → 按有效成分主成分匹配：唯一=自动回填只读、多家=下拉「登记证号 | 企业（原药）」必选、无匹配=留空提示手动补充；**保质期整行 DOM 移除**（新增/编辑皆无，历史值保留，批次页自动计算仅对仍存保质期的老产品生效）；商标改非必填；切换生产类型实时核对当前产品是否在新过滤范围内，被过滤则清空产品与全部回填字段；编辑回显已有数据（不锁定），重新选择产品后按数据源规则重新处理
- **修改文件**：scripts/db-init.mjs（+pesticide_reg DDL）、scripts/import-regdata.mjs（新增）、server/utils/regdata.ts（新增）、server/api/admin/regdata.get.ts + regdata/originals.get.ts（新增）、server/api/admin/products.post.ts + products/[id].patch.ts、app/pages/admin/products/index.vue（重构）、app/components/RegProductPicker.vue（新增）、package.json/lock（xlsx devDep）、.gitignore（xlsx）
- **测试情况**：tsc 0 错误；生产构建成功（10.5MB）；导入脚本幂等重跑（97,471 条）；API 冒烟 12 项全过（制剂搜索/原药候选含边界：氟虫腈 21 家/2,4-滴丁酸 1 家/不存在成分 0 家/本厂过滤 total 5/exact 核对/制剂多原药空值 400）；CDP 真实浏览器三轮合计 73 项通过（29+34+10：新增弹窗无保质期、本厂空态引导、委托加工 30 条自动加载、EX20200001 选中回填 6 字段 + 只读 disabled、原药 21 家下拉、未选原药保存拦截、切换持有人生产清空、保存落库 DB 核验 6 字段、编辑回显、编辑重选产品锁定、单匹配 auto 回填只读、母药自身回填只读）；SSR 全站回归 13 页 200 + 新 API 未登录 401。提交 d2362b3 / 00d4f46
- **遗留问题/待办**：①**演示企业「山东绿丰生物科技有限公司」在数据源中无同名厂家**——本厂过滤按企业名称归一化相等匹配（真实厂家名与登记证持有人一致即可用；本地验证时曾临时改企业名实测后还原）；②复配制剂按「首个有效成分」匹配原药（PRD 产品模型仅单原药字段，35,716 条复配中主成分匹配到原药的走正常三态，若需完整复配原药支持需改数据模型，另议）；③数据源 xlsx 更新（2027 版）时重跑 import 脚本即可；④登记证过期记录已从产品下拉过滤，产品档案侧「登记证过期管控」原逻辑不受影响；⑤其余待办不变（真机验证 /scan、微信凭据、D1-D4 等）
- **给下一个 Agent 的提示**：①新增产品现在**必须先从登记数据源选择产品**（登记字段只读回填），POST 服务端同时校验制剂多原药必选；②本厂匹配的口径在 server/utils/regdata.ts normalizeOrgName 与 regdata.get.ts 的 COMPANY_NORM_SQL，**两处替换链必须保持一致**（股份有限公司→有限责任公司→有限公司→集团→去空格）；③findOriginalCandidates 只取有效期内原药候选，过期原药登记不出现；④批次新建的「有效期自动计算」依赖产品 shelf_life——新产品不再录入保质期，此自动计算对新数据失效（手填有效期），如需恢复需在数据源或产品侧另找保质期来源；⑤编辑产品若改动登记证号会触发服务端按新证号重算多原药必填校验；⑥pesticide_reg 为只读字典表，任何业务写入都不应碰它

---
### 2026-09-02 | 修复侧栏菜单「数据概览」永远高亮（isActive 前缀匹配吞掉全部子路由）
- **工作内容**：后台布局 isActive(path) 用 route.path.startsWith(path + '/') 前缀匹配，数据概览路径为根级 /admin，导致所有 /admin/* 子页面（追溯码生成/码库管理等）都命中前缀，数据概览永远高亮。修复：根路径菜单（/admin）仅精确匹配 route.path === '/admin'，其余模块保持前缀匹配。菜单高亮现在完全跟随当前路由：点击哪个高亮哪个，直达/刷新/客户端切换均正确。
- **修改文件**：app/layouts/admin.vue（isActive + 注释）
- **测试情况**：生产构建 + CDP 真实点击 5 场景全过：①直达 /admin/generator → 追溯码生成高亮、数据概览不高亮；②点击码库管理 → 码库管理高亮；③点击数据概览 → 数据概览高亮；④直达 /admin/codes → 码库管理高亮；⑤点击追溯码生成 → 追溯码生成高亮（DOM class 客观测量，非视觉模型判断）
- **遗留问题/待办**：无
- **给下一个 Agent 的提示**：后台根级路由与子路由前缀冲突的通用模式——精确路径（/admin、/）与前缀路径（/admin/xxx）不能共用同一条 startsWith 判断，根级必须精确匹配优先；本机 3100 跑的是生产构建（.output/server/index.mjs），改源码后需重新 build + 重启进程验证

---

### 2026-09-02 | 删除外箱码管理模块及其关联部分（按用户指示收敛功能边界）
- **工作内容**：用户指示删除外箱码管理（PRD 5.5.6：上传绑定/查询/解绑）。该功能为后台独立模块，数据落在 `trace_code.outer_box_code` 列（无独立表），删除范围如下：
  - **删除后台页面**：`app/pages/admin/boxes/index.vue`（上传解析/绑定/查询/解绑/详情整页）；
  - **删除 5 个管理 API**：`server/api/admin/boxes.get.ts`（列表）、`boxes/[code].get.ts`（箱内码详情）、`boxes/parse.post.ts`（文件解析校验）、`boxes/bind.post.ts`（一对多绑定，事务）、`boxes/unbind.post.ts`（解绑+审计）；
  - **删除入口与冗余字段**：`admin.vue` 侧栏菜单项；`codes.get.ts` 码列表 SELECT 中无人使用的 `outer_box_code` 字段；
  - **数据库清理**：`db-init.mjs` trace_code DDL 删除 `outer_box_code` 列；`migrate()` 新增**条件删列**（查 information_schema 确认存在才 DROP，幂等）——本地库已实测执行删除，历史库/生产库下次跑 db-init 自动清理；
  - **文档同步**：README 后台模块表删除「外箱码管理」行；AGENTS 模块列表与进度段同步（后台剩 11 个模块页，12 张表不变——外箱码本无独立表）。
  - 说明：PRD 需求原文（5.5.6、术语表、数据字典 outer_box_code 行）为需求文档历史口径，按惯例不动；公众端扫码页 `/scan` 与外箱码无耦合（提示文案曾提及「可复用解码层识别外箱码」，属建议性描述，不构成代码依赖）。
- **修改文件**：删除 `app/pages/admin/boxes/`（1 文件）、`server/api/admin/boxes*.ts`（5 文件）；修改 `app/layouts/admin.vue`、`server/api/admin/codes.get.ts`、`scripts/db-init.mjs`、`README.md`、`AGENTS.md`；-571 行
- **测试情况**：全绿——tsc 0 错误；生产构建成功（10.5MB）；SSR 冒烟 `/admin/boxes`、`/api/admin/boxes`、`/api/admin/boxes/bind` 均 404；登录后台（admin/admin123）侧栏含数据概览/追溯码生成、**不含外箱码管理与 /admin/boxes 链接**；码库页 200 无外箱码文案；db-init 首次运行执行「迁移：trace_code 删除列 outer_box_code」，重跑幂等无重复日志；数据库 information_schema 确认列与索引引用零残留；stats/登录等接口 200（数据库连通正常）。提交 b49ec23
- **遗留问题/待办**：①外箱码相关操作日志（历史 operation_log 中「外箱码绑定/解绑」action 记录）为历史数据，保留不动；②其余待办不变（真机验证 /scan、微信凭据、高德白名单、D1-D4 等）。
- **给下一个 Agent 的提示**：①外箱码已全量下线：不要新增读取/写入 `outer_box_code` 的代码（该列已从 DDL 与存量库删除）；②删除历史库冗余列的幂等写法参考 `scripts/db-init.mjs` migrate()（information_schema 探测后 ALTER，勿用 `DROP COLUMN IF EXISTS`——MySQL 8 不支持）；③本次为功能收敛删除，与 557b13a（门店管理）同模式：公众端扫码页与 /scan 的 zxing 解码层可复用于未来其他码类识别，但需先确认有后端支撑。

### 2026-09-02 | 附近农资店切换为高德 POI 周边检索（用户选定数据源方案 1，弃自建门店库）
- **工作内容**：继删除后台门店管理后，用户选定「附近门店」数据源方案 1——**授权定位后由高德实时检索附近农资店**，自建门店库（`agro_store`）彻底退出。
  - **接口重写**（`server/api/stores/nearby.get.ts`）：未定位（缺坐标）→ `located:false` 空数据引导定位；双关键词检索——实测济南 `keywords=农药` 结果干净、`农资` 混入大量「农贸市场/市集」噪音，故按名称过滤（剔除不含农资/农药/化肥/种子/植保/农化/农业词的市场类条目）后合并去重，按 POI 自带 distance 升序截取最近 20 家；高德坐标即 GCJ-02 直接使用；**配额保护**：1km 网格内存缓存 10 分钟（实测二次请求 2ms）；两路查询全失败才 502，未配 key 明确 503，不做假数据（红线）。
  - **字段取舍**：POI 无「许可证/授权/营业时间」数据 → 接口返回 `isAuthorized:false/licenseNo:null/businessHours:null`，页面按字段存在性条件渲染，授权标签与许可证行自动隐藏，前端无需大改。
  - **联动清理**：`db-init.mjs` 移除 `agro_store` DDL 与演示 seed（12 张表）；`nuxt.config` 恢复 `amapWebKey`（POI 用途，仅服务端）；页面文案纠正——副标题去「授权」语义、定位拒绝文案原「已按授权门店优先展示」系自建库时代旧逻辑改为引导开启权限、空状态按定位状态区分（未定位引导/无结果）、新增接口失败错误条+重试按钮。
- **修改文件**：`server/api/stores/nearby.get.ts`（重写）、`scripts/db-init.mjs`（-2 段）、`app/pages/nearby-stores.vue`（文案/状态）、`nuxt.config.ts`（恢复 key 配置）
- **测试情况**：API 8 项全通过（未定位空数据、济南 20 家、噪音过滤、字段/距离齐全、升序、缓存 2ms）；CDP 模拟定位 UI 链路全通过（**注意：headless 需先 `Browser.grantPermissions(['geolocation'])`，否则 override 被当作「用户拒绝」**——未定位引导态 → 授权后 7 家真实 POI 门店列表 + 地图、控制台零错误）；全站 SSR 回归与公众端链路全通过。提交 4c1ebdb
- **遗留问题/待办**：①POI 无「授权经销商/许可证/营业时间」字段，若未来需要这些展示，只能回到自建数据（届时另定维护方案）；②高德 POI 质量为第三方数据，可能出现个别无关「农业公司/帮扶专馆」类条目（名称含「农业」关键词所致），过滤规则如需收紧可移出 GOOD 中的「农业」；③本地库遗留的 `agro_store` 空表（db-init 不再管理）可手动 DROP；④其余待办不变。
- **给下一个 Agent 的提示**：①附近门店接口现在**必须带定位参数**，未定位不再返回任何数据（与自建库时代的「授权优先退化」行为不同）；②高德 POI 检索与地理编码共用一把 Web服务 key，同样受 QPS 限制，服务端缓存勿删；③`agro_store` 相关代码已全量移除（AGENTS 表数量改 12），不要再引用该表。

### 2026-09-02 | 删除后台门店管理模块（按用户指示收敛公众端功能边界）
- **工作内容**：用户指示「附近农资店」不需要门店管理，只需**用户授权位置后展示其附近的农资店铺**；后台门店管理功能删除。本次为功能收敛清理，公众端数据链路保留：
  - **删除**：后台门店管理页（`app/pages/admin/stores/index.vue`）、管理 API（`server/api/admin/stores*.ts` 共 4 个，含地理编码 geocode）、侧栏菜单入口、`nuxt.config.ts` 的 `amapWebKey` 与 `.env.example` 对应说明（真实 key 仍在 `.env`，不入库、无副作用）；
  - **保留**：`agro_store` 表与演示门店 seed、公众端 `/api/stores/nearby`（定位 → 距离排序）、`/nearby-stores` 页面（上一轮按设计稿实现的双布局）。
  - 说明：本次不删 `agro_store` 表——公众端页面数据依赖它；**真实门店数据的来源与维护方式（人工灌库/高德 POI/后续运营后台）待用户决定**，演示门店上线前须替换。
- **修改文件**：删除 5 个文件（`app/pages/admin/stores/`、`server/api/admin/stores*.ts`），修改 `app/layouts/admin.vue`、`nuxt.config.ts`、`.env.example`；-571 行
- **测试情况**：引用核查零残留；tsc 0 错误；生产构建通过；后台 `/admin/stores` 与管理/地理编码 API 均 404、侧栏无入口；公众端 `/nearby-stores` 200 且演示门店 SSR 直出、`/api/stores/nearby` 按坐标命中正常；全站 SSR 回归全通过；并发会话新增的 `/scan` 页不受影响（200）。提交 557b13a
- **遗留问题/待办**：①**真实门店数据来源待定**——当前公众端展示 3 家济南演示门店（seed），上线前需替换为真实数据（方案选项：人工维护入库脚本 / 高德 POI 周边搜索 / 后续运营后台）；②上一轮遗留项不变（微信凭据待提供、上线前域名白名单等）。
- **给下一个 Agent 的提示**：①后台已无任何门店管理入口，公众端数据直接读 `agro_store` 表；若后续接入高德 POI，注意其返回即为 GCJ-02 可直接使用，但 POI 无「授权经销商/许可证」字段，页面相应标签需调整；②注意本项目存在**并发会话**（/scan 扫码页等为另一会话所加），动手前先 `git log` 确认 HEAD。

### 2026-09-01 | 重做「附近农资店」页面（PC 双栏 / 移动端折叠地图 + 底部弹窗，按用户设计稿）
### 2026-09-02 | 公众端「扫一扫」真正落地（用户反馈：手机打开网站无法扫一扫）
- **问题定位**：首页大按钮与 BottomNav「扫码查询」入口均为**占位实现**——只聚焦输入框 + Toast 提示手动输入（index.vue handleScan 注释自述「网页内无法直接调相机」）。用户在手机上点「扫一扫」没有任何扫码能力。
- **实现方案**（新页面 + 核心 composable + 三入口接线）：
  ① **新增扫码页 /scan**（app/pages/scan.vue，fullbleed 无壳布局，沉浸黑底）：取景框四角标 + CSS 扫描线动画 + box-shadow 9999px 框外压暗；识别命中自动跳 /trace?code=（SSR 秒开查询）；顶部栏返回/相册按钮，底部「从相册选择」「手动输入」双降级通道；
  ② **核心 composable app/composables/useQrScanner.ts**：解码分层——**BarcodeDetector 原生优先**（Android Chrome/iOS Safari 17+），**@zxing/library 逐帧兜底**（复用已有依赖，服务端同库生成 DM 码；按需动态 import 分包）；zxing 走 **1x/0.8x/0.6x 多尺度重试**（见踩坑：HybridBinarizer 对特定图像宽度存在解不出相位）；解码循环 RAF 节流 180ms + 防重入；识别结果只认 32 位纯数字码或含 /trace?code= 的 URL，普通二维码静默忽略不误跳；相机启动中文错误归一（权限拒绝/无摄像头/被占用/非 HTTPS），**命中或离开页面即释放相机流**；
  ③ **环境降级策略**（关键约束：微信 JS-SDK 凭据未配置 + iOS 微信系统级禁网页相机）：iOS 微信 UA 自动展示引导（右上角「···」在浏览器打开 / 相册选图识别已拍码图）；getUserMedia 需 HTTPS + 用户手势触发（iOS 强制，页面首屏为「开启摄像头扫码」按钮而非自动请求）；
  ④ **入口接线**：首页大按钮 + BottomNav（扫码项虚拟路径 /q/ 改真实路由 /scan，结果页 /trace 保持高亮）+ AppHeader PC 菜单新增「扫码查询」。
- **修改文件**：app/pages/scan.vue（新增）、app/composables/useQrScanner.ts（新增）、app/pages/index.vue、app/components/BottomNav.vue、app/components/AppHeader.vue
- **测试情况**（全部通过）：tsc 0 错误；生产构建成功；Edge headless CDP——移动视口 18 项（渲染/相机启动 videoWidth=1280/取景框/相册识别跳转/非追溯码忽略+提示/手动输入/微信 UA 引导/控制台零错误）、无 BarcodeDetector 强制 zxing 兜底 4 项（真实覆盖 zxing 前端路径）、PC 视口 3 项；DOM 客观测量 6 项（扫描框 360×360 居中/视频铺满/四角+扫描线+压暗）；vision 抽查布局无错乱（查询结果页演示码 …1001 恰好命中「产品已过有效期」场景，判定正确）
- **过程中发现的两个 zxing 特性**（已记入 AGENTS 踩坑表）：①HybridBinarizer 对图像宽度敏感（同一码 520/600px 解不出、480/640 成功）→ 多尺度重试；②MultiFormatReader 每 reader 失败都打 console.warn（相机逐帧刷屏）→ 改显式 QR→DataMatrix 顺序尝试
- **遗留问题/待办**：①**真机验证**——Android Chrome（原生 BarcodeDetector 路径）与 iOS Safari 17+ 各扫一张真实印刷码，确认 HTTPS 权限弹窗与后置摄像头调用；②微信 JS-SDK wx.scanQRCode 在凭据到位后可作微信内增强（当前 iOS 微信用引导+相册方案）；③扫码页为自定义沉浸式（未用 default 布局），PC 端可正常访问（桌面摄像头/相册/手动输入均可用）
- **给下一个 Agent 的提示**：①网页扫码参考实现 = useQrScanner.ts + scan.vue，新增其他码类识别（如外箱码）可直接复用解码层；②zxing 兜底务必保留多尺度重试；③页面销毁钩子 onBeforeUnmount 调 stop() 释放相机，勿漏；④Node 端可用 PNG 直解脚本思路验证解码算法（无需浏览器）

- **工作内容**：用户提供了「附近农资店」PC 与移动端效果图并要求重做该板块。**技术栈裁决**：规格原文要求 Vue3+Nuxt3+Element Plus+SCSS，与项目实际（Nuxt 4 + Nuxt UI v4 + Tailwind v4）冲突——两套组件库共存会产生 CSS 重置/主题冲突，且违反本项目的统一视觉基调；开工前已与用户确认改用项目技术栈实现，**视觉规格（配色/布局/交互/响应式）全部保留**。
- **实现要点**：
  ① **新增 fullbleed 无壳布局**：default 布局的 480px 移动壳与 PC 居中限宽（max-w-6xl）与「整屏沉浸式地图」规格冲突，新布局让页面自绘顶栏并全宽铺开；
  ② **配色按稿**：背景 `#f8f9f4` / 主色 `#2c5c3a` / 强调橙 `#e67e22` / 卡片 8px 圆角柔和阴影——仅作用本页（scoped + 页内 CSS 变量），不污染全局；
  ③ **PC 双栏**：左 38%（搜索+列表滚动）右 62%（地图整高 calc(100dvh-58px)）；列表 hover/点击联动 marker 高亮与详情卡（marker 容器坐标换算锚点 + 边界收敛防溢出）；
  ④ **移动端**：顶栏（返回+标题+定位）→ 搜索卡 → 列表 → 折叠地图 35vh 可全屏展开（**单一 StoreMap 实例 + 纯 CSS 裁剪**实现，画布恒 100dvh，切换零 resize 抖动）；点击门店弹底部弹窗（详情+拨号橙+导航绿，上滑动画）；
  ⑤ **状态处理**：定位拒绝橙色提示+Toast、空列表占位、无高德 key 降级提示（列表不受影响）；
  ⑥ **修复测试发现的 AMap2.0 兼容问题**：`setFitView` 只接受 [lng,lat] 数组不接受对象（报 getBounds 错），同城点位过密须显式限 maxZoom 否则门店缩成小点。
- **修改文件**：`app/pages/nearby-stores.vue`（重写，-120/+550 行）、`app/components/StoreMap.vue`（新增地图画布组件）、`app/composables/useAmapLoader.ts`（新增加载器单例）、`app/layouts/fullbleed.vue`（新增）
- **测试情况**：Edge headless CDP **双视口 20 项全通过**——PC 1440×900（左 37.9%/右 62.0%、主体不出视口、hover 联动、详情卡弹出含拨号+导航且可关闭、控制台零错误）；移动 375×812（DOM 顺序搜索<列表<地图、折叠 35vh、全屏覆盖视口、底部弹窗贴底可关闭）；全站 SSR 回归 16 项 + 公众端链路 7 项全通过；视觉模型复核配色与分区符合设计稿，按其指摘统一了两端图标/按钮色语言（拨号统一橙）。提交 ae2f609
- **遗留问题/待办**：①微信凭据仍待用户提供；②**页面与 default 布局的关系**——本页脱离默认壳意味着无全局底部导航与 PC 顶部菜单，若用户希望保留全局导航需另行方案（当前按设计稿沉浸式优先）；③3 家演示门店上线前清空；④底部弹窗为自绘（未用 UModal），因其需要 bottom-sheet 形态与拖拽无关的简单呈现。
- **给下一个 Agent 的提示**：①AMap2.0 的 `setFitView` 只接受 [lng,lat] 数组或覆盖物实例；②移动端折叠地图的「画布恒 100dvh + 外层裁剪」技巧可复用于任何「可展开全屏地图」，展开切换不需要 map.resize()；③本页 scoped 样式与 Tailwind 响应式类同时存在时，**scoped 样式会覆盖同权重 Tailwind 类**（如 .pc-topbar{display:flex} 会压过 lg:hidden），两套断点机制不要混用；④vue 作用域样式下 media query 的层叠顺序正常，可放心在媒体查询内做桌面覆盖。

### 2026-09-01 | 接入高德地图（地图渲染 + 地址自动解析坐标），并识破高德地理编码的模糊匹配陷阱
- **工作内容**：用户提供高德两把 key（Web端 JS API、Web服务），据用途分离配置并完成接入。**真实 key 仅写入 `.env`**（已确认被 `.gitignore` 排除且未被 git 跟踪），`.env.example` 只留空占位与用途说明；提交前用 grep 全库复查无明文 key 泄露，并实测前端 HTML 中不含 Web服务 key。
  ① **公众端地图**：`NUXT_PUBLIC_AMAP_JS_KEY` 下发浏览器，`/nearby-stores` 地图正常渲染；
  ② **后台「按地址自动获取坐标」**（新增 `server/api/admin/stores/geocode.get.ts`）：消除上一轮遗留的「门店坐标需人工录入」痛点，高德返回的即 GCJ-02，与门店库坐标系天然一致。
- **本轮最关键的发现——高德地理编码是模糊匹配，不校验会静默写入错误坐标**：实测传入无效地址**不会报错**，而是返回其它省市的兴趣点，且 `level` 仍为「兴趣点」（我原本据此判定为「精确」）：
  - `zzzz不存在的地址xxxx` → 湖南省怀化市「珍珍针织」
  - `阿斯顿发发发` → 广东省深圳市「阿斯顿」
  即：给山东的门店填错地址，系统会把湖南某针织店的坐标当作精确结果写进门店库，公众端「附近农资店」随之失真。**这与本项目曾清理过的「伪造核验接口」属同一类风险——看似有效的假数据**。已加三重防护：①前端连同省/市提交，服务端校验高德返回的 `province`/`city` 与之一致，不一致即 404 并在文案中指出解析结果落在哪个省市；②拒绝「省」「市」级结果（会落到行政中心点）；③仅门牌号/单元号级别标记为精确，其余提示人工复核。另：未配置 key 时明确 503 不返回猜测坐标，接口要求后台登录防配额被刷。
- **修改文件**：`server/api/admin/stores/geocode.get.ts`（新增）、`app/pages/admin/stores/index.vue`、`nuxt.config.ts`、`.env.example`、`.env`（不入库）
- **测试情况**：地理编码 7 项全通过（正常地址解析到门牌号级、两组乱码地址被行政区校验拦截并指明落点、省级/市级精度不足被拒、跨省地址被拒、不传省市向后兼容）；地图 CDP 实测渲染成功（脚本与瓦片/图标请求全 200、`window.AMap` 已加载、容器渲染出 WebGL 画布、控制台零错误、列表 3 家门店）；提交 d630e3a
- **遗留问题/待办**：①**微信凭据仍待用户提供**（AppID/AppSecret + 公众平台配置网页授权域名 www.nz315.cn），到位后需真机走一次授权回调；②高德免费额度有 **QPS 上限**，连续快速调用返回 `CUQPS_HAS_EXCEEDED_THE_LIMIT`（测试时触发过），错误已如实透传，后台按钮为人工低频操作不受影响，但若将来做**批量地址解析必须限速**；③JS API key 会暴露在前端，**上线前务必在高德控制台配置域名白名单**（本地 127.0.0.1 未受限可用）；④演示门店 3 家上线前应清空并导入真实数据。
- **给下一个 Agent 的提示**：①**任何第三方「智能解析」类接口都要假设它会模糊匹配**——高德地理编码对乱码输入照样返回高置信度结果，必须用业务侧已知信息（此处是省/市）做交叉校验；②高德 Web服务 key 与 JS API key **用途不可混用**，前者绝不能下发浏览器；③坐标一律 GCJ-02，高德地理编码返回值可直接入库，但**浏览器定位仍是 WGS-84**，需经 `wgs84ToGcj02()` 转换。

### 2026-09-01 | 修复 4 处 bug：地图选中不居中 / 审计 IP 缺失 / hover 卡顿 / 定时器泄漏
- **工作内容**：按 code-review 全量审查（crg + semgrep + tsc + 真机冒烟）发现并修复 4 处 bug：
  ① **StoreMap defineExpose 快照 bug**（提交 c510cff）：defineExpose({ map, ... }) 在 setup 阶段求值，而 map 是 onMounted 后才赋值的普通变量——暴露给父级的是 null 永久快照，父级 comp.map 恒为 null，导致 PC 端点击门店列表时地图 setCenter 静默失效（marker 直接点击正常因有内部 handler）。改为 getter 暴露实时引用。
  ② **StoreMap hover 全量重建 marker**：原 watch 同时监听 stores+activeStoreId，hover 扫过列表（mouseenter 即更新 activeStoreId）每次都全量删建 30+ marker（高德 DOM 操作）。拆为两个 watch：stores 变化才全量重建，activeStoreId 变化仅增量替换高亮 marker 内容。
  ③ **审计/登录 IP 直连时恒为 null**：audit.ts 与 login.post.ts 只读代理头，本地/内网直连（无 x-real-ip/x-forwarded-for）时 IP 落 NULL，违反 PRD 5.12.4 审计完整性。新增 audit.clientIpOf()：代理头优先 + TCP socket remoteAddress 兜底（含 ::ffff: 前缀剥离），logLogin/logOperation/login 统一复用。
  ④ **nearby-stores 定时器泄漏 + 死代码**：onStoreClick 居中 setTimeout 无清理（页面销毁后仍可能 setCenter），已记录并随卸载清理；清除 __zoneW 死代码（只读无赋值）。
- **修改文件**：app/components/StoreMap.vue、app/pages/nearby-stores.vue、server/utils/audit.ts、server/api/auth/login.post.ts
- **测试情况**：tsc 0 错误；生产构建成功（10.6MB）；重启服务器冒烟——页面/API 全 200（nearby/profile/consumer me/trace/admin 系列）；登录日志 IP 已捕获 127.0.0.1（修复前 null）实测验证
- **遗留问题/待办**：见 AGENTS.md 待办段（微信凭据、高德白名单、D1-D4 等）
- **给下一个 Agent 的提示**：①defineExpose 暴露非响应式普通变量会在 setup 时固化为快照，需用 getter（get map() { return map }）或 ref；②IP 获取统一用 audit.clientIpOf(event)；③地图 hover 高亮用增量更新避免全量重建

### 2026-09-01 | 消费者体系落地：微信登录 + 个人中心 + 附近农资店（并修复两个既有 bug）
- **工作内容**：按用户决策为公众端补齐三项能力（微信公众号网页授权登录、个人中心、附近农资店），**均为前后端一起做**——此前这三块我方后端完全空白。四项架构决策：①微信用**公众号网页授权**（snsapi_userinfo）；②非微信环境**不做备选登录**，仅引导「请在微信中打开」；③「查询档案」与「查询历史」合并为同一份数据；④农资店采用**自建门店库**，高德只做地图与距离。
- **实施要点**：
  ① **消费者身份体系**（提交 6cfb410）：新增 `consumer` 表；`scan_log` 增列 `consumer_id` + 索引（新增 `migrate()` 增量迁移函数，因 `CREATE TABLE IF NOT EXISTS` 不会改动已有表）。**会话安全**：消费者独立 Cookie `nz315_consumer`，与后台共用密钥但 payload 带 `consumer:` 命名空间前缀，**两类 token 不可互换**（后台校验解析出 NaN 即拒，消费者校验强制要求前缀），已双向实测并设合法后台会话 200 作对照组；微信凭据未配置时授权接口直接 503，**不做任何模拟登录**；state 承载回跳路径并强制校验为站内相对路径，防开放重定向。
  ② **个人中心**（提交 2e64067）：`/profile` 三态引导（未配置/非微信/微信内），已登录展示昵称头像与「我的查询记录」（数据来自真实 `scan_log`，不另建收藏表）。修了一处自己写出的 SSR bug——原 `immediate:false` + watch 触发的写法，异步刷新不会被 SSR 等待、首屏必为空列表，改为利用已 await 的登录态直接 `immediate: loggedIn.value`；同时修正 BottomNav 渲染顺序（原实现先渲染全部链接再固定渲染扫码按钮，新增入口后扫码会被挤到末位）。
  ③ **附近农资店**（提交 019837e）：新增 `agro_store` 表与后台「门店管理」页（复用 `b-*` 设计语言）+ 公众端 `/nearby-stores`。**关键设计：不依赖高德密钥即可用**——定位用浏览器原生 API（WGS-84），经 `app/composables/useGeoConvert.ts` 转 GCJ-02 后查询，距离由服务端 haversine 计算（先用外接矩形借 `idx_geo` 缩小范围再精算），高德仅用于地图展示，未配密钥时自动降级为纯列表。
- **顺带修复的两个既有 bug**：
  - **db-init 缺建两张表**（提交 d799728）：脚本只建 9 张表却输出「9 张表创建完成」，而代码实际读写 11 张——`message`（消息中心）与 `system_setting`（库存预警阈值/通知配置）从未纳入初始化，本地库中这两张是当初手工建的。**任何新环境按文档初始化都会缺表**，消息中心/通知配置/数据概览均会报错。已按真实结构补入并把「9 张」改为 `DDL.length` 防再次不同步。
  - **业务操作日志缺失操作人**（提交 5c5ac25）：`audit.logOperation()` 从 `event.context.authUser` 取操作人，但**全代码库无任何地方给它赋值**。实测 174 条日志中，登录日志 134 条完整（`logLogin` 显式传 userId），而**业务操作日志 40 条操作人全为 NULL**（码库管理 29／用户管理 5／系统设置 3／数据备份 2／风险预警 1）——批量作废、用户增删、数据备份等敏感操作无法追溯到人，违反 PRD 5.12.4 与 8.4「审计日志完整率 100%」。已在 `getCurrentUser()` 中挂载上下文，一处修复覆盖全部受保护接口。
- **修改文件**：`scripts/db-init.mjs`、`server/utils/{auth,consumer-auth}.ts`、`server/api/consumer/*`（5 个）、`server/api/{stores/nearby,admin/stores*}`（4 个）、`server/api/trace.get.ts`、`app/pages/{profile,nearby-stores}.vue`、`app/pages/admin/stores/index.vue`、`app/composables/useGeoConvert.ts`、`app/components/{BottomNav,AppHeader}.vue`、`app/layouts/admin.vue`、`nuxt.config.ts`、`.env.example`
- **测试情况**：tsc 0 错误；生产构建通过；db-init 幂等重跑（含迁移不重复执行）；消费者链路 6+7 项全通过（含双向 token 隔离与对照组、篡改签名失效、登录后扫码正确归属、查询记录联表）；微信分支 5 项全通过（授权 URL 含正确 appid 与 scope、**开放重定向被归一**）；个人中心配置态自适应 7 项全通过；门店 8 项 + 坐标转换 4 项全通过（**天安门转换与公认值偏差 17.7 米、境内纠偏 555 米**）；SSR 回归 16 项、CDP 22 项全通过
- **遗留问题/待办**：①**等待用户提供凭据**——微信 AppID/AppSecret（还需在公众平台配置网页授权域名 www.nz315.cn）、高德 JS API key 与安全密钥；配好后需真机走一次授权回调与地图渲染；②`runtimeConfig` 构建时内嵌，运行期覆盖须用 `NUXT_` 前缀（`NUXT_WECHAT_APP_ID` 等），与 SESSION_SECRET 同源踩坑，部署文档需补；③门店省市区为三段手填（无地区字典与级联组件），坐标需人工录入，后续可考虑接高德地理编码自动补坐标；④演示门店 3 家为本地验证数据，上线前应清空并导入真实门店；⑤上一轮遗留项（预警类型列配色、预警统计口径、重置密码原生 prompt、产品登记证过期高亮）仍未处理。
- **给下一个 Agent 的提示**：①**新增消费者相关接口时务必用 `requireConsumer`/`getCurrentConsumer`，不要复用后台的 `requireBackendUser`**——两套身份体系是刻意隔离的；②任何「未配置凭据」的降级路径都**不得伪造数据或假登录**（本项目已因伪造核验接口清理过一次）；③浏览器定位是 WGS-84，本项目门店库与高德是 GCJ-02，**混用会产生数百米误差**，务必经 `wgs84ToGcj02()` 转换；④`event.context.authUser` 现由 `getCurrentUser()` 挂载，新写的审计日志直接调 `logOperation(event, ...)` 即可拿到操作人。

### 2026-09-01 | 清理农码查移植遗留的 767 行死代码（含一个输出伪造核验结果的演示接口）
- **工作内容**：本轮转向「完善前端界面」，以桌面参考项目「农码查」（`C:\Users\Administrator\Desktop\二维码展示网站\农码查-代码`）为视觉参考。调研先行，得到三条结论：
  ① **参考项目是 React 19 + Vite + Radix/shadcn 的 Mock 原型**，与我们的 Nuxt 4 + Vue 3 + Nuxt UI v4 技术栈不同源，代码不可复用；且其业务逻辑全为假（`MOCK_PESTICIDES`、扫码结果按 45%/25%/15%/15% 随机分发、localStorage 假登录），**只能取视觉，逻辑照搬会有害**；
  ② 我们的公众端其实**已经 1:1 复用了它的视觉骨架**（渐变大扫码卡、480px 移动壳、结果页绿色横幅、信息行卡片），视觉差距不大；
  ③ **仓库里已存在上一次移植遗留的死代码**——正是「弄一堆不相关东西」的后果，本轮予以清除。
- **删除清单（每一项均经全仓库引用核查确认零引用）**：`ResultGenuine.vue`(140) / `ResultAbnormal.vue`(141) / `ResultNotFound.vue`(115) / `ResultExpired.vue`(110) —— 与真正在用的 `TraceResult/TraceAlert/TraceNotFound` 功能重复的未接线组件；`RegistrationCompareCard.vue`(59) —— 仅被上述死组件引用的传递性死代码；**`server/api/query/[code].get.ts`(165)** —— 零调用方的「演示版扫码查询接口」，内含硬编码演示产品库，且 `buildCompare()` **返回伪造的登记证核验结果**（登记证存在性/产品名称/生产企业一律硬编码 `pass`），对 1049 合规项目属实质风险；`shared/types/compare.ts`(37) —— 仅服务上述死代码，其登记证比对能力依赖未决项 D2；另移除 `layouts/default.vue` 中 `hideNav` 对 `/result/` 的判断（该路由不存在，系参考项目遗留）。
- **保留**：`/q/:code` 旧路径兼容为活链路（302 重定向至 PRD 3.3 官方格式 `/trace?code=`），未动。
- **修改文件**：删除 7 个文件（`app/components/` 5 个、`server/api/query/` 1 个、`shared/types/compare.ts`），修改 `app/layouts/default.vue`；合计 -768 行
- **测试情况**：引用核查 8 项全部零残留；tsc 0 错误；生产构建通过（10.4 MB / gzip 2.64 MB）；SSR 15 项回归全通过；**公众端专项 7 项全通过**——门户/登录/扫码结果/查无此码均 200、`/q/:code` 仍 302 正确重定向、已删演示接口返回 404、真实接口 `/api/trace` 正常返回 `genuine` 与产品名。提交 945d338
- **遗留问题/待办**：本轮只做了清理（用户明确圈定范围）。调研中已筛出**有后端数据支撑**、可随时开做的两项前端增强：①**扫码结果页「合规校验清单」**——参考页有 4 项核验清单，我们全部有真实字段支撑：`formatValid`（32 位结构校验，**后端已返回但前端从未使用**）、产品解析一致、登记证有效（`resultType !== 'reg-expired'`）、重复查询记录（`firstQuery/queryCount`）；②**首页手动输入区卡片化**（加字段标签、1049 说明、「填入示例」按钮，示例用已 seed 的演示码）。其余参考页功能（用药档案 / 附近农资店 / 异常举报工单 / 登记证查询比对 / 消费者登录与个人中心 / 查询历史）**我方后端全无对应实现**，不应移植。
- **给下一个 Agent 的提示**：①**农码查只能当视觉参考**，它的数据与判定逻辑全是 mock，照搬会把假数据带进合规系统（本轮删掉的伪造核验接口就是前车之鉴）；②移植参考项目 UI 时，**先确认我方 `shared/types/trace.ts` 有对应字段再画界面**，没有后端支撑的区块一律不做；③公众端与后台是**两套视觉基调**——公众端保留农业绿友好风（渐变、圆角 xl、移动壳），后台是本项目另一轮建立的克制 B 端风（`b-*` 类、4px 圆角、无阴影），**勿相互套用**。

### 2026-09-01 | 全后台 12 页 B 端风格统一（抽出共享设计语言 CSS 基座）+ 批次效期预警补齐
- **工作内容**：承接「其余列表页 B 端风格迁移」这条长期待办。此前只有码库管理页完成企业级 B 端改造，其余 11 页仍是小程序轻量风格（大圆角 rounded-xl、阴影浮层 shadow-sm、高饱和彩色药丸标签、primary 绿主按钮），且上一轮记录明确指出「页面色彩全部页面级硬编码，未用主题变量」。本轮没有沿用「逐页复制硬编码 Tailwind 串」的老办法，而是**先把设计语言沉淀成共享 CSS 层再统一迁移**：
  ① **新增 B 端设计语言基座**（`app/assets/css/main.css`，+112 行）：11 个色板变量（`--b-text-title/strong/regular/muted/disabled`、`--b-border`、`--b-divider`、`--b-fill` 等，Element Plus 色板口径）+ 40 个语义类，放进 `@layer components` 保证 Tailwind 工具类仍可覆盖。类族覆盖页面标题（`b-page-title/b-page-desc`）、卡片（`b-card/b-card-clip/b-card-head/b-card-title/b-card-extra/b-card-body/b-card-foot`）、筛选表单（`b-form-grid/b-label/b-label-lg/b-help/b-required`）、表格（`b-table` 内置表头浅灰底+行分割线+hover、`is-selected/b-scroll-x/b-strong`）、标签（`b-tag` + `default/info/success/warning/danger` 五语义色）、操作列（`b-actions/b-sep`）、空状态（`b-empty` 三件套）、分页（`b-pager`）、吸底批量条（`b-bulkbar/b-count`）、提示框（`b-note`）、弹窗（`b-modal` 六件套）、指标卡（`b-stat` 四件套）；
  ② **12 个后台页面全量迁移**到统一类——数据概览、追溯码生成、码库管理、外箱码管理、产品规格管理、产品管理、生产批次、生产采集、扫码统计、系统设置、风险预警、消息中心。统一口径：白底细边框 + 4px 小圆角 + 无阴影、浅灰表头 + 细分割线、浅底深字标签（取代高饱和药丸）、操作列纯文字按钮 + 竖线分隔、主按钮中性深灰、筛选区一律「卡片头 + 带中文标签的栅格 + 底部操作条」三段式；
  ③ **基准页也一并归一**：`codes/index.vue` 原本是硬编码 Tailwind 串的"标准答案"，本轮同样改用共享类，全站只剩一种写法；
  ④ **业务逻辑零改动**：迁移只动 `<template>`，脚本仅把各页「标签配色映射常量」的值换成语义类名（alerts 的 STATUS_STYLE、batches 的 STATUS_STYLE、messages 的 TYPE_STYLE、codes 的 statusBadge/flagBadge、generator 的 SEGMENT_COLORS、index 的 cards/quickLinks/segments），已用「HEAD 版 vs 工作区版 script 块逐行比对」脚本逐页核验；
  ⑤ **独立提交的功能补齐**：迁移过程中发现生产批次列表缺 PRD 5.6 的「效期预警」，按合规要求补上——已过有效期标红「已过期」、距有效期 ≤30 天标黄「临期」，封装为 `expiryBadge()` 纯函数并统一按「当天零点」做整日差，规避 SSR/水合时间差；该功能按提交契约**单独成一次 feat 提交**，未混进风格重构。
- **修改文件**：`app/assets/css/main.css`（设计语言层）、`app/pages/admin/` 下 12 个 `index.vue`（index/generator/codes/boxes/specs/products/batches/collection/statistics/settings/alerts/messages）
- **测试情况**：
  - 源码层审计：`color="primary"`、`rounded-xl/shadow-sm/bg-elevated/border-border/60`、`text-default/text-muted`、`bg-*/10` 半透明彩底、Element 硬编码色值（#303133 等 11 个）**全部清零**；
  - tsc 0 错误；生产构建通过（10.4 MB / gzip 2.64 MB）；构建产物 CSS 中确认 `.b-card` 等设计层类已产出；
  - **SSR 回归 15 项全通过**：12 个后台页 HTTP 200 且新设计类命中 4/4、页面级旧风格残留 0；门户首页 / 登录页 / H5 扫码页回归 200（确认后台改动无外溢）；
  - **CDP 真实浏览器回归 20 项全通过**（Edge headless）：12 页控制台零异常；3 处弹窗真实点击弹出（新增规格 9 控件 / 新增产品 18 控件 / 新建批号 10 控件）且命中 `b-modal`；系统设置 5 个 Tab 面板改用「关键词校验」逐个确认可达（企业信息含"统一社会信用代码"、通知配置含"库存预警阈值"等）；
  - **DOM 客观测量 5 页全通过**（用测量代替主观视觉评估）：筛选控件高度全为 32px（对齐）、标签-控件间距恒为 6px、表格文字溢出 0、页面横向溢出 0px、标签圆角 4px + 浅底深字（emerald-50/#047857）、卡片圆角 4px + 无阴影 + 边框 #e4e7ed；
  - 效期预警专项：CDP 实测批次 2026080101（剩余 0 天）正确渲染「临期」，与接口数据独立计算的期望值一致，控制台无水合不匹配告警。
- **遗留问题/待办**：①**视觉评估模型不可信**——本轮 vision 模型给出的「仍有大圆角/高饱和药丸标签/控件不对齐/文字溢出」四条结论，经 DOM 计算样式实测**全部证伪**（实为 4px 圆角、-50 浅色底、32px 等高、零溢出），后续视觉验收建议以 CDP 计算样式测量为准，vision 仅作辅助且有 429 频控；②统计页图表柱体仍沿用 `bg-primary/70`、`bg-sky/70` 等数据表达色，未收敛为灰阶（如需全灰阶可再调）；③产品列表尚无「登记证过期」高亮（PRD 5.4 业务规则 7 只在批次侧生效），可参照本轮 `expiryBadge()` 模式补 `registrationBadge()`；④`.gitignore` 仍为 GBK 编码（中文注释乱码，不影响规则）；⑤**风险预警页「预警类型」列写死 `b-tag-danger`**（\`alerts/index.vue\` L174）——类型是分类不是严重度，每行都出现红标签会稀释右侧「处理状态」列的红色告警信号，建议改 `b-tag-default` 把颜色让给状态列；⑥**风险预警「已确认违规」统计卡只统计当前页**（`data?.rows?.filter(...)`，翻页数字会跳变），正确做法是 `/api/admin/alerts` 返回全量分状态计数；⑦**系统设置「重置密码」仍用原生 `window.prompt`**（`settings/index.vue` L106）——B 端后台风格不统一，且无法实施 PRD 6.2 要求的密码复杂度策略，应改为 UModal 表单 + 强度校验；⑧PRD 差距项（异步批量任务中心 / 自动备份调度 / 剩余 6 类预警接入）待办不变。
- **给下一个 Agent 的提示**：①**新写后台页面请直接用 `b-*` 语义类**（清单见 `app/assets/css/main.css` 末尾「B 端中后台设计语言」段），不要再手写 Element 色值，否则又会产生第二套风格；②`b-table` 已内置 th/td 内边距与行样式，**不要再给 th/td 写 `px-4 py-3`**；③做「旧风格残留」检测时必须排除 **Nuxt UI v4 组件自带的内部类**——`bg-elevated`（UTabs 容器）、`bg-error/10`（outline error 按钮）由框架渲染而非页面书写，直接字符串匹配会误报（本轮已踩）；④设置页面板可达性别用「字符数阈值」判断（企业信息面板仅 227 字符但完全正常），要用关键词校验；⑤本机构建与 Edge headless 均需放宽沙箱（`spawn EPERM`），验证脚本在 `scripts/_tmp-*`（已被 .gitignore 排除，未入库）。

### 2026-09-01 | 后台剩余 7 处弹窗与 13 处空值下拉全量修复（Nuxt UI v4 迁移收尾）+ 系统设置 Tab 空白与板块重复渲染修复
- **工作内容**：接手后按 PROJECT_LOG 头号待办清理上一轮遗留的同族迁移 bug，并在验证中新发现两处系统设置缺陷：
  ① **UModal（5 页 7 处）**：alerts（showHandle）、batches（showModal）、boxes（showDetail/showUnbind）、codes（showFlagModal/showCorrectModal）、settings（showUserModal）全部由 v3 写法（`v-model` + 默认插槽直放内容）迁移为 v4 写法（`v-model:open` + 内容进 `#content` 插槽），修复「弹窗点不开 + 表单直列渲染在页面下方」；
  ② **空字符串 value 下拉（6 页 13 处）**：reka-ui 禁止 `{ value: '' }`（触发 500 错误页）。筛选类「全部类型/全部状态/全部角色/全部模块/全部结果/全部产品」改由 placeholder 承载、筛选默认值改 `undefined`（alerts 2、batches 1、codes 2、settings 4、messages 1）；表单类「不修改/不绑定」不能丢失可回退语义，改用**哨兵值**——codes 批量修正 `batchId=0`/`qcResult='keep'`、collection 导入 `batchId=0`，提交时归一为 undefined（codes 2、collection 1）；
  ③ **系统设置 UTabs 缺 value（新发现）**：`<UTabs :items="[{label:'企业信息'},…]">` 未给 value，v4 回退为索引 '0'/'1'…，而面板判断写的是 `v-if="tab === 'enterprise'"`，**点击任意 Tab 后 5 个面板全部落空、页面一片空白**（用户权限/操作日志/通知配置/数据备份四个模块实际不可达）。已补 value；
  ④ **系统设置板块重复渲染（新发现）**：「通知配置 + 数据备份」两个板块整段重复出现两次（第 577-658 行与第 495-576 行逐字符相同），切到对应 Tab 会渲染两遍且共用同一份表单状态，已删除重复的 82 行。
- **修改文件**：`app/pages/admin/alerts/index.vue`、`batches/index.vue`、`boxes/index.vue`、`codes/index.vue`、`collection/index.vue`、`messages/index.vue`、`settings/index.vue`（7 文件，+99 / -143 行）
- **测试情况**：tsc 0 错误；生产构建通过（10.4 MB / gzip 2.64 MB）；生产服务器（3000）+ Edge headless CDP 真实鼠标点击**19/19 全通过**——SSR 层 5 页弹窗文案确认不再直列渲染、7 处弹窗点击后 `role=dialog` 真实弹出且内容正确（含外箱码详情/解绑：临时绑定 32 位测试外箱码验证后自动解绑清理）、settings 5 个 Tab 面板逐个切换均正常渲染且无重复、控制台零 JS 异常；另全后台 12 个页面 SSR 200 + 客户端渲染 + 控制台无错回归通过。提交 e05ac71
- **遗留问题/待办**：①**Nuxt UI v4 迁移遗留 bug 至此清零**（UModal/USelect items/空 value/UTabs 已全量排查）；②筛选下拉改 placeholder 后无法单独清空某一项（需点「重置」），若后续要求单项清空可考虑哨兵值方案；③`.gitignore` 为 GBK 编码，中文注释在 UTF-8 编辑器下是乱码（不影响规则匹配，可择机转码）；④其余列表页 B 端风格迁移、PRD 差距项（异步任务中心/自动备份调度/剩余 6 类预警接入）待办不变
- **给下一个 Agent 的提示**：①**Nuxt UI v4 三条硬规则**——UModal 用 `v-model:open` + `#content`；USelect 选项 prop 是 `items` 且 value 不可为空字符串；**UTabs items 必须显式给 value**（否则回退索引，配 `v-if` 判断会静默全空白，无任何报错）；②本机 dev 不可用，改 UI 必须「生产构建 + node .output/server/index.mjs + CDP 真实点击」验证，只看 SSR HTML 会漏掉 v-model 绑定类错误；③沙箱内 `Start-Process`／构建子进程被拒（Access is denied），构建需全权模式；④CDP 验证脚本模式（登录写 Cookie → 导航 → scrollIntoView 后按坐标派发 mousePressed/mouseReleased → 查 `[role=dialog]`）可直接复用，本轮临时脚本按约定未入库；⑤外箱码测试数据的外箱码本身也必须是 **32 位纯数字**（`^\d{32}$`），bind 接口入参是 `pairs:[{outer,inner}]`、unbind 是 `{outer,confirm:'确认解绑'}`

### 2026-09-01 | 产品/规格管理新增表单改为弹窗（UModal v4 迁移修复：v-model:open + #content 插槽 + 筛选下拉 placeholder）
- **工作内容**：用户反馈「产品管理和产品规格管理板块的新增界面直勾勾展示在页面的下方不美观，点击新增按钮才弹出」。排查发现这是 Nuxt UI v3→v4 迁移遗留的**三叠加 bug**：①**UModal 默认插槽语义变化**——v3 默认插槽=弹窗内容，v4 默认插槽=触发按钮（DialogTrigger），内容必须放 #content 插槽；原代码把整个表单放默认插槽，SSR 时被当作 trigger 直列渲染在页面流中（即用户看到的「直勾勾展示在下方」）；②**v-model 绑定无效**——v4 UModal 只有 open prop + update:open 事件，无 modelValue prop，原 v-model="showModal" 绑定无效（点击新增按钮 open 状态根本不更新，弹窗打不开），必须 v-model:open；③**reka-ui SelectItem 空字符串 value 校验**——v4 底层 reka-ui 禁止 { value: '' } 选项（会抛「must have a value prop that is not an empty string」500 错误页），原筛选下拉「全部类别/全部状态」等选项全用空字符串 value，改为 placeholder 承载（筛选值默认 undefined）。
- **修改文件**：app/pages/admin/products/index.vue、app/pages/admin/specs/index.vue（filters 默认值改 undefined、筛选 USelect 去空字符串选项改 placeholder、UModal 改 v-model:open + 表单内容包进 #content 插槽）
- **测试情况**：生产构建通过；SSR HTML 验证两个页面不再直列渲染表单字段；CDP 真实鼠标点击（Edge headless）验证：点击「新增产品/新增规格」按钮后 role=dialog 真实弹出且可见（含完整表单字段、保存/取消按钮），无 JS 异常；提交 a7657ee
- **遗留问题/待办**：**其余 5 个页面 7 处 UModal 仍是同款 bug 写法**（v-model + 默认插槽直放内容）：alerts/index.vue（showHandle）、batches/index.vue（showModal）、codes/index.vue（showFlagModal/showCorrectModal）、boxes/index.vue（showDetail/showUnbind）、settings/index.vue（showUserModal）——弹窗同样打不开且内容直列，需按本页模式迁移；另其他页面筛选下拉若含空字符串 value 选项（batches/alerts/statistics 等）也需改 placeholder
- **给下一个 Agent 的提示**：①Nuxt UI v4 的 UModal 必须 v-model:open + 内容放 #content 插槽（v3 的 v-model + 默认插槽写法在 v4 完全失效且不报错）；②reka-ui SelectItem 禁止空字符串 value，「全部」类选项一律用 placeholder；③v4 USelect 空值（undefined/null）自动显示 placeholder，filters 默认值用 undefined 而非 ''；④本机 dev 不可用，改 UI 后须生产构建 + CDP 验证弹窗真实弹出（仅看 SSR HTML 不够，v-model 绑定错误在 SSR 无报错）

### 2026-09-01 | 产品/规格下拉框加宽修复（完整显示产品名）
- **工作内容**：修复后台多处下拉选择框过窄导致产品名被截断的问题（用户反馈「看不见产品完整名字」）。根因：Nuxt UI v4 USelect 的 trigger 为 inline-flex（宽度只够显示占位符），且下拉面板宽度跟随 trigger（w-(--reka-select-trigger-width)）、选项文字默认 truncate。修复：trigger 加 w-full 撑满父容器、面板加 min-w-72 最小宽度兜底、选项文字 whitespace-normal break-words 允许换行。涉及 7 处下拉：生成页产品选择（用户反馈位置）、生产采集关联产品/绑定批次、产品管理规格选择、批次管理筛选/关联产品、码库管理重新绑定批次。
- **修改文件**：app/pages/admin/generator/index.vue、app/pages/admin/collection/index.vue、app/pages/admin/products/index.vue、app/pages/admin/batches/index.vue、app/pages/admin/codes/index.vue（各 +3 行属性）
- **测试情况**：生产构建通过；服务重启后页面 200；构建产物中确认 min-w-72 已进入 generator/codes chunk；提交 74551b0
- **遗留问题/待办**：其他页面若仍有窄下拉可复用相同三件套（class=w-full + :content min-w-72 + :ui itemLabel 换行）
- **给下一个 Agent 的提示**：Nuxt UI v4 USelect 面板宽度默认跟随 trigger 宽度，长文本选项需显式加宽/换行；本机 dev 不可用，改 UI 后须生产构建验证

### 2026-09-01 | 修复后台下拉框点击无效（USelect items prop + UToaster + 生成按钮笔误）
- **工作内容**：用户反馈「追溯码生成页的产品选择/时间戳段/校验位段下拉框点击无效」，排查定位到**三个叠加问题**：①**USelect 选项不渲染**——项目从 Nuxt UI v3 迁移 v4 后选项 prop 仍是 v3 的 `:options`，v4 已更名 `:items`（options 被透传为无效属性，下拉面板永远为空，点击像没反应）；②**全局 Toast 不显示**——Nuxt UI v4 不再自动注入 Toast 容器（v3 自动），项目 21 处 useToast 无渲染载体，所有操作反馈静默丢失；③**生成按钮点击无效**——doGenerate 首行变量名笔误 `qrResult.value = null`（实际变量 `imgResult`），try 块外同步抛 ReferenceError，选中产品后点生成无任何反应。
- **修改文件**：`app/pages/admin/{generator,batches,alerts,collection,codes,products,specs,messages,settings}/index.vue`（37 处 options→items）、`app/app.vue`（+UToaster）、`app/pages/admin/generator/index.vue`（qrResult→imgResult）
- **测试情况**：三次提交逐项验证——items 修复后 4 个下拉选项渲染/选择联动通过；UToaster 修复后登录失败/生成成功 toast 显示；qrResult 修复后**SSR 模式生产构建 + CDP 真实鼠标点击全链路 8/8 通过**（产品下拉选择→生成请求→结果区+统计→toast→二维码图片输出 QR，无 JS 异常）。排查过程一度误判为 hydration/useId 问题并尝试 routeRules 方案，最终确认真实根因是上述三点（**routeRules 已回退**，SSR 模式本就正常）
- **遗留问题/待办**：①其他页面的 toast/下拉同样受益（同批修复）；②排查中发现的 Nuxt UI v4 USelect 在 SSR 下的 useId 差异（按钮 aria-controls v-0-0-12-x vs 客户端面板 v-0-0-0-x）未造成实际功能问题（reka 面板客户端重建正常），已记录备查；③package-lock.json 仍未同步（新增依赖待联网 npm install）
- **给下一个 Agent 的提示**：①Nuxt UI v4 的 USelect 选项 prop 是 `items`（v3 是 options），**写新页面务必用 items**；②v4 的 Toast 必须显式放 `<UToaster />`（建议放 app.vue）；③CDP 自动化点击下拉选项须用 pointerup 事件（reka 用 pointerup 选择，click 无效）；④headless 窗口点击视口外元素无效，先 scrollIntoView；⑤排查交互问题先查浏览器 console（ReferenceError 直接暴露笔误），再考虑框架问题


### 2026-08-31 | 追溯码生成板块增强（PRD 3.2 自定义段全配置 + QR/DM 二维码图片输出 + 导出命名规范）
- **工作内容**：按用户指示参考离线工具「农药追溯码生成工具」（E:\wokeplace\二维码生成离线软件）增强 Web 版追溯码生成：①生成引擎对齐 PRD 3.2——新增**随机数字段**（8位随机 / 6位随机+2位校验 / 不使用）与**校验位算法选择**（MD5 / CRC16-CCITT / 不使用），36 种配置组合全部保持 32 位纯数字且校验位可重算；②新增**二维码图片输出**（合规第一条：QR/DM 码制）——qrcode（QR，容错 H）+ @zxing/library（DataMatrix）+ pngjs 渲染 PNG，archiver 打包 zip 下载，前 3 张预览，一次性下载凭证（token 60 分钟过期）；③导出增强——TXT 按 PRD 5.5.1 P1 强制命名（企业ID_产品名_规格_日期）、新增 urls.txt（每行完整扫码 URL，PRD 3.3，域名可由 NUXT_PUBLIC_TRACE_BASE_URL 配置）、CSV 对齐离线工具 sn 清单格式（sn/农药名称/登记证号/生产企业/生产类型/规格码/生成时间/绑定状态+分段列）；④生成统计展示（总数/唯一/重码/耗时，参考离线工具）。
- **修改文件**：`server/utils/code-generator.ts`（引擎扩展）、`server/api/admin/codes/generate.post.ts`（新配置+统计+命名元数据）、`server/utils/qr-image.ts`（新增渲染工具）、`server/api/admin/codes/qrcode.post.ts`+`qrcode-download.get.ts`（新增图片生成/下载 API）、`app/pages/admin/generator/index.vue`（页面大改）、`nuxt.config.ts`（public.traceBaseUrl）、`package.json`（+qrcode/@zxing/library/pngjs）、`server/types/cjs-modules.d.ts`（新增本地类型声明）、`scripts/test-code-generator.mjs`（新增回归测试）、`.gitignore`（+.tmp-shot/）
- **测试情况**：tsc 0 错误（TypeScript 7.0.2）；核心逻辑回归测试 144 项断言全过（36 配置组合结构/校验位重算、批量去重、QR/DM PNG 魔数、zip 打包）；生产构建通过；生产服务器 18 项全链路通过（SSR 3 页 200、登录、生成 API 新配置、QR 50 张+3 预览、DM 30 张、zip 下载 PK 头、token 一次性、未登录 403）；Edge headless 截图 + DOM 检查生成页渲染正常（自定义段配置/随机段/校验位段齐全）
- **遗留问题/待办**：①**dev 模式在本机环境不可用**（Nitro 2.13.4 + Node 24 + Windows 中文路径组合 bug：CJS external 依赖生成 file://E:/ 少一个斜杠 → ESM loader 500；inline 配置触发 renderer TDZ，已回退）——开发验证改用生产构建 + node .output/server/index.mjs；②package-lock.json 未同步新增依赖（离线无法 npm install，后续联网后需 npm install 更新 lock）；③离线 EXE 版打包（参考工具 app/ 已有 electron 工程，可把 code-generator.ts 移植）；④其余列表页旧风格迁移待办不变
- **给下一个 Agent 的提示**：①依赖 qrcode/@zxing/library/pngjs 是从参考工具 node_modules 复制的（不入库），新环境 npm install 会从 registry 拉取；②TS7 下「模块化 d.ts（带 import）+ 三斜线引用」失效（实验证实），server/types/cjs-modules.d.ts 必须保持无 import 的全局脚本形态；③tsc 直调 node node_modules/typescript/bin/tsc（npx/npm wrapper 均损坏）；④沙箱内 node 命令勿用管道（Select-String 等会吞输出），需全权模式跑 dev/构建；⑤生产服务器端口 3000，dev 3100（3100 曾有残留占用需先清理）；⑥二维码图片 API 的临时文件在系统 tmpdir（nz315-qr-*），zip 下载后自动清理

# PROJECT_LOG.md — 项目变更记录（Agent 交接档案）

> **本文件是项目的记忆备份**：让后续接手的 Agent 在最短时间内了解项目演进、最近改动与遗留问题。
> **使用规则**：每个参与本项目的 Agent 完成一轮修改后，**必须在「变更记录」最顶部追加一条记录**（不要覆盖历史），并在 `AGENTS.md` 的「项目进度」段同步更新。

---

## 变更记录模板（复制使用）

```
### YYYY-MM-DD | 标题（一句话概括本次工作）
- **工作内容**：做了什么、为什么做
- **修改文件**：涉及的文件路径清单
- **测试情况**：运行了哪些验证、结果如何
- **遗留问题/待办**：未完成事项、已知问题、后续建议
- **给下一个 Agent 的提示**：接手时需要特别注意什么
```

---


### 2026-08-31 | 数据概览板块增强（PRD 5.2/5.5.8：30天趋势折线图 + 快捷入口 + 码库存预警）
- **工作内容**：按用户指示聚焦数据概览板块，对照 PRD 补齐差距项：①扫码趋势由近 7 天条形图升级为**近 30 天折线图**（SVG 自绘：面积渐变 + 折线 + 数据点 + 轴刻度，API 侧补零保证连续 30 个日期点）；②新增 8 个**快捷入口**（生产采集/追溯码生成/码库管理/产品管理/生产批次/扫码统计/风险预警/消息中心，PRD 5.2 P2）；③新增**码库存预警**卡片（PRD 5.5.8：可用码低于 stockThreshold 阈值标红「低库存」、作废占比超 10% 告警，阈值从 system_setting 读取、默认 10000）。
- **修改文件**：`app/pages/admin/index.vue`、`server/api/admin/stats.get.ts`
- **测试情况**：dev(3100) 验证 stats API 12 字段齐全（scanTrend 30 点补零连续、stockThreshold=10000、stockAlerts 正确触发 lowStock+voidAbnormal）；Edge headless CDP 登录真实页面截图 + DOM 检查：折线图 polyline 渲染、快捷入口齐全、库存预警「低库存」红标签与「作废占比 25%」黄标签正常显示；提交 a239510。
- **遗留问题/待办**：①演示数据中个别产品名含乱码字符（数据问题，非 UI，AGENTS.md 已记录）；②本机 Chrome 无法 headless 启动（静默退出 code 0），截图已改用 Edge（同内核 CDP 可用），调试脚本保留在 screenshots/（不入库）；③其余列表页仍为旧风格可继续按码库页模式迁移
- **给下一个 Agent 的提示**：①MySQL 8 中 `generated` 是保留字，SQL 别名/排序勿用（已踩坑两次）；②数据概览折线图为 SVG 自绘（无图表库），坐标计算在 index.vue script 内，改样式注意 viewBox 与 PAD 常量；③vision API 有频控（429），截图验证优先用 CDP DOM 检查（scripts/check-dashboard-dom.mjs 可复用）
### 2026-08-31 | V1.0 生产构建验证通过 + 修复生产登录 500（SESSION_SECRET 未改默认值）
- **工作内容**：按 AGENTS.md 待办优先级执行生产构建验证（npm run build 全量构建 + 生产服务器运行验证），验证过程发现并修复一个生产环境登录故障。
- **验证过程与结论**：
