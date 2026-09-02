## 变更记录

### 2026-09-01 | 重做「附近农资店」页面（PC 双栏 / 移动端折叠地图 + 底部弹窗，按用户设计稿）
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