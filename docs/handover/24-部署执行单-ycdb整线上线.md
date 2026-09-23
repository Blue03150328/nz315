# 24 · 部署执行单 —— ycdb 整线上线（外部二维码核验 + 公众端登记库比对 + P1-1 + 生成上限 50 万 + N2–N6 六条修复）

> **生成时间**：2026-09-22 18:2x；**2026-09-23 11:0x 按重打的包全面更新（基线 `a573f09`）**；**2026-09-23 14:3x 按记账版包再次更新（基线 `39753e3` = v2，见下方修订表）**
> **用途**：你（大大怪）在**宝塔终端里逐条粘贴**照做，我在旁边读你贴回来的输出。
>
> **与 17 / 19 号的关系**：
> - **17 号**（09-19 安全加固）**已执行完**，只作历史，**不要照它重跑**；
> - **19 号**（生成上限 50 万）**已被本文取代** —— 因为 `ycdb` **包含** 19 号那笔 `68163bb`
>   （本机已验证 `git merge-base --is-ancestor 68163bb ycdb` → 真）。**跑本文就够了，别再单独跑 19 号**，
>   否则是同一份代码构建两遍。19 号的两条命令铁律仍然有效（已抄进本文 §1）。
>
> 🔴 **2026-09-23 重打说明（原包已作废）**：原包 `nz315-ycdb-1c6730a.tar.gz` **只到 `1c6730a`**，
> **不含 09-23 的 N2–N6 六条修复**（其中 4 个提交改动运行代码）⇒ **照原包部署等于这一轮白干**。
> 现已以 `a573f09` 重打（**该包随后又被 `39753e3` 取代，见下方「2026-09-23 14:3x 修订」**），**指纹见 §0**。**两个旧包都请勿使用、勿上传。**
>
> | 项 | 值 |
> |---|---|
> | **本次代码基线** | **`39753e3`**（`ycdb` 分支；功能提交 = `66b0f6b`(P1-1) + 外码核验/登记库比对 一批 + **N2–N6 五笔 `27f1514`/`18b40f5`/`5a59478`/`d1dbf78`/`d38ba0a`** + **农资记账四笔 `86b4795`/`0542d72`/`1bb28df`/`4308da1`** + **三明治白名单补 `farm_bill`（`39753e3`，v2 包才有）**，其后为文档/记忆提交） |
> | **服务器当前基线** | `02f4d5c`（09-19 那次部署，**已公网实证**，见下「开工前的事实」） |
> | 本次范围（相对 `02f4d5c`） | **75 个文件 / +8,941 −1,023** |
> | 本次性质 | **代码增量 + 有 DDL**（新表 1 张 + `risk_alert` 补 1 列 1 索引）· **零依赖变化** · **零 nginx 变化** · **不需要重传 90MB 工具包** · **不要求用户重新登录** · **新增 1 条宝塔计划任务（N3）** |

---

## 🔴 2026-09-23 14:3x 修订 —— 「农资记账」上线插入，本单从第 5 步起有 **3 处替换**（**已执行到第 4 步的，务必先读这里再做第 5 步**）

> 🆕 **2026-09-23 14:50 现场更新：上一轮上线【已经完成】** —— 本机直连公网实测：构建指纹 `1790135393647` = **2026-09-23 11:49:53（东八区）**、
> `/api/stats` → `{"totalQueries":28,"abnormalClues":0}`（真数）、`/trace?code=10929272…` → 含「不是农资315签发」+`PD20092927`（`external-reg` 生效）、
> 恶意前缀 Origin → **403**、`/nearby-stores` → **200**、`/api/bill` → **404** ⇒ **线上 = `a573f09`，N2–N6 与 P1-1 都已生效**。
> ⇒ **本文原来的口吻「你已做到第 4 步、接着做第 5 步」已过时**：本次是**一轮全新的上线窗口**，走完 §1–§8 全程。
> **本次作业总纲以 `docs/handover/30-交接手册-上线记账功能（2026-09-23）.md` 为准**（含当时的实测评据与逐条命令）。
>
> ✅ **先给结论：上一轮你做的第 0–4 步全部有效，不用重做。** 数据库结构变更（第 4 步）**当时已完整通过**
> （`external_verification` 建表 + `risk_alert` 补列补索引，`external_verification_rows = 0`）。
> 其中三明治第 ③ 步报的「出现基线中不存在的新表」是**假阳性**（处置见提交 `5e1face`），**当时不必回滚**。
>
> 🔴 **变的是后面**：上线期间新增了「**农资记账**」功能，并把「**附近门店**」模块**整体删除**，**动了运行代码**
> ⇒ 原来备好的包 `a573f09` **再次作废**。方案与实施记录见
> **`docs/handover/29-农资记账功能方案（2026-09-23）.md`**（其中 §11.5 与本表内容一致）。

| 编号 | 原内容 | **改成** | 不改的后果 |
|---|---|---|---|
| **R1** | 第 2 步上传的包 = `nz315-ycdb-a573f09.tar.gz`（655,237 B / `9a67f3dd…`） | **换成 `nz315-ycdb-39753e3.tar.gz`**：<br>`E:\software\workbuddy\文件存放处\2026-09-23-1442-ycdb记账版上线包v2\nz315-ycdb-39753e3.tar.gz`<br>**671,250 B** / SHA256 **`40ff67453d5ce79c8f37e4a0d0d97f5132eb066e17a84e93b845bd946fa14b14`**<br>（168 文件 + 55 目录；本机自验 **0 多 0 缺 0 泄漏**） | build 出来**没有记账功能**，且线上**仍挂着要下线的门店模块** |
| **R2** | 第 4 步（已做完）只建了 `external_verification` | 在第 5 步的 `npm run build` **之前**，**再补跑一次 `node scripts/db-init.mjs --migrate-only`** 建新表 **`farm_bill`**（`--migrate-only` **绝不能省**） | 5 个 `/api/bill*` 接口**全部 500**（表不存在），账本页 / 成本分析页**白屏** |
| **R3** | §6.1 / §N6①②③ / §7' 里用 `/api/stores/nearby` 做的 **3 处验收** | **全部作废**（接口已删除 ⇒ **必 404**）；改用下方「R3 替换后的验收」 | 会被误判成「上线失败」而停手 |

> 📌 **为什么又打了 v2（`39753e3`）**：v1 包（`f3c43e0`）里的 `scripts/verify-db-migration.mjs` **白名单只登记了 `external_verification`** ⇒ 本次三明治第 ③ 步会把新表 `farm_bill` 报成 **`FAIL 不在预期白名单里`（假 FAIL、退出码 1）**。
> 已把 `farm_bill` 加进 `EXPECTED_NEW_TABLES`（新表必须存在且 **0 行**）与 `ACTIVE_TABLES`（上线后消费者记账会正常写行，不该被当成污染），
> 并**用四个分支实测过**（白名单内非空→FAIL / 白名单内空→PASS / 白名单外→FAIL / 窗口期增长→不计 FAIL，四条全部符合预期）。v1 包已作废。
> **⏱ 新的执行顺序（第 0–4 步已完成 ⇒ 从这里接）**：
> `上传 R1 新包 + sha256sum 校验（§2）` → `解包并核对（§3）` → **`R2：node scripts/db-init.mjs --migrate-only`** →
> `§5：npm install → npm run build → pm2 reload nz315` → `§6 验证（按 R3 替换后的判据）` → `§7 N3 计划任务` → `§8 写部署标记`。
>
> ⚠️ **R2 的写法已简化**：线上库已经有 `external_verification` 与 `risk_alert` 的新列，本次 `--migrate-only` **只需要建出 `farm_bill`**——
> 但**命令照跑不误、`--migrate-only` 不可省**（它同时负责幂等地补齐其余结构，裸跑会 seed 污染生产）。

**R3 替换后的验收（三条，照这个看数字）**：
1. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/bill` —— **应为 `401`**（记账接口要求消费者登录）；
2. `SHOW TABLES LIKE 'farm_bill'` → **应存在**；`SELECT COUNT(*) FROM farm_bill` → **`0`**（迁移零写入业务数据）；
3. 🔴 **P1-1 换判据**：`/api/stores/nearby` 已删除 ⇒ 验 `scan_log.province` **只能靠"新扫一次码"**：
   先 `SELECT MAX(id) FROM scan_log;` → 打开 `https://www.nz315.cn/trace?code=<任一 32 位码>` →
   再 `SELECT province, city FROM scan_log WHERE id = <刚才那个新 id>;` —— **应有省份值**。
   ⚠️ 缺 `AMAP_WEB_KEY` 时**不报错、不告警**，表现就是这一列**空着**（这条检查的含义变窄了，见 §0 里原来的事实 4）。

**记账功能本身怎么验**（本轮增量，可选）：见 **29 号 §7 验收清单** —— 登录消费者后 `/bill` 与 `/bill/analysis` 的卡片/图表/月小计/年总计表现。

---

