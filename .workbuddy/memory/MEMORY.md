# 项目长期记忆 — 农资315 追溯码管理平台

> 只留「改错会出生产事故」的硬约定。细节在 `AGENTS.md`（踩坑表/铁律）与 `docs/handover/`：**42 号**=hyny168/sdakzw 适配器 + 回退 `f820bcd`（本轮）· **41 号**=上线单 · 39 号=假空壳解析器修复 · 34/35=线 B。复测用 skill `nz315-func-regression`。

## 🔴 判「线上是什么版本」——只信公网指纹
`curl -s https://www.nz315.cn/_nuxt/builds/latest.json` → `timestamp`。**每轮先量指纹，再写执行单/备份名/包指纹。**
- 现役 `1790496675391` = 2026-09-27 16:11（`47bcbd7`）。链：`1790158070910`(09-23 18:07 线 A) → `1790236396250`(09-24 15:53 线 B `a40ef08`) → 现役。
- 捞真实 `sourceUrl`：`POST /api/auth/login {admin,admin123}` 返 `{"ok":true,"user":null}` 但 **cookie 有效** ⇒ 带上读 `/api/admin/source-snapshots`（`{total,rows}`，20/页）。

## 🔴 部署与数据库
- 补列补索引一律 `db-init.mjs --migrate-only`；三明治判据 `bad=0`。**新建表不打印迁移行**（判据=表数+1+`OK 新表 <名> 0`）；带新表上线须同改 `DDL` 与 `ACTIVE_TABLES`/`EXPECTED_NEW_TABLES` 两处白名单。
- `external_source_snapshot` **匿名可写**（1MB/次）、失败不复用缓存 ⇒ 存储放大（与 cynx 共用磁盘 ~75%）。**方案已定未修**。
- 与 cynx 共用 PM2：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`.conf` 绝不写 `default_server`；**改 `.env` 必须 rebuild**；顺序 补列→构建→reload；工具包须 build 前放 `public/tools/`。
- `mysqldump` 必加 `--no-tablespaces`；判据 `gzip -dc|tail -3` 有 `-- Dump completed on`。`mv .output .output.bak-<TS>` **当场**断静态资源 ⇒ 只许放 build 紧前一行。
- 判包过期**只能逐文件比内容**（`\r\n→\n` 归一、剔 `export-ignore`），**绝不可比 SHA256**；`tar xzf` 不删多余文件 ⇒ 含删除的上线要独立 `rm -f` 清单。

## 🔴 git（本机特有）
- 写不了嵌套引用 `a/b`（静默失败、退出码 0）⇒ 平铺分支名或 node 直写 loose ref；checkout/merge 后 `git reset --hard HEAD` 当常规收尾；push 后跟踪引用可能不落盘 ⇒ node 直写 `refs/remotes/origin/<名>`。
- ycdb 上**绝不用 `-A`/`.`**（常驻未跟踪项：`docs/厂家后台使用说明/`、`scripts/generate-user-guide.mjs`）；先断言 staged 恰等于预期，再 pathspec 提交 + `git show --name-status` 复核；误提交 `reset --soft HEAD~1`。

## 🔴 工程铁律
- 同一文件多次 Edit **绝不并行**；`node --check` 不查未声明引用。
- **合成 HTML 单测全绿 ≠ 真实页面没被读坏**（2026-09-28 实证：`f820bcd` 单测 10/10，真实页面对照却把 ddspp 的批次读成说明文字、把 nyzs315 空壳读出假字段 ⇒ 已 revert）。改解析口径必须做**真实页面逐字段对照**，且要拿**有值**的页面（空壳页对照不出问题）。
- 判重构等价必须**全表穷举集合比较**；「回归全绿」证明不了在跑新代码 ⇒ 金丝雀+换码。**「已修」≠「已上线」**；失败命令的 fallback 输出绝不当证据。
- 用户报「**点了没反应/某控件用不了**」⇒ **先把代码回退到上一版对照复跑，再下结论**（2026-09-28 实证：真因是输入框落在弹窗滚动区不显眼 ⇒ 对症=选完自动 `focus()`）。

