# 项目长期记忆 — 农资315 追溯码管理平台

> 只留「改错会出生产事故」的硬约定。细节看 `AGENTS.md`（踩坑表/铁律）与 `docs/handover/`：**36 号**=外码解析失败方案（未实施）· **35 号**=线 B 执行单（✅已上线）· **34 号**=线 B 手册 · 32/33 号=线 A（已上线，留档）。旧日志蒸馏在 `archive-2026-09-11_09-22.md`；09-23/09-24 日志保留。复测用 skill `nz315-func-regression`。

## 🔴 判「线上是什么版本」——只看公网构建指纹，本机记录一律不可信
`curl -s https://www.nz315.cn/_nuxt/builds/latest.json` → `timestamp`。
- **现役 `1790236396250` = 2026-09-24 15:53:16（线 B `a40ef08` 已上线）**；历史 `1790158070910` = 09-23 18:07（线 A）。
- 线 B 判据：`/api/admin/source-snapshots` 返 **401**、`/api/trace-snapshots/<uuid>` 返 **404「快照不存在」**。
- 教训：本机记录被公网实测推翻过 ⇒ **每轮先量指纹，再写执行单/备份名/包指纹**。

## 🔴 部署与数据库（每条都踩过）
- 补列补索引一律 `db-init.mjs --migrate-only`（裸跑会 seed 演示数据）；三明治 `verify-db-migration.mjs` 判据 `bad=0`。**新建表不打印 `[db] 迁移：` 行**（判据 = 表数+1 + `OK 新表 <名> 0`）；本机现 18 张表。带新表上线必须同改 `DDL` + `ACTIVE_TABLES`/`EXPECTED_NEW_TABLES` 两处白名单（累积制）。
- `external_source_snapshot` **匿名可写**（1MB/次原文落库）；失败行不复用 10 分钟缓存 ⇒ 存储放大（服务器与 cynx 共用磁盘 ~75%）。方案已定**未修** ⇒ 偶尔 `SELECT COUNT(*)`。
- 与 cynx 共用 PM2：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`.conf` 绝不写 `listen 443 ssl default_server`；绝不传本机 `.output`；**改 `.env` 必须 rebuild**；顺序 补列→构建→reload；工具包须 build 前放 `public/tools/`。
- 三段 token 部署后需重登（非故障）；改他人凭证顺带 `revokeUserSessions`；Origin **无 Origin 要放行**。
- 服务器 `mysqldump` 必加 `--no-tablespaces`（报错非致命）；备份判据 = `gzip -dc | tail -3` 有 `-- Dump completed on`；`ls -lh` 看不到 `.env`，用 `ls -la`。
- `mv .output .output.bak-<TS>` **当场**断静态资源（运行期读盘）⇒ 只许放 `npm run build` 紧前一行。
- 判包是否过期**只能逐文件比内容**（先 `\r\n→\n` 归一、先剔 `export-ignore`），**绝不能比 SHA256**；`git -c core.quotePath=false ls-tree` 的 `-c` 必须在子命令**之前**。
- `tar xzf` 不删服务器多余文件 ⇒ 含删除的上线必须有独立 `rm -f` 清单（`git diff --name-status` 的 `D` 当反向清单）。

## 🔴 git（本机特有）
- `ycdb` 已推送（= `6afeee6`，代码基线 `a40ef08`），带 DDL ⇒ 上线必须 `--migrate-only`。
- 写不了嵌套引用 `a/b`（静默失败 ⇒ 平铺分支名或 node 直写 loose ref）；checkout/merge 后 `git reset --hard HEAD` 当常规收尾；push 后跟踪引用可能不落盘 ⇒ node 直写 `refs/remotes/origin/<名>` 修。
- ycdb 上**绝不用 `-A`/`.`**（master 线常驻未跟踪项：`docs/厂家后台使用说明/` + `scripts/generate-user-guide.mjs`）；先断言 staged 恰等于预期，再用 pathspec 提交 + `git show --name-status` 复核；误提交回退 = `reset --soft HEAD~1`。

