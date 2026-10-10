# 项目长期记忆 — 农资315 追溯码管理平台

> 硬约定只在这里；细节看 `AGENTS.md`（含交接索引）+ `docs/handover/` + `ARCHIVE-参考细节.md`。复测 skill `nz315-func-regression`。

## 🔴 只信公网指纹
`curl -s www.nz315.cn/_nuxt/builds/latest.json`→`timestamp`；**每轮先量指纹再写执行单/包名**，本机记录不可信。现役 **`1791357027077`**（10-07 15:1x 上线，源码 **`1dc0f13`**，含后台单设备登录）；上一版 `1791273745911`（10-06 16:02，源码 `201b65a`）；再上一版 `1790755593671`（09-30 16:06）。

## 🔴 部署与数据库
- 补列补索引一律 `db-init.mjs --migrate-only`（判据 `bad=0`）；**新建表不打印迁移行**（判据=表数+1），须同改 `DDL`+`ACTIVE_TABLES`/`EXPECTED_NEW_TABLES`。
- 与 cynx 共用 PM2：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`.conf` 绝不写 `default_server`；**改 `.env` 必须 rebuild**；顺序 补列→构建→reload。
- `mv .output` 只许放 build 紧前一行（否则当场断静态资源）；备份见 `ARCHIVE`。
- 判包过期只能**逐文件比内容**（`\r\n→\n` 归一、剔 `export-ignore`），**绝不比 SHA256**；`tar xzf` 不删多余文件 ⇒ 含删除的上线要独立 `rm -f` 清单。

## 🔴 git（本机特有）
- 写不了嵌套引用 `a/b` ⇒ 平铺分支名或 node 直写 loose ref；`^`/`~` **也不可靠**（`f820bcd^` 解析成它自己）⇒ 要历史版本**写全 sha**；checkout/merge 后 `git reset --hard HEAD` 收尾。
- 🔴 **push/fetch 后 `refs/remotes/origin/<名>` 也可能不落盘**（判据：`git rev-list origin/ycdb...HEAD` 报 unknown revision）⇒ 同样 node 直写 loose ref。
- ycdb 上**绝不用 `-A`/`.`**（常驻未跟踪项：`docs/厂家后台使用说明/`、`scripts/generate-user-guide.mjs`）；先断言 staged 恰等于预期再提交。
- 🔴 **切分支前必查 `.workbuddy/memory/<当天>.md`**：本机改过而目标分支**已跟踪**该文件时，`checkout` 直接中止（"untracked working tree files would be overwritten"）。正确姿势 = 先 `copyFileSync` 备份到 `tmp/` → `unlinkSync` 删盘 → checkout → `reset --hard HEAD` → 把两分支内容**并回**（日志只增不减）→ 在目标分支提交。
- 🔴 **`node` 里 `execSync` 跑 git 时，`commit -m "中文含空格"` 会被 cmd.exe 拆成 pathspec 报错**（`pathspec '+' did not match…`）⇒ 中文提交信息一律写临时文件用 **`commit -F <file>`**（消息里不含空格的短消息才可直接 `-m`）。

## 🔴 工程铁律
- 同一文件多次 Edit **绝不并行**；`node --check` 不查未声明引用；用户报「点了没反应/控件用不了」⇒ **先回退上一版对照复跑**。
- **合成 HTML 单测全绿 ≠ 真实页面没被读坏**（`f820bcd` 单测 10/10 却读坏 2 站 ⇒ revert）；改解析口径必须真实页面**逐字段**对照。
- **「已修」≠「已上线」**；失败命令的 fallback 输出绝不当证据；判等价必须**全表穷举集合比较**。
- 🔴 **「校验 + 写入」必须同事务**：只加一条 `SELECT COUNT` 前置检查是**假防护** —— 单请求下它常不可达（能操作该账号的人本身就是启用中的平台账号，「除目标外」恒 ≥ 1），真漏洞是**并发**（TOCTOU：两名管理员同时禁用对方 → 一个不剩、后台永久锁死）。并发安全的防自锁一律 `SELECT … FOR UPDATE` + 判定 + 写入放**同一事务**（实例 `server/api/admin/users/[id].patch.ts`）。
- 🔴 **并发用例必须先断言前置条件**（如「启用中的总部管理员恰为 N 个」），否则场景根本不成立，却会被误读成代码有问题。
- 🔴 **`UInput type="number"` 的 `v-model` 是 number 不是 string**（Nuxt UI v4 `Input.vue` 对 `type==='number'` 走 `looseToNumber`）⇒ 对它调 `.trim()` 会在按钮事件里静默抛 TypeError：请求不发出、无任何提示，**表现为「点了没反应」**。实例：记账保存自 `20caee5`(09-29) 起坏了 7 天，「新建记账」全量不可用。凡此类字段一律先 `String(v ?? '')` 归一。
- 🔴 **两个口径别混**：①「两文件测试合计数」≠「单文件数」；②「git blob 字节(LF)」≠「包内字节(CRLF)」（本机 `core.autocrlf=true`，`git archive` 产物是 CRLF）⇒ 核执行单字节判据**必须用包内口径**。