## 外码解析（通用解析 + 宿主适配器）
- `source-parser.ts`（通用，`SOURCE_PARSER_VERSION` 现 `2026-09-27.4`）+ `source-adapters/`（白名单宿主）。
- 🔴 **判「该不该加适配器」：先判是不是 JS 空壳** —— 抓下来剥掉标签后**还有没有值**：有值 ⇒ 通用解析（`ddspp.cn`、`cx.jilinhengda.com`）；没值 ⇒ 空壳，补标签别名**永远无效**（标签不在 HTML 里），必须接它自己页面调的接口。例：`zp.hyny168.cn`（12,107 B 壳 → `/prod-api/trace/{码}`）· `www.sdakzw.com`（1,661 B 壳 → `api.sdakzw.com/api/nongYaoItem/zhuisu/{码}`）· `nyzs315.com`（JSONP + `X-Tenant-ID`）。**字段名一律抄对方前端源码，不猜。**
- 适配器三态：**拿到声明 / `{notFound:true}`（对方明确查无此码 ⇒ `issue=source-not-found`）/ `null`（退回通用抓取）**。任何异常一律 null，适配器**永不成为唯一失败点**；核心字段全空也 null。🔴 每调一次都会**在对方系统写一条扫码记录**（含不存在的码）；靠 10 分钟缓存 + 白名单缓解；删 `source-adapters/index.ts` 一行即下线。
- 口径：纯文本保留换行、含标签 HTML 压平换行（逐字节不变）；`commodityName`（品种/商品名）**单列，绝不并进 `productName`**；原药缺字段**留空，绝不拿下一组补位**；不采信页面上写死的常量（如 sdakzw 的「检验报告：合格」）。
- 回归：`node --test tests/source-snapshot.test.mjs`（13）+ `tests/external-summary.test.mjs`（5）+ `tests/source-adapters.test.mjs`（6 常跑 + 3 真接口，`NZ315_LIVE_ADAPTERS=1` 打开）；`logs/_m7-regression.mjs`（22 项，**真写库**，跑完按 `id > 基线 AND created_at >= 今天` 清理）。

## 登记库与码（别自己重写）
- 码提取唯一来源 = `shared/utils/trace-code.ts` 的 `extractTraceCode()`；比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL）。
- 「后六位+类别过滤」唯一实现 = `registry-lookup.ts` 的 `findRegistryRowsByUnitCode()`；`MAX_ROW_SCAN=20`/`MAX_CANDIDATES=5` **上下限必须一起调**。M7 **刻意不用** `lookupRegistryByCode()`（截断会误判）。

## 其余硬约定
- `/api/trace` 未命中 → `external-reg` 兜底 → `not-found`；**只读**：不写 `scan_log`、不触发预警；`sourceSnapshot` 只在这两类出现。
- 上限取 `shared/utils/code-limits.ts`（50万/20万；CHUNK 只能减不能加）；线上 PM2 800M ⇒ 线上验收只跑 5 万。
- 写接口 `requireWritableUser` + 按钮 `v-if="canWrite"`；IP 取 `clientIpOf(event)`；限流 `rate-limit.ts`（进程内），`feedback.post.ts` 的限流放**入参校验之后**。
- 高德配额用尽 **HTTP 仍 200**（须判 `status==='1'`）、未命中返 `[]`；仅 `ip-geo.ts` 一个调用方 ⇒ 刷爆 = 省份静默写不进。
- 合规必显六项（名称/持有人/生产日期〔须与标签一致〕/批次/原药证号/原药企业）；演示数据**数值不可信**。
- 接口形状：`/api/admin/*` 返 `{total,rows}`（未登录 401、非 platform_admin 403）；`/api/trace-snapshots/<uuid>` 匿名可读、60/分、**不返 `raw_document`**。`external_source_snapshot` 列名是 **`code`**、无 `status` 列（在 `payload` 里）；`scan_log` 没有 `created_at` ⇒ 写 SQL 前 `DESCRIBE`。raw mysql2 返 `[rows,fields]`、项目 `db.query()` 返行数组 ⇒ 收口 `firstRow()`。