## 开工前的事实（2026-09-22 18:1x 从本机直连公网实测，不是推测）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **线上仍是 09-19 的构建产物** | `GET /_nuxt/builds/latest.json` → `timestamp=1789812536370` → **2026-09-19 18:08:56 (UTC+8)**。⇒ **ycdb 整条线与 50 万上限都还没上线** |
| 2 | **线上已是 09-19 加固版** | `POST /api/auth/login` 带恶意前缀 Origin `https://www.nz315.cn.evil.com` → **403**（旧版会走到 401）⇒ 17 号执行单是完整跑完的 |
| 3 | **离线工具包已就位、旧版已删** | `HEAD /tools/nz315-qr-tool-v1.2.0.exe` → **200 / `95035957`**；`.../v1.1.0.exe` → **404**。⇒ 本次**不用重传**，但**必须在 build 之前确认它还在**（Nitro 静态清单构建期固化） |
| 4 | ✅ **服务器的高德 key 真的可用** | `GET /api/stores/nearby?lng=108.32&lat=22.82` → **200** 且返回真实 POI（南宁）。这是**本次的关键前置**：`ip-geo.ts` 复用同一个 `amapWebKey`（`nuxt.config.ts` 读 `process.env.AMAP_WEB_KEY`），key 在 = P1-1 上线即生效；key 不在 = **功能静默不工作**（`ip-geo` 一律返回 null，不报错） |
| 5 | **裸域名已修好** | `https://nz315.cn/` → **301 → `https://www.nz315.cn/`**，路径与 query 保留 |
| 6 | ★ **本次的 before / after 判据（同一条 URL）** | 码 `10929272000000000000000000000000`：<br>**部署前** → 接口 `resultType=not-found`、页面含「未查询到」、26,464 字节<br>**部署后应为** → `resultType=external-reg`、页面含「不是农资315签发」「农药登记资料库」「PD20092927」、约 34,291 字节 |

> 事实 1+6 说明：本文上线后，**同一个 URL 的响应会明显变样**，这是最容易判、也最难骗的验收点。

---

## 0. 本机已备好的东西（不用你动手，只需把它传上去）

**只有一样要传，没有第二样**（90 MB 工具包不用再传）：

| # | 项 | 值 |
|---|---|---|
| ① | 代码包 | `E:\software\workbuddy\文件存放处\2026-09-23-1442-ycdb记账版上线包v2\nz315-ycdb-39753e3.tar.gz` |
| | 字节数 | **671,250**（约 655 KB） |
| | SHA256 | `40ff67453d5ce79c8f37e4a0d0d97f5132eb066e17a84e93b845bd946fa14b14` |
| | 包内 | **168 个文件 + 55 个目录**（核对方式：`git ls-tree -r 39753e3` = 209 个跟踪文件，**减去 `.gitattributes` 里 `export-ignore` 掉的 41 个** = 168；双向核对 **多出 0 / 缺失 0 / 被 ignore 的 0 泄漏** ✅） |
| | 不含 | `.env`（含就出大事）· `node_modules/` · `.output/` · `.nuxt/` · **`public/tools/*.exe`**（`git archive` 天然不带，本次也无需它）· **`.workbuddy/memory/` 与 `docs/handover/`（共 41 个文件，`export-ignore` 剔出）** |
| | 依赖变化 | **依赖零变化、但 `nuxt.config.ts` 有改动** —— `package.json` / `package-lock.json` 相对服务器基线 `02f4d5c` **无差异**（`npm install` 应是秒级 `up to date`）；但 `nuxt.config.ts` 删掉了 `public.amapJsKey` / `amapSecurityCode` ⇒ **必须重新 build 才生效**（runtimeConfig 构建期内嵌） |

