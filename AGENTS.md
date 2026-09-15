# AGENTS.md — AI 协作指南（项目 Memory 系统）

> **任何接手本项目的 AI 助手，开始工作前必须先阅读本文件。**
> 本文件是项目的长期记忆：记录**用户全局偏好**（所有项目通用）与**本项目状态**（进度/架构/踩坑）。
> 接手顺序：本文件 → `git log --oneline`（最近提交）→ PRD 需求文档（农药追溯码管理平台 PRD 纯净版.md）。

---

## 🧭 用户全局偏好（所有项目通用，必须遵守）

1. **JavaScript 严格模式**：所有 JavaScript / TypeScript 代码一律使用严格模式。
   - ESM 模块（`"type": "module"`）与 TypeScript 文件本身即处于严格模式，无需额外声明；
   - 普通 `.js` / `.mjs` 脚本若运行在非模块上下文，必须在文件顶部显式写 `'use strict';`。
2. **UI 文案一律使用简体中文**：页面标题、按钮、提示语、Toast、错误信息、表单占位符、空状态、报告文案等，全部中文。
3. **代码注释一律使用中文**：函数说明、业务逻辑解释、TODO、关键规则注释全部用中文书写；变量/函数/组件等标识符保持英文命名。
4. **强制提交契约（每个 Agent 必须遵守）**：
   - **一轮修改 = 一次提交**：任何代码/配置/文档修改完成后，必须立即 `git commit`，禁止积压、禁止混合多个主题到同一提交；
   - 提交信息使用中文，遵循约定式提交风格：`feat:`（新功能）/`fix:`（修复）/`docs:`（文档）/`refactor:`（重构）/`chore:`（杂项），正文简述改动内容与原因，便于接手者从 `git log` 快速了解项目演进；
   - **隐私红线**：`.env`、数据库连接凭据、密码、会话密钥等隐私信息**一律不提交**（`.gitignore` 已排除）；提交前自查 `git status`，确认敏感文件未被暂存；
   - **记忆备份**：每次重要变更，除 commit 外还需在 `PROJECT_LOG.md` 顶部追加一条变更记录（模板见该文件），并同步更新本文件「项目进度」段——让后续接手者始终能看到最新状态。

---

## 📌 项目：农资315 · 追溯码管理平台（SaaS）

| 项 | 说明 |
|---|---|
| 定位 | 农药生产企业追溯码管理 SaaS（PRD 依据：农业农村部公告第1049号，2026-11-01 合规硬上线） |
| 技术栈 | **Nuxt 4.5**（Vue 3 + Nitro SSR）+ **Nuxt UI v4**（Tailwind v4）+ MySQL 8.0 + mysql2 + bcryptjs |
| 域名 | www.nz315.cn（扫码 URL 格式：`https://{域名}/trace?code={32位码}`） |
| 参考前端 | 农码查（`C:\Users\Administrator\Desktop\二维码展示网站\农码查-代码`，另有 E:\wokeplace\二维码跳转网站）：**仅作视觉参考**——它是 React 19 + Vite + Radix 的 **Mock 原型**（数据与判定逻辑全为假：MOCK 产品库、扫码结果随机分发、localStorage 假登录），技术栈与我们不同源，**代码与逻辑一律不可照搬**；公众端视觉骨架已 1:1 复用完毕 |
| 文档 | README.md（总览）· docs/DEPLOYMENT.md（部署）· docs/COMPLIANCE.md（1049合规自检） |

### 🛠️ 常用命令

| 命令 | 说明 |
|---|---|
| `start-dev.cmd`（双击）或 `npm run dev -- --host 0.0.0.0 --port 3100` | 启动开发服务器（**端口 3100**！3000 被农码查残留实例占用，勿用 3000） |
| `node scripts/db-init.mjs` | 初始化数据库（建库建表 + 演示数据，幂等可重跑；连接凭据从 `.env` 读取） |
| `node scripts/import-regdata.mjs` | 导入农药登记数据源（pesticide_reg 字典表，97,471 条；数据源 2026农药登记证大全2.xlsx 不入库；幂等重灌） |
| `npm run build` / `npm run preview` | 生产构建与预览 |
| `node scripts/dev-start.mjs --check` | **启动失败先跑这个**（只读体检：node/npm、端口占用、依赖完整性、.env 键、缓存新鲜度，并给出结论与修复建议） |
| `node scripts/dev-start.mjs` / `--clean` | 体检 + 自动清理过期缓存 + 启动服务（`--clean` 表示无条件清缓存） |

**服务托管（计划任务「NZ315 Dev Server」，2026-09-11 起）**：开发服务现由 Windows 计划任务常驻托管，登录自动启动，进程根在 `services.exe → svchost(任务计划程序)`，**不随任何终端/会话关闭而消失**。

| 命令 | 说明 |
|---|---|
| `powershell -File scripts\install-dev-task.ps1` | 注册/更新计划任务（幂等，`-Force` 覆盖；无需管理员） |
| `powershell -File scripts\uninstall-dev-task.ps1` | 卸载计划任务 |
| `Start-ScheduledTask -TaskName 'NZ315 Dev Server'` | 立即启动服务 |
| `Stop-ScheduledTask -TaskName 'NZ315 Dev Server'` | 停止服务 |
| `Get-ScheduledTaskInfo -TaskName 'NZ315 Dev Server'` | 查看上次运行结果与下次运行时间 |
| 服务日志 | `logs\dev-server.log`（dev 输出）· `logs\dev-guard.log`（守护/重启记录）· `logs\dev-task-runner.log`（任务拉起记录） |

### 🗄️ 数据库（MySQL：`nz315`，连接配置在 `.env`，不提交仓库）

14 张表（PRD 第七章 9 张 + message 消息 + consumer 消费者 + **product_original 产品原药多行表**（2026-09-04 原药多行化：复配产品多条原药；product.original_* 单值列已迁移下线）+ **upload_batch 上传文件批次**（2026-09-04 码库聚合改造新增：生产采集每上传一份追溯码文件即一行，trace_code.upload_batch_id 关联）+ **pesticide_reg 农药登记数据源字典表**（97,471 条，登记证号唯一，产品弹窗自动回填；农资店改用高德 POI 实时检索，无自建表；system_setting 配置表已于 2026-09-07 随通知配置功能删除）：`enterprise`（企业）· `product_spec`（产品规格主数据，规格码=码第9-11位）· `product`（产品 SKU，登记证号全局唯一）· `batch`（生产批次，三要素）· `trace_code`（追溯码：两状态 status 1已生成/2已绑定 + 异常标记 abnormal_flag 0正常/1冻结/2作废，正交；含 upload_batch_id 上传批次归属）· `user`（角色 platform_admin/enterprise_admin/code_admin/viewer，bcrypt 密码）· `operation_log` · `scan_log`（含 `consumer_id`，登录消费者扫码归属） · `risk_alert` · `consumer`（微信 openid 唯一，公众端消费者）

演示账号：`admin/admin123`（总部）、`lvfeng/admin123`（厂家）、`codeop/admin123`（码管理员）

### 🧠 核心业务规则（编码与码状态）

1. **32 位追溯码结构**（PRD 3.1）：第1位登记类别(1=PD/2=WP) + 第2-7位登记证号后6位 + 第8位生产类型(1持有人/2委托加工/3委托分装) + 第9-11位规格码（企业规格主数据）+ 第12位后企业自定义
2. **码两状态**：已生成（可查，无生产信息）→ 已绑定（生产日期+批号+质量合格证号三要素齐全，自动流转）
3. **异常标记与状态正交**：作废为终态不可恢复；作废码扫码不展示产品与批次信息
4. **扫码不改变码状态**（无核销动作），仅记录查询日志
5. **登记证号全局唯一**；规格码被追溯码使用后不可修改；同产品下批次号唯一

### 📁 架构约定

- **Nuxt 4 目录规范**：前端在 `app/`（pages/components/layouts/composables/middleware/assets），`~/` 别名指向 `app/`；`server/`（API 与工具）、`public/`、`shared/types/` 在根目录
- 页面：`/trace?code=` H5 扫码页（SSR 首屏秒开）+ `/login` + `/admin/*` 后台（深色侧栏布局 `app/layouts/admin.vue`）
- 认证：`server/utils/auth.ts`（bcrypt 校验 + HMAC 签名会话 cookie `nz315_user`，7天）；守卫 `app/middleware/backend-guard.ts`；**跨站校验允许无 Origin 请求**（API 客户端可用）
- 码校验：`server/utils/code-validator.ts`（32位结构 + 产品/规格匹配 + 查重）
- 主题：`app/assets/css/main.css`（UI4 变量体系，主色沉稳深绿 hsl(142 32% 30%)，圆角 --ui-radius 0.375rem，中后台克制基调）

### ✅ 项目进度（截至 2026-09-12）

