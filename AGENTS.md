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
| `npm run dev -- --host 0.0.0.0 --port 3100` | 启动开发服务器（**端口 3100**！3000 被农码查残留实例占用，勿用 3000） |
| `node scripts/db-init.mjs` | 初始化数据库（建库建表 + 演示数据，幂等可重跑；连接凭据从 `.env` 读取） |
| `node scripts/import-regdata.mjs` | 导入农药登记数据源（pesticide_reg 字典表，97,471 条；数据源 2026农药登记证大全2.xlsx 不入库；幂等重灌） |
| `npm run build` / `npm run preview` | 生产构建与预览 |
| `node "E:\software\nodejs\install\node_modules\npm\bin\npm-cli.js" install ...` | npm wrapper（npm.ps1/cmd）损坏时的替代调用方式 |

### 🗄️ 数据库（MySQL：`nz315`，连接配置在 `.env`，不提交仓库）

13 张表（PRD 第七章 9 张 + message 消息 + system_setting 配置 + consumer 消费者 + **pesticide_reg 农药登记数据源字典表**（97,471 条，登记证号唯一，产品弹窗自动回填；农资店改用高德 POI 实时检索，无自建表）：`enterprise`（企业）· `product_spec`（产品规格主数据，规格码=码第9-11位）· `product`（产品 SKU，登记证号全局唯一）· `batch`（生产批次，三要素）· `trace_code`（追溯码：两状态 status 1已生成/2已绑定 + 异常标记 abnormal_flag 0正常/1冻结/2作废，正交）· `user`（角色 platform_admin/enterprise_admin/code_admin/viewer，bcrypt 密码）· `operation_log` · `scan_log`（含 `consumer_id`，登录消费者扫码归属） · `risk_alert` · `consumer`（微信 openid 唯一，公众端消费者）

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

### ✅ 项目进度（截至 2026-09-02）

**已实现（V1.0 核心）**：
- **产品弹窗原药字段双通道组合框**（2026-09-03，提交 b56c365）：原药登记证号/企业两字段升级「下拉选择+手动输入」（RegOrigCombobox：自由输入+候选面板实时过滤）；双向联动（命中候选自动带出对方/不匹配清空对方）；剂型原药/母药回填自身后仍可下拉重选或手输（候选=同成分原药含自身）；无匹配场景候选空纯手动互不清空；制剂多匹配两字段保存必填（非空即可）。验证：tsc 0 + 构建 + CDP v5 17/17 + SSR 13 页全过
- **产品弹窗登记回填放开编辑迭代**（2026-09-03，提交 434903d）：回填字段从「只读锁定」改为「数据源默认值 + 可手动修改」（9 字段含**产品类别**，非标类别如卫生杀虫剂/杀螨剂动态并入下拉）；切换登记产品以数据源覆盖刷新、清空同步清空；原药两字段回填放开编辑，多匹配场景两字段均为下拉（v-model 同源联动必填）；**复配制剂取首个有效成分匹配并显示核对警示**；服务端补产品类别必填校验。验证：tsc 0 错误 + 构建 + CDP 30 项 + SSR 13 页全过
- **产品弹窗接入农药登记数据源自动回填**（2026-09-03，提交 d2362b3 / 00d4f46）：新增/编辑产品改为「先选生产类型 → 搜登记产品（登记证号主键，97,471 条数据源表 pesticide_reg）→ 自动回填 8 个登记字段（只读）→ 原药两字段三态联动」；持有人生产只选本厂（企业名称归一化过滤）、委托加工/分装可选全部；原药：剂型原药/母药=自身回填，制剂按有效成分匹配原药（唯一自动/多家必选下拉/无匹配手填提示）；**保质期录入整行移除**（服务端不再写，历史值保留）；切换生产类型自动核对清空。数据源导入脚本 scripts/import-regdata.mjs（xlsx 不入库，.gitignore 已排除）。验证：tsc 0 错误 + 生产构建 + API 12 项 + CDP 73 项 + SSR 13 页全过
- **修复侧栏菜单高亮跟随**（2026-09-02）：isActive 前缀匹配 bug 导致根级菜单 /admin（数据概览）永远高亮——startsWith('/admin/') 命中全部子路由；改根路径精确匹配后，点击/直达/切换页面菜单高亮均正确跟随（CDP 5 场景实测）
- **删除外箱码管理模块**（2026-09-02，提交 b49ec23）：按用户指示整体下线 PRD 5.5.6 外箱码管理——后台页面 app/pages/admin/boxes/、侧栏入口、5 个管理 API（列表/详情/bind/parse/unbind）、码库查询冗余字段一并清除；trace_code 表 DDL 删 outer_box_code 列并新增 migrate() 增量删列（幂等，已实测执行）；数据库列与索引引用零残留，后台剩 11 个模块页
- **公众端「扫一扫」真正落地**（2026-09-02，提交 5090eb8）：原首页/BottomNav 扫码按钮仅聚焦输入框提示手动输入（占位），用户反馈「手机点开网站无法扫一扫」。新增沉浸式扫码页 `/scan`（fullbleed 黑底 + 取景框四角/扫描线/框外压暗）+ 核心 composable `useQrScanner.ts`——**BarcodeDetector 原生优先 + @zxing/library 逐帧兜底**（复用已有依赖），识别 32 位纯码或 `/trace?code=` URL 自动跳查询页，普通二维码忽略继续扫（防误跳）；**三通道降级**：iOS 微信网页禁调相机 → 引导右上角浏览器打开/相册选图、权限拒绝/无摄像头/非 HTTPS → 中文错误、相册拍照选图全环境可用（含 iOS 微信）；命中/离开即释放相机流。入口接线：首页大按钮 + 手机底栏（扫码项 /q/ 虚拟路径改真实 /scan，/trace 结果页保持高亮）+ PC 顶部菜单。验证：tsc 0 错误 + 构建 + CDP 移动视口 18 项 / zxing 兜底 4 项 / PC 3 项 / DOM 测量全通过
- H5 扫码页 10 场景（正品·已绑定/已生成、查无此码、登记证过期、重复查询、冻结、作废、过有效期、信息存疑、格式错误）
- 后台：登录、数据概览、追溯码生成（1049结构+自定义段+导出）、码库管理（异常标记/批量修正）、产品规格管理、产品管理、生产批次管理、生产采集、扫码统计、系统设置（企业信息/用户权限/操作日志/通知配置/数据备份）、风险预警中心、消息中心
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
- **等待用户提供微信凭据**：AppID/AppSecret（另需在公众平台配置网页授权域名 www.nz315.cn）；到位后需真机验证授权回调
- **上线前**：高德 JS API key 须在控制台配置**域名白名单**（本地未受限但线上必配）；Web服务 key 需确保生产环境额度充足（POI 检索每请求 2 次调用，有 1km 网格缓存）
- 自动备份调度与异地备份（OSS）、微信推送（需公众号对接）、异常类型 2/3/5/6/7/8 预警触发接入（依赖 D2 登记证库/IP 归属地）
- 码生成离线 EXE 版（参考工具 E:\wokeplace\二维码生成离线软件 已有 electron 工程，Web 引擎已对齐可移植打包）
- 待决项：D1 亿级数据方案（上线前定）、D2 登记证数据库对接、D3 限用农药、D4 旧规迁移

