# 项目长期记忆 — 农资315 追溯码管理平台

> 只留「改错会出生产事故」的硬约定。细节看 `AGENTS.md`（踩坑表/铁律）与 `docs/handover/`：**39 号**=外码「假空壳」定因+解析器修复（`3bf3042`，未上线）· 38 号=外码适配器上线执行单 · 36 号=外码解析失败三档 · 34/35 号=线 B · 32/33 号=线 A。复测用 skill `nz315-func-regression`。

## 🔴 判「线上是什么版本」——只看公网构建指纹，本机记录一律不可信
`curl -s https://www.nz315.cn/_nuxt/builds/latest.json` → `timestamp`。
- **现役 `1790496675391` = 2026-09-27 16:11（`47bcbd7`：nyzs315 适配器 + 失败原因人话文案 + 记账表单精简）**。链：`1790158070910`=09-23 18:07 线 A → `1790236396250`=09-24 15:53 线 B `a40ef08` → 现役。
- 判据：`/api/trace?source=http://nyzs315.com/c/z.aspx?m=c74&c=1172…` 返 `status:"ok"`+`resultType:"external-reg"`（不走适配器必 empty-shell）；`/api/admin/source-snapshots` 未登录 401、`/api/trace-snapshots/<uuid>` 404 仍成立。
- 捞真实 `sourceUrl`：`POST /api/auth/login {admin,admin123}` 返 `{"ok":true,"user":null}` 但 **cookie 有效**，带上读 `/api/admin/source-snapshots`（`{total,rows}`，20/页）。
- **每轮先量指纹，再写执行单/备份名/包指纹**。

## 🔴 部署与数据库
- 补列补索引一律 `db-init.mjs --migrate-only`；三明治 `verify-db-migration.mjs` 判据 `bad=0`。**新建表不打印迁移行**（判据=表数+1+`OK 新表 <名> 0`）；本机现 18 表。带新表上线须同改 `DDL`+`ACTIVE_TABLES`/`EXPECTED_NEW_TABLES` 两处白名单（累积制）。
- `external_source_snapshot` **匿名可写**（1MB/次）、失败不复用 10 分钟缓存 ⇒ 存储放大（与 cynx 共用磁盘 ~75%）。**方案已定未修** ⇒ 偶尔 `COUNT(*)`。
- 与 cynx 共用 PM2：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`.conf` 绝不写 `default_server`；绝不传本机 `.output`；**改 `.env` 必须 rebuild**；顺序 补列→构建→reload；工具包须 build 前放 `public/tools/`。
- 服务器 `mysqldump` 必加 `--no-tablespaces`；备份判据 `gzip -dc|tail -3` 有 `-- Dump completed on`；`ls -la` 才看得到 `.env`。
- `mv .output .output.bak-<TS>` **当场**断静态资源 ⇒ 只许放 `npm run build` 紧前一行。
- 判包过期**只能逐文件比内容**（`\r\n→\n` 归一、剔 `export-ignore`），**绝不可比 SHA256**；`git -c core.quotePath=false ls-tree` 的 `-c` 必在子命令之前。
- `tar xzf` 不删多余文件 ⇒ 含删除的上线须有独立 `rm -f` 清单（`git diff --name-status` 的 `D` 当反向清单）。
- 三段 token 部署后需重登（非故障）；改他人凭证顺带 `revokeUserSessions`；Origin **无 Origin 要放行**。

## 🔴 git（本机特有）
- `ycdb` 已推送（`6afeee6`，基线 `a40ef08`），带 DDL ⇒ 上线必 `--migrate-only`。
- 写不了嵌套引用 `a/b`（静默失败）⇒ 平铺分支名或 node 直写 loose ref；checkout/merge 后 `git reset --hard HEAD` 当常规收尾；push 后跟踪引用可能不落盘 ⇒ node 直写 `refs/remotes/origin/<名>`。
- ycdb 上**绝不用 `-A`/`.`**（常驻未跟踪项：`docs/厂家后台使用说明/`+`scripts/generate-user-guide.mjs`）；先断言 staged 恰等于预期，再 pathspec 提交 + `git show --name-status` 复核；误提交回退 `reset --soft HEAD~1`。

