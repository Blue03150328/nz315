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

### 2026-08-31 | 修复 10 处类型错误与统计接口 GROUP BY 兼容问题
- **工作内容**：全量 typecheck 发现 9 处类型错误（新增模块引入）+ 1 处逻辑 bug——catch(e) 隐式类型、split 索引可能 undefined、FLAG_LABEL 索引类型、map(Number) 隐式 any、pairs[prev] 可能 undefined；statistics.get.ts 产品分布 GROUP BY 缺 p.name（ONLY_FULL_GROUP_BY 兼容）。
- **修改文件**：server/utils/{audit,notify,risk-alert}.ts、server/api/admin/{boxes/parse.post, codes/[id].patch, codes/batch-correct.post, codes/batch-flag.post, statistics.get}.ts、server/api/trace.get.ts
- **测试情况**：nuxi typecheck 0 错误、semgrep（security-audit+secrets）0 发现、code-generator 长度数学验证通过、git 提交 c7e9aa2
- **遗留问题/待办**：见 AGENTS.md 项目进度待办段
- **给下一个 Agent 的提示**：本机类型检查用 npx tsc --noEmit -p .nuxt/tsconfig.json；catch(e) 需 (e as any)；split(',')[0] 需 (…[0] || '')；GROUP BY 需列出全部非聚合列

### 2026-08-31 | 上线文档（README / 部署指南 / 1049 合规自检表）
- **工作内容**：① README.md（项目总览/功能清单/快速开始/演示账号/目录结构/文档索引/上线注意事项）；② docs/DEPLOYMENT.md（环境要求/部署步骤/nginx HTTPS 配置/PM2 守护/安全清单 8 项/备份恢复/性能容量提醒/FAQ）；③ docs/COMPLIANCE.md（1049 公告 13 项条款逐条核对：9 项 ✅、3 项 🟡 依赖外部、1 项上线倒排；合规验收指标对照）。
- **修改文件**：`README.md`、`docs/DEPLOYMENT.md`、`docs/COMPLIANCE.md`（新增）
- **测试情况**：文档与平台实际功能逐项核对；部署验证清单 6 项
- **遗留问题/待办**：自动备份调度与异地备份（OSS）；微信推送（需公众号凭据）；异常类型 2/3/5/6/7/8 预警接入（依赖 D2/IP 归属地）；码生成离线 EXE（复用 code-generator.ts）；D1-D4 待决项上线前决策
- **给下一个 Agent 的提示**：合规自检 3 项 🟡 为外部依赖（D2 登记证库/IP 归属地/印刷码制），上线前需用户确认印刷方与外部数据源

---
### 2026-08-31 | 追溯码生成（PRD 5.5.1 Web 版离线生成工具）
- **工作内容**：① 码生成引擎（code-generator.ts）：第 1-11 位强制结构（登记类别+登记证后6位+生产类型+规格码，取自产品/规格主数据），第 12 位后自定义段（时间戳：毫秒/秒/年月日/不使用 + 校验位：MD5取模转纯数字 00-99，保证 32 位全数字）；② 批量生成：流水号填充保证唯一、本地+系统内重码检测自动重试；③ 生成 API（不入库，审计日志）；④ 页面 /admin/generator：产品选择（自动带出码结构说明）、数量（1-10000）、时间戳/校验位配置、分段色块预览（登记类别|登记证后6位|生产类型|规格码|自定义段）、导出 TXT/CSV（CSV 含分段列）。菜单新增「追溯码生成」。
- **修改文件**：`server/utils/code-generator.ts`（新增）、`server/api/admin/codes/generate.post.ts`（新增）、`app/pages/admin/generator/index.vue`（新增）、`app/layouts/admin.vue`
- **测试情况**：端到端全过：生成 100 条全部 32 位纯数字、结构断言（1|040767|1|001）、校验位重算匹配、无时间戳/无校验配置、超量 400 拒绝、页面 SSR；修复了 MD5 hex 校验位含字母（违反 32 位纯数字）问题
- **遗留问题/待办**：离线 EXE 版工具（可复用生成引擎打包）；自动备份调度与异地备份（OSS）；微信推送（需公众号凭据）；异常类型 2/3/5/6/7/8 预警接入（依赖 D2/IP 归属地）；**部署文档与 1049 合规自检（上线前必做）**
- **给下一个 Agent 的提示**：校验位必须纯数字（MD5 hex 含 a-f 会破坏 32 位数字规则）；生成码不入库，走生产采集导入