> 🔴 **包又换了一次（2026-09-23 14:31）**：上一版包 `nz315-ycdb-a573f09.tar.gz`（655,237 B）**已作废并移入
> `E:\software\workbuddy\文件存放处\_作废包-勿传（已过期）\`** —— 它**不含农资记账**，且**还带着本轮要下线的门店模块**。
> 现包基线 `39753e3`，比它多 **7 个文件条目**（168 vs 161），本机自验通过。**旧包请勿使用、勿上传。**

> 📌 **内部文件外溢已解决**：`.gitattributes` 的 `export-ignore` 会把 **AI 工作记忆（`.workbuddy/`）与
> 内部交接手册（`docs/handover/`，本次共 41 个）** 剔出上线包 —— 原包会把它们一并解包到 `/var/www/nz315/`
> （不构成凭据泄露：包内**确认无真 `.env`**，但属不必要外溢）。

### 这个包里装的是服务器上 `02f4d5c` 之后**全部 75 个文件的改动**，可以概括成七块

| 块 | 内容 | 主要文件 |
|---|---|---|
| **① 生成上限 1 万 → 50 万**（19 号那笔） | 上限收敛到唯一出处；写入通道（入库留档 / 生产采集导入 / 解析）同步提到 50 万；生成页新增 >20 万二次确认弹窗 | `shared/utils/code-limits.ts`(新) · `app/pages/admin/generator/index.vue` · `server/api/admin/codes/{generate,import,parse,stock-in}.post.ts` · `server/utils/code-generator.ts` |
| **② 后台「外部二维码核验」** | 拿别人的码 → 用国家登记资料库 `pesticide_reg` 当基准核验前 8 位；新后台页 + 历史列表 | `app/pages/admin/external-verify/index.vue`(新) · `server/api/admin/external-verify.post.ts`(新) · `server/api/admin/external-verifications.get.ts`(新) · `server/utils/external-verification.ts`(新) · `shared/types/external-verification.ts`(新) · `app/layouts/admin.vue` |
| **③ 公众端扫码接入登记库比对** | 扫到**别人平台**的码时不再只回「未查询到」，而是给编码结构解析 + 登记资料比对（新结果类型 `external-reg`）；`/scan` 不再静默丢弃非本平台二维码 | `shared/utils/unit-code.ts`(新) · `shared/utils/trace-code.ts`(新) · `server/utils/registry-lookup.ts`(新) · `app/components/TraceExternal.vue`(新) · `app/components/TraceNotFound.vue` · `app/pages/{scan,trace}.vue` · `app/composables/useQrScanner.ts` |
| **④ P1-1 修复** | `scan_log.province` / `city` 此前**只有读没有写** ⇒「重复查询」在真实链路永不触发；现用高德 IP 定位补齐（缓存命中即写、首见 IP 后台异步补） | `server/utils/ip-geo.ts`(新) · `server/api/trace.get.ts` |
| **⑤ N2–N6 六条修复**（09-23 新增） | **N2** 公众端反馈入口真正可用（新增 `POST /api/feedback` + 反馈组件，复用 `risk_alert` 零 DDL）· **N3** 每日定时巡检脚本（类型 3/4/6，**需单独加计划任务，见第 7 步**）· **N4** 登记证过期 ⇒ 暂停绑定批次 · **N5** 首页统计由硬编码 `128630/42` 改为真实计数 · ~~**N6①②③** `/api/stores/nearby` 防御加固~~（**已随模块删除失效，见 §N6①②③ 与 R3**） | `server/api/feedback.post.ts`(新) · `app/components/TraceFeedback.vue`(新) · `server/utils/product-guard.ts`(新) · `server/utils/rate-limit.ts`(新) · `scripts/inspect-daily.mjs`(新) · `server/api/stats.get.ts` · `app/components/{TraceAlert,TraceResult}.vue` |
| 🆕 **⑥ 农资记账 + 彻底下线「附近门店」**（09-23 14:3x 新增，**上一版包 `a573f09` 没有**） | 新增消费者私人账本：**5 个 `/api/bill*` 接口**（年度账本 / 新建 / 编辑 / 删除 / 成本分析，全部要求消费者登录、写操作带 `consumer_id` 归属校验）+ **账本页 `/bill`**（= 档案页，上底栏第 3 项，含用药/用肥/总花费/覆盖作物四张卡 + 按月分组小计 + 年总计）+ **成本分析页 `/bill/analysis`**（本月/本季/本年 + 12 月柱状图 + 类别饼图 + 作物维度）+ 扫码结果页右上「**记一笔**」入口；**同时彻底删除「附近门店」**（页/组件/composable/接口共 5 个文件，导航第 3 项由「附近门店」改为「账本」，删高德 JS key 配置） | `server/api/bill{,.post}.ts`(新) · `server/api/bill/analysis.get.ts`(新) · `server/api/bill/[id].{patch,delete}.ts`(新) · `server/utils/bill-input.ts`(新) · `shared/utils/bill-category.ts`(新) · `app/pages/bill/{index,analysis}.vue`(新) · `app/components/Bill{FormModal,BarChart,PieChart}.vue`(新) · `app/components/{TraceResult,PageHeader,BottomNav,AppHeader}.vue` · `scripts/db-init.mjs` · `nuxt.config.ts`(删 JS key) · `server/utils/{ip-geo,rate-limit}.ts` · **删** `app/pages/nearby-stores.vue` / `app/components/StoreMap.vue` / `app/composables/{useAmapLoader,useGeoConvert}.ts` / `server/api/stores/nearby.get.ts` |
| ⑦ （附带） | 异常场景扫码测试码脚本（**⚠️ 禁止在生产跑，见 §6'**）、各条线的交接文档 | `scripts/seed-abnormal-demo.mjs`(新) · `docs/handover/{18,19,20,21,22,23}.md` |

### 包里**没有**的东西（本次刻意不含）

任何依赖变更 · nginx 配置 · `public/tools` 下的 EXE · **AI 记忆与内部交接手册（本次新增 `export-ignore` 剔出）** · **`docs/handover/24-…（本文）`**。

> 🔴 **本文不在包里，而且这次是"双重不在"**：
> ① **顺序使然** —— 本次仍是「**先提交代码 → 再打包 → 最后写文档**」（刻意的：本文要写死包的 SHA256，
>   若把本文也打进包里，包一变、SHA256 就自我矛盾）；
> ② 🆕 **`.gitattributes` 的 `export-ignore`** —— `docs/handover/` 整个目录都不进包。
> ⇒ **服务器上不会出现 24 号，执行一律以本机这份为准，别在服务器上找 24 号。**

---

## 1. 动手前必须记住的五件事

1. 🔴 **`pm2 reload nz315`，只能 reload。** 这台机器上跑着别人的正式站 `www.cynx.cn`（端口 3000），
   **与 nz315 共用同一个 PM2 守护进程** —— `pm2 kill` / `pm2 delete all` / `pm2 restart all` 会把 cynx 一起带走。
2. 🔴 **`node scripts/db-init.mjs --migrate-only`，`--migrate-only` 绝不能省。** 裸跑 `db-init.mjs` 会执行 `seed()`：
   往库里插演示企业、4 条演示追溯码（**进 `trace_code` 核心表**）、演示产品/批次与 `admin123` 演示账号。
   **在真实库上执行 = 生产数据污染。**
3. 🔴 **绝不把本机 `.output` 传上服务器。** Nitro 的 `runtimeConfig` 在构建期把 `.env` 内嵌进产物，本机产物里是本机数据库凭据。
   （本次走 `git archive`，天然不含 `.output`。）
4. ⚠️ **`pm2` 命令不要加 `env PATH=` 前缀**，但 **`npm` 必须加** —— 两者方向相反：
   `pm2` 的守护进程挂在系统 Node 上，PATH 一变会让 PM2 重建 daemon，**cynx 跟着挂**；
   而 `npm` 不加前缀会用到系统的旧 Node，构建会失败。
5. ✅ **本次不需要用户重新登录。** `git diff 02f4d5c..ycdb -- server/utils/auth.ts` **为空** ⇒ token 格式一字未动。
   （09-19 那次换成三段 token 时已要求全员重登过。）**若有人被要求重登，那不是本次预期，贴我。**
6. 🆕 **本次多了一件"部署之后才做"的事：加 N3 的每日巡检计划任务**（第 7 步）。
   它**不参与构建**（纯独立脚本，不经 HTTP），所以第 5 步的 build 与它无关；漏了它 = N3 这条修复等于没上。

---

## 2. 总览（共 9 步，第 0 步为只读体检；约 25–30 分钟，第 5 步的 build 是大头）

| 步 | 动作 | 能否中断 |
|---|---|---|
| 0 | 体检 + 记下部署前的两个"不变式"（只读） | 随时 |
| 1 | 备份代码 + 备份数据库 | 随时（**备份完最安心**） |
| 2 | 上传代码包 + `sha256sum` 校验 | 随时 |
| 3 | 解包 + 核对（PM2 配置 / 工具包仍在 / 新文件落地） | 随时 |
| 4 | ★ **数据库结构变更**（三明治：基线 → 迁移 → 比对） | 随时（步后即可回滚） |
| 5 | `npm install` → `npm run build` → `pm2 reload nz315` | 构建中别断电 |
| 6 | 验证（终端 + 公网 before/after + 生成页 + 外码核验 + P1-1 + **N2–N6** + 库未污染） | — |
| 7 | 🆕 **加 N3 每日巡检计划任务**（先 dry-run 看量，再加 `--apply`） | 随时 |
| 8 | 写部署标记 | — |

---

## 第 0 步 · 登录 + 体检（只读，2 分钟）

宝塔面板 → **终端**（黑窗口）→ 整段粘贴：

```bash
whoami; pwd
cat /var/www/nz315/.deploy-version
pm2 list
pm2 describe nz315 | grep -Ei 'script path|interpreter|exec cwd|status'
echo "nz315 实际解释器: $(readlink /proc/$(pm2 pid nz315)/exe)"
free -m; swapon --show
ls -l /var/www/nz315/public/tools/
grep -c '^AMAP_WEB_KEY=' /var/www/nz315/.env
ls -l /tmp/*.tar.gz 2>/dev/null || echo "（/tmp 里没有 tar.gz，正常）"
```

**期望看到**

| 检查项 | 期望 |
|---|---|
| `pm2 list` | **`cynx` 与 `nz315` 两个都 online** |
| `interpreter` | `/usr/local/node22/bin/node`（`interpreter args : N/A` 属正常） |
| 实际解释器 | `/usr/local/node22/bin/node` |
| `.deploy-version` | `code_base` 里应含 **`02f4d5c`**（09-19 那次写的） |
| `swapon` | **有 2G swap**（构建要用，没有会 OOM） |
| `public/tools/` | **只有 `nz315-qr-tool-v1.2.0.exe`，`95035957` 字节**（本次不重传，只需确认还在） |
| `grep -c '^AMAP_WEB_KEY='` | **应为 `1`** ⇒ 高德 key 在 `.env` 里（P1-1 与"附近门店"都靠它）。**输出 `0` 就停手贴我** |
| `/tmp/*.tar.gz` | 最好为空；若有旧包，第 2 步会让你先删 |

然后把**部署前的两个不变式**记下来（后面第 6 步要对照）：

```bash
cd /var/www/nz315
while IFS='=' read -r k v; do v=${v%$'\r'}; case "$k" in DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME) export "$k=$v";; esac; done < .env
M=/www/server/mysql80/bin/mysql
$M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
  -e "SELECT COUNT(*) AS trace_code_rows FROM trace_code; SELECT id,name FROM enterprise ORDER BY id; SHOW TABLES LIKE 'external_verification';"
```

**期望**：打印 `trace_code_rows` 一个数（**记住它**，第 6 步必须一模一样）· 企业名单（**记住，不该多出「山东绿丰生物科技有限公司」**）· 最后一行**应为空**（`external_verification` 表还不存在 ⇒ 这正是第 4 步要建的）。

🔴 **出现下面任意一条就停下来贴我，别往下走**：`nz315` 不是 online；`interpreter` 不是 node22；`public/tools/` 里看不到 v1.2.0 的 EXE；`grep -c AMAP_WEB_KEY` 输出 `0`。

---

## 第 1 步 · 备份（代码 + 数据库）

### 1.1 备份代码（整段粘贴）

```bash
TS=$(date +%Y%m%d-%H%M%S); B=/root/nz315-backup-39753e3-$TS; mkdir -p $B
cd /var/www/nz315
cp -a .env .deploy-version package.json package-lock.json $B/
cp -a deploy $B/deploy-server-corrected
tar czf $B/src.tar.gz --exclude=node_modules --exclude=.output --exclude=.env --exclude='public/tools/*.exe' -C /var/www/nz315 .
mv .output .output.bak-$TS
pm2 describe nz315 > $B/pm2-describe.txt
pm2 save
echo "====== 备份目录: $B ======"; ls -lh $B; echo "TS=$TS"
```

**期望**：打印 `备份目录: /root/nz315-backup-39753e3-20260923-xxxxxx`，里面能看到 `.env`、`src.tar.gz`、
`deploy-server-corrected/`、`pm2-describe.txt`。

> 👉 **把打印出来的 `TS=...` 记到手机备忘录** —— 回滚全靠它。
> `mv .output .output.bak-$TS` 是把旧构建产物**改名保留**（不是删），万一新版有问题 10 秒切回。

### 1.2 备份数据库（整段粘贴）

```bash
cd /var/www/nz315
while IFS='=' read -r k v; do v=${v%$'\r'}; case "$k" in DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME) export "$k=$v";; esac; done < .env
echo "目标库: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
/www/server/mysql80/bin/mysqldump --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction --default-character-set=utf8mb4 "$DB_NAME" | gzip > $B/db-$DB_NAME.sql.gz
gzip -t $B/db-$DB_NAME.sql.gz && echo "备份包完整性 OK"
ls -lh $B/db-$DB_NAME.sql.gz
```

**期望**：打印 `目标库: nz315@127.0.0.1:3307/nz315`（端口 **3307**，不是 cynx 的 3306）+ `备份包完整性 OK` + 一个几 MB 的 `.sql.gz`。

> **本次要动数据库结构**（第 4 步），所以这个备份**不是可选项**，是回滚的兜底。

**卡住了怎么办**

| 现象 | 处理 |
|---|---|
| `Access denied` | 把报错原样贴我（**别去试密码**） |
| `No such file or directory` | `ls -l /www/server/mysql80/bin/` 看实际有啥，贴我 |
| 包大小是 0 或只有几十字节 | dump 失败了，**别继续**（备份没成功就不该动生产） |

---

## 第 2 步 · 上传代码包 + 校验

1. 宝塔面板 → **文件** → 地址栏输入 `/tmp` 回车
2. 点 **上传** → 选 `E:\software\workbuddy\文件存放处\2026-09-23-1442-ycdb记账版上线包v2\nz315-ycdb-39753e3.tar.gz`
3. 传完回终端：

```bash
ls -l /tmp/*.tar.gz
sha256sum /tmp/nz315-ycdb-39753e3.tar.gz
```

**先做一次清理（防手滑解错包 —— 尤其别把 09-22 那个旧包传上去）**：

```bash
rm -f /tmp/nz315-ycdb-1c6730a.tar.gz /tmp/nz315-ycdb-a573f09.tar.gz /tmp/nz315-master-68163bb.tar.gz /tmp/nz315-master-02f4d5c.tar.gz /tmp/nz315-master-933a12a.tar.gz
ls -l /tmp/*.tar.gz
```

**期望（必须逐字符一致）**

```
40ff67453d5ce79c8f37e4a0d0d97f5132eb066e17a84e93b845bd946fa14b14  /tmp/nz315-ycdb-39753e3.tar.gz
-rw-r--r-- ... 671250 ... /tmp/nz315-ycdb-39753e3.tar.gz
```

且清理后 `/tmp/*.tar.gz` **只剩 `nz315-ycdb-39753e3.tar.gz` 这一个**。

👉 **SHA256 对不上就别往下走**，删掉重传（640 KB 的东西传坏概率不小，传坏了极难排查）。
👉 ⚠️ **别只看文件名，务必核对"字节数"**：本次包 **671,250**；`655,237`（`a573f09`）与 `875,337`（`1c6730a`）**都已是作废包**，见一个就停手重传。

---

## 第 3 步 · 解包 + 核对四件事

```bash
tar xzf /tmp/nz315-ycdb-39753e3.tar.gz -C /var/www/nz315
echo "解包完成"
grep -nE "PORT|interpreter" /var/www/nz315/deploy/ecosystem.config.cjs
ls -l /var/www/nz315/public/tools/
ls -l /var/www/nz315/server/utils/ip-geo.ts /var/www/nz315/server/utils/registry-lookup.ts \
      /var/www/nz315/shared/utils/unit-code.ts /var/www/nz315/shared/utils/trace-code.ts \
      /var/www/nz315/app/components/TraceExternal.vue /var/www/nz315/scripts/seed-abnormal-demo.mjs
echo "---- 以下 5 个是 09-23 新增（N2–N6），旧包没有 ----"
ls -l /var/www/nz315/server/api/feedback.post.ts /var/www/nz315/app/components/TraceFeedback.vue \
      /var/www/nz315/server/utils/product-guard.ts /var/www/nz315/server/utils/rate-limit.ts \
      /var/www/nz315/scripts/inspect-daily.mjs
node -e "const fs=require('fs');const R=(p)=>fs.readFileSync(p,'utf8');console.log('trace.get.ts 含 province 写入:', R('/var/www/nz315/server/api/trace.get.ts').includes('province, city'));console.log('含 clientIpOf:', R('/var/www/nz315/server/api/trace.get.ts').includes('clientIpOf'));console.log('stats.get.ts 已去硬编码:', !R('/var/www/nz315/server/api/stats.get.ts').includes('128630'));console.log('nearby 含限流:', R('/var/www/nz315/server/api/stores/nearby.get.ts').includes('allowRequest'));console.log('feedback 接口存在:', fs.existsSync('/var/www/nz315/server/api/feedback.post.ts'));"
echo "---- 确认内部文档没被解包到服务器（应为 No such file） ----"
ls -d /var/www/nz315/docs/handover /var/www/nz315/.workbuddy 2>&1 | tail -2
```

**期望**

| 检查 | 期望 |
|---|---|
| 解包 | 打印 `解包完成` |
| PM2 配置 | 同时出现 **`PORT: 3100`** 和 **`interpreter: '/usr/local/node22/bin/node'`**（该文件与线上相同，属核对性质） |
| `public/tools/` | **仍只列出 `nz315-qr-tool-v1.2.0.exe`（`95035957` 字节）** —— 解包不会删它（tar 里没有这个文件，只覆盖同名文件） |
| 6 个（外码/P1-1）新文件 | 全部**存在**（`ip-geo.ts` 约 8353 B · `registry-lookup.ts` 约 6694 B · `unit-code.ts` 约 3016 B · `trace-code.ts` 约 2464 B · `TraceExternal.vue` 约 11911 B · `seed-abnormal-demo.mjs` 约 29428 B） |
| 🆕 5 个 N2–N6 新文件 | `feedback.post.ts` 约 7859 B · `TraceFeedback.vue` 约 4624 B · `product-guard.ts` 约 3196 B · `rate-limit.ts` 约 2346 B · `inspect-daily.mjs` 约 13894 B —— **缺任一 ⇒ 你传的是旧包** |
| `node -e` 五行 | **全部 `true`** ⇒ P1-1 / N2 / N5 / N6 的代码确实落地了 |
| 最后一个 `ls -d` | **两行都是 `No such file or directory`** ⇒ `export-ignore` 生效，内部手册与 AI 记忆**没有**被解包到服务器 ✅ |

🔴 **若有任一文件不存在、或五行里出现 `false`** → 包传错了或没解包成功，**停手贴我**，别往下走。

---

## 第 4 步 · ★ 数据库结构变更（本次唯一的"危险步"，用三明治证明零写入）

本次要补的**只有三样，全是幂等迁移**（`db-init.mjs` 里逐条写着，已读 diff 确认）：

| # | 变更 | 幂等保护 |
|---|---|---|
| ① | **新表 `external_verification`**（外部二维码核验快照，含 `idx_code` / `idx_status` / `idx_enterprise_time`） | `CREATE TABLE IF NOT EXISTS` |
| ② | `risk_alert` **补列** `external_verification_id BIGINT NULL` | `if (!hasColumn(...))` |
| ③ | `risk_alert` **补索引** `idx_external_verification` | `if (!hasIndex(...))` |

**注意：P1-1 不在这三样里** —— `scan_log.province` / `city` 两列与索引**本来就存在**，本次一行 DDL 都没为它加。

### 4.1 三明治第 ① 步 —— 记基线（只读）

```bash
cd /var/www/nz315
env PATH=/usr/local/node22/bin:/usr/bin:/bin node scripts/verify-db-migration.mjs dump
```

**期望**：打印基线已写入 `logs/mig-baseline.json`。**这一步不写任何业务数据。**

### 4.2 三明治第 ② 步 —— 执行迁移

```bash
cd /var/www/nz315
env PATH=/usr/local/node22/bin:/usr/bin:/bin node scripts/db-init.mjs --migrate-only
```

**期望**：日志里出现
`[db] 迁移：risk_alert 补充列 external_verification_id` 与
`[db] 迁移：risk_alert 补充索引 idx_external_verification`，
以及建表语句执行；结尾 **`[db] 初始化完成（仅迁移）`**。

🔴 **必须看到「仅迁移」这三个字。** 打印成 `含演示数据` 就说明 `--migrate-only` 被漏了 —— **立刻停手贴我**，
然后按 §4.4 检查是否有演示数据被写入。

### 4.3 三明治第 ③ 步 —— 比对（判据：**除「新表」那一条外，其余每一行都必须是 `OK`**）

```bash
cd /var/www/nz315
env PATH=/usr/local/node22/bin:/usr/bin:/bin node scripts/verify-db-migration.mjs compare
echo "compare 退出码: $?"
```

**期望输出**：
- 逐表行数：`scan_log` / `operation_log` 允许「只增不减」，**其余全部 `OK`**；
- `MAX(id)` 八项**全部 `OK`**；
- 明细快照（企业名单 / 账号 / 追溯码前 30 条）**全部 `OK`**；
- `user.session_epoch`：显示**「现在存在」**（本平台在 09-19 上线时已补过这一列，所以是「迁移前已存在 → 现在存在」，正常）。

🔴 **会出现恰好 1 条 `FAIL`，它是预期的，不是故障**：

```
FAIL  出现了基线中不存在的新表: external_verification
```

**为什么**：本次迁移要做的**第一件事就是新建 `external_verification` 表**（见本步开头的表格 ①）。比对脚本把「多出一张表」一律当污染 —— 那是给 09-19 那次「只补列、不建表」的迁移写的判据，**本次迁移天生会命中它**。已读 `db-init.mjs` 源码核实：`--migrate-only` 的路径**只有 `CREATE TABLE` 与 `ALTER TABLE ADD COLUMN|KEY`，整条路径没有任何 `INSERT`**（`INSERT` 全在 `seed()` 里，而 `seed()` 被 `--migrate-only` 跳过了）。

⇒ **退出码会是 `1`，但不代表失败。** 本次三明治真正的判据是**下面两条同时成立**：

1. **除了那一条「新表」FAIL，其余每一行都是 `OK`** —— 尤其 14 张表的行数与 8 项 `MAX(id)`；
2. §4.4 里 **`external_verification_rows = 0`** —— 新表必须是空的。
   ⚠️ 这是原脚本的盲区：逐表行数循环**只遍历「基线里已有的表」**，新表自己有多少行它根本不看，所以**必须靠 §4.4 手工确认**。

🔴 **真正要停手的情况**（这些才是数据污染）：出现 `x -> y` 形式的行数 `FAIL`、`MAX(id)` 被推进、企业名单/账号/追溯码快照不一致、或新表 `external_verification` **不是 0 行**。

> 📌 **这个误判已在仓库里修好**（`verify-db-migration.mjs` 改为「预期新建表白名单 `EXPECTED_NEW_TABLES` + 新表必须存在且为 0 行」，并同时把 `external_verification` 加进活跃表白名单）。
> 但**修复版不在你手上这个包里**（包早已打好、你也已解包执行），**本次不重传、不重打**（该脚本只在部署窗口用，不属于运行代码）。
> ⇒ **本次就照上面那两条判据人工判读**；下次上线起脚本自己就会判对。
>
> 判据口径（脚本自己写明的）：**业务主数据（企业 / 产品 / 批次 / 追溯码 / 账号）行数与 `MAX(id)` 必须严格相等**；
> `scan_log` / `operation_log` 是活跃日志，放宽为「只增不减」且**不计入 FAIL**；`session_epoch` **只留证不判定**
> （它随登出/改密正常变化，纳入比对会产假 FAIL）。⇒ **看到 FAIL 先看是哪张表**，别慌。

### 4.4 确认结构真的落地了（只读）

> 🔴 **`$M` 与 `$DB_*` 是「当前这个终端窗口内」的变量** —— 换一个终端 / 重新 SSH 连进来 / 关掉宝塔终端再开，它们**就没了**。
> 症状：`bash: --no-defaults: command not found`（说明 `$M` 展开成了空串，**不是路径错、也不是数据库问题**）。
> ⇒ 下面这段**自带变量赋值**，**任何终端都能直接整段粘贴**（2026-09-23 上线现场踩到，原本只写 `$M` 是不自包含的）。

```bash
cd /var/www/nz315
while IFS='=' read -r k v; do v=${v%$'\r'}; case "$k" in DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME) export "$k=$v";; esac; done < .env
M=/www/server/mysql80/bin/mysql
echo "M=[$M]  目标库=[$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME]"
"$M" --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SHOW TABLES LIKE 'external_verification';
SHOW COLUMNS FROM risk_alert LIKE 'external_verification_id';
SHOW INDEX FROM risk_alert WHERE Key_name='idx_external_verification';
SELECT COUNT(*) AS external_verification_rows FROM external_verification;
SELECT COUNT(*) AS trace_code_rows FROM trace_code;
SELECT id,name FROM enterprise ORDER BY id;"
```

> ✅ **先看 `echo` 那行**：应打印 `M=[/www/server/mysql80/bin/mysql]  目标库=[nz315@127.0.0.1:3307/nz315]`。
> 若 `M=[]` 是空的 —— 说明那段 `while`/`M=` 没进去，**把这三行连同后面一起重新整段粘贴**（别只粘最后那条命令）。
> 若报 `No such file or directory` —— 才是路径问题：`ls -l /www/server/mysql80/bin/` 看实际有啥，贴我。

**期望**：三个结构查询**都有输出**；`external_verification_rows` = **0**（新表就该是空的）；
`trace_code_rows` 与**第 0 步记下的数一模一样**；企业名单**没有多出任何一行**。

🔴 **`trace_code_rows` 变了 / 企业名单多了「山东绿丰生物科技有限公司」= 迁移把演示数据灌进来了**：
立刻 `pm2 list` 别动，把输出贴我，然后用 1.2 的 `db-*.sql.gz` 恢复数据库，**不要继续第 5 步**。

---

## 第 5 步 · 装依赖 → 构建 → 重载

```bash
cd /var/www/nz315
free -m; swapon --show
ls -l public/tools/
env PATH=/usr/local/node22/bin:/usr/bin:/bin npm install --no-audit --no-fund
env PATH=/usr/local/node22/bin:/usr/bin:/bin npm run build
pm2 reload nz315
```

**每步期望**

| 命令 | 期望输出 | 耗时 |
|---|---|---|
| `ls -l public/tools/` | **仍是 v1.2.0 的 EXE（`95035957`）** —— 必须在 `npm run build` **之前**确认（Nitro 静态清单构建期固化，build 时不在就 404） | 秒 |
| `npm install` | `up to date`（依赖零变化，应很快） | 秒级 |
| `npm run build` | 末尾 **`✨ Build complete!`** | 1–2 分钟 |
| `pm2 reload` | `[PM2] Applying action reloadProcessId on app [nz315]` | 数秒 |

**本次没有 5.0**（不用放工具包，线上已是 v1.2.0 且在 build 之前就已就位，见 18 号文档）。

🆕 **关于 N3 的巡检脚本**：`scripts/inspect-daily.mjs` **随包上传即可，不参与 build**（纯独立 Node 脚本，不经 HTTP、不被 Nitro 打包）。
它在第 3 步解包时就已落到 `/var/www/nz315/scripts/inspect-daily.mjs`，**第 7 步再去加计划任务**。

- ❌ **不要用 `npm ci`**（全量重装 780+ 包，10 分钟起步，3.5G 内存的机器容易 OOM）
- ❌ **不要改 `.env`**（改了必须重新 build 才生效）
- ❌ **不要 `pm2 restart` / `kill` / `delete`**，只要 `reload nz315`

---

## 第 6 步 · 验证（别用"应该好了"交差）

> 🔴 **本步多处要用 `$M` / `$DB_*`，而它们是「当前终端窗口内」的变量** —— 换终端 / 重连 SSH / 关掉宝塔终端再开，**就没了**。
> 症状固定是 **`bash: --no-defaults: command not found`**（说明 `$M` 展开成了空串，**不是路径错、也不是数据库问题**）。
> ⇒ 只要换过终端，**先把下面这三行粘一遍**（§4.4 已内置同样三行，可直接整段粘贴）：

```bash
cd /var/www/nz315
while IFS='=' read -r k v; do v=${v%$'\r'}; case "$k" in DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME) export "$k=$v";; esac; done < .env
M=/www/server/mysql80/bin/mysql
echo "M=[$M]  DB=[$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME]"
```

### 6.1 终端（整段粘贴）

```bash
pm2 list
echo "nz315 实际解释器: $(readlink /proc/$(pm2 pid nz315)/exe)"
curl -s -o /dev/null -w '首页          : %{http_code}（期望 200）\n' http://127.0.0.1:3100/
curl -s -o /dev/null -w '登录页        : %{http_code}（期望 200）\n' http://127.0.0.1:3100/login
curl -s -o /dev/null -w '恶意Origin    : %{http_code}（期望 403）\n' -X POST -H 'Origin: http://127.0.0.1:3100.evil.com' -H 'Content-Type: application/json' -d '{"username":"nobody","password":"x"}' http://127.0.0.1:3100/api/auth/login
curl -s -o /dev/null -w '同站Origin    : %{http_code}（期望 401）\n' -X POST -H 'Origin: http://127.0.0.1:3100' -H 'Content-Type: application/json' -d '{"username":"nobody","password":"x"}' http://127.0.0.1:3100/api/auth/login
curl -s -o /dev/null -w 'cynx 未受影响 : %{http_code}（期望 301）\n' -H 'Host: www.cynx.cn' http://127.0.0.1/
curl -sI https://www.nz315.cn/tools/nz315-qr-tool-v1.2.0.exe | grep -Ei 'HTTP/|content-length'
echo "---- N5：统计不再是伪造数字 ----"
curl -s http://127.0.0.1:3100/api/stats; echo
echo "---- R3：附近门店已删除 ⇒ 该接口应 404（这就是本轮的成功判据）----"
curl -s -o /dev/null -w 'nearby 应 404 : %{http_code}\n' 'http://127.0.0.1:3100/api/stores/nearby?lng=999&lat=999'
echo "---- R3：记账接口已上线且要求登录 ----"
curl -s -o /dev/null -w 'bill  应 401 : %{http_code}\n' 'http://127.0.0.1:3100/api/bill'
```

**期望**：五个 http code 依次为 `200 / 200 / 403 / 401 / 301`，最后一个 `HTTP/2 200` + `content-length: 95035957`；
`pm2 list` 里 **`cynx` 和 `nz315` 双双 online**；
`/api/stats` 返回**真实两个小数字**（或极端情况下 `{"totalQueries":null,...}`）——**绝不能是 `128630`**；
🔴 **`nearby 应 404 : 404`** 且 **`bill 应 401 : 401`** —— 两条缺一不可：前者证明门店模块**真的下线了**，
后者证明记账接口**已上线且要求登录**。
（📌 本处原文写的是「`nearby` 应返回 `{"located":false,"rows":[]}` 且 <100 ms」 —— **那条判据随模块删除已作废**，
见文首「2026-09-23 修订」的 R3。）

### 6.2 ★ 公网 before/after 判据：**同一个 URL，响应必须变样**

在你自己的电脑浏览器/终端里打这一条（**这是本次最容易判的验收点**）：

```
https://www.nz315.cn/trace?code=10929272000000000000000000000000
```

| | 部署前（已实测） | **部署后应为** |
|---|---|---|
| 接口 `resultType` | `not-found` | **`external-reg`** |
| 页面关键词 | 「未查询到」 | **「不是农资315签发」+「农药登记资料库」+「登记证号后六位」+ `PD20092927`** |
| 页面字节数 | 26,464 | 约 **34,291** |

终端版（更客观）：

```bash
curl -s 'https://www.nz315.cn/api/trace?code=10929272000000000000000000000000' | head -c 400; echo
```

**期望**：JSON 里含 `"resultType":"external-reg"`。

> 这条走的是**只读分支**（不是本平台的码 ⇒ **不写 `scan_log`、不触发预警**），随便打，不会污染任何统计。

### 6.3 公网：版本指纹必须变

```bash
curl -s https://www.nz315.cn/_nuxt/builds/latest.json
```

**期望**：`timestamp` **不再是 `1789812536370`**（那是 09-19 的）⇒ 证明新构建真的生效了（而不是"构建了但没 reload"）。

### 6.4 ★ 后端新功能：后台「外部二维码核验」（浏览器）

用 `admin` 登录 → 左侧应多出 **「外部二维码核验」**：

| # | 动作 | 期望 |
|---|---|---|
| 1 | 看左侧菜单 | 出现 **「外部二维码核验」** 一项（admin 可见） |
| 2 | 进该页 → 「追溯码」填 `10929272000000000000000000000000` → 点【开始核验】 | 返回结果：前 8 位结构 `match`、登记证后六位 `match`、**命中 `PD20092927`（硝钠·萘乙酸）**、产品名/持有人为 `insufficient`（因为只给了 6 位、候选不唯一） |
| 3 | 只填「粘贴内容」且内容里**不含 32 位码** → 点【开始核验】 | 报错 **`未识别到至少32位数字单元识别代码`**（这是**预期行为**，不是 bug） |
| 4 | 看「核验历史」列表 | 有记录、能翻页（响应结构是 `{total,page,pageSize,rows}`） |

### 6.5 ★ 生成页上限（19 号那笔的核心验收，别省）

用 `admin` 登录 → 左侧 **追溯码生成**：

| # | 动作 | 期望 |
|---|---|---|
| 1 | 看「生成数量」输入框下方提示 | **`1-50 万条/次；超过 20 万条会先弹确认框（提示文件体积与耗时）`**（旧版是「1-10000 条/次」） |
| 2 | 右键 → 检查 → 选中数量输入框看 `max` | **`500000`**（旧版是 `10000`） |
| 3 | 数量填 **500001** 点【生成追溯码】 | 提示 **`生成数量须为 1-50 万`**，不发起请求 |
| 4 | 数量填 **200001** 点【生成追溯码】 | 弹确认框：**「本次共 200,001 条」**，正文含预估耗时与 TXT / urls.txt / CSV 体积 |
| 5 | 点弹窗【取消】 | 弹窗关闭，不生成 |
| 6 | 数量填 **50000** 点【生成追溯码】 | **不弹确认框**，直接出结果；结果区 **生成总数 = 50,000** |

> ⚠️ 生成**不入库** —— 只往 `operation_log` 写一条审计记录，**不写 `trace_code`、不动码库、不影响任何人**。
> 🔴 **强烈建议线上不要跑满 50 万。** 依据是本机实测：本机 dev（**同一套代码**）反复生成数十万条后
> **撞 4.1GB 堆上限 OOM 崩过**（exit 134）。线上 PM2 的 `max_memory_restart` 是 **800M**，
> 一旦命中进程会被重启、**站点当场闪断**。验到第 6 项（5 万条）就收手。

### 6.6 ★ P1-1：`scan_log.province` / `city` 真的开始写了

**先看线上有没有可扫的真实码**：

```bash
cd /var/www/nz315
$M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SELECT COUNT(*) AS codes FROM trace_code;"
```

**若 `codes > 0`**（有真实码，走下面这条完整链路）：

1. 后台 → **追溯码管理** → 随便挑一个已存在的码，用它显示的二维码；
2. **用手机（走 4G/5G，别连 Wi-Fi，这点不影响但更接近真实消费者）扫它** → 打开 `https://www.nz315.cn/trace?code=…`；
3. 等 2 秒（省市是**后台异步补齐**的），然后回终端：

```bash
$M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT id, ip_location, province, city, scan_time FROM scan_log ORDER BY id DESC LIMIT 5;
SELECT COUNT(*) AS with_geo FROM scan_log WHERE province IS NOT NULL AND province <> '';"
```

**期望**：刚扫的那一行 **`ip_location` 是你的公网 IP**、**`province` 非空**（例：`广西壮族自治区` / `南宁市`），
且 `with_geo` 比部署前**有增长**。

> 这就是 P1-1 的验收本质：不是"列写进去了"，而是**真实扫码链路能把省市落库** —— 这是「重复查询」
> （判据 `≥3 次且 ≥2 省`）能触发的前提。

**若 `codes = 0`**（线上还没有真实码）：这条**现在验不了**（演示用的测试码只在开发库，生产库里没有，
而扫到非本平台的码走的是只读分支、本来就不写 `scan_log`）。此时记一笔：
**P1-1 代码已上线，待有真实码后复验**，并在有码后用上面同一套命令补验。

### 6.7 生产库未被污染 + 结构已就位

```bash
$M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT id,name FROM enterprise ORDER BY id;
SELECT COUNT(*) AS trace_code_rows FROM trace_code;
SELECT COUNT(*) AS external_verification_rows FROM external_verification;"
```

**期望**：企业名单与第 0 步**完全一致**（**不该多出「山东绿丰生物科技有限公司」**）；
`trace_code_rows` 与第 0 步一致；`external_verification_rows` 是个**小数字**（第 6.4 步你核验了几次就是几行，属正常业务数据）。

> 若 `$M` / `$DB_*` 换了终端丢了（症状：`bash: --no-defaults: command not found`），
> 先粘「**第 6 步开头那三行**」（等同 §4.4 开头那三行）再重跑。

---

### 6.8 ★ 🆕 N2–N6 六条修复的验收（**线上只跑"不写库"的那几种，别污染生产**）

> 🔴 **原则**：生产库上**只做只读断言**。凡会写库的用例，下面都给出「可选 + 清理 SQL」，**默认不跑**。

### N5 ✅ 首页伪造统计（已含在 6.1 里）
`/api/stats` 不再返回 `128630/42`。再补一条"公网首页也不该出现这个数"：

```bash
curl -s https://www.nz315.cn/ | grep -c 128630
```
**期望**：输出 **`0`**（旧版线上是 `1` 或更多 —— 这一个数字就是 N5 的 before/after 判据）。

### N6①②③ ⛔ 附近门店防御 —— **本节随模块删除整体作废（2026-09-23）**

🔴 **不要再照下面的循环打 `/api/stores/nearby`** —— 该接口**已随「附近门店」模块删除**，
线上**任何参数都返回 404**（连非法坐标也 404，因为整个路由不存在了）。

**为什么可以整节删掉（比修更省事）**：N6 ①②③ 当时防的是「匿名可用 + 缓存无上限 + 坐标无范围校验」，
而这一轮用户决定**整个模块下架**⇒ **攻击面本身就是零**，`CACHE_MAX` / 坐标校验 / 同 IP 限流都随文件一起消失。
**连带收益**：高德 **POI 调用彻底消失** ⇒ 「匿名刷爆配额 ⇒ 连带绞杀 `scan_log.province` 写入 ⇒ P1-1 回死分支」
这条路径**物理消除**（`AMAP_WEB_KEY` 现只被 `server/utils/ip-geo.ts` 使用）。
⇒ **28 号里 N6④ 与 N6-b 两条「暂缓」随之 CLOSED**（代码都不存在了，不再是技术债）。

**改用什么判据**：见文首「2026-09-23 修订」的 **R3** —— `nearby` 应 **404**、`bill` 应 **401**、
P1-1 改成**新扫一次码看 `scan_log.province` 有没有值**。

> 以下是本节原文，**仅作历史留档，不要执行**：
~~非法坐标 → `200 {"located":false,"rows":[]}` 且 **< 100ms**；再验限流（故意用非法坐标，不消耗高德配额），
前 30 次 `200`、第 31 次起 `429`（同 IP 30 次/分钟）。~~

### N2 ✅ 公众端反馈入口（**默认只验不写库的部分**）

**① 页面入口存在（只读，SSR 断言）**

```bash
for c in genuine voided; do
  echo "---- $c ----"
  curl -s "https://www.nz315.cn/trace?code=$(date +%s)0000000000000000000000000" >/dev/null 2>&1 || true
done
# 用真实码验（有码才跑；把 CODE 换成 /var/www/nz315 库里任一个真码）
CODE=$($M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -B -e "SELECT code FROM trace_code WHERE status=2 LIMIT 1;")
echo "取样码: $CODE"
curl -s "https://www.nz315.cn/trace?code=$CODE" | grep -o '点此反馈' | head -1
```
**期望**：打印出 **`点此反馈`**（旧版线上**一个字都没有** —— 这是 N2 的判据）。

**② 入参校验（400 路径，**零写入**，随便打）**
```bash
curl -s -o /dev/null -w '31位码        : %{http_code}（期望 400）\n' -X POST -H 'Content-Type: application/json' -d '{"code":"1234567890123456789012345678901","content":"这条是要反馈的内容够十个字了"}' http://127.0.0.1:3100/api/feedback
curl -s -o /dev/null -w '内容过短      : %{http_code}（期望 400）\n' -X POST -H 'Content-Type: application/json' -d '{"code":"12345678901234567890123456789012","content":"太短"}' http://127.0.0.1:3100/api/feedback
```
**期望**：两个都是 **400**（400 路径**不落库、不发站内信、不打外部调用**，所以随便打、不吃限流额度）。

**③（可选，**会写库**）真提交一次**
```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"code":"12345678901234567890123456789012","content":"【部署验证】测试反馈，可删除，内容已够十个字"}' http://127.0.0.1:3100/api/feedback; echo
```
**期望**：`{"ok":true}`。然后清理（**不清理就是一条垃圾工单**）：
```bash
$M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT id, alert_type, handle_status, LEFT(evidence,80) FROM risk_alert WHERE alert_type=7 ORDER BY id DESC LIMIT 3;
-- 确认上面那行的 evidence 里 code=12345678901234567890123456789012 后，再执行下面这句删除：
-- DELETE FROM risk_alert WHERE alert_type=7 AND JSON_UNQUOTE(JSON_EXTRACT(evidence,'\$.code'))='12345678901234567890123456789012';"
```
> 💡 **建议**：线上**跳过 ③**。N2 的写路径在本机 dev 已端到端验过（含四态校验、同码/同 IP 双限流、真浏览器三条页面），
> 生产上验到 ①② 就够证明"代码上线了且入口可达"。

### N4 ✅ 登记证过期 ⇒ 暂停绑定（**先看影响面，不必造数据**）

```bash
$M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT COUNT(*) AS 已过期产品数 FROM product WHERE registration_expire IS NOT NULL AND registration_expire < CURDATE();
SELECT id, name, registration_no, registration_expire FROM product WHERE registration_expire IS NOT NULL AND registration_expire < CURDATE() LIMIT 5;"
```
**期望**：一个数 + 若干行（**可能是 0**）。这个数是**上线后会"以前能绑、现在被拦"的产品量**——
> ⚠️ **这是预期行为，不是故障**（PRD 8类异常-4 的要求就是这个）。数很大时先跟业务确认，别急着回滚。
> 想验 400 文案：后台 → 码库 → 对一个**已过期产品**的码点【换绑批次】，应报
> `该产品登记证（XXX）已于 YYYY-MM-DD 到期，不可绑定生产批次，请先更新登记证有效期`。

### N3 ✅ 每日巡检（**第 7 步做，且首次必须 dry-run**）

---

## 第 7 步 · 🆕 加 N3 每日巡检计划任务（**先 dry-run 看量，再加 `--apply`**）

**这一步不做，N3 这条修复等于没上**（脚本已在服务器上，但没有任何东西会定时跑它）。

### 7.1 先 dry-run（**只读，绝不写库**）

```bash
cd /var/www/nz315
env PATH=/usr/local/node22/bin:/usr/bin:/bin node scripts/inspect-daily.mjs
```

**期望**：打印巡检结果 —— 它会列出**待写入的预警条数**（按类型 3 登记证号不存在 / 4 登记证已过期 / 6 生产厂家不符），
并明确说明这是 **dry-run、未写任何数据**。结尾应能看到 `待写入 N 条` 之类的统计。

🔴 **`N` 很大（比如几百上千）时先停下来贴我** —— 先决定是「全量落库」还是「只记日志不上预警」，
再决定要不要加 `--apply`。**别在一个数字都没看清之前就把计划任务配上。**

### 7.2 加计划任务（宝塔面板 → 计划任务）

- 任务类型：**Shell 脚本**
- 任务名称：`nz315 每日巡检`
- 执行周期：**每天 03:00**
- 脚本内容：

```bash
/usr/local/node22/bin/node /var/www/nz315/scripts/inspect-daily.mjs --apply >> /www/wwwlogs/nz315-inspect.log 2>&1
```

> ⚠️ **必须用 `/usr/local/node22/bin/node` 绝对路径** —— 系统 `node` 是 v20（cynx 在用那套），
> 与 PM2 的 per-app 解释器保持一致最稳。

### 7.3 加完手动触发一次，确认真的能跑

```bash
/usr/local/node22/bin/node /var/www/nz315/scripts/inspect-daily.mjs --apply
echo "退出码: $?"
tail -5 /www/wwwlogs/nz315-inspect.log
$M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT alert_type, COUNT(*) FROM risk_alert WHERE alert_type IN (3,4,6) GROUP BY alert_type;"
```
**期望**：退出码 `0`；日志里出现一次巡检记录；`risk_alert` 里出现 `alert_type` 为 3/4/6 的行（**之前的库这些类型通常是 0 行**）。

👉 **再来一次 `--apply` 应该「待写入 0 条」**（30 天冷却生效）—— 这是幂等性判据，**强烈建议跑两次确认**。

---

## 第 8 步 · 写部署标记（沿用服务器现有键名）

```bash
cat > /var/www/nz315/.deploy-version <<EOF
deploy_time=$(date '+%Y-%m-%d %H:%M:%S %z')
code_base=02f4d5c → 39753e3 (ycdb 分支：外部二维码核验 + 公众端扫码接入登记资料库比对(新结果类型 external-reg) + P1-1 补齐 scan_log.province/city 写入 + N2 公众反馈入口 + N3 每日巡检脚本 + N4 登记证过期不绑批次 + N5 首页真实统计 + 农资记账 farm_bill/账本页/成本分析页(并彻底下线「附近门店」模块) ; 本包同时含 68163bb 的生成上限 1万→50万)
backup_dir=$B
previous_dir=/var/www/nz315/.output.bak-$TS
note=含 DDL（新表 external_verification + risk_alert 补列 external_verification_id 与索引 idx_external_verification，已用 --migrate-only + verify-db-migration 三明治证明零写入）；零依赖变化；未改 nginx；未重传 public/tools；未动 token 格式故不要求用户重新登录；包内已 export-ignore 掉 .workbuddy/ 与 docs/handover/；已加宝塔计划任务 nz315 每日巡检（03:00）；回滚只需切回 .output.bak-$TS
EOF
cat /var/www/nz315/.deploy-version
```

> 键名照抄服务器上**实际在用的** `deploy_time` / `code_base` / `backup_dir` / `previous_dir`，只更新 `deploy_time` 与 `code_base`，另加 `note`。
> 换过终端导致变量丢了就重取：
> ```bash
> TS=$(ls -d /var/www/nz315/.output.bak-* | sed 's|.*/\.output\.bak-||' | tail -1)
> B=$(ls -d /root/nz315-backup-39753e3-* | tail -1)
> echo "TS=$TS"; echo "B=$B"
> ```

---

## 4'. 回滚（真出事了再看，两条路）

**秒回旧版（10 秒，用改名保留的旧构建产物）**

```bash
cd /var/www/nz315
rm -rf .output
mv .output.bak-<你的TS> .output
pm2 reload nz315
```

**彻底回到改动前（约 5 分钟：恢复源码 + 恢复数据库 + 重建）**

```bash
B=/root/nz315-backup-39753e3-<你的TS>
cd /var/www/nz315
tar xzf $B/src.tar.gz -C /var/www/nz315
cp -a $B/.env .env
cp -a $B/deploy-server-corrected deploy
rm -rf .output && cp -a /var/www/nz315/.output.bak-<你的TS> .output
env PATH=/usr/local/node22/bin:/usr/bin:/bin npm install --no-audit --no-fund
env PATH=/usr/local/node22/bin:/usr/bin:/bin npm run build
pm2 reload nz315
```

> ⚠️ **回滚代码不会撤销宝塔那条计划任务** —— 若已加，请到「计划任务」里把 `nz315 每日巡检` **暂停或删除**
> （旧代码里没有 `scripts/inspect-daily.mjs` 的调用方，但脚本本身是独立的，留着会继续按 30 天冷却写预警）。

**数据库要不要回滚？** —— **只回代码就不用**：本次三样 DDL **全是追加式**（新表 + **可空**新列 + 新索引），
**旧代码完全不认识它们也不受影响**，留着不碍事。
只有当 `verify-db-migration compare` 报出**业务表行数变化**（意味着演示数据被灌进来了）才需要恢复库：

```bash
cd /var/www/nz315
gunzip -c $B/db-$DB_NAME.sql.gz | $M --no-defaults -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"
```

**回滚不会造成全员重登**：本次未动 token 格式。

---

## 5'. 卡住了怎么办（速查）

| 现象 | 原因 | 处理 |
|---|---|---|
| `grep -c '^AMAP_WEB_KEY='` 输出 `0`（第 0 步） | 服务器 `.env` 里没有高德 key | **停手贴我**。P1-1 与「附近门店」都靠它；需从本机 `.env` 复制该行（`AMAP_WEB_KEY=...`）补进服务器 `.env`，**改完必须重新 build 才生效** |
| 解包后新文件找不到 / `trace.get.ts` 不含 `province, city` | 包传错或没解包成功 | 停手贴我；先 `ls -l /tmp/*.tar.gz` 看字节数：**本次包 `671250`**（比对 `655237` / `875337` = 作废包） |
| `grep` 里 `PORT` 是 `3000` / 没有 `interpreter` | 包里那份配置与线上不同 | 用备份里那份盖回：`cp -a $B/deploy-server-corrected/ecosystem.config.cjs /var/www/nz315/deploy/` |
| `db-init` 打印 `含演示数据`（**没看到「仅迁移」**） | **`--migrate-only` 被漏了** 🔴 | 立刻按 §4.3 跑 `compare`；若有业务表行数变化 → 用 §4' 的库恢复命令回滚，**不要继续第 5 步** |
| `compare` 报 FAIL | 先看是**哪一条** | ① `FAIL 出现了基线中不存在的新表: external_verification` → **正常**（本次迁移本来就要建这张表，详见 §4.3，退出码 1 属预期）；② `scan_log` / `operation_log` 行数增长 → **正常**（活跃日志，判据"只增不减"）；③ 企业/产品/批次/`trace_code` 行数出现 `x -> y`、`MAX(id)` 被推进、快照不一致、或**新表不是 0 行** → **停手贴我** |
| `SHOW COLUMNS` 没输出（`external_verification_id` 不在） | 迁移没跑成功 | 别继续；贴我输出 |
| `nz315` 重启后不是 online | — | `pm2 logs nz315 --lines 50` 贴我；**先别做任何 pm2 的 delete/kill** |
| `npm run build` 被 killed | 内存不够 | 确认 2G swap 在（`swapon --show`），停掉吃内存的进程重跑 |
| 站点 502 | 构建没跑或失败 | `pm2 logs nz315 --lines 50`；确认 `✨ Build complete!` 出现过 |
| 页面能开但样式/交互全乱 | `.nuxt` 缓存与进程不匹配 | `pm2 reload nz315`；仍不行则删 `.nuxt` 与 `node_modules/.cache` 后重建 |
| 6.2 的页面还是「未查询到」 | 构建没跑到 / reload 没生效 | 回第 5 步重跑 `npm run build` + `pm2 reload nz315`，再硬刷新浏览器（Ctrl+F5） |
| 6.6 的 `province` 仍为空 | ① 高德 key 没生效；② 扫的码不是本平台码（只读分支不写日志）；③ 异步补齐还没跑完 | 先 `SELECT ip_location FROM scan_log ORDER BY id DESC LIMIT 1` 看是不是你的公网 IP —— 若是 `127.0.0.1` 说明请求没走 nginx（贴我）；若是公网 IP 但 `province` 空 → 等 2 秒再看，仍空则贴我 |
| **cynx 打不开了** | ⚠️ 危险信号 | 立刻检查有没有执行过 `pm2 kill` / `pm2 delete all`；把 `/root/nz315-backup-*/pm2-describe.txt` 贴我 |
| `pm2: command not found` | 登录 shell 的 PATH 异常 | 先 `which pm2`；**千万别**给它加 `env PATH=...` 前缀（Node 版本不一致会让 PM2 重建 daemon，cynx 跟着挂） |
| 🆕 `bash: --no-defaults: command not found` | **不是路径错、也不是数据库问题** —— `$M` 展开成了**空串**：`$M` 与 `$DB_*` 是「当前终端窗口内」的变量，**换终端 / 重连 SSH / 关掉宝塔终端再开就没了** | 粘「**第 6 步开头那三行**」（或 §4.4 开头那三行）再重跑。**别只粘最后那条命令** |
| 🆕 解包后 `server/api/feedback.post.ts` 等 5 个文件**不存在** | **你传的是 09-22 的旧包** 🔴 | 停手。`ls -l /tmp/*.tar.gz` 看字节数：**本次包 671250**（`655237` / `875337` 均已作废）。删掉重传 `nz315-ycdb-39753e3.tar.gz`（本文 §2） |
| 🆕 服务器上出现了 `docs/handover/` 或 `.workbuddy/` | 包不对（`export-ignore` 没生效） | 同上：传的是旧包。新包**不该**含这两个目录（第 3 步有核对命令） |
| 🆕 `/api/stats` 仍返回 `128630` | 构建没跑到 / reload 没生效 | 回第 5 步重跑 `npm run build` + `pm2 reload nz315`；再 `curl -s https://www.nz315.cn/ \| grep -c 128630` 应为 `0` |
| 🆕 `/trace` 页面搜不到「点此反馈」 | 同上 | 同上；另确认扫的是**本平台已绑定的码**（作废码故意没有入口） |
| 🆕 `nearby?lng=999&lat=999` 返回 **400**（而不是 200 + `located:false`） | 包不对（旧版没有坐标校验） | 按 §2 重传新包；旧版是**透传给高德**的，会白烧配额 |
| 🆕 N3 计划任务日志报 `command not found` / `Cannot find module` | 用了系统 `node`（v20） | 计划任务里**必须**写 `/usr/local/node22/bin/node` 绝对路径（第 7.2 步） |
| 🆕 N3 第一次 `--apply` 就写了**几百上千条**预警 | 线上存量过期/证号缺失产品很多 | **不是故障**，但先停手贴我 —— 决定是保留还是清掉（`risk_alert` 里 `evidence` 带 `source:'daily-inspection'` 可精确识别） |

---

## 6'. 🔴 本次部署**不包含**的待办（别顺手一起做，风险要隔离）

> 🆕 **先说清本次"包含了什么"**：26 号复查挖出的 **N2 / N3 / N4 / N5 / N6①②③ 六条已全部修完并随本包上线**
> （提交 `27f1514`/`18b40f5`/`5a59478`/`d1dbf78`/`d38ba0a`，细节见 **28 号**）。
> **仍然没做的**：**N1**（建档不校验登记证号 —— 存量由 N3 巡检类型 3 兜住）·
> **N7**（`registry-lookup` 注释与实现相反，P2，实测当前不构成故障）·
> **N6④** 拆高德 key 与 **N6-b** 搜索框（用户裁定：附近门店模块**可能整体下架**改农资记账，故不投入）。
> ⚠️ **代价要知道**：N6④ 没做 ⇒ POI 与 `ip-geo` 仍共用一把 key ⇒ **配额被打爆时 `scan_log.province` 会静默写不进去，
> P1-1 会退回死分支**（表现为「重复查询」不再触发，且不报错）。

| 优先级 | 事项 | 说明 |
|---|---|---|
| 🔴 **禁令** | **绝对不要在生产跑 `node scripts/seed-abnormal-demo.mjs`** | 它的硬安全闸只拦「`DB_HOST` 不是本机」—— 而**服务器的 `DB_HOST` 正是 `127.0.0.1`** ⇒ **闸门会放行，脚本会往生产库写入演示企业/产品/批次/9 条演示码**。它是**开发库专用**工具，生产上永远不要执行。<br>🆕 **注意与 N3 的区别**：`inspect-daily.mjs` 是**默认 dry-run、必须显式 `--apply`** 才写库，**取向相反**，那个是可以跑的 |
| P1 | `X-Forwarded-Host` 可绕过 `assertSameOrigin` | 线上仍可绕过（`Origin: evil.com` + `X-Forwarded-Host: evil.com` → 未拦）。修法：nz315 server 块加一行 `proxy_set_header X-Forwarded-Host $host;`（**只影响 nz315，不动 cynx**，`nginx -s reload` 即可，**不需重建**）。**建议下一轮单独做** |
| P1 | SSRF 防护实际失效 | `external-verification.ts` 的 `PRIVATE_HOST` 正则**末尾多了个 `$`** ⇒ 点分内网 IPv4（`127.0.0.1` / `10.x` / `192.168.x` / `169.254.169.254`）全放行。**本次带着这个缺陷上线**（该功能仅后台管理员可用），改法是把末尾 `$` 去掉 + IPv4 规范化 |
| P1 | 产品名比对对真实平台误报并**落 `risk_alert`** | 真实第三方平台把「剂型 + 序号」写进产品名（如 `15%精草铵膦可溶液剂-2` vs 登记库 `精草铵膦`）⇒ 判 `mismatch` ⇒ 写预警。**改它等于改预警数据源，先定口径再动** |
| P1 | 上线后安全清单 | 改初始管理员密码、清理演示/残留账号（`lvfeng` / `codeop` / `op2` / `lvop`）。见 06 号文档 |
| P1 | 阿里云免费证书续期 | **2026-12-16 到期 · 不自动续期**；到期前重新申请替换 `cert/nz315/` 两个文件 + `nginx -s reload` |
| P0 | 微信「网页授权域名」是否保存成功 | 服务器侧校验文件已 200，**微信后台那一步公网看不到，得你自己确认** |
| P0 | 公安联网备案 | **未做**（起算点 = 公网上线日 09-15 ⇒ 时限约 **2026-10-15**），与 11-01 合规硬上线只隔两周 |
| P2 | PM2 `max_memory_restart: 800M` 与「常态化 20 万+ 生成」的内存峰值 | 若要常态化跑大数量，该值应调到 1200–1500M。⚠️ **改它需要 `pm2 delete nz315` 后重新 start 才生效**（`reload` 不重读），**与「只许 reload」铁律冲突，必须专门安排窗口** |
| P2 | `registry-lookup` 的提速（生成列 `reg_last6` + 索引） | 当前 `RIGHT(registration_no,6)=?` 走不了索引（`EXPLAIN` = 覆盖索引全扫 **95,386** 行，本机 **26–32ms/次**），靠进程内 LRU 兜。属 DDL，**未做** |

---

## 7'. 一句话

**本次比 19 号多了一样有脾气的东西：第 4 步的数据库迁移。** 它本身是三条幂等语句，风险不在语句，而在**漏写 `--migrate-only`**。
所以务必按「dump → `--migrate-only` → compare」三明治走，**看到「仅迁移」三个字再往下**。

**本次比 09-22 那版多了三件"容易漏"的事**：① **包又换了**（`39753e3` / **671,250 B** / `40ff6745…`，
旧包 `a573f09` **不含农资记账、且还带着要下线的门店模块**）；② **第 5 步之前要补跑一次 `--migrate-only`**
（建新表 `farm_bill`）；③ **第 7 步的宝塔计划任务**（不加它，N3 等于没上）。

**最容易判的验收点（三条，逐个看数字就行）**：
1. `https://www.nz315.cn/trace?code=10929272000000000000000000000000` —— 部署前「未查询到」，**部署后应变「不是农资315签发」**；
2. `curl -s https://www.nz315.cn/ | grep -c 128630` —— **应为 `0`**（旧版是 1+）；
3. 🔴 **`nearby` 应 **404**、`bill` 应 **401**（见文首 R3）** ——
   ⚠️ 原文此处写的是「`/api/stores/nearby` 应返回 `{"located":false,"rows":[]}`」，**那条已随模块删除作废**；
   P1-1 的判据改看「**新扫一次码后 `scan_log.province` 有值**」。

每步把输出贴我，我读。