## 🔴 工程铁律
- 同一文件多次 Edit **绝不并行**；`node --check` 不查未声明引用；Vue/SPA 修复必须真浏览器验证。
- 失败命令的 fallback 输出**绝不当证据**；上限/截断/唯一性怀疑必须用真实数据算边界；**「已修」≠「已上线」**。
- 判重构等价必须**全表穷举集合比较**（`logs/_equivalence-proof.mjs`）；「回归全绿」证明不了在跑新代码 ⇒ 金丝雀+换码。
- 用户报「**点了没反应 / 某个控件用不了**」⇒ **先把代码回退到上一版对照复跑，再下结论**（2026-09-28 实测证伪：「购买渠道自定义不能输入」旧代码逻辑本就通、`v-model` 拿到了值，真因是输入框落在弹窗滚动区不显眼 ⇒ 对症 = 选完自动 `focus()`）。对照骨架 `~/.workbuddy/binaries/node/workspace/_verify-bill-selects.mjs`（真鼠标 + 真键盘 + 回读 `setupState`）。

## 外码解析
- **只有一套实现**（`0598e2d`）：`source-parser.ts`（`sourceText`/`parseSourceDocument`/`SOURCE_PARSER_VERSION`）+`source-compare.ts`（4 态含 `review`）+落表 `external_source_snapshot`；`verifyExternalCode`（6 项判定+预警 3/5/6/7）与 `fetchWla1`（`productionType` 唯一来源）别动。
- 🔴 两侧口径必须同时保住：**纯文本保留换行**；**含标签 HTML 压平换行**、逐字节不变。纯文本兜底**一律挂 `plain` 探测下**。
- 盲区两类（症状都是 `empty-shell`）：① **JS 壳**（nyzs315 靠 JSONP+innerHTML）⇒ 找它自己的 JSON 接口（`/api/h5/Code/QueryCodeJson`+`X-Tenant-ID`）；② **假空壳**（服务端渲染有值、被我们行结构吃掉）——**`3bf3042` 已修**：`</td>`→Tab 遇「td 内包 div」把标签/值拆两行 ⇒ 兜底③「标签一行值一行」由 `plain` 专用放开到全路径、下行**只取首个 Tab 格**；新增 `commodityName`（品种/商品名）**单列，绝不并进 `productName` 别名表**（否则误报「与登记资料不一致」）；`SOURCE_PARSER_VERSION` → `2026-09-27.4`。
- 遇读不出内容**先判是否解析器盲区**，别上无头浏览器/OCR/Agent；36 号 §4.1 判据应细化为「**标签与值是否落在同一 Tab 格内**」。外站探测别拿根路径代表一个站（`cx.jilinhengda.com/` 只是登录壳 342 B，且**只开 80**）。
- 回归：`node --test tests/source-snapshot.test.mjs`（**13 例**）+ `node logs/_m7-regression.mjs`（22 项，**会真写库**，跑完按 `id > 基线 AND created_at >= 今天` 清理）。M7 现 **19/22**，3 FAIL（wla1 403 / 通用 HTML 抓取）已用 stash 复跑证明与本改动无关；该脚本 HOST = `process.env.M7_HOST || 'localhost'`。

## 登记库与码（别自己重写）
- 码提取唯一来源 = `shared/utils/trace-code.ts` 的 `extractTraceCode()`；比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL）。
- 「后六位+类别过滤」唯一实现 = `registry-lookup.ts` 的 `findRegistryRowsByUnitCode()`（`797407c`）；`MAX_ROW_SCAN=20`（实测最大桶 6）/`MAX_CANDIDATES=5` **上下限联动必须一起调**。M7 **刻意不用** `lookupRegistryByCode()`（截断会误判）。