---
### 2026-08-31 | 外箱码管理 + 批量修正工具（PRD 5.5.6 / 5.8）
- **工作内容**：① 外箱码管理（PRD 5.5.6）：上传解析（每行"外箱码,单品码"）→ 校验（外箱码全局唯一/单品码在系统且标记正常/单品码未归属其他外箱/文件内重复）→ 事务绑定（一对多）→ 外箱码列表（箱内码数/箱状态随最低码联动/含作废码标红）→ 箱内码详情 → 解绑（需输入"确认解绑"二次确认+审计日志）；② 批量修正工具（PRD 5.8 场景8）：码库勾选 → 重新绑定批次（仅"已生成"码，产品一致性校验，绑定后自动"已绑定"）/生产日期/有效期至/质检结果/合格证号（按批次更新+冗余同步）→ 异常标记优先（含冻结/作废码整批拒绝）→ 已绑定码修改记合规更正强日志。菜单新增「外箱码管理」。
- **修改文件**：`server/api/admin/boxes/parse.post.ts`、`boxes/bind.post.ts`、`boxes.get.ts`、`boxes/[code].get.ts`、`boxes/unbind.post.ts`（新增5个）、`server/api/admin/codes/batch-correct.post.ts`（新增）、`app/pages/admin/boxes/index.vue`（新增）、`app/pages/admin/codes/index.vue`（+批量修正对话框）、`app/layouts/admin.vue`
- **测试情况**：端到端全过：解析（有效/无效原因分类）、绑定（bound=1）、列表/详情、重复归属拦截、解绑确认词校验（错误拒绝/正确通过）；批量修正绑定批次 rebound=1、生产日期 corrected=1、含作废码整批拒绝；页面 SSR 全过
- **遗留问题/待办**：自动备份调度与异地备份（OSS）、微信推送（需公众号凭据）、异常类型 2/3/5/6/7/8 预警接入（依赖 D2/IP 归属地）、码生成 Web 版与离线 EXE、部署文档与 1049 合规自检（上线前）
- **给下一个 Agent 的提示**：conn.query 返回 [rows,fields]，取第一行须先解构 rows 再 [0]（本模块踩坑已修）；外箱码状态联动=箱内最高 abnormal_flag

---
### 2026-08-31 | 消息中心与通知配置 + 数据备份（PRD 5.11/5.12.5/5.12.6）
- **工作内容**：① 站内消息系统：message 表 + 消息工具（notify.ts），风险预警触发/生产采集导入完成自动生成消息，消息中心页（/admin/messages：类型筛选/只看未读/标记已读/跳转链接/未读角标）；② 通知配置（PRD 5.12.5）：system_setting KV 表 + 配置页 Tab（库存预警阈值/日报时间/5 类通知开关），厂家/平台级隔离存储；③ 数据备份（PRD 5.12.6）：mysqldump 全库手动备份（--single-transaction 不锁表）→ backup/ 目录（已 gitignore），历史/下载/删除（文件名纯数字防穿越），仅总部管理员；④ 系统设置新增「通知配置」「数据备份」两个 Tab；菜单新增「消息中心」。
- **修改文件**：`server/utils/notify.ts`（新增）、`server/utils/risk-alert.ts`（预警→消息）、`server/api/admin/codes/import.post.ts`（导入→消息）、`server/api/admin/messages.get.ts`、`messages/[id].patch.ts`（新增）、`server/api/admin/settings/notify.get.ts`、`notify.put.ts`（新增）、`server/api/admin/backup.post.ts`、`backup.get.ts`、`backup.delete.ts`、`backup/download.get.ts`（新增）、`app/pages/admin/messages/index.vue`（新增）、`app/pages/admin/settings/index.vue`（+2 Tab）、`app/layouts/admin.vue`、`scripts/db-init.mjs`（+message/system_setting 表）、`.gitignore`（+backup/）
- **测试情况**：端到端全过：预警触发→自动消息（未读计数正确）→标记已读；通知配置保存/读取（厂家/平台隔离）；备份执行（23KB SQL）→历史→下载（200）→文件名校验；页面 SSR 全过
- **遗留问题/待办**：自动备份调度（频率/时间/保留周期）、异地备份（OSS）、微信推送（需公众号对接）；异常类型 2/3/5/6/7/8 预警接入；码生成离线工具；外箱码管理；批量修正工具
- **给下一个 Agent 的提示**：备份文件在 backup/（gitignore，含全量数据勿提交）；消息由 notify.ts 发送，新事件类型只需调用 sendMessage