**已实现（V1.0 核心）**：
- **码库新建批次绑定与整批修正分离（2026-09-15）**：独立弹窗入口；新建绑定质量合格证号选填，空值存「见箱内质量合格证」；整批修正空值不修改；两弹窗日期可按 YYYY-MM-DD 手输或日历选择，前后端校验真实日期。其他入口与码状态判定不变。
- **域名不可访问排查 + 阿里云上线方案（部署材料三件套 + 操作手册）**（2026-09-12）：① **排查结论**——`www.nz315.cn` 在 AliDNS/114DNS 均为 **Non-existent domain**，裸域 `nz315.cn` 只有 SOA+NS（阿里云万网）**无 A 记录**；本地侧正常（校验文件 16 字节、`localhost:3100` HTTP 200）；`handover/08` P0-2 记载**无服务器、无备案、无证书**。→ 打不开的真因是**域名无解析 + 站点未上线**，与校验文件无关。② **决定排期的硬约束**：微信「网页授权域名」**强制要求域名已备案**（后台对接工信部备案库校验），换香港/海外节点也绕不开；管局审核 1–20 工作日**无法加急**；未备案期间域名不能解析到大陆节点，只能 `http://<公网IP>:3000` 测试。距 2026-11-01 剩 50 天 → **备案是唯一关键路径**。③ **新增 4 文件**：`deploy/setup-server.sh`（幂等：2G swap 防 OOM、Node 22 走 npmmirror 二进制、MySQL8 utf8mb4+08:00、nginx、PM2、firewalld）、`deploy/nginx-nz315.conf`（80→443 + **裸域 301 到 www** 因微信回调取 Host + 反代 `127.0.0.1:3000` + `client_max_body_size 60m`）、`deploy/ecosystem.config.cjs`（PM2，`type: module` 项目必须 `.cjs`）、`docs/上线操作手册-阿里云.md`（备案前置/主体决策/等待期并行项/解析+证书+微信校验+公安联网备案+验收 14 项+故障速查）；另加 `.gitattributes` 对 `deploy/*` 强制 `text eol=lf`。④ **查出两个项目侧缺口**：**前端无任何备案号展示**（`app/` 搜 `备案`/`ICP` 零命中）而工信部要求首页底部标注 → 需补页脚；**登记数据源 xlsx 已不在根目录**（gitignore 排除）而 `pesticide_reg` 97,471 条是产品回填必需 → 手册给出「本机 mysqldump 导单表 → scp → 导入」替代路径（本机 mysqldump.exe 可用）；`backup/nz315_20260905085514.sql` 含全 15 表但**已落后于 09-07 删 `system_setting` 的结构变更**，不宜直接用于生产。⑤ **校验**：`bash -n`、`node --check` 通过，nginx 括号配平 7/7、server 块 3 个，换行符 Python 逐字节实测纯 LF。**未验证：脚本未在真实 Linux 实跑，发行版分支与包名系推断。** ⑥ **本轮犯过一次误报并自更正**：`grep -c $'\r'` 在 Git Bash 下给出「全是 CRLF」的假阳性，据此误做两次转换；`od -c` 与 Python 复核证明文件自始为纯 LF。已记入踩坑表。**代码零改动**，未跑 tsc/构建。
- **微信网页授权域名机制澄清 + 文档校正 + 明文凭据脚本清理**（2026-09-12）：① **澄清回调域名取自请求头 `Host`**（`server/api/consumer/wechat/authorize.get.ts:15-17` 用 `x-forwarded-proto` + `host` 动态拼接），代码**零引用 `SITE_URL`**——原文档「改 `SITE_URL` 后重建」是**无效路径**，已更正 4 处（`PROJECT_LOG.md` 2026-09-07 条目、`handover/03` §3.2、`handover/08` P0-4、本文件待办段，均采用**删除线 + 更正标注**保留历史）；② 删除含**明文 AppSecret** 的 `scripts/_tmp-set-wechat-env.mjs`（未跟踪、未泄漏——全仓库反向扫描确认 AppSecret 仅此一处，其余 4 个凭据键零命中；`_tmp-*` 计数 117→116）；③ 微信域名校验文件 `public/MP_verify_OUOoNSqTrpZkfWli.txt` 就位并**纳入提交**（本地实测 16 字节 / 无 BOM / 无多余换行 / HTTP 200 / 逐字节一致）。**代码零改动**，故未跑 tsc/构建。
- **push 前安全审查（semgrep）+ 代码图谱审查（code-review-graph）+ 交接文档过时项校正**（2026-09-12）：① **semgrep**（隔离 venv `C:\Users\27475\.workbuddy\binaries\python\envs\default`，1.177.0）两轮扫描共 204 条规则覆盖 121 个 git 跟踪文件 → **0 findings**（`--config=auto` 在 `--metrics=off` 下会报错，必须用具体规则包如 `p/security-audit`/`p/owasp-top-ten`/`p/sql-injection`）。② **人工复核补位**（因 semgrep 仅扫 git 跟踪文件）：`server/` **零 SQL 字符串拼接**（全 `?` 占位，`execute()` 走预编译；唯一模板插值只是登录限流提示文案）；`auth.ts` HMAC-SHA256 + `timingSafeEqual` + httpOnly/lax/secure cookie + 生产拒默认密钥；登录 5 次/分钟锁 15 分钟且无用户枚举；公开 `trace.get.ts` 先 `^\d{32}$` 校验、全参数化（**唯一可提风险：该公开接口无速率限制且每次调用都 INSERT scan_log**）。③ **code-review-graph**：MCP 未连接，改读 `.code-review-graph/graph.db`（123 nodes/788 edges），**该图构建于 2026-08-31 且路径全为另一台机器，仅作参考**；安全相关 10 节点最高 `db.ts::execute`(0.85)、`auth.ts` 系列(0.70)，已逐个人工复核无实际漏洞。④ **交接文档 8 个文件校正**：远程仓库「无」→已有 `origin`；`tsconfig.json` 未跟踪→已入库；「dev 模式不可用」→已恢复（并写明**服务自愈靠 `dev-service.mjs` 进程内守护，Task Scheduler 失败后重启在本例不生效**）；环境实测值 node v24.18.0→**v22.22.2**、npm 11.16.0→**10.9.7**、Windows 10.0.19045→**10.0.26200**、路径 `E:\wokeplace`→`C:\Users\27475\Desktop\二维码管理`；计数 155→167 提交 / 128→148 跟踪文件 / 119→117 `_tmp-*` / 64→70 日志条目。**文档双层写法**：保留 `> 生成日期 …` 快照行，其下加「**复核更新**」行标现态，勿直接覆盖快照。代码零改动，故本轮未跑 tsc/构建。
- **开发服务改为 Windows 计划任务常驻托管（根治「服务自己消失」）**（2026-09-11）：背景是用户上一次「合并后拉不起服务」的排查中发现——真正的痛点不是启动失败，而是**服务没有任何守护**（会话/终端一结束就停，项目历史里这条建议已被提过三次未落地）。用户选择「Windows 计划任务」方案，已落地并**实测验证**。**架构（双层恢复）**：① `scripts/dev-task-run.ps1`（任务动作入口，**纯 ASCII** 以免 PS 5.1 误读 UTF-8 中文脚本；所有路径从 `$PSScriptRoot` 推导，不写死中文路径）→ 自己解析 node 绝对路径 → ② `scripts/dev-service.mjs`（**常驻守护**：内部 `for(;;)` 循环跑 dev 服务，子进程崩了就按 3s 起步的指数退避重启，最多 30s；1 分钟内快速失败 5 次则放弃并退出 1，防重启风暴；启动前主动清跨版本残留缓存；端口已被占用则退出 0 不重复启动）→ ③ 计划任务（登录触发器 + **1 分钟心跳触发器**，`IgnoreNew`）。**实测证据**：进程链 `services → svchost → powershell → node(守护) → node(nuxt dev)`，根在 Windows 服务、与任何会话无关；杀掉 dev 子进程后 **3 秒**自动重启（守护日志记 `存活=29.8s` → `3s 后重启`）；把守护整个干掉后，**心跳在排期的 20:02:52 准点拉起**。**环境关键事实（本机特有，务必记住）**：node **不在持久化的用户 PATH 也不在系统 PATH** 中（`[Environment]::GetEnvironmentVariable('Path','User')` 实测无 node），只有 WorkBuddy 注入到它派生的进程里 → **计划任务里不能写 `node`**，必须解析绝对路径；`dev-task-run.ps1` 按「PATH → 扫 `.workbuddy\binaries\node\versions\*\node.exe` 取最高版本 → Program Files」三级兜底，能扛住 node 升级换目录。**踩坑（见下方踩坑表三条）**：计划的「失败后重启」根本不覆盖本例、空 `RepetitionDuration` 导致永不重复、拐在登录触发器上的重复不排期。**新增文件**：`scripts/dev-service.mjs`、`scripts/dev-task-run.ps1`、`scripts/install-dev-task.ps1`、`scripts/uninstall-dev-task.ps1`。日志落 `logs/`（已被 .gitignore 排除）。
- **修复「合并后服务拉不起来」+ 新增启动体检脚本**（2026-09-11）：用户反馈 merge PR #1 后无法启动服务。实测排查结论：**合并本身无罪**（PR #1 只改 3 个文件：`products/index.vue`、`products.post.ts`、`products/[id].patch.ts`，`package.json` 零改动，12 个依赖齐全），真实原因有两条——① 按 AGENTS.md 记录的 `node "E:\software\nodejs\install\node_modules\npm\bin\npm-cli.js"` 启动 → **本机无 E 盘**，直接 MODULE_NOT_FOUND（该路径属另一台开发机，本机 npm 10.9.7 本身完好）；② `.nuxt` / `node_modules/.cache` 是合并前旧世界的缓存，与 vite 配置不匹配 → 依赖优化器**卡死在 `[optimizer] scanning dependencies...`**，Nitro 虽已监听但上游 Vite 未就绪，全站路由返回 **502**。解法：清 `.nuxt`+`node_modules/.cache`(+`.vite`) 后重启即恢复（Vite 秒建、Nitro 约 12s 就绪）。**同时推翻两条长期存在的过时记录**：文档原写「dev 模式在本机不可用，开发验证须退回生产构建」——实测 dev 模式完全可用（`/`、`/login`、`/trace?code=` 全 200；登录签发 Set-Cookie 正常、带 Cookie 请求 `/api/auth/me` 正确返回 admin 用户），该限制已由提交 af33393（xlsx 改内联依赖）修掉。**新增可复用资产**：`scripts/dev-start.mjs`（一体两用——`--check` 只读体检：Node 版本/npm 可用性/3100+3000 端口占用与 PID/12 个依赖完整性/`.env` 键名（只报键名不打印值）/缓存新鲜度（对比 package.json、package-lock.json、nuxt.config.ts 的修改时间；**刻意不拿 git 提交时间当参照**——2026-09-11 实测踩到该误报：我改文档提交后脚本立刻把缓存判成过期，但缓存实际完全正常、服务 6s 就起来了），并输出「结论 + 修复建议」；无参则体检后自动清过期缓存并启动；`--clean` 强制清；`--port` 换端口）+ 根目录 `start-dev.cmd`（双击即启；**纯 ASCII 包装仅调 node**，规避 cmd 读 UTF-8 中文脚本的编码风险，中文提示全部由 Node 输出）。另修正 AGENTS.md 三处过时记录（npm wrapper 路径、dev 模式不可用、npx 备用命令）并把「合并后卡在 scanning dependencies / 全站 502」正式收进踩坑表。
- **新增项目交接文档包（docs/handover/ 10 篇 + scripts/handover-audit.mjs 体检脚本）**（2026-09-10）：为「另一个人快速了解项目现状」产出——① `README.md` 交接索引（40 分钟阅读路径 + 5 分钟上手 + 接手当天必须知道的 6 件事）；② `01-项目总览.md`（定位/状态快照/两端功能地图/角色模型/码的一生/5 条业务规则/演示基线）；③ `02-最新需求.md`（PRD 三层需求优先级 + 版本规划 + 1049 合规对照 + **64 条变更时间线** + 「已下线/未实现」差异清单 + D1-D4）；④ `03-技术文档.md`（技术栈实测版本/架构/环境清单/Git 地址与分支提交规范/代码索引/8 条架构红线/Nuxt UI v4 迁移坑）；⑤ `04-第三方依赖.md`（npm 依赖逐包版本与坑点 + 微信/高德接口实况 + **短信与 OSS 均未接入**的明确结论 + 未接入但规划依赖的外部资源）；⑥ `05-数据库说明.md` + `05-ER图.mmd`（15 张表/字段/索引/ER 图/冗余列 COALESCE 口径/migrate() 迁移表/10 条 DB 踩坑）；⑦ `06-账号与资源清单.md`（5 个后台账号、消费者体系、数据库账号、第三方凭据状态、域名服务器资源、9 项资源缺口）；⑧ `07-项目资产清单.md`（代码/文档/数据/运维/日志/外部参考资产 + 9 项资产风险）；⑨ `08-待办清单.md`（P0 上线阻塞 9 项 / P1 功能 9 项 / P2 技术债 13 项 / 待决项 / 上线验收清单 / 第一周节奏）。**体检实测发现并已记录**：库内多一张遗留表 `agro_store`（门店模块删除后未清理，3 条演示数据、零代码引用）；`tsconfig.json` **未被 git 跟踪**（新克隆环境 tsc 不可用）；`git remote` 为空（155 次提交零远程备份）；数据库**零存储过程/函数/触发器/视图/外键**（已明确写入文档回答交接问题）。脚本 `scripts/handover-audit.mjs` 只读输出 .env 键名与长度（不泄露值）+ 表行数 + 触发器统计，可随时复跑
- **修复修正弹窗「批号已存在必 500」（用户实测修正一直失败，提交 bc33660）**（2026-09-10）：用户想用【修正】把「生成入库」的码绑定生产批次却一直失败。根因：upload-batches/[id]/correct.post.ts 用 `const [exist] = await query(...)` 查同产品同批号，而封装 `query()` 返回**行数组本身**（非 conn.query 的 [rows,fields]）→ exist 是首行对象 → `exist.length > 0` 恒 false → 已存在批号也走 INSERT → 唯一键 batch.uq_product_batch 冲突 → **500 Server Error**（页面只显示「Server Error/修正失败」）。修复：整体接收行数组（一致→归并 / 不一致→400 中文回显库内值）+ INSERT ER_DUP_ENTRY 兜底 + 全库扫描同类风险（仅此 1 处）。验证：tsc 0 + 构建 12.2MB + API 5/5 + CDP 6/6；脚本 _tmp-verify-correct-fix.mjs/_tmp-cdp-correctfix.mjs 可复用
- **追溯码上传支持扫码链接与 CSV 清单（智能提取 32 位码，提交 36536c2）**（2026-09-10）：用户上传生成页导出的 urls.txt（每行 https://域名/trace?code=32位码）必失败——原解析只认纯 32 位数字码。cleanLine 升级为智能提取（parse/import/stock-in 三入口同源）：①优先取链接 code 参数；②整行纯码；③行内独立 32 位串（CSV 首列，边界断言防截取）；④表头行静默跳过；⑤失败文案改「未识别到 32 位追溯码」；⑥采集页格式说明同步。验证：真实 urls 100 行识别正确 + 混合格式 8 行 + urls 变体 import 全链路 + CDP 5/5。**注意：演示/测试基线已变（trace_code 104=用户 100 条生成入库+演示 4 条、batch 1）**；并行线遗留 9 个 tsc 存量错误待处理
- **操作日志按厂家/平台分组（一行=分组；展开明细；组内可独立分页）**（2026-09-09，提交 1d68190）：logs.get.ts 重写双模式——①分组列表：{ rows:[{ id(0=平台), name(平台操作), log_count 全量, hit_count 过滤 }], totalLogs, filtered }，无条件=全部企业+平台组、筛选=命中组 GROUP BY、外层分页=组；②entId&dPage 组内过滤后明细分页（内部可分页，越权兜底）。前端日志面板同构用户权限页：外层 3 列+展开行内嵌 7 列明细（原字段全保留）+组内分页条（每页 10、按组缓存+序号防竞态）；筛选命中自动展开（watch filtered）；重置清折叠与明细缓存。验证：tsc 0 + 构建 12.1MB + API 8 场景 + CDP 16/16。**logs 契约已变（无参=分组/带 entId=明细页）；GROUP BY 勿 [x] 解构、COUNT 单行勿再 [0]；label 定位严格 ===**。
- **厂家续费状态与删除厂家（用户权限页）**（2026-09-09，提交 b84844e）：enterprise 新增 renew_expire DATE（续费到期日，NULL/早于今天=到期未续费；db-init DDL+migrate 幂等+seed 过期演示；存量企业1=2027-12-31/企业2=2026-08-01）。厂家行新增【续费状态】列（有效期内绿/到期未续费红/平台—）+【续费设置】弹窗（PATCH /enterprises/:id/renew，登记/清空到期日）+【删除厂家】（DELETE /enterprises/:id：5 张业务主表引用则 400 保护防孤儿，事务级联删该厂全部 user，审计）。登录与守卫双闸：login.post.ts 与 auth.ts requireBackendUser 均校验 status=1 且 renew_expire>=CURDATE()（SQL CURDATE 口径），到期未续费→403 拦截登录且已登录会话业务请求同样 403（7 天会话跨到期点也锁）。users.get.ts 组行返回 renew 三元组+can_delete，keyword 双通道（账号信息或厂家名称 LIKE，名称命中整厂返回）。验证：tsc 0 + 构建 12.1MB + API 14 项 + CDP 28/28 + 分组回归 23/23。**改启停口径须同步 login 与 requireBackendUser 两处；[id]/ 子目录端点 import 需 4 级 ../；日期判定勿用服务器 UTC**。
- **用户权限列表按厂家分组展示（一行=厂家 + 展开明细；筛选自动展开命中厂家）**（2026-09-09，提交 5cdcf0c）：后端 users.get.ts 重写为分组结构 { total(厂家组数), totalUsers, filtered, rows:[{ id, name, user_count(全量), users(明细带 roleLabel) }] }——无条件=企业全量+「平台总部」虚拟组（id=0=enterprise_id IS NULL 总部账号，仅 platform_admin、排最后）；筛选态=命中用户所在企业去重、组内仅命中用户（keyword 内存过滤兼容 LIKE ci）；权限/新增用户/重置密码/启用禁用端点零动；前端 settings 用户面板重写：外层表 3 列（厂家名称/用户总数/展开收起），展开行内嵌 b-table 子表 7 列明细（平台账号仍『总部账号』禁操作），expandedEnts Set 展开态翻页/刷新保留，watch(userData) filtered 时自动展开命中组，重置清展开；统计『N 个厂家 · M 个账号』+『命中 N 人』徽标。验证：tsc 0 + 构建 12.1MB + API 7 场景 + CDP 23/23（展开折叠往返/筛选自动展开/op2 启用禁用自还原/厂家视角/零 JS 异常）。**users 接口契约已变（rows=分组），消费方注意；量大改 SQL 分组；CDP 计厂家行按『个账号』特征**。
- **企业基本信息精简为 8 字段 + 7 项必填（前后端同口径）**（2026-09-08，提交 bae1067）：按用户要求删 企业官网/注册地址/企业简介 三项输入（厂家单企业表单与总部编辑弹窗两处同步）——后端 GET /settings/enterprise、factories 列表（改显式列清单，原 SELECT e.*）不再返回，PATCH UPDATE 不再写回（**DB 列保留**，存量值不受影响）；必填（带*）：企业名称/统一社会信用代码/联系人/联系电话/法定代表人/农药生产许可证号/资质到期日——前端 ENT_REQUIRED+checkEntRequired 拦截（toast 请填写：XXX），后端 [id].patch.ts requiredFields 同口径 400；单元识别码保留可空；保存按钮等其余逻辑不变。存量企业补齐必填（企业1 补信用代码；企业2 全补=db-init 种子同值），db-init 种子 INSERT 扩列。验证：tsc 0 + 构建 12.1MB + API 8 项（含缺项逐一 400 文案精确、三列零返回零回写）+ CDP 19/19（7 星号名单/空值拦截不提交/恢复保存成功/零 JS 异常）；脚本 scripts/_tmp-cdp-ent-req.mjs 可复用。**改必填口径须同步前端 ENT_REQUIRED 与后端 requiredFields；PATCH 为全列覆盖式 UPDATE，未来加可空字段需防误清 NULL**。
- **系统设置企业信息 Tab 按角色分流：总部=入驻企业列表+行内编辑弹窗；厂家=编辑本企业资料**（2026-09-08，提交 9df421f）：管理员打开 企业信息 看到并编辑的是企业 1 资料（GET /settings/enterprise 总部回退 `enterprise_id || 1` 的历史取巧）。现按角色分流（纯前端，后端零动）：总部渲染「入驻企业列表」（数据源 /api/admin/factories=enterprise 表列表+user_count，8 列：名称/信用代码/联系人/电话/状态/账号数/入驻时间/操作），行【编辑】弹窗=既有 11 字段全量回填+状态 启用/禁用 下拉，保存 PATCH /settings/enterprise/:id（本就允许总部改任意企业含 status）；厂家/码管理员保持原单企业表单。验证：tsc 0 + 构建 12.1MB + CDP 34/34（改企业1电话+状态禁用保存→行实时更新→落库核验→API 还原后 DB 复核；lvfeng 表单回填；用户 Tab 新增用户企业下拉回归；零 JS 异常）；脚本 scripts/_tmp-cdp-ent-tab.mjs 可复用（自还原）。