## 其余硬约定
- `/api/trace` 未命中 → `external-reg` 兜底 → `not-found`；**只读**：不写 `scan_log`、不触发预警。
- 上限取 `shared/utils/code-limits.ts`（50万/20万；CHUNK 只能减不能加）；线上 PM2 800M ⇒ 线上验收只跑 5 万。
- 写接口 `requireWritableUser`+按钮 `v-if="canWrite"`；IP 取 `clientIpOf(event)`；限流 `rate-limit.ts`（进程内）；`feedback.post.ts` 限流放**入参校验之后**。
- 高德配额用尽 **HTTP 仍 200**（须判 `status==='1'`）、未命中返 `[]`；仅 `ip-geo.ts` 一个调用方 ⇒ 刷爆 = 省份静默写不进。
- 合规必显六项（名称/持有人/生产日期〔须与标签一致〕/批次/原药证号/原药企业）；演示数据**数值不可信**。

## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 `{total,page,pageSize,rows}`；`/api/admin/source-snapshots` 返 `{total,rows}`，未登录 401 / 非 platform_admin 403。
- `GET /api/trace-snapshots/<uuid>` 匿名可读、60/分、**不返 `raw_document`**；id 小写 hex UUID；页面假 UUID = 页面 200+文案、接口 404，别混判。
- `/api/trace` 的 `sourceSnapshot` 只出现在 `not-found`/`external-reg` 两类。用户态取 `GET /api/auth/me`。
- raw mysql2 `conn.query()` 返 `[rows,fields]`、项目 `db.ts query()` 返行数组 ⇒ 统一收口 `firstRow()`。
- `external_source_snapshot` 列名是 **`code`**、无 `status` 列（在 `payload` JSON 里）；`scan_log` 没有 `created_at` ⇒ 写 SQL 前 `DESCRIBE`。