---
### 2026-08-31 | 异常码处理与风险预警中心（PRD 5.8/5.9）
- **工作内容**：① 预警触发引擎（risk-alert.ts）：扫码命中异常自动写 risk_alert，同码同类未处理合并累计次数（重复查询 type=1、登记证过期 type=4 已接入，其余类型预留）；② 码异常标记操作（PRD 5.5.5）：单条/批量冻结·作废·恢复正常（作废必填原因、终态不可恢复、整批含作废码拒绝）；③ 风险预警中心（/admin/alerts）：列表筛选（类型/状态/关键词/日期）、证据摘要、处理对话框（核实合规 / 确认违规 + 一键作废关联码）、待处理统计；④ 码库管理页增强：批量勾选 + 冻结/作废/恢复正常操作。菜单「风险预警」已启用。
- **修改文件**：`server/utils/risk-alert.ts`（新增）、`server/api/trace.get.ts`（预警触发）、`server/api/admin/codes/[id].patch.ts`、`codes/batch-flag.post.ts`（新增）、`server/api/admin/alerts.get.ts`、`alerts/[id].patch.ts`（新增）、`app/pages/admin/alerts/index.vue`（新增）、`app/pages/admin/codes/index.vue`（增强）、`app/layouts/admin.vue`
- **测试情况**：端到端全过：登记证过期扫码→自动预警（type=4/pending=1）→核实合规；冻结→扫码 frozen；作废（必填原因）→扫码 voided 产品隐藏；作废无原因 400；**作废后恢复被拒（终态保护）**；日志记录完整
- **遗留问题/待办**：异常类型 2/3/5/6/7/8 预警触发待接入（依赖登记证库对接 D2、IP 归属地）；消息通知与数据备份（PRD 5.12.5/5.12.6）；码生成离线工具；外箱码管理；批量修正工具
- **给下一个 Agent 的提示**：预警合并逻辑在 risk-alert.ts（handle_status=0 合并累计）；作废终态保护在 batch-flag.post.ts

---
### 2026-08-31 | 系统设置模块（企业信息/用户权限/操作日志）
- **工作内容**：① 企业信息维护（PRD 5.12.1）：enterprise 表扩展 7 字段（法人/官网/地址/LOGO/简介/生产许可证号/资质到期日）+ 查看/编辑；② 用户权限管理（PRD 5.12.3）：用户列表（角色/企业/最后登录/状态）、新增用户（角色与企业归属校验）、禁用/启用、重置密码（bcrypt）；③ 操作日志（PRD 5.12.4）：audit.ts 审计工具 + 登录日志（成功/失败、IP、设备）+ 敏感操作日志（用户管理/系统设置），日志列表筛选分页；④ 新增企业列表 API（选企业用）。菜单「系统设置」已启用。
- **修改文件**：`server/utils/audit.ts`（新增）、`server/api/auth/login.post.ts`（登录审计+失败限速）、`server/api/admin/settings/enterprise.get.ts`、`settings/enterprise/[id].patch.ts`、`server/api/admin/users*.ts`（4个）、`server/api/admin/logs.get.ts`、`server/api/admin/factories.get.ts`、`app/pages/admin/settings/index.vue`（新增三Tab页）、`app/layouts/admin.vue`、`scripts/db-init.mjs`（enterprise 表扩展）
- **测试情况**：Node 端到端全过：企业信息读/改、用户创建/重复名拒绝/重置密码后新密码可登录/禁用后登录 403、厂家账号权限隔离（不可建管理员、可建码管理员）、日志查询含登录记录；设置页 SSR 200
- **遗留问题/待办**：异常码处理与风险预警中心（PRD 5.8，V1.1）、码生成离线工具、外箱码管理、批量修正工具；消息通知配置与数据备份（PRD 5.12.5/5.12.6）本期未做
- **给下一个 Agent 的提示**：⚠️ 存在并行 Agent 会话修改本项目（login.post.ts 限速、icon 配置等）——修改文件前先 `git status` 与 `git log` 核对，提交时精确 `git add` 指定文件避免混合；db-init.mjs 曾被并行覆盖，已重新应用 enterprise 扩展字段

---
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