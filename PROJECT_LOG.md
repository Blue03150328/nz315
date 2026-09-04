## 变更记录
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