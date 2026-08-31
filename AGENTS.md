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
| 参考前端 | 农码查（E:\wokeplace\二维码跳转网站）：界面 1:1 复用（绿色农业风、移动壳+PC 响应式）；后端全部重做 |
| 文档 | README.md（总览）· docs/DEPLOYMENT.md（部署）· docs/COMPLIANCE.md（1049合规自检） |

### 🛠️ 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev -- --host 0.0.0.0 --port 3100` | 启动开发服务器（**端口 3100**！3000 被农码查残留实例占用，勿用 3000） |
| `node scripts/db-init.mjs` | 初始化数据库（建库建表 + 演示数据，幂等可重跑；连接凭据从 `.env` 读取） |
| `npm run build` / `npm run preview` | 生产构建与预览 |
| `node "E:\software\nodejs\install\node_modules\npm\bin\npm-cli.js" install ...` | npm wrapper（npm.ps1/cmd）损坏时的替代调用方式 |

### 🗄️ 数据库（MySQL：`nz315`，连接配置在 `.env`，不提交仓库）

11 张表（PRD 第七章 + message 消息 + system_setting 配置）：`enterprise`（企业）· `product_spec`（产品规格主数据，规格码=码第9-11位）· `product`（产品 SKU，登记证号全局唯一）· `batch`（生产批次，三要素）· `trace_code`（追溯码：两状态 status 1已生成/2已绑定 + 异常标记 abnormal_flag 0正常/1冻结/2作废，正交）· `user`（角色 platform_admin/enterprise_admin/code_admin/viewer，bcrypt 密码）· `operation_log` · `scan_log` · `risk_alert`

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

### ✅ 项目进度（截至 2026-08-31）

**已实现（V1.0 核心）**：
- H5 扫码页 10 场景（正品·已绑定/已生成、查无此码、登记证过期、重复查询、冻结、作废、过有效期、信息存疑、格式错误）
- 后台：登录、数据概览、追溯码生成（1049结构+自定义段+导出）、码库管理（异常标记/批量修正）、外箱码管理、产品规格管理、产品管理、生产批次管理、生产采集、扫码统计、系统设置（企业信息/用户权限/操作日志/通知配置/数据备份）、风险预警中心、消息中心
- H5 扫码为真实链路：查库 + 写 scan_log + 异常判定 + 自动触发风险预警（重复查询/登记证过期已接入）
- **生产构建验证通过**（2026-08-31）：npm run build 全量构建成功（.output 6.24MB），生产服务器登录/扫码/后台全链路 200；修复 .env 的 SESSION_SECRET 未改默认值导致的生产登录 500（已换 64 字符强随机密钥，不入库）
- **码库管理页已完成企业级 B 端改造**（2026-08-31，两轮）：①筛选卡片化+吸底批量操作条+内容区 max-w-[1600px]；②彻底剥离小程序风格：白底细边框小圆角、细分割线分区、状态标签浅底深字（bg-*-50+text-*-700）、操作列纯文字按钮、批量条浅灰底、主按钮 neutral solid 深灰黑；全局主色降饱和 hsl(142 32% 30%)、--ui-radius 0.375rem、后台底色 #f0f2f5。其他列表页仍为旧风格，迁移模式见 PROJECT_LOG

**待办（按 PRD 版本规划）**：
- 自动备份调度与异地备份（OSS）、微信推送（需公众号对接）、异常类型 2/3/5/6/7/8 预警触发接入（依赖 D2 登记证库/IP 归属地）
- 码生成离线 EXE 版（可复用 code-generator.ts 引擎打包）
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