## 外码解析
- `source-parser.ts`（`SOURCE_PARSER_VERSION`=`2026-09-27.4`）+ `source-adapters/`（白名单宿主）；落库策略收口在 `source-raw-cap.ts`：成功原文截 **64KB** 按字符边界、失败**不落原文**且**也进缓存**（2min < 成功 10min）。
- 🔴 判该不该加适配器：**先判是不是 JS 空壳**——抓下来剥标签后**还有没有值**。有值⇒通用解析；没值⇒空壳，补别名**永远无效**，只能接它页面调的接口（见 `ARCHIVE`）。**字段名抄源码，别猜**。
- 三态：拿到声明 / `{notFound:true}`⇒`issue=source-not-found` / `null` 退回通用；异常一律 null。🔴 每调一次都在**对方系统写一条扫码记录**；靠 10 分钟缓存+白名单缓解，删登记行即下线。
- 口径：纯文本保留换行、含标签 HTML 压平（逐字节不变）；`commodityName` **单列，绝不并进 `productName`**；原药缺字段留空、**绝不拿下一组补位**。
- 回归：`source-snapshot`(8)+`external-summary`(5)+`source-adapters`(6+3 真接口 `NZ315_LIVE_ADAPTERS=1`)+`source-raw-cap`(6)；`_m7-regression.mjs`（22 项，**真写库**，跑完按 `id>基线 AND created_at>=今天` 清理）。

## 登记库与码 / 其余
- 码提取唯一来源 `trace-code.ts` 的 `extractTraceCode()`，比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL）；「后六位」查询 `registry-lookup.ts`。
- `/api/trace` 未命中→`external-reg` 兜底→`not-found`；**只读**（不写 `scan_log`、不触发预警）。写接口 `requireWritableUser`+`v-if="canWrite"`；演示数据**数值不可信**。

## 本机环境
- 托管 Node 22.22.2-3；dev 必须显式 `node node_modules/nuxt/bin/nuxt.mjs dev --port 3100`（**nuxt.config 未配 devServer，裸 `nuxt dev` 默认落 3000**；全项目集成测试硬编码 `http://localhost:3100`）。**`npm run build` 跑不了** ⇒ `node node_modules/nuxt/bin/nuxt.mjs build`。`curl` 走代理 ⇒ 连本机加 `--noproxy '*'`；Git Bash coreutils 全瘫 ⇒ 用 node 脚本。
- 🔴 改 CRLF 文档别用 Edit ⇒ 补丁表+驱动脚本、**函数式替换**（见 `ARCHIVE`）。
- 公众端真浏览器端到端回归：`playwright-core`（托管 workspace）+ 系统 Chrome + `context.addCookies` 注入自造 `nz315_consumer`（**httpOnly 只禁 JS 读、服务端不查该标志**，故可注入）⇒ 见 skill `nz315-consumer-e2e`。旧法 jsdom 只验结构不验视觉。

## 待办
1. 🔴 存储放大**已收口**（`5a0246f`）但**未上线** ⇒ 需另打含本轮 3 文件的新包。
2. 🔴 拿到 sdakzw 真码后补端到端验收。
3. 微信授权域名保存状态未确认；公安备案 ~2026-10-15；HTTPS 证书 2026-12-16 到期不续期。
4. 其余遗留（未登记标签 / 线 B 缺口 / C7·E4）见 `AGENTS.md` 待办段。
5. 🔴 记账保存修复（`app/components/BillFormModal.vue` 的 `toText` 归一，本机已改**未提交未上线**）⇒ 上线需按 54 号流程重打包；线上当前版本该功能不可用。
6. 🔴 **新增总部管理员并入「新增用户」**（`server/api/admin/users.post.ts` 提权闸 + `[id].patch.ts` 同事务 `FOR UPDATE` 防并发互禁 + `settings/index.vue` 角色下拉）与 **码库批次导出 + 生成页防丢失提醒**（新 `upload-batches/[id]/export.get.ts`，仅「生成入库」留档批次可导；`generator/index.vue` 未导出/未入库时 `beforeunload` 拦截 + 提醒条）：**本机已改、测试全绿、未提交未上线**。见 `.workbuddy/memory/2026-10-10.md`。
7. 🔴 导出/生成页/账号三处的真浏览器回归方法已写入 skill `nz315-func-regression`（含「弹窗判据不能用 body.innerHTML.includes」「操作列第 6 个文字按钮会被挤到点不中 ⇒ 改图标按钮」「USelect items 来自 useFetch ⇒ 必须 networkidle + 轮询」「合成点击失效先查水合，勿误判 UI 缺陷」）。
