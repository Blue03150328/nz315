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

## 变更记录

### 2026-08-31 | 扫码统计模块 + H5 扫码真实化
- **工作内容**：① H5 扫码链路真实化：`/api/trace` 从 mock 改为查库（trace_code/product/batch 联查）→ 写扫码日志（scan_log，设备识别/IP 记录）→ 异常判定链（作废/冻结优先 → 登记证过期 → 产品过有效期 → 重复查询≥3次且≥2省）；② 新增扫码统计页（/admin/statistics）：累计/今日卡片、近30天趋势、24小时时段、产品分布、地区分布、明细（分页+筛选）。菜单「扫码统计」已启用。
- **修改文件**：`server/api/trace.get.ts`（重写）、`server/api/admin/statistics.get.ts`（新增）、`app/pages/admin/statistics/index.vue`（新增）、`app/layouts/admin.vue`、`scripts/db-init.mjs`（seed 登记证有效期改未来日期）
- **测试情况**：端到端 Node 测试全过：扫码已绑定码→正品（批次信息完整）、作废码→作废页（产品隐藏）、连续扫码查询计数正确、统计 API 聚合正确（累计/今日/产品分布/明细）；统计页 SSR 200
- **遗留问题/待办**：扫码地区分布依赖 IP 归属地（province 暂空，接入后生效）；重复查询跨省判定同；下一步：系统设置（企业信息/用户权限/操作日志）
- **给下一个 Agent 的提示**：扫码日志在 `scan_log` 表；H5 判定链在 trace.get.ts，异常优先级：作废>冻结>登记证过期>产品过期>重复查询>正常

---
### 2026-08-31 | 修复类型错误：icon 客户端打包配置与查询接口类型标注
- **工作内容**：按 code-review 遗留项修复两处类型错误——nuxt.config.ts 的 icon clientBundle.collections 为 @nuxt/icon 2.5.1 不支持的选项（TS2353），改用 scan 自动收集 lucide 图标；server/api/query/[code].get.ts 的 buildCompare 缺返回类型标注导致 riskLevel 推断为宽类型（TS2322），补 ICompareResult/ICompareItem 标注。
- **修改文件**：nuxt.config.ts、server/api/query/[code].get.ts
- **测试情况**：nuxi typecheck 0 错误（此前 4 个类型错误清零）、semgrep 安全扫描 0 发现、git 提交 9f9e0a0
- **遗留问题/待办**：扫码统计、系统设置、异常码处理（V1.1）、码生成离线工具、外箱码管理、批量修正工具；待决项 D1-D4 见 PRD
- **给下一个 Agent 的提示**：icon 配置 clientBundle 不支持 collections（仅 serverBundle 支持）；类型检查用 npx tsc --noEmit -p .nuxt/tsconfig.json

### 2026-08-31 | 建立 Memory 系统与提交契约（AGENTS.md + PROJECT_LOG.md）
- **工作内容**：按用户要求建立项目记忆系统：创建 `AGENTS.md`（用户全局偏好：JS 严格模式/中文 UI/中文注释/强制提交契约 + 项目速览/进度/踩坑），创建本变更记录档案，并注册 DSH 技能 `project-preferences`。
- **修改文件**：`AGENTS.md`、`PROJECT_LOG.md`、`.dsh/skills/project-preferences/SKILL.md`
- **测试情况**：git log 验证两次提交（c15eab2 V1.0 核心功能、6c859a1 Memory 系统）
- **遗留问题/待办**：扫码统计、系统设置、异常码处理（V1.1）、码生成离线工具、外箱码管理、批量修正工具；待决项 D1-D4 见 PRD
- **给下一个 Agent 的提示**：先读 `AGENTS.md` → `git log --oneline` → 本文件 → PRD；dev 端口 3100；.env 不入库

### 2026-08-31 | 农资315追溯码管理平台 V1.0 核心功能（首个提交）
- **工作内容**：完成平台 V1.0 核心：H5 扫码页（/trace?code=，10 场景）、后台六模块（登录/数据概览/码库/规格/产品/批次/采集）、9 张表数据库、认证与会话、码校验引擎。前端界面 1:1 复用农码查（农资315 绿色主题）。
- **修改文件**：`app/`（全部页面与组件）、`server/`（API 与工具）、`shared/types/`、`scripts/db-init.mjs`、`nuxt.config.ts`、`package.json`
- **测试情况**：SSR 全页面 200 验证、登录/CRUD/码解析导入端到端 Node 测试全过、Chrome 截图视觉验证
- **遗留问题/待办**：见 AGENTS.md 项目进度段
- **给下一个 Agent 的提示**：mysql2 JSON 列自动解析、query() 解构陷阱、模板禁 import.meta，详见 AGENTS.md 踩坑记录