### ⚠️ 踩坑记录

| 坑 | 应对 |
|---|---|
| 端口 3000 被农码查残留 dev 实例占用 | 本项目 dev 固定用 **3100**；启动前 `Get-NetTCPConnection -LocalPort 3000` 排查 |
| npm wrapper（npm.ps1/cmd）损坏 | 直调 `node <npm安装路径>/npm-cli.js install` |
| mysql2 对 JSON 列自动解析为数组 | 勿再 `JSON.parse`；BIGINT 用 `Number()` 转换 |
| `const [rows] = await query()` 解构陷阱 | `query()` 返回行数组，取第一行用 `const [row] =`，取全部直接赋值 |
| Vue 模板中禁止 `import.meta.*` 表达式 | 先赋值到 script 常量再用于模板（Vite 编译报错） |
| 离线环境 dev 崩溃（fonts.google.com 超时） | nuxt.config.ts 已禁用 fonts.providers.google/googleicons，勿恢复 |
| Nuxt UI v4 无 URadio 组件 | 单选用 URadioGroup 或自绘；v3 组件名（URadio/UButton square 等）会触发 Vue warn |
| Chrome headless 截图挂死 | 加 `--user-data-dir` 独立 profile；一次一个进程，`Start-Process -Wait` |
| DSH 沙箱内构建报 esbuild spawn EPERM | 沙箱禁止子进程管道（非项目问题）；构建在沙箱外运行或申请全权模式 |
| 生产登录 500「必须配置独立 SESSION_SECRET」 | `.env` 的 SESSION_SECRET 仍是默认值 dev-session-secret-change-me；换强随机值后**重新构建**（runtimeConfig 构建时内嵌）；运行期覆盖用 NUXT_SESSION_SECRET 环境变量 |
| 本机 MySQL | 服务 MySQL80，root/ruijie（**凭据只在 `.env`，不提交**） |
| **dev 模式在本机不可用**（Nitro 2.13.4 + Node 24 + 中文路径） | CJS external 依赖生成 `file://E:/`（少一个斜杠）→ ESM loader 500；nitro.inline 触发 renderer TDZ（已回退）。**开发验证用生产构建 + node .output/server/index.mjs**；待升级 nitro 后恢复 |
| TS7 模块化 d.ts 三斜线引用失效 | `server/types/cjs-modules.d.ts` 必须保持无 import 的全局脚本形态（实验证实：带 import 的 d.ts 经 /// reference 不生效） |
| npx/npm wrapper 损坏 | tsc 直调 `node node_modules/typescript/bin/tsc`；dev/构建直调 npm-cli.js |
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