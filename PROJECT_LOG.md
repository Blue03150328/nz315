## 变更记录

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
  - 客户端 935 模块构建通过，Nitro server 构建成功，产物 .output 共 6.24 MB（gzip 1.63 MB）；
  - 生产服务器（node .output/server/index.mjs, 端口 3101）验证：首页/登录/扫码页/后台页全部 200；登录→me→码库→概览 API 链路全通；扫码页正品码 resultType=genuine、无效码查无此码场景正常；
  - **发现并修复**：登录接口 500「生产环境必须配置独立 SESSION_SECRET」——根因是 .env 的 SESSION_SECRET 一直为 .env.example 默认值（28 字符 dev-session-secret-change-me），构建时被内嵌进产物，运行时代码的正确安全拦截生效。已生成 64 字符强随机密钥（base64url，PS 加密 API）更新 .env（不入库）并重新构建，产物内默认密钥零残留，登录链路复测通过；
  - **环境备注**：本会话沙箱下 esbuild spawn EPERM（沙箱禁止子进程管道，非项目问题），构建需在沙箱外或全权模式运行。
- **修改文件**：.env（不入库，密钥轮换）、docs/DEPLOYMENT.md（SESSION_SECRET 配置警告 + 运行时环境变量注入说明 + 安全清单 2 条 + 常见问题 1 条）
- **测试情况**：构建产物验证（首页/登录/扫码/后台 200，登录全链路 API 通过，正品/无效码场景正常，产物密钥内嵌检查无默认值残留）
- **遗留问题/待办**：V1.1 增强按 AGENTS.md 待办推进；D1-D4 待决项待用户确认；.env 为 GBK 编码已顺手转 UTF-8（键值均为 ASCII 不受影响）
- **给下一个 Agent 的提示**：① 构建时 runtimeConfig 从 .env 内嵌进产物（含 DB 凭据明文），构建前必须确认 .env 最终正确，.output 严禁对外分发；② 构建产物启动不加载 .env，生产运行期配置靠 NUXT_* 环境变量注入（文档已写）；③ 本机 npm wrapper（npm.ps1）损坏，构建/安装用 node 直调 npm-cli.js；④ 沙箱内构建需全权模式（esbuild spawn 限制）。

### 2026-08-31 | 码库管理页第二轮改造：彻底剥离小程序风格（Element Plus / AntD Pro 式克制中后台）
- **工作内容**：上一轮 B 端化仍残留小程序设计语言（大圆角、柔和浅底、高饱和彩色标签、鲜艳绿按钮），本轮彻底收敛：①筛选区/表格/批量条全部改为白底细边框小圆角（rounded-sm 4px）、内部细分割线（#ebeef5）分区，去掉阴影与卡片浮层；②状态标签改为「底色浅 + 文字重」简约样式（bg-blue-50/emerald-50/amber-50/red-50 + 深色字，圆角收小，去掉圆点与边框）；③操作列改纯文字按钮（link 变体，去图标，竖线分隔）；④批量操作条低饱和浅灰底（#fafafa）+ 顶部细横线，按钮主次分明（仅批量作废用红色警示，其余中性灰）；⑤主按钮改中性深色（neutral solid），重置/取消 outline 中性；⑥全局主题：主色降饱和 hsl(142 45% 38%)→hsl(142 32% 30%)、--ui-radius 0.5rem→0.375rem、后台底色 #f0f0f8→#f0f2f5（AntD 标准底色）。逻辑零改动。
- **修改文件**：`app/pages/admin/codes/index.vue`、`app/assets/css/main.css`、`app/layouts/admin.vue`
- **测试情况**：headless Chrome 截图 + DOM 检查：标签类名全部为浅底深字（bg-*-50 + text-*-700）、按钮序列符合主次设计、无 Vue warn；视觉模型评估确认克制严谨中后台质感、黑白灰主调、无高饱和色块；登录页/数据概览/H5 扫码页截图验证全局主题改动无副作用
- **遗留问题/待办**：其他列表页（products/boxes/batches 等）仍为旧风格，可按码库页模式迁移；演示数据中个别产品名含乱码字符（数据问题，非 UI）
- **给下一个 Agent 的提示**：页面色彩全部页面级硬编码（#303133/#606266/#86909c/#ebeef5 等 Element 色板），未用主题变量；主按钮用 neutral solid（深灰黑）刻意脱离主题绿；批量条吸底依赖布局 px-8