## 本机环境
- 托管 Node 22.22.2-3（无系统 Node）；dev 端口 3100；账号 `admin`/`lvfeng`/`codeop`/`viewer`，密码 `admin123`。
- 起 dev：计划任务本机不存在 ⇒ 手动后台 `node node_modules/nuxt/bin/nuxt.mjs dev --port 3100`；🔴 **只能用 `http://localhost:3100`**。**`npm run build` 跑不了**（shim 缺 bash）⇒ 直接 `node node_modules/nuxt/bin/nuxt.mjs build`（exit 0 / ~70 s）。
- 🔴 `curl` 默认走系统代理 ⇒ 连本机也要 `--noproxy '*'`；真浏览器验证用 skill `browser-ui-screenshot`，输出路径必须 ASCII（`C:/shots/`）。
- 🔴 Git Bash coreutils 全瘫（`ls`/`cat`/`grep`/`tail` 全无）⇒ 用专用工具或 node 脚本，**`node -e` 的输出别接管道**；临时脚本放 `~/.workbuddy/binaries/node/workspace`。`.ts` 可 `import('file://…ts')` 直载（类型必须真剥离；给 loader 写死 `format:'module'` 会跳过剥离而报 SyntaxError）；项目源码无扩展名相对导入需 `tests/_ts-loader.mjs` 那种钩子。
- 🔴 文档是纯 CRLF（`AGENTS.md`/`PROJECT_LOG.md`/`docs/handover/*.md`），`.workbuddy/memory/*.md` 是 LF；改 CRLF 文档**别用 Edit** ⇒ 补丁表 + 驱动脚本（`_apply-patch.mjs`：`\n` 归一、逐条断言全文恰命中 1 次、不满足即整体中止），替换必须**函数式** `s.replace(old, () => new)`（`new` 含 `$'`/`$&` 会被当替换模式展开，实测把文档后半段整段注入）。

## 待办（易漂移，用前现测）
1. 🔴 `external_source_snapshot` 存储放大修复（匿名可写 + 失败也落 1MB）—— 建议优先。
2. 🔴 **拿到 sdakzw 真码后补端到端验收**（本轮只验到「接口存在 + 响应信封正确」）。
3. 微信「网页授权域名」后台保存状态未确认；公安联网备案未做（时限约 2026-10-15）；HTTPS 证书 2026-12-16 到期不自动续期。
4. 同族盲区其它未登记标签（部门/查询次数/质量检验/地址/电话）未排查；`productName` 别名表仍含「商品名称」的旧隐患；`mashangzhuisu.com` 根路径 404。
5. 外码页记账预填类别恒「其他」· P2「内容不符」提示位 · 数据治理（线上仍演示数据）· 线 B 自带缺口（死代码 `outcome.externalSource`、`resultType` 隐式真值、`PRIVATE_HOST` 末尾多 `$`）· 已知未修缺陷 C7/E4。

## 📜 历史批次要点
09-23/09-24/09-27 三份逐日日志已压缩进 `.workbuddy/memory/ARCHIVE-2026-09-23_09-27.md`。别处没有的：外码构造公式 · 🔴 `deploy/nginx-nz315.conf` 的 `proxy_pass` 指向 cynx 的 3000 端口（**别照模板部署**）· 隐式耦合点（`regdata.ts` 被扫码主链路+建档+外部核验三处共用）· 权限 5 类守卫在 68 端点的分布 · 被撤销的「扫码结果页折叠」diff（`logs/_reverted-1c8ea0c.diff`）· `seed-abnormal-demo --verify` 必须带 `--verify-base http://localhost:3100`。