## 🔴 工程铁律
- 同一文件多次 Edit **绝不并行**（写覆盖竞态）；`node --check` 不查未声明引用；Vue/SPA 修复必须真浏览器验证。
- 失败命令的 fallback 输出**绝不当证据**；「上限/截断/唯一性」怀疑必须用真实数据算边界；**「已修」≠「已上线」**。
- 判重构等价必须**全表穷举集合比较**（范例 `logs/_equivalence-proof.mjs`），不许用近似口径替代真实函数口径；「回归全绿」证明不了在跑新代码 ⇒ 金丝雀 + 换码。

## 外码解析（最易踩，单列）
- **只有一套实现**（`0598e2d` 合并）：`source-parser.ts`（`sourceText`/`parseSourceDocument`/`SOURCE_PARSER_VERSION`）+ `source-compare.ts`（4 态含 `review`）+ 落表 `external_source_snapshot`；M7 内联解析**全删**改调内核，`verifyExternalCode`（6 项判定 + 预警 3/5/6/7）一字未动，`fetchWla1` 是 `productionType` 唯一来源。
- 🔴 两侧口径必须同时保住：**纯文本保留换行**（分隔认冒号/Tab/2+空格/换行，含「标签一行值一行」兜底）；**含标签 HTML 压平换行**、逐字节不变。纯文本兜底**一律挂 `plain` 探测下**（一刀切压平曾让登记证号/持有人全取不到，`.2`→`.3`）。
- 🔴 解析不到的头号原因 = **JS 壳页面**（nyzs315：72% 是 script、数据靠 JSONP+innerHTML 回填）⇒ 抛错后 `snapshot.source` 未赋值 ⇒ 「查看原查询页」没有、`code` 空 ⇒ 登记库比对短路。破法 = 找它自己的 JSON 接口（`/api/h5/Code/QueryCodeJson` + `X-Tenant-ID`，`firstFullAddress` 必填）。详见 36 号。
- 回归：`node --test tests/source-snapshot.test.mjs`（8 例）+ `node logs/_m7-regression.mjs`（22 项，**会真写库**，跑完按 `id > 基线 AND created_at >= 今天` 清理）。⚠️ wla1/通用 HTML 抓取本机不可测（代理出口，500/502）——**不是回归**。

## 登记库与码（别自己重写）
- 码提取唯一来源 = `shared/utils/trace-code.ts` 的 `extractTraceCode()`（三路兜底），**别自己 slice**。比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL）。
- 「后六位+类别过滤」唯一实现 = `registry-lookup.ts` 的 `findRegistryRowsByUnitCode()`（`797407c` 收口），公众端兜底与 M7 共用，改它即同时改两端。`MAX_ROW_SCAN=20`（类别过滤前，实测最大桶 6）/ `MAX_CANDIDATES=5` **上下限联动必须一起调**（桶>20 会把「一致」误判成「不一致」）。M7 **刻意不用** `lookupRegistryByCode()`（`slice(0,5)`+缓存，截断会误判）。

## 其余硬约定
- `/api/trace` 未命中 → `external-reg` 兜底 → `not-found`；**只读**：不写 `scan_log`、不触发预警。
- 上限取 `shared/utils/code-limits.ts`（50万/20万；MySQL 占位符贴 65535，CHUNK 只能减不能加）；线上 PM2 800M ⇒ 线上验收只跑 5 万。
- 写接口 `requireWritableUser` + 按钮 `v-if="canWrite"`（别散落 `role==='viewer'`）；IP 取 `clientIpOf(event)`（优先 `x-real-ip`）；限流用 `rate-limit.ts`（进程内）；`feedback.post.ts` 限流放**入参校验之后**。
- 高德配额用尽 **HTTP 仍 200**（须判 `status==='1'`）、未命中返 `[]`；仅 `ip-geo.ts` 一个调用方 ⇒ 刷爆 = 省份静默写不进。
- 合规必显六项（名称/持有人/生产日期〔须与标签一致〕/批次/原药证号/原药企业）；演示数据**数值不可信**，只有「机制」可下结论。

## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 `{total,page,pageSize,rows}`（不是裸数组）；`GET /api/admin/source-snapshots` 返 `{total,rows}`，未登录 401 / 非 platform_admin 403（正确行为）。
- `GET /api/trace-snapshots/<uuid>` 匿名可读、60/分、**不返 `raw_document`**；id 是小写 hex UUID；页面假 UUID = 页面 200+文案，接口层 404，别混判。
- 🔴 `/api/trace` 的 `sourceSnapshot` 只出现在 `not-found`/`external-reg` 两类。
- 用户态取 `GET /api/auth/me`（登录接口 `user:null`）。断言文案前先取组件源码真实字符串；断言响应前先 `Object.keys`。
- raw mysql2 `conn.query()` 返 `[rows,fields]`、项目 `db.ts query()` 返行数组 ⇒ 统一收口 `firstRow()`。
- `external_source_snapshot` 列名是 **`code`**、无 `status` 列（在 `payload` JSON 里）；`scan_log` 没有 `created_at` ⇒ 写 SQL 前 `DESCRIBE`。

## 本机环境
- 托管 Node 22.22.2-3（无系统 Node）；dev 端口 3100；账号 `admin`/`lvfeng`/`codeop`/`viewer`，密码 `admin123`（`viewer` 只在本机库）。
- 🔴 起 dev 服务：计划任务 `NZ315 Dev Server` **本机当前不存在**（`Get-ScheduledTask` 返 `NO_TASK`）⇒ 手动后台跑 `node node_modules/nuxt/bin/nuxt.mjs dev --port 3100`；🔴 **只能用 `http://localhost:3100` 访问，`127.0.0.1:3100` 连不上**（Nuxt 绑 localhost/IPv6），探活写 127.0.0.1 会误判成"服务没起"。
- 🔴 `curl` 默认走系统代理 ⇒ **连本机也要 `--noproxy '*'`**，否则返 502（假故障）。真浏览器验证用 skill `browser-ui-screenshot` 的 `scripts/ui-shot.js`（Edge + CDP），输出路径必须 ASCII（`C:/shots/`）。
- 🔴 **本机 DNS 被代理接管为 fake-ip（全部外站域名 → `198.18.x`/`198.19.x`），而 `source-fetch.ts` 的 SSRF 黑名单恰好含 `198.18.0.0/15` ⇒ 本机抓任何外部来源页 100% 失败**（文案「来源网址不是可访问的公网地址」）。指定公共 DNS 也没用（UDP 53 被劫持，`dns.Resolver.setServers(['223.5.5.5'])` 仍返 fake-ip）。**要拿真实公网 IP 只能用 DoH**（`fetch('https://223.5.5.5/resolve?name=<域名>&type=A')`，Node fetch 不走代理），再直连 IP 验站点。⇒ 本机**永远无法**验收外码抓取，别把它当回归。**2026-09-27 已修**：用 DoH 取真实公网 IP 后写 `hosts` 映射（`mashangzhuisu.com`/`ddspp.cn`/`nyzs315.com`/`www.wla1.cn`，夹在 `# === nz315-dev-source-fetch BEGIN/END ===` 之间，备份 `logs/hosts.bak-*.txt`，删块即回退）⇒ **本机现在能真实验收外码抓取**（实测：`ddspp.cn` 18 项比对、`nyzs315.com` 走适配器 11 项）；仅 `www.wla1.cn` 因真实 403 反爬仍不可测（非环境问题）。
- 🔴 Git Bash coreutils 全瘫 ⇒ 一律 node 绝对路径 + `fs.writeFileSync` 落盘再 Read；PowerShell stdout 也常被吞。`curl` 可用。临时脚本放 `~/.workbuddy/binaries/node/workspace`（已装 jsqr/@zxing/library/jpeg-js，可解瓶身二维码）。`node --experimental-strip-types` 可直接 import 项目 `.ts`。

## 待办（易漂移，用前现测）
1. 🔴 `external_source_snapshot` 存储放大修复（匿名可写 + 失败也落 1MB）—— 建议优先做。
2. **36 号三条**（失败回填 `sourceUrl`/`platform` · 复用 `extractTraceCode()` 取码 · nyzs315 适配器〔需先认「污染外站 queryCount」〕）—— 均未实施、未提交。
3. 外码页记账预填类别恒「其他」（用户裁定先不管）· P2「内容不符」提示位 · 数据治理（线上仍演示数据，换真数据放功能上线后）。
4. 线 B 自带缺口：死代码 `outcome.externalSource` · `trace.get.ts` 的 `resultType` 隐式真值 · `PRIVATE_HOST` 正则末尾多 `$`（当前不可利用）。
5. 服务器残留早年 `docs/handover`/`.workbuddy`/`AGENTS.md`/`PROJECT_LOG.md`（公网实测全 404，不构成泄露）。