- **新增产品弹窗移除 5 段辅助说明小字**（2026-09-07，提交 712ee15）：用户要求弹窗只留控件/label/红*/标题。删 3 段（products/index.vue：b-modal-sub + 两处 b-help）+ 2 段（RegProductPicker.vue：搜索框下提示 + noEnterprise 空态提示）；emptyReason='noEnterprise' 赋值保留仅去 UI。验证：tsc 0 + 构建 12.1MB + CDP 13/13 + SSR 200。**注意：该弹窗其余空态提示（noOwn/无结果/选中规格净含量）不在清单仍保留**
- **修复规格导入模板下载 404**（2026-09-07，提交 f244970）：用户反馈「点下载模板返回 404」——CDP 复现根因：a 直链下载被 Nuxt 客户端路由拦截为站内导航（URL 变 /templates/... 无路由 → 404 页，零网络请求；服务器直连 200 正常）。修复：Blob 程序化下载（fetch blob → objectURL → 临时 a.download.click），页面不跳转。验证：tsc 0 + 构建 + CDP 6/6（URL 停留无 404/下载事件/文件名/20525 字节落盘）
- **删除通知配置功能（系统设置剩四 Tab）**（2026-09-07）：按用户指示整体下线「通知配置」——settings Tab/面板/开关/库存阈值/日报时间、notify.get/notify.put API、system_setting 表（DDL+存量库均删，14 张表）、数据概览「码库存预警」卡（其阈值唯一来源即通知配置）一并清除；**消息中心保留**（站内信与通知配置无关）；stats.get.ts 去 stockThreshold 逻辑。验证：tsc 0 + 构建 12.1MB + db-init 14 表 + SSR（4 Tab 在位/notify 404/无库存卡）+ CDP 真实点击 5/5。**CDP 点击 Tab 必须 Input.dispatchMouseEvent（合成事件 reka 不接受）**
- **规格批量导入（Excel）**（2026-09-07，提交 f039beb）：右上角【新增规格】旁加【批量导入】；弹窗 = 模板下载（public/templates/spec-import-template.xlsx，与用户桌面模板同构——单列「规格」，80 条标准行：净含量数值+中文含量单位+斜杠+包装单位如 200毫升/瓶；原 116 行中 36 行无法拆分已按用户指示从模板删除，原文件备份系统临时目录、桌面原文件被 Excel 占用改出「-标准版.xlsx」）+ 归属企业下拉（仅平台管理员）+ Excel 上传 + 结果明细（成功/失败条数 + 行号/内容/原因表）。后端新 POST specs/import（multipart、xlsx 打包 +2.2MB、文件内/库内查重、事务入库、规格码事务外基线 MAX 内存递增、上限 5000/10MB）；规格码分配抽共享 utils/spec-code.ts。验证：tsc 0 + 构建 12.7MB + API 7/7（混合文件 20 成 3 败明细精确/二次导入全重复失败/码连续/解析正确）+ 平台场景 3/3 + SSR + CDP 9/9：右上角【新增规格】旁加【批量导入】；弹窗 = 模板下载（public/templates/spec-import-template.xlsx，与用户桌面模板同构——单列「规格」，80 条标准行：净含量数值+中文含量单位+斜杠+包装单位如 200毫升/瓶；原 116 行中 36 行无法拆分已按用户指示从模板删除，原文件备份系统临时目录、桌面原文件被 Excel 占用改出「-标准版.xlsx」）+ 归属企业下拉（仅平台管理员）+ Excel 上传 + 结果明细（成功/失败条数 + 行号/内容/原因表）。后端新 POST specs/import（multipart、xlsx 打包 +2.2MB、文件内/库内查重、事务入库、规格码事务外基线 MAX 内存递增、上限 5000/10MB）；规格码分配抽共享 utils/spec-code.ts。验证：tsc 0 + 构建 12.7MB + API 7/7（混合文件 20 成 3 败明细精确/二次导入全重复失败/码连续/解析正确）+ 平台场景 3/3 + SSR + CDP 9/9
- **规格列表操作列改造：移除停用/启用，新增删除**（2026-09-07，提交 a1a81a3）：用户五项要求——操作列只留编辑+新增【删除】；被引用（ref_count）>0 删除置灰（外层 span title「已被 N 个产品引用，不可删除」）、=0 可点；点击弹确认框确认后删除；其余列/分页/样式原样。后端原无 DELETE（经确认新增最小端点 specs/[id].delete.ts：归属校验 + 被引用>0 400 防绕过 + logOperation 审计）；状态列与编辑弹窗开关保留（停用入口收敛到编辑弹窗）。验证：tsc 0 + 构建 + API 5 场景（引用 400/无引用 200/重复与不存在 404）+ CDP 12/12（操作列按钮序列/置灰+title/弹窗取消与确认/删除后行消失+库核验/控制台零错误）
- **批次三字段行常驻基础信息表**（2026-09-07，提交 94b1aca）：用户反馈「三个字段行没见到」——根因 9d2e9f2 把批次三行包在 v-if="isBound && batch"（仅已绑定显示），未绑定演示码页面不渲染。修正：三行无条件渲染 + batch?.xxx || '-' 占位（与基础字段 '-' 风格一致），已绑定显示真实值；删无消费 isBound。验证：tsc 0 + 构建 + SSR（未绑定三行全在值 '-';临时绑定 …1002 显示 2026080101/2026-08-20/2028-08-19 后还原）。**教训：演示码全未绑定——「看不到字段」类反馈先确认码绑定态，勿用绑定态条件隐藏常驻字段行**
- **溯源结果页删除「批次信息」区块，批次三字段并入基础信息行**（2026-09-07，提交 9d2e9f2）：用户反馈（续上轮）——「批次信息」标题及整个区块 DOM 删除；生产日期/有效期至不能丢（澄清确认三字段一起并入）。TraceResult.vue：批次小节整体删除，批次三行（生产批次号/生产日期/有效期至）改以基础字段同款行样式紧随基础字段 v-for 后渲染（v-if="isBound && batch"）；未绑定码无批次数据→不留任何占位直接接原药小节。后端零动。验证：tsc 0 + 构建 + SSR 双场景（已绑定：无批次标题/三字段顺序正确；未绑定：无标题无字段无提示）。**注意：TraceResult 中「批次信息」字面已清零（TraceAlert 异常页从无批次标题，勿混）**
- **溯源结果页移除未绑定橙色提示**（2026-09-07，提交 92e437b）：删除批次信息小节下提示「该码尚未绑定生产信息，请联系企业（生产厂家）」与警告图标（TraceResult.vue v-else 块 -4/+1）；【批次信息】标题模块保留，已绑定码正常展示三字段，未绑定码区域直接留空；后端零改动。验证：tsc 0 + 构建 10.7MB + SSR（未绑定 …1001 无提示残留/批次标题在位/无批次字段；冻结 …0004 分支不受影响）。注意：PRD/README 中该提示描述为历史原文，按用户最新决策覆盖
- **溯源查询结果页单卡片布局重组**（2026-09-07，提交 dce8a8d）：【产品基本信息】成唯一业务卡——批次（三要素/未绑定提示）、原药（单组/复合多行循环）、产品图片小节并入卡内，删独立原药卡/批次卡；DOM 删除质检信息模块（检验结果/合格证号/报告号）、查询记录模块（次数/最近扫码）、「信息有误」反馈按钮；横幅副行改中性文案；保留横幅/32 位码+复制/顶部返回/底部【返回】/页脚提示。纯前端改动（TraceResult.vue），API/类型零动。验证：CDP bound 10/10 + 未绑定 3/3 + SSR 200。**提示：接口仍返回质检/查询记录字段（后端不动），页面不再消费勿误删**
- **扫码页完整展示复合（多原药）原药组分**（2026-09-07，提交 8b64064）：TraceResult 原药区块改读 product.originals 数组（此前引用已删单值字段致原药区块自 V1.0 从未显示）——单原药保持原两行样式；多条循环分组「原药组分 N」各自完整展示证号+企业（不合并）；标题「共 N 个原药组分」。演示：25%多·酮补真实第二原药行（三唑酮）作复合样本。验证：CDP 7/7（复合 2 组/单行回归/样本恢复）+ SSR 200。**踩坑：vue 模板引用已删字段纯 tsc 查不出（模板类型检查不在项目 tsc 范围），组件改字段先 grep 模板消费**
- **归属企业候选=登记数据源全部厂家**（2026-09-07，提交 4fffd75）：用户澄清候选应为 pesticide_reg 全部生产厂家（DISTINCT 3,637 家）而非系统 enterprise 表。新 API regdata/factories（远程搜索分页）；regdata 候选支持 company 参数（持有人生产按厂家名精确过滤，与数据源同源）；EnterprisePicker 重写远程搜索（modelValue=厂家名）；products POST 总部 body.company → 服务端归一化解析已入驻系统企业，未入驻 400 提示（enterprise_id NOT NULL 护栏）。厂家账号保留 enterpriseId 老路径。验证：API 8/8 + CDP UI 5/5 + lvfeng 回归 + SSR 200
- **修复归属企业下拉不展开厂家列表**（2026-09-07，提交 f1b74f6）：用户反馈持有人生产下企业下拉未全展示。双修复：①EnterprisePicker/RegOrigCombobox 面板展开改根容器 @click 驱动（UInput @focus 透传链不可靠，实测点击聚焦不开面板）；②products factoryData 加「打开新增弹窗时列表空则客户端 refresh」双保险（条件 immediate 在缓存/keepalive 路径下可能未加载）。验证：CDP 两种生产类型下点击企业框均全量展开 + 过滤 + 选中回显
- **产品弹窗：归属企业可搜索全量选择器 + 原药多行化**（2026-09-04，提交 4a67502）：①EnterprisePicker 替代企业 USelect——三种生产类型下均展示完整厂家列表（去掉持有人生产限制）+ 输入关键字实时过滤点击选择；②原药（母药）信息多行（product_original 表，product.original_* 列迁移后删）：行列表+添加/删除行（至少 1 行、单行禁删），每行双字段 RegOrigCombobox（候选=登记产品全有效成分池 findOriginalPool，复配合并去重）+同行双向联动；切换登记产品清空全部行并按新成分初始化首行；标题提示「有效成分匹配到 N 家…保存必填，多原药请点击添加行」、复配黄条「请核对每个有效成分对应的原药信息」；保存至少 1 行且每行两字段必填（服务端同口径）；products 三 API 多行化（事务/聚合 JSON_ARRAYAGG）、originals API ?regNo= 池模式、trace.get 返回 originals 数组。验证：tsc 0 + 构建 10.7MB + 迁移实测 + API 冒烟 + CDP v6 20/20 + SSR 22 页 200
- **侧栏菜单两项改名**（2026-09-04）：生产采集→追溯码上传、批次管理→效期预警（仅 label，路由/图标/权限/后端零改动）
- **数据概览下线「快捷入口」板块**（2026-09-04）：按用户要求删除快捷入口标题/8 宫格卡片/链接与 quickLinks 定义，其余统计板块随布局自然上移；构建 + CDP 验证五张卡齐全无残留
- **追溯码生成支持入库留档——「已生成（未绑定）」状态恢复业务意义（方案 A，提交 4918fb8）**：用户质疑强制绑定后未绑定态无意义，拍板方案 A。①新 API stock-in：生成码入库为已生成（结构校验/查重/归属校验 + upload_batch 建档 + 分块插码）；②生成页「入库留档（状态：已生成）」按钮；③码库整批修正新增「新建批次绑定」模式（自动建档/归并批次并绑定行内全部已生成码，闭环打通：生成入库→码库绑定→扫码完整展示）；④修复 execute 被数组解构 500。验证：tsc 0 + API 8 项 + CDP 12 项全过；脚本 _tmp-verify-stockin.mjs 可复用。**码的入库双通道：import=采集绑定入库；stock-in=生成留档入库**（校验/建档逻辑同构需同步改）
- **数据维护：清理测试批次与验证残留，修复演示数据**（2026-09-04）：删除并行线验证残留批次 20260904/2026090417（200 码+2 批次+空壳上传批次行）与演示批次 2026080101（关联 2 码解绑转未绑定保留）；补回演示码 …1005、1002 挂历史数据行。**当前演示基线：trace_code 4 条（1001/1002/…0004/…1005 全未绑定）、batch 0 条（批次页空态）、upload_batch 1 行**——需要「已绑定」演示样本时用桌面码文件走生产采集导入（自动建档）
- **批次码明细弹窗单行操作列新增【删除】按钮**（2026-09-04，提交 5032f8d）：明细行（批次列表【详细】弹窗）操作列 冻结/作废/修改 后新增【删除】——确认后**仅删除当前这一条码**（DELETE /api/admin/codes/:id），不影响同批其他码与 upload_batch 行，成功后 loadDetail+refresh 刷新；**置灰约束：已绑定码（status=2）禁删**（服务端同语义 400 防绕过；作废但未绑定的码也可物理删除——判定与 abnormal_flag 正交），hover 提示外层 span 承载（disabled 不触发 title）；三个行态分支均追加按钮。验证：tsc 0 + 构建 10.7MB + API 9/9 + CDP 8/8 + SSR 200；脚本 _tmp-verify-rowdel.mjs/_tmp-cdp-rowdel.mjs 可复用
- **上传批次列表操作列新增【删除】按钮**（2026-09-04，提交 81a155e）：批次行操作 详细/冻结/修正 后追加【删除】。交互：二次确认（删除批次与批次下全部追溯码，不可恢复）→ DELETE /upload-batches/:id 事务删除码+行；**置灰约束：批次内任意已绑定码（status=2）即禁删**（聚合列表新增 bound_count/boundCount/canDelete，与冻结/作废正交勿混），hover 提示用外层 span 承载（disabled 按钮自身不触发 title）；服务端同语义 400 防绕过；生产批次/扫码历史不随删。验证：tsc 0 + 构建 10.7MB + API 10/10 + CDP 7/7 + SSR 200；脚本 _tmp-verify-del.mjs/_tmp-cdp-del.mjs 可复用。**踩坑：Nitro 路由 [id].delete.ts（放 upload-batches/ 目录）才映射 DELETE /:id，[id]/delete.ts 会多一段 /delete 404；PowerShell 对 [id] 路径须 -LiteralPath**
- **码库管理改为按上传文件批次聚合展示（详细弹窗/整批冻结/整批修正）**（2026-09-04，提交 c980f42）：用户要求码库页不再逐条展示码，改为按上传文件批次聚合（一份采集文件=一行）。**数据模型**：新增 upload_batch 表（文件维度，enterprise/file_name/产品/生产批快照）+ trace_code.upload_batch_id 列+索引；import 事务内自动建档（fileName=原始文件名，缺省「手动导入 时间」），响应返回 uploadBatchId；db-init 补 DDL/migrate 补列/backfill 历史码兜底归并「历史数据」批次（本库 104 条）。**页面**（codes/index.vue 重写）：批次列表 7 列（批次名称/关联产品/码总数量/码状态汇总/生产批号/上传时间/操作），**勾选框与底部批量条整体删除**；汇总实时聚合（正常/部分冻结/全部冻结/部分作废/全部作废，作废优先）；【详细】大弹窗看单条明细（复用 codes.get + uploadBatchId，仅查看+单行冻结/作废/恢复）；【冻结】确认框整批冻结（全冻结/全作废后置灰）；【修正】复用批量修正表单整批作用域（含异常码整批拒绝）；整批作废/恢复暂未上（flag API 已支持 0/2 可随时扩展）。**新 API**：upload-batches.get（聚合）/ [id]/flag / [id]/correct。验证：tsc 0 + 构建 10.6MB + API 31/31 + CDP 15/15 + SSR 200；脚本 scripts/_tmp-verify-uploadbatch.mjs、scripts/_tmp-cdp-codes-agg.mjs 可复用
- **侧栏菜单排序与改名**（2026-09-04）：按用户指定重排 11 项菜单（数据概览→产品管理→规格管理→追溯码生成→生产采集→码库管理→批次管理→扫码统计→风险预警→消息中心→系统设置），产品规格管理→规格管理、生产批次→批次管理；仅改 MENU_READY 数组，路径/图标/权限/后端零改动
- **恢复导入接口安全防线（合并 0a40d76，防重写回退）**（2026-09-04，提交 0e31394）：采集重写（fe8db86）全文覆盖了并行工作线的 0a40d76 安全修复（结构校验/归属校验/分块写入），重写版仅查重——错构码可绕过解析直接灌库并自动建批绑定。已并入：逐条 validateCode 结构校验（parse 同口径）+ 码归属产品校验 + 分块 5000/批（事务内）+ skippedInvalid/skippedDup 返回与页面提示。验证：tsc 0 + 防线四场景全过。**教训：改公共接口前先 git log 看最新 HEAD 版本，防全文重写覆盖并行改动**
- **生产采集直接填三要素自动建档/归并批次（流程改造，用户决策 B）+ 批次新建入口收敛**（2026-09-04，提交 fe8db86）：用户先提「删除生产批次板块」，经概念澄清（批次=扫码页生产日期/批号/质检的数据源，1049 第五条合规依赖）确认真实诉求是流程绕，拍板方案 B。①import API 三要素必填自动建批——批号不存在自动建档（质检默认合格/quantity=0 后补），存在则校验日期/合格证号一致后归并（分次补采天然支持），不一致 400 回显库内值防串批，qc_result=0 拒绑；建批+插码同一事务原子执行；②采集页第 3 步改必填三要素表单（生产日期/批号/合格证号 + 质检报告号/有效期至选填），逐级前端拦截；③批次页移除「新建批号」按钮（仅编辑/删除/效期预警）；④批次 PATCH 效期放开选填 + 三要素更正同步已绑定码冗余列（码库列表口径；扫码页实时 JOIN batch）。验证：tsc 0 + 构建 10.6MB + API 五场景（自动建批/归并/不一致 400/缺要素 400/质检不合格拒绑）+ CDP 终验 12/13（新表单/拦截/导入成功落库 100 码/扫码展示/批次页无新建）；脚本 scripts/_tmp-cdp-final.mjs 可复用
- **修复生产采集「校验成功但导入必失败」+ 厂家账号解析 500**（2026-09-04，提交 7fe926f / 858fbe7 / aee5f70）：用户实测发现——生产采集页面上传码文件解析 100/100 通过、点导入提示失败。CDP 真实浏览器页面级复现定位两处根因：①**契约断裂（主因）**：parse.post.ts 响应从不返回完整 results（仅前 20 条 preview），页面 doImport 依赖 parseResult.results 过滤构造导入码数组 → 恒空 → import 400「没有可导入的码」——生产采集「解析→导入」链路自 V1.0 起即坏（API 直测绕过页面构造逻辑未暴露）；修复：parse 响应新增 validCodes 全量有效码，页面改读 validCodes；②**parse 企业过滤双重 WHERE**：prodCond 前缀 ' WHERE ' 拼出双重 WHERE → 厂家账号（lvfeng/codeop）解析必 500（仅总部账号正常，厂家路径为验证盲区），改 ' AND ' 与全库范式一致；③附带修复 nearby.get.ts TS2532 存量错误（tsc 0 基线）。验证：tsc 0 + 重建重启 3100 + CDP 全流程（真实文件→解析→导入→落库 100 条→清理恢复）；脚本 scripts/_tmp-repro-cdp-import.mjs 可复用
- **后台业务页 Keep-Alive 缓存（菜单切换保留页面状态）+ 各页重置按钮**（2026-09-04，提交 94572ca / 400daa4 / 4424688）：需求——业务页表单/筛选在左侧菜单切换后保留，切回无需重填。①nuxt.config 开 `experimental.normalizePageNames`（页面组件 name 对齐路由名——NuxtPage Keep-Alive include 按组件 name 匹配，后台页全是 admin/*/index.vue 不开则全叫 index 且会误缓存公众首页）；②11 个业务页 definePageMeta 加 `keepalive: true`（登录页/门户首页/404/公众端页面不缓存，每次进入全新）；③登出清缓存双保险——NuxtLayout 以 layout 名为 key 渲染，admin→登录页切换必然卸载 NuxtPage 与全部缓存实例；useUser.logout 补 clearNuxtData() 防切换账号数据串号；④重置按钮：generator/collection（标题区右侧 resetPage）、settings（resetPanel 按当前 tab）、messages（筛选区）、codes resetSearch 补清批量勾选；⑤数据概览 onActivated 激活静默刷新（纯数据面板，缓存后数字不陈旧）。验证：tsc 0 + 全权构建 11.1MB + **CDP 25/25 全过**（表单/筛选切换保留、切回不重复请求、重置仅当前页、弹窗切走无残留、F5 清空、登出换账号无残留、概览激活刷新、登录页不缓存）+ SSR 14 页 200；脚本 scripts/_tmp-verify-keepalive.mjs 可复用回归
- **自定义段配置固定为平台标准参数**（2026-09-03，提交 16b7efc）：用户决策——追溯码生成「自定义段配置（码第 12 位后 21 位）」去掉三个下拉框固定死：时间戳=毫秒级、随机=6位随机+2位校验、校验=MD5取后2位，仅展示不可修改（防客户乱配置导致追溯码出错）。页面改只读徽标展示（FIXED_SEGMENTS + lock 图标）；服务端 generate API 用 FIXED_CONFIG 锁定、不再接受客户端传参（防绕过）；**引擎 code-generator.ts 零改动**（多选项能力保留供离线工具复用）。验证：tsc 0 + 构建 10.5MB + 引擎冒烟 300 条结构正确（11头+13毫秒+6随机+2MD5校验，校验可重算）+ 端到端 17 项全过（非法传参被忽略返回固定 cfg、SSR 旧下拉选项消失）
- **含量单位中文化：选项与存储英改中**（2026-09-03，提交 ee803d4）：含量单位下拉「ml/L/g/kg/片/包/粒」→「毫升/升/克/千克/片/包/粒」，仅含量单位（包装单位不动）；存储即中文透传，存量英文由用户自行迁移（不做数据迁移）；选项唯一源 = specs/index.vue UNITS 常量（筛选+表单共用），db-init 注释与演示 seed 同步中文（仅新环境）。验证：tsc 0 + 构建 + 冒烟（毫升落库 HEX 核验/中文筛选命中/ml 筛选仅命中存量）+ SSR 200
- **规格字段精简：规格码企业内自动分配 + 下线「适用剂型」**（2026-09-03，提交 2e44d16）：用户提出去掉规格新增页的「企业合规码」与「适用剂型」——核查澄清系统无「企业合规码」概念（实为**企业规格码**=32 位码第 9-11 位，1049 强制段不可删），改为**系统自动分配**（企业内 MAX+1 补零 3 位、001 起上限 999、并发撞唯一键自动换码重试，界面不再录入）；适用剂型全库零下游消费（产品建档下拉本就全量启用可见、无剂型过滤）按确认整体下线：specs 三 API + 页面字段/列 + db-init DDL 与 migrate() 幂等删列（已实测）；编辑不再改码且常规编辑补 status 落库（修复编辑弹窗开关不生效缺陷）；产品建档下拉去掉码后缀。验证：tsc 0 + 构建 10.5MB（全权模式）+ 迁移删列 + API 冒烟（自动分配 006/编辑落 status/重复名 400/停用退出启用列表）+ SSR specs/products 200
- **修复统计接口企业过滤歧义**（2026-09-03，提交 3fd51b3）：数据概览「产品分布」SQL 在 trace_code JOIN product 后企业过滤未限定表名（errno 1052），厂家账号访问仪表盘 500（历史验证均用总部 admin 未暴露）；按 stockRows 同款 replace 限定 t.enterprise_id，全库复查无同类
- **产品弹窗原药字段双通道组合框**（2026-09-03，提交 b56c365）：原药登记证号/企业两字段升级「下拉选择+手动输入」（RegOrigCombobox：自由输入+候选面板实时过滤）；双向联动（命中候选自动带出对方/不匹配清空对方）；剂型原药/母药回填自身后仍可下拉重选或手输（候选=同成分原药含自身）；无匹配场景候选空纯手动互不清空；制剂多匹配两字段保存必填（非空即可）。验证：tsc 0 + 构建 + CDP v5 17/17 + SSR 13 页全过
- **产品弹窗登记回填放开编辑迭代**（2026-09-03，提交 434903d）：回填字段从「只读锁定」改为「数据源默认值 + 可手动修改」（9 字段含**产品类别**，非标类别如卫生杀虫剂/杀螨剂动态并入下拉）；切换登记产品以数据源覆盖刷新、清空同步清空；原药两字段回填放开编辑，多匹配场景两字段均为下拉（v-model 同源联动必填）；**复配制剂取首个有效成分匹配并显示核对警示**；服务端补产品类别必填校验。验证：tsc 0 错误 + 构建 + CDP 30 项 + SSR 13 页全过
- **产品弹窗接入农药登记数据源自动回填**（2026-09-03，提交 d2362b3 / 00d4f46）：新增/编辑产品改为「先选生产类型 → 搜登记产品（登记证号主键，97,471 条数据源表 pesticide_reg）→ 自动回填 8 个登记字段（只读）→ 原药两字段三态联动」；持有人生产只选本厂（企业名称归一化过滤）、委托加工/分装可选全部；原药：剂型原药/母药=自身回填，制剂按有效成分匹配原药（唯一自动/多家必选下拉/无匹配手填提示）；**保质期录入整行移除**（服务端不再写，历史值保留）；切换生产类型自动核对清空。数据源导入脚本 scripts/import-regdata.mjs（xlsx 不入库，.gitignore 已排除）。验证：tsc 0 错误 + 生产构建 + API 12 项 + CDP 73 项 + SSR 13 页全过
- **修复侧栏菜单高亮跟随**（2026-09-02）：isActive 前缀匹配 bug 导致根级菜单 /admin（数据概览）永远高亮——startsWith('/admin/') 命中全部子路由；改根路径精确匹配后，点击/直达/切换页面菜单高亮均正确跟随（CDP 5 场景实测）
- **删除外箱码管理模块**（2026-09-02，提交 b49ec23）：按用户指示整体下线 PRD 5.5.6 外箱码管理——后台页面 app/pages/admin/boxes/、侧栏入口、5 个管理 API（列表/详情/bind/parse/unbind）、码库查询冗余字段一并清除；trace_code 表 DDL 删 outer_box_code 列并新增 migrate() 增量删列（幂等，已实测执行）；数据库列与索引引用零残留，后台剩 11 个模块页
- **公众端「扫一扫」真正落地**（2026-09-02，提交 5090eb8）：原首页/BottomNav 扫码按钮仅聚焦输入框提示手动输入（占位），用户反馈「手机点开网站无法扫一扫」。新增沉浸式扫码页 `/scan`（fullbleed 黑底 + 取景框四角/扫描线/框外压暗）+ 核心 composable `useQrScanner.ts`——**BarcodeDetector 原生优先 + @zxing/library 逐帧兜底**（复用已有依赖），识别 32 位纯码或 `/trace?code=` URL 自动跳查询页，普通二维码忽略继续扫（防误跳）；**三通道降级**：iOS 微信网页禁调相机 → 引导右上角浏览器打开/相册选图、权限拒绝/无摄像头/非 HTTPS → 中文错误、相册拍照选图全环境可用（含 iOS 微信）；命中/离开即释放相机流。入口接线：首页大按钮 + 手机底栏（扫码项 /q/ 虚拟路径改真实 /scan，/trace 结果页保持高亮）+ PC 顶部菜单。验证：tsc 0 错误 + 构建 + CDP 移动视口 18 项 / zxing 兜底 4 项 / PC 3 项 / DOM 测量全通过
- H5 扫码页 10 场景（正品·已绑定/已生成、查无此码、登记证过期、重复查询、冻结、作废、过有效期、信息存疑、格式错误）
- 后台：登录、数据概览、追溯码生成（1049结构+自定义段+导出）、码库管理（异常标记/批量修正）、产品规格管理、产品管理、生产批次管理、生产采集、扫码统计、系统设置（企业信息/用户权限/操作日志/数据备份）、风险预警中心、消息中心
- H5 扫码为真实链路：查库 + 写 scan_log + 异常判定 + 自动触发风险预警（重复查询/登记证过期已接入）
- **生产构建验证通过**（2026-08-31）：npm run build 全量构建成功（.output 6.24MB），生产服务器登录/扫码/后台全链路 200；修复 .env 的 SESSION_SECRET 未改默认值导致的生产登录 500（已换 64 字符强随机密钥，不入库）
- **数据概览板块增强**（2026-08-31）：近 30 天扫码趋势折线图（SVG 自绘+补零）、8 个快捷入口、码库存预警（低库存阈值 stockThreshold 默认 10000 + 作废占比 10% 告警，PRD 5.2/5.5.8 差距项补齐）
- **追溯码生成板块增强**（2026-08-31，对齐离线工具 + PRD 3.2/5.5.1）：自定义段全配置（时间戳段+随机数字段 8位随机/6位随机+2位校验+校验位段 MD5/CRC16）、二维码图片输出（QR/DM PNG 批量生成 + zip 打包下载 + 预览 + 一次性凭证）、导出增强（TXT 强制命名 企业ID_产品名_规格_日期、urls.txt 完整扫码 URL、CSV sn 清单）、生成统计（总数/唯一/重码/耗时）；扫码域名 NUXT_PUBLIC_TRACE_BASE_URL 可配；生产链路 18 项验证全过，提交 af6bc7e
- **码库管理页已完成企业级 B 端改造**（2026-08-31，两轮）：①筛选卡片化+吸底批量操作条+内容区 max-w-[1600px]；②彻底剥离小程序风格：白底细边框小圆角、细分割线分区、状态标签浅底深字（bg-*-50+text-*-700）、操作列纯文字按钮、批量条浅灰底、主按钮 neutral solid 深灰黑；全局主色降饱和 hsl(142 32% 30%)、--ui-radius 0.375rem、后台底色 #f0f2f5。其他列表页仍为旧风格，迁移模式见 PROJECT_LOG
- **产品/规格管理新增表单弹窗化修复**（2026-09-01，提交 a7657ee）：修复 Nuxt UI v3→v4 迁移遗留三叠加 bug——①UModal 默认插槽 v4 语义=触发按钮（内容必须放 #content 插槽），原写法导致新增表单直列渲染在页面下方；②v-model 绑定无效（v4 UModal 无 modelValue prop，须 v-model:open），点击新增按钮弹窗打不开；③reka-ui 禁止 SelectItem 空字符串 value，筛选下拉「全部」选项改 placeholder。已修：products/specs 两页（其余 5 页 7 处已于下一条全量修复）
- **Nuxt UI v4 迁移遗留 bug 全量清零**（2026-09-01，提交 e05ac71）：①**UModal 5 页 7 处**（alerts/batches/boxes×2/codes×2/settings）统一迁移 `v-model:open` + `#content` 插槽，弹窗恢复可用；②**空字符串 value 下拉 6 页 13 处**——筛选类改 placeholder 承载 +默认值 undefined，表单类「不修改/不绑定」改哨兵值（codes `batchId=0`/`qcResult='keep'`、collection `batchId=0`）保留可回退语义；③**新发现并修复系统设置两处缺陷**——`UTabs` items 缺 value 导致 v4 回退索引、点击任意 Tab 后 5 个面板 v-if 全部落空（用户权限/操作日志/通知配置/数据备份实际不可达），以及「通知配置+数据备份」整段重复渲染（删除重复 82 行）。验证：tsc 0 错误 + 生产构建 + CDP 真实点击 19/19 全通过 + 全后台 12 页回归无控制台错误
- **全后台 B 端风格统一 + 共享设计语言基座**（2026-09-01，提交 0b9b12d / 248bdc0）：①`app/assets/css/main.css` 新增「B 端中后台设计语言」层——11 个色板变量 + 40 个语义类（`b-page-title`/`b-card`系/`b-form-grid`/`b-table`/`b-tag` 五语义色/`b-actions`/`b-empty`/`b-pager`/`b-bulkbar`/`b-note`/`b-modal`系/`b-stat`系），置于 `@layer components` 以便工具类覆盖；②**12 个后台页面全部迁移**（此前仅码库管理一页完成改造），连基准页 codes 也一并归一，全站只剩一种写法，页面级旧风格类与硬编码 Element 色值**清零**；③业务逻辑零改动（仅标签配色映射常量改语义类名，已用 script 块逐行比对脚本核验）；④顺带补齐 **PRD 5.6 批次效期预警**（已过期红 / ≤30 天临期黄，`expiryBadge()` 按当天零点整日差，无水合告警），按提交契约单独成一次 feat 提交。验证：tsc 0 错误 + 生产构建 + SSR 15 项 + CDP 真实点击 20 项 + DOM 客观测量 5 页全通过
- **清理农码查移植遗留死代码**（2026-09-01，提交 945d338）：删除 767 行零引用代码——4 个与 `TraceResult/TraceAlert/TraceNotFound` 重复的未接线结果页组件、仅被它们引用的 `RegistrationCompareCard`、**零调用且返回伪造登记证核验结果的演示接口 `server/api/query/[code].get.ts`**（对 1049 合规项目属实质风险）、仅服务上述死代码的 `shared/types/compare.ts`，以及 `default.vue` 中指向不存在路由 `/result/` 的判断。`/q/:code` 旧路径重定向为活链路已保留。验证：引用核查零残留 + tsc + 构建 + SSR 15 项 + 公众端专项 7 项全通过
- **公众端消费者体系**（2026-09-01，提交 6cfb410 / 2e64067 / 019837e）：①**微信公众号网页授权登录**（snsapi_userinfo），消费者独立 Cookie `nz315_consumer`，与后台共用密钥但 payload 带 `consumer:` 命名空间前缀，**两类 token 不可互换**（已双向实测）；凭据未配置时授权接口 503，**不做模拟登录**；state 强制校验为站内相对路径防开放重定向；②**个人中心 `/profile`**（三态引导：未配置/非微信/微信内；「查询档案」与「查询历史」按决策合并为一份，数据取自真实 `scan_log`）；③**附近农资店**：公众端 `/nearby-stores`（**2026-09-02 起改用高德 POI 实时检索，提交 4c1ebdb**——授权定位 → 双关键词（农药+农资去市场噪音）检索 → 距离升序前 20 家；1km 网格缓存 10 分钟防配额；未定位返回空引导开启定位；后台门店管理已于 557b13a 删除）
- **两个既有 bug 修复**（2026-09-01，提交 d799728 / 5c5ac25）：①**db-init 缺建 `message` 与 `system_setting`**——新环境按文档初始化必缺表，消息中心/通知配置/数据概览会报错；②**业务操作日志操作人恒为 NULL**——`event.context.authUser` 全代码库无人赋值，实测 40 条业务日志（含批量作废/用户管理/数据备份）全部无法追溯到人，违反 PRD 5.12.4 与 8.4，已在 `getCurrentUser()` 挂载上下文

- **高德地图接入**（2026-09-01，提交 d630e3a；Web服务地理编码随门店管理删除 557b13a）：JS API key 用于公众端地图渲染（CDP 实测瓦片全 200、WebGL 画布正常、控制台零错误）；真实 key 仅在 `.env`（不入库）。~~Web服务 key 地理编码~~（已删）

- **「附近农资店」页重做**（2026-09-01，提交 ae2f609）：按用户设计稿实现双布局——PC 左 38% 列表 + 右 62% 整高地图（hover 联动 marker 详情卡）、移动端顶栏+搜索+列表+35vh 折叠地图（可全屏）+ 底部详情弹窗；配色 #f8f9f4/#2c5c3a/#e67e22 仅限本页。新增 fullbleed 无壳布局与 StoreMap 画布组件（单一实例 + CSS 裁剪实现折叠/全屏，零 resize）。CDP 双视口 20 项全通过

**待办（按 PRD 版本规划）**：
- **真机验证 /scan 扫码**：Android Chrome（原生 BarcodeDetector 路径）与 iOS Safari 17+ 各扫一张真实印刷码；确认 HTTPS 下权限弹窗与后置摄像头调用正常
- **微信凭据已配置**（2026-09-07）：WECHAT_APP_ID/WECHAT_APP_SECRET 已写入 .env（不入库）并重建生效，authorize 端点 302 验证通过（appid/scope=snsapi_userinfo/state 正确）；**待做两步**：①公众平台配置「网页授权域名」= www.nz315.cn（设置与开发→公众号设置→功能设置；只填裸域名）；②生产域名就绪后真机验证授权回调（微信内打开 authorize URL → code → callback 落库）
  - **回调域名机制（2026-09-12 更正）**：回调地址由 `server/api/consumer/wechat/authorize.get.ts:15-17` 从请求头 `x-forwarded-proto` + `host` **动态拼接**，**代码零引用 `SITE_URL`**（全仓库 grep 仅命中文档）——故改 `SITE_URL` 无效，线上须确保**唯一入口为 www.nz315.cn**。网页授权**无服务器回调**，微信仅校验 `redirect_uri` 域名白名单（不在即 10003），跳转由用户浏览器执行，因此 127.0.0.1/带端口的环境永远测不通。
  - **域名校验文件已就位**：`public/MP_verify_OUOoNSqTrpZkfWli.txt`（16 字节 `OUOoNSqTrpZkfWli`，无 BOM、无多余换行，本地 `curl` 200 且逐字节一致）——**已提交入库**，部署时随之带上；微信保存域名时会实时抓取它。另：公众号的「JS 接口安全域名」是**独立入口**（各限 2 个），将来用 JSSDK 分享/定位才需要配。
- **上线前**：高德 JS API key 须在控制台配置**域名白名单**（本地未受限但线上必配）；Web服务 key 需确保生产环境额度充足（POI 检索每请求 2 次调用，有 1km 网格缓存）
- 自动备份调度与异地备份（OSS）、微信推送（需公众号对接）、异常类型 2/3/5/6/7/8 预警触发接入（依赖 D2 登记证库/IP 归属地）
- 码生成离线 EXE 版（参考工具 E:\wokeplace\二维码生成离线软件 已有 electron 工程，Web 引擎已对齐可移植打包）
- 待决项：D1 亿级数据方案（上线前定）、D2 登记证数据库对接、D3 限用农药、D4 旧规迁移

### ⚠️ 踩坑记录

| 坑 | 应对 |
|---|---|
| **`grep -c $'\r'` 判 CRLF 在 Git Bash 下是假阳性**（2026-09-12 实测踩到） | 用 `grep -c $'\r'` 检查 `deploy/` 三个文件，报「243/103/66 行含 CR」（几乎等于总行数），据此误判为 CRLF 并做了两次 `sed -i 's/\r$//'` + `tr -d '\r'` 「修复」。改用 `od -c file \| head` 与 Python `Path(p).read_bytes().count(b'\r\n')` 复核，**文件自始即为纯 LF、CR 计数 0**。→ **判换行符一律用 `od -c` 或 Python 逐字节，勿用 grep**；Git Bash 下该模式不可靠。附带教训：**工具给出"异常"结论时，换一种互相独立的检测手段交叉验证再动手** |
| **mysql2 affectedRows 是「匹配行数」而非「实际变更行数」语义**（2026-09-04 实测） | 同值 UPDATE（如对已冻结码再执行冻结）也返回全部匹配行数，靠 UPDATE 返回值判「无操作对象→400」会漏判（整批 flag 曾重复冻结/恢复 200 假成功）。凡需「无实际变化时报错」的判定：**UPDATE 前先按当前真实状态 COUNT 可操作数**，为 0 直接 400 |
| **edit 改写含反引号多行模板字符串易丢闭合反引号**（2026-09-04 实测） | db-init DDL 数组元素尾行「反引号+逗号」在编辑中丢失反引号后，模板字符串一路吞到下一个模板开头才报错，错误行号远离真实位置（报 261 行实为 259 行缺符）。另：node --check 在本机对含中文多行模板字符串的 ESM 误报（报错回显与文件字节不符）。对策：含反引号模板的编辑后立即用 esbuild transform（或直接运行）验证语法，勿依赖 --check |
| **全文重写会覆盖并行工作线对同一文件的修复**（2026-09-04 实测） | 三要素重写 import.post.ts 时基于旧版本全文 write，误回退了并行提交 0a40d76 的结构校验/分块写入安全修复。多 Agent/多会话协作下：改动核心接口前先 `git log --oneline -5` + `git show HEAD -- <file>` 确认最新版本；diff 型改动优先 edit 而非全文 write |
| **前端依赖 API 响应字段时以接口契约为准（契约断裂静默成 400）**（2026-09-04 实测） | parse.post.ts 响应只含前 20 条 preview（完整 results 从未返回），生产采集页 doImport 却 `parseResult.results.filter(valid)` 构造导入码数组 → 恒空 → import 400「没有可导入的码」。接口与页面各自看似正常、API 直测永不暴露。改 API 返回体先 grep 前端消费字段；「页面操作类功能」验证用 CDP 真实浏览器而非 API 直测 |
| **多租户 SQL 条件前缀必须 `' AND ...'`，`' WHERE ...'` 拼出双重 WHERE**（2026-09-04 实测） | 基底已有 WHERE（`WHERE status = 1`/`WHERE 1=1`）时拼接 `' WHERE enterprise_id = ?'` → 双重 WHERE 语法错误，厂家账号（lvfeng/codeop）解析文件必 500；总部账号无过滤参数正常 → 厂家路径成验证盲区（与 3fd51b3 统计 500 同类）。新写/改动企业过滤接口后至少用厂家账号冒烟一次 |
| **NuxtPage Keep-Alive 按组件 name 匹配 include**（2026-09-04 源码确认） | 页面组件 name 默认=文件名，后台全是 index.vue 同名；页面级缓存必须开 `experimental.normalizePageNames`（name=路由名）再 definePageMeta `keepalive: true`，否则 include 误命中公众首页。清缓存无 API：登出靠布局切换重建 NuxtPage（NuxtLayout 以 layout 名为 key 渲染）+ clearNuxtData 清数据缓存 |
| **沙箱内全权模式调用可能无限挂起**（2026-09-04 实测） | danger-full-access 命令在审批无人应答时挂满 run_code 600s 墙钟才失败（timeoutMs 不生效），ask_user_question 同样无应答超时。无人值守环境验证构建前先确认审批人在线，或请用户手动构建 |
| 端口 3000 被农码查残留 dev 实例占用 | 本项目 dev 固定用 **3100**；启动前 `Get-NetTCPConnection -LocalPort 3000` 排查 |
| npm wrapper（npm.ps1/cmd）损坏（2026-09-11 复核：**本机 npm 正常，无需此招**） | 直调 `node <npm安装路径>/npm-cli.js install`；**注意 npm 安装路径因机器而异**，本机为 `C:\Users\27475\.workbuddy\binaries\node\versions\22.22.2-2\`，文档里旧记录的 `E:\software\nodejs\...` 是**另一台开发机**的路径，本机无 E 盘，照抄必然 MODULE_NOT_FOUND |
| mysql2 对 JSON 列自动解析为数组 | 勿再 `JSON.parse`；BIGINT 用 `Number()` 转换 |
| **`query()` 解构陷阱（两个方向都会踩，2026-09-10 实测成灾）** | 项目封装 `query()` 返回**行数组本身**：①取单行用 `const [row] = await query(...)` 后访问 `row.字段` ✅；②取多行**不要解构**（`const rows = await query(...)`）——写成 `const [x] = await query(...)` 再 `x.length / x[0]` 会恒 falsy → **静默走错分支**（correct.post.ts 因此把「批号已存在→归并」变成「→INSERT」，唯一键冲突 500，用户侧只看到「修正失败」）；③原生 `conn.query` 返回 `[rows, fields]` 二元组，**把 import 的逻辑抄进用封装 query() 的文件时必须同步改解构方式**（本次 bug 正源于此）。排查可用脚本扫「const [x] = await query 后 x 被当数组用」模式 |
| Vue 模板中禁止 `import.meta.*` 表达式 | 先赋值到 script 常量再用于模板（Vite 编译报错） |
| 离线环境 dev 崩溃（fonts.google.com 超时） | nuxt.config.ts 已禁用 fonts.providers.google/googleicons，勿恢复 |
| Nuxt UI v4 无 URadio 组件 | 单选用 URadioGroup 或自绘；v3 组件名（URadio/UButton square 等）会触发 Vue warn |
| Chrome headless 截图挂死 | 加 `--user-data-dir` 独立 profile；一次一个进程，`Start-Process -Wait` |
| DSH 沙箱内构建报 esbuild spawn EPERM | 沙箱禁止子进程管道（非项目问题）；构建在沙箱外运行或申请全权模式 |
| 生产登录 500「必须配置独立 SESSION_SECRET」 | `.env` 的 SESSION_SECRET 仍是默认值 dev-session-secret-change-me；换强随机值后**重新构建**（runtimeConfig 构建时内嵌）；运行期覆盖用 NUXT_SESSION_SECRET 环境变量 |
| 本机 MySQL | 服务 MySQL80，root/ruijie（**凭据只在 `.env`，不提交**） |
| ~~**dev 模式在本机不可用**（Nitro 2.13.4 + Node 24 + 中文路径）~~ **已于 2026-09-11 实测推翻：dev 模式可用** | 旧的 `file://E:/` 裸盘符 ESM 500 已由提交 af33393（xlsx 改内联依赖，Nitro 不再外置）修掉；2026-09-11 在本机（Node 22.22.2 + 中文路径 `Desktop\二维码管理`）实跑 `npm run dev -- --port 3100`：`/`、`/login`、`/trace?code=` 全 200，登录接口 Set-Cookie 正常、带 Cookie 请求 `/api/auth/me` 正确返回 admin。**开发验证不必再退回生产构建** |
| TS7 模块化 d.ts 三斜线引用失效 | `server/types/cjs-modules.d.ts` 必须保持无 import 的全局脚本形态（实验证实：带 import 的 d.ts 经 /// reference 不生效） |
| npx/npm wrapper 损坏（2026-09-11 复核：本机 npm/npx 均正常） | 万一损坏：tsc 直调 `node node_modules/typescript/bin/tsc`；dev/构建直调 `node node_modules/nuxt/bin/nuxt.mjs dev`（**不写死 npm-cli.js 的绝对路径**，那会因机器而异） |
| **合并/切分支后卡在 `[optimizer] scanning dependencies...` 或全站 502**（2026-09-11 实测） | 根因是 `.nuxt` / `node_modules/.cache` 是**旧版本世界**留下的缓存，与新的 vite 配置/deps 不匹配，依赖优化器卡死。Nitro 已监听但上游 Vite 未就绪 → 所有路由返回 **502**。解法：停掉 dev 进程 → 删 `.nuxt`、`node_modules/.cache`、`node_modules/.vite` → 重启（清缓存后 Vite 秒建、Nitro 约 12s 就绪）。`node scripts/dev-start.mjs` 会自动完成这套判定与清理 |
| **`npm` 路径/Dev 卡死类问题，先跑 `node scripts/dev-start.mjs --check`**（2026-09-11 新增） | 只读体检，一次列全：Node 版本、npm 可用性、3100/3000 端口占用与 PID、12 个直接依赖是否装全、`.env` 键名（**只报键名不打印值**）、缓存新鲜度（对比 `package.json`/`package-lock.json`/`nuxt.config.ts` 的修改时间——**刻意不拿 git 提交时间当参照**，否则改任何文档提交一次都会误报）。不带 `--check` 则体检后直接启动；`--clean` 强制清缓存 |
| **计划任务 `RestartOnFailure` 不覆盖「任务跑起来之后才挂」**（2026-09-11 实测） | `-RestartCount/-RestartInterval`（XML 里的 `<RestartOnFailure>`）**只在「任务计划程序启动不了这个任务」时生效**，不会因为动作跑起来、之后内部进程退出码非 0 而重启它。实测：杀掉 dev 进程后 `LastTaskResult=0xFFFFFFFF`、`State=Ready`、`NextRunTime` **为空**，服务一直没起来。**结论：恢复能力必须做进进程内部**（`dev-service.mjs` 的 `for(;;)` 守护循环），不能外包给任务计划程序 |
| **`RepetitionDuration` 省略 → 重复永不触发**（2026-09-11 实测） | `New-ScheduledTaskTrigger -Once -At ... -RepetitionInterval PT1M` **不带** `-RepetitionDuration` 时，导出的 XML 是 `<StopAtDurationEnd>true</StopAtDurationEnd>` 且**没有 `<Duration>` 元素** → 重复窗口长度为零 → 永不重复（表现为 `NextRunTime` 恒空，极易误判为「已配置好」）。用 `-RepetitionDuration (New-TimeSpan -Days 3650)`；**注意 `[TimeSpan]::MaxValue` 会被 schema 拒绝**（`P99999999DT23H59M59S` → HRESULT 0x80041318） |
| **重复周期拐在 LogonTrigger 上不排期**（2026-09-11 实测） | 把 repetition 附着到 `MSFT_TaskLogonTrigger` 上，即使 duration 合法，`NextRunTime` 仍为空——因为登录触发器的重复是从**登录那一刻**起算的，而注册任务时登录早已发生、重复窗口已成过去。**要心跳就用独立的 `-Once -At <近未来>` 触发器**，别拐在登录触发器上 |
| **本机 node 不在持久化 PATH 中**（2026-09-11 实测） | `[Environment]::GetEnvironmentVariable('Path','User')` 与 Machine PATH **均无 node**，只有 WorkBuddy 注入到它派生的进程里。因此：① 计划任务里**不能直接写 `node`**，必须解析绝对路径；② 任何要脱离 WorkBuddy 会话运行的脚本都得自己找 node。`scripts/dev-task-run.ps1` 的三级兜底：PATH → 扫 `%USERPROFILE%\.workbuddy\binaries\node\versions\*\node.exe` 取最高版本（扛得住 node 升级换目录）→ `Program Files\nodejs` |
| **写 `.ps1`/`.cmd` 一律只用 ASCII 并靠 `$PSScriptRoot`/`%~dp0` 取路径**（2026-09-11 定规） | 本项目路径含中文（`Desktop\二维码管理`），Windows PowerShell 5.1 可能误读 UTF-8 脚本、cmd 也会乱码。`scripts/dev-task-run.ps1`、`install-dev-task.ps1`、`uninstall-dev-task.ps1` 与根目录 `start-dev.cmd` **全部零非 ASCII 字面量**，需要中文提示时交给 Node 脚本输出 |
| 沙箱内 node 命令勿用管道 | 管道/重定向会吞输出或 EPERM；全权模式跑 dev/构建（AGENTS.md 原记录） |
| 二维码图片临时文件 | 在系统 tmpdir（nz315-qr-*），zip 下载后自动清理；下载凭证 token 一次性 + 60 分钟过期 |
| **Nuxt UI v4 USelect 选项 prop 是 items 不是 options**（v3 迁移坑，2026-09-01 实测） | options 被透传为无效属性，下拉面板永远为空（用户反馈「点击无效」的真凶）；新页面写 `:items`；已全局修复 37 处 |
| **Nuxt UI v4 UModal 写法**（v3 迁移坑） | 必须 `v-model:open`（无 modelValue prop）+ 内容放 `#content` 插槽（v4 默认插槽=触发按钮）；旧写法**不报错**但弹窗打不开且内容直列渲染在页面下方 |
| **Nuxt UI v4 UTabs items 必须显式给 value** （2026-09-01 实测） | 不给 value 时回退为索引 '0'/'1'…，配 `v-if="tab === 'xxx'"` 判断会**静默全部落空、页面空白无报错**；settings 页曾因此 4 个模块不可达 |
| **reka-ui 禁止 SelectItem 空字符串 value** | `{ value: '' }` 抛「must have a value prop that is not an empty string」500 错误页；筛选「全部」用 placeholder + 默认值 undefined，表单「不修改」用哨兵值（0 / 'keep'）提交时归一 |
| **Nuxt UI v4 Toast 不自动注入**（v3 自动） | 必须显式 `<UToaster />`（已放 app.vue），否则 21 处 useToast 静默失效——所有操作提示丢失 |
| **scoped 样式会压过同权重 Tailwind 响应式类** | Vue 作用域样式的特异性与层叠会把 `.pc-topbar{display:flex}` 压在 `lg:hidden` 之上（2026-09-01 踩，PC 顶栏在移动端显示）。**页面自绘响应式时：断点一律收进 CSS 媒体查询，不要与 Tailwind 类混用同一属性** |
| **AMap2.0 `setFitView` 只接受 [lng,lat] 数组** | 传 {lng,lat} 对象会报 `getBounds is not a function`；同城多点要显式传 maxZoom 参数，否则视口拉满门店缩成小点 |
| **两套身份体系刻意隔离，勿混用** | 后台用 `requireBackendUser`/`nz315_user`，消费者用 `requireConsumer`/`nz315_consumer`。两者共用签名密钥，靠 payload 命名空间前缀（`consumer:`）区分，**互换 token 必被拒**。新增消费者接口勿复用后台守卫 |
| **第三方「智能解析」接口会模糊匹配，必须交叉校验** | 高德地理编码对乱码地址**照样返回高置信度结果**（`zzzz不存在的地址xxxx`→湖南怀化某针织店、`阿斯顿发发发`→深圳某店，level 均为「兴趣点」）。若直接采信会把错误坐标当精确值写库。必须用业务侧已知信息（省/市）交叉校验，并拒绝省市级粗精度。**这与被清理的「伪造核验接口」是同类风险：看似有效的假数据** |
| **高德两把 key 用途不可混用** | Web服务 key（`AMAP_WEB_KEY`）仅服务端用于地理编码，**绝不能下发浏览器**；JS API key（`NUXT_PUBLIC_AMAP_JS_KEY`）用于前端地图，会暴露，**上线前须配域名白名单**。免费额度有 QPS 上限（`CUQPS_HAS_EXCEEDED_THE_LIMIT`），批量解析须限速 |
| **浏览器定位是 WGS-84，门店库与高德是 GCJ-02** | 直接混用在国内有数百米偏差（实测济南纠偏 555 米），会让「附近门店」排序失真。必须经 `app/composables/useGeoConvert.ts` 的 `wgs84ToGcj02()` 转换 |
| **runtimeConfig 运行期覆盖须用 `NUXT_` 前缀** | 构建时内嵌，`WECHAT_APP_ID` 只在构建时生效；运行期要用 `NUXT_WECHAT_APP_ID`/`NUXT_WECHAT_APP_SECRET`（与 SESSION_SECRET 同源踩坑，验证时踩过） |
| **未配置凭据时禁止降级为假数据/假登录** | 本项目已因一个「返回伪造登记证核验结果」的演示接口清理过一次。正确做法：明确报错（如微信未配置 → 503）或功能性降级（如高德未配置 → 只是不显示地图，列表照常） |
| **农码查参考项目只能取视觉，勿取逻辑** | 它是 Mock 原型（MOCK_PESTICIDES、扫码结果 45%/25%/15%/15% 随机、假登录）。上一次移植遗留了 767 行死代码，其中含一个**对外可达却返回伪造登记证核验结果**的演示接口（已于 945d338 删除）。移植 UI 前先确认 `shared/types/trace.ts` 有对应字段，**没有后端支撑的区块一律不做**（用药档案/附近农资店/举报工单/登记证比对/消费者账号均无我方后端） |
| **公众端与后台是两套视觉基调，勿相互套用** | 公众端保农业绿友好风（渐变、rounded-xl、480px 移动壳）；后台是克制 B 端风（`b-*` 类、4px 圆角、无阴影、中性按钮） |
| **后台新页面必须复用 `b-*` 设计语言类** | 类清单在 `app/assets/css/main.css` 末尾「B 端中后台设计语言」段；再手写 Element 色值会产生第二套风格。`b-table` 已内置 th/td 内边距与行样式，**别再给 th/td 写 `px-4 py-3`** |
| **「旧风格残留」检测会被 Nuxt UI 内部类误报** | `bg-elevated`（UTabs 容器）、`bg-error/10`（outline error 按钮）由框架渲染而非页面书写；字符串匹配 SSR HTML 时必须排除，否则每页都误报（2026-09-01 踩） |
| **视觉评估勿轻信 vision 模型** | 本轮 vision 给出的「大圆角/高饱和药丸/控件不对齐/文字溢出」四条经 CDP 计算样式实测**全部证伪**（实为 4px 圆角、-50 浅底、32px 等高、零溢出）；视觉验收以 `getComputedStyle`+`getBoundingClientRect` 测量为准，vision 仅辅助且有 429 频控 |
| **面板可达性别用「字符数阈值」判断** | 系统设置「企业信息」面板仅 227 字符但完全正常；应改用关键词校验（如含「统一社会信用代码」） |
| reka-ui 选项用 pointerup 选择 | CDP 自动化点击下拉选项须派发 pointerup（click 无效）；面板关闭需真实 pointer 事件 |
| headless 点击视口外元素无效 | CDP Input 点击前先 scrollIntoView |
| Vue 3.5 生产模式元素无 __vueParentComponent/_vei | 排查事件绑定用 DOMDebugger.getEventListeners（能看到真实监听器），勿用 _vei 判断 |
| **CDP 模拟定位须先 grantPermissions(['geolocation'])** | 只调 setGeolocationOverride 会被当作「用户拒绝」（ERR code 1）；headless 验证定位流必须先 Browser.grantPermissions 且带 origin 参数（2026-09-02 实测） |
| **zxing HybridBinarizer 对图像宽度敏感**（2026-09-02 实测） | 同一二维码渲染成 520/600px 解不出、相邻宽度（480/640）成功——二值化分块与模块宽度的相位问题。zxing 兜底解码必须**多尺度重试**（useQrScanner 已实现 1x/0.8x/0.6x） |
| **zxing MultiFormatReader 解码失败会打 console.warn 刷屏** | 相机逐帧解码失败是本路径的预期行为，MultiFormatReader 内部对每个失败的 reader 记 warn。改用**显式顺序尝试**（QRCodeReader → DataMatrixReader）自行 catch，控制台零噪音 |
| **网页扫码能力分层（无微信 JS-SDK 凭据时）** | ①系统浏览器：getUserMedia + BarcodeDetector（Android Chrome/iOS Safari 17+），zxing 兜底（无 BarcodeDetector 的 Edge/旧 Safari）；②**iOS 微信内网页禁调相机**（系统限制，无解）→ 引导「右上角在浏览器打开」+ 相册选图识别兜底；③getUserMedia 必须 HTTPS + 用户手势触发（iOS 强制）；④扫码页参考实现 `app/pages/scan.vue` + `app/composables/useQrScanner.ts` |
| **企业名归一化匹配必须 SQL/JS 两侧同一替换链**（2026-09-03） | 「本厂产品」判定 = 数据源厂家列与 enterprise.name 都做（股份有限公司→有限责任公司→有限公司→集团→去空格）后相等；`server/utils/regdata.ts normalizeOrgName` 与 `regdata.get.ts COMPANY_NORM_SQL` 任一改动必须同步另一侧，否则过滤结果漂移 |
| **SQL 列清单与 VALUES 占位符人工删列易错**（2026-09-03） | 移除 product 表 shelf_life 写入时列改 19 个但 VALUES 只留 18 个 ?，运行期才报 `Column count doesn't match`（500，生产构建与 tsc 均查不出）。删列后数一遍列名与 ? 数量 |
| **数据源有效成分提取勿把含量单位「/」当成分分隔符**（2026-09-03） | 「50克/升」含斜杠；成分名分隔只按间隔号/顿号/分号/加号（·、；+），每段取首个空白前 token；复配制剂按主成分（首成分）匹配原药（product 模型仅单原药字段） |
| **登记证过期记录不入产品/原药下拉** | regdata 候选一律 (expire_date IS NULL OR expire_date >= CURDATE())；原药候选同规则——历史 LS 老证被自然过滤，避免误建「登记证过期」产品 |
| **失败构建会清空 .output/server/chunks 且服务器懒加载 chunk 404**（2026-09-03 实测） | nitro 打包前清空输出目录；沙箱内构建失败（esbuild spawn EPERM）会留下**空 chunks/build**——正在运行/后续启动的服务器 API 正常但页面路由 ERR_MODULE_NOT_FOUND 500（懒加载）。构建一律全权模式，失败后必须重跑完整构建再启服务器；验收页面 SSR 前先确认 chunks/build 非空 |
| **生产服务器进程脱离 DSH job 常驻** | 后台 job（pwsh 包装）显示 completed 但 node 子进程继续监听端口（曾见 16:42 旧构建进程遗留占 3100，导致冒烟打到旧代码）；收尾用 Get-NetTCPConnection/netstat 找 PID + taskkill（沙箱内被拦，需全权） |
| **PowerShell 控制台中文乱码 ≠ DB 乱码** | Invoke-RestMethod 返回 JSON 中文在 GBK 控制台显示为 Ã¥... 型乱码；DB 实际存储正常（HEX 核验 UTF-8）。判断写入是否正常用 node 脚本直查库，勿信 pwsh 显示 |
| **Nuxt SPA 内 <a download> 直链点击被客户端路由拦截成 404**（2026-09-07 实测） | 点击后 URL 变目标路径但零网络请求（Network 事件为空铁证）→ Nuxt 404 页。文件下载一律用 downloadTemplate 模式：fetch(blob) → URL.createObjectURL → 临时 a[download].click() → revoke（specs/index.vue 现成实现）；CDP 下载验证监听 Page.downloadWillBegin + Browser.setDownloadBehavior 落盘 |
| **workspace-write 沙箱内访问 127.0.0.1 超时/被重置、netstat 不见监听**（2026-09-08 实测） | 沙箱进程的 HTTP 探测（Invoke-WebRequest/fetch）对 127.0.0.1 表现为超时或 ECONNRESET，Get-NetTCPConnection/netstat 也看不到宿主机监听（误导「端口干净」）；但宿主机视角连接其实建立（TIME_WAIT 可见）。**服务器连通性验证一律在 danger-full-access 模式执行**（会话切全权后正常）；判断端口占用以「实际 bind 是否 EADDRINUSE」与全权 netstat 为准 |
| **CDP 脚本页面内函数序列化（String(fn)+Runtime.evaluate）禁止引用 Node 上下文闭包**（2026-09-08 实测） | expr/q 只序列化函数体本身，引用的外层辅助函数（Node 侧定义）在页面作用域不存在 → ReferenceError（EXC），表现为断言全 FAIL 而页面无真实错误。需页面执行的函数必须**自包含**（document/window 全量内联），参数经 JSON 序列化传入；脚本 scripts/_tmp-cdp-ent-tab.mjs 即自包含写法范例 |

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