---

### 2026-08-31 | 码库管理页 B 端化改造（企业级后台风格，替代小程序轻量风格）
- **工作内容**：按需求将「码库管理」页从移动端轻量风格切换为企业级 B 端后台：①筛选查询区改为带标题条+标签表单+底部操作条的独立卡片（与列表容器明确分隔，控件尺寸适配 PC）；②表格强化表头（浅灰底+加粗列头+全选列）、行区分（hover/选中高亮）、状态标签提升视觉权重（边框+圆点+语义色，已作废/已冻结实心高对比）；③批量操作从筛选区移出，改为吸底通栏操作条（顶部粗分隔线+阴影，含已选计数徽章、禁用态、清空）；④后台内容区 max-w-6xl 放宽至 max-w-[1600px] 适配大屏；⑤弹窗加图标头部与分隔线规范化。逻辑（筛选/冻结/作废/恢复正常/批量修正）未改动。
- **修改文件**：`app/pages/admin/codes/index.vue`、`app/layouts/admin.vue`
- **测试情况**：dev(3100) 热更新后 headless Chrome 截图+DOM 检查：9 列表头/筛选卡/吸底批量条/状态标签全部渲染正常，无 Vue warn；批量条 4 按钮同高同行对齐，未选时禁用态正确；视觉模型评估为专业 B 端风格
- **遗留问题/待办**：其他列表页（products/boxes/batches/specs/collection/statistics 等）仍为旧轻量风格，可按本页模式逐步迁移；截图验证产物在 .tmp-shot/（不入库）
- **给下一个 Agent 的提示**：页面吸底批量条依赖 admin.vue 的 px-8 内边距（-mx-8 通栏），调整布局内边距时需同步；本机 headless Chrome 受沙箱命名管道限制，截图需在沙箱外运行或复用常驻 CDP 实例

---

### 2026-08-31 | 修复预警页 URadio 组件（Nuxt UI v4 无 URadio，Vue warn + 处理对话框不可用）
- **工作内容**：风险预警处理对话框使用 `URadio`（Nuxt UI v3 组件，v4 已移除）导致组件解析失败。改为自绘单选卡片（点击切换 + 选中态圆圈勾选图标）。
- **修改文件**：`app/pages/admin/alerts/index.vue`
- **测试情况**：dev 重启后预警页 200 无组件警告；后台各页正常
- **遗留问题/待办**：无
- **给下一个 Agent 的提示**：Nuxt UI v4 无 URadio/URadioButton，单选用 URadioGroup 或自绘；dev 服务器退出多为外部原因（并行 Agent/字体超时），重启即可

---
### 2026-08-31 | 修复 dev 崩溃：禁用 google 字体提供器（离线环境 fonts.google.com 超时）
- **工作内容**：dev 服务器因 unifont 的 google/googleicons 提供器连接 fonts.google.com 超时（3 次重试耗尽）导致进程退出（exit 1）。在 nuxt.config.ts 增加 `fonts.providers.google/googleicons = false`（@nuxt/fonts 配置），图标仍用本地 lucide 集合不受影响。
- **修改文件**：`nuxt.config.ts`
- **测试情况**：重启后首页/后台/生成页/扫码页全部 200，无 google 超时日志
- **遗留问题/待办**：无
- **给下一个 Agent 的提示**：本机离线，勿恢复 google 字体提供器；HANDOFF 级踩坑已同步 AGENTS.md

---
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