## 本机环境
- 托管 Node 22.22.2-3（无系统 Node）；dev 端口 3100；账号 `admin`/`lvfeng`/`codeop`/`viewer`，密码 `admin123`。
- 🔴 起 dev：计划任务 `NZ315 Dev Server` 本机不存在 ⇒ 手动后台 `node node_modules/nuxt/bin/nuxt.mjs dev --port 3100`；🔴 **只能用 `http://localhost:3100`**（`127.0.0.1:3100` 连不上）。
- 🔴 `curl` 默认走系统代理 ⇒ 连本机也要 `--noproxy '*'`；真浏览器验证用 skill `browser-ui-screenshot` 的 `scripts/ui-shot.js`，输出路径必须 ASCII（`C:/shots/`）。
- 🔴 本机 DNS 被代理接管为 fake-ip（`198.18.x`），恰在 `source-fetch.ts` SSRF 黑名单内。**已修**：DoH 取真 IP 写 `hosts` 映射块（`# === nz315-dev-source-fetch BEGIN/END ===`，含 mashangzhuisu/ddspp/nyzs315/www.wla1/**cx.jilinhengda**，备份 `logs/hosts.bak-*.txt`，删块即回退）⇒ 本机**能真实验收外码抓取**；仅 `www.wla1.cn` 真实 403 不可测。
- 🔴 Git Bash coreutils 全瘫 ⇒ node 绝对路径 + `fs.writeFileSync` 落盘再 Read；PowerShell stdout 常被吞。临时脚本放 `~/.workbuddy/binaries/node/workspace`。`node --experimental-strip-types` 可 import 项目 `.ts`。
- 🔴 **本机 `npm run build` 跑不了**（shim 里 `/usr/bin/env: 'bash': No such file or directory`）⇒ 绕开 npm 脚本，直接 **`node node_modules/nuxt/bin/nuxt.mjs build`**（实测 exit 0 / 约 1 分 10 秒）。打包自验脚本范例：`~/.workbuddy/binaries/node/workspace/_verify-pkg.mjs`、`_cmp-pkg.mjs`（**包对包逐文件比内容**，判「包只变了哪几个文件」的正确口径）、`_scan-output.mjs`（产物级正/反向 grep）。
- 项目内**文档是纯 CRLF**（`AGENTS.md`/`PROJECT_LOG.md`/`docs/handover/*.md`），而 `.workbuddy/memory/*.md` 是 **LF**；要给 CRLF 文档做多行插入，**别用 Edit**（多行匹配会失手）⇒ 用 node 脚本 `split('\r\n')` 后 splice 再 join 写回。

## 待办（易漂移，用前现测）
1. 🔴 `external_source_snapshot` 存储放大修复（匿名可写 + 失败也落 1MB）—— 建议优先。
2. 🔴 **`3bf3042` 的上线包已备（40 号执行单），等用户放行**：包 `nz315-ycdb-bf6ae7e.tar.gz` **742,679 B / SHA256 `b2029918…bbebac` / 187 文件**；范围 `47bcbd7..bf6ae7e`，**运行时代码仅 4 个**（`source-parser.ts`/`source-snapshot.ts`/`shared/types/source-snapshot.ts`/`tests/source-snapshot.test.mjs`）；**零 DDL**（判据 = **不出现任何 `[db] 迁移：` 行** + 表数仍 17）；上线 = 服务器 `npm run build` + `pm2 reload nz315`。✅ **已推送**（2026-09-28；远端 `refs/heads/ycdb` 与本地同步，以 `git ls-remote` 为准）；推送后 HEAD 比包基线多 2 个纯文档提交，**运行时代码差异 0 ⇒ 包不必重打**。
3. 同族盲区其它未登记标签（部门/查询次数/质量检验/地址/电话）未排查；`productName` 别名表仍含「商品名称」的既有隐患；「只在用户点『查看原查询页』时才查」这个更小污染口径未做。
4. 外码页记账预填类别恒「其他」（用户裁定先不管）· P2「内容不符」提示位 · 数据治理（线上仍演示数据）。
5. 线 B 自带缺口：死代码 `outcome.externalSource` · `trace.get.ts` 的 `resultType` 隐式真值 · `PRIVATE_HOST` 正则末尾多 `$`。
6. 服务器残留早年 `docs/handover`/`.workbuddy`/`AGENTS.md`/`PROJECT_LOG.md`（公网实测全 404，不构成泄露）。
7. 微信「网页授权域名」后台保存状态未确认；公安联网备案未做（时限约 2026-10-15）；HTTPS 证书 2026-12-16 到期不自动续期。

## 📜 历史批次要点（09-23 / 09-24 / 09-27）

三份逐日日志（`2026-09-23.md` / `2026-09-24.md` / `2026-09-27.md`，共约 65K 字符）已于 **2026-09-28 压缩进同目录的 `ARCHIVE-2026-09-23_09-27.md` 并删除原文**；原文可从 git 历史取回（找删除提交的前一版）。

该归档留着**别处没有的**东西，动代码前值得先扫一眼：

- 外码构造公式（可零写入触发「登记证过期」等分支）· 登记库兜底守卫的真实条件
- 🔴 `deploy/nginx-nz315.conf` 的 `proxy_pass` 写的是 cynx 的 3000 端口（线上已手工改对，**别照模板部署**）
- 🔴 隐式耦合点：`regdata.ts` 被**扫码主链路 + 产品建档 + 外部核验**三处共用；`risk-alert.ts`、`source-fetch.ts` 同理
- 权限 5 类守卫在 68 端点上的分布；两套会话不可互换
- **已知未修缺陷 C7（点分内网 IP 被放行）/ E4（`x-forwarded-host` 绕过 Origin）**
- 4 个「有后端没前端」的端点 · `backup/download` 疑死链 · 10 个写端点无审计
- 🔴 **做过又被用户撤销的「扫码结果页折叠」**及其 diff 备份位置（`logs/_reverted-1c8ea0c.diff`）
- 回归脚本的两条过期点（M7 的 3 条 FAIL 是过期断言；`seed-abnormal-demo --verify` 必须带 `--verify-base http://localhost:3100`）
