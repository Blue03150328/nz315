# 项目长期记忆 — 农资315 追溯码管理平台

> 硬约定只在这里；细节看 `AGENTS.md`+`docs/handover/`（42=外站适配器+回退 `f820bcd`·41=上线单·39=假空壳·34/35=线 B）；溢出见 `ARCHIVE-参考细节.md`。复测 skill `nz315-func-regression`。

## 🔴 只信公网指纹
`curl -s www.nz315.cn/_nuxt/builds/latest.json`→`timestamp`；**每轮先量指纹再写执行单/备份名/包指纹**，本机记录不可信。现役 `1790496675391`（09-27 16:11 / `47bcbd7`）。

## 🔴 部署与数据库
- 补列补索引一律 `db-init.mjs --migrate-only`，判据 `bad=0`；**新建表不打印迁移行**（判据=表数+1），须同改 `DDL`+`ACTIVE_TABLES`/`EXPECTED_NEW_TABLES`。
- 与 cynx 共用 PM2：绝不 `pm2 kill`/`delete all`，只 `pm2 reload nz315`；`.conf` 绝不写 `default_server`；**改 `.env` 必须 rebuild**；顺序 补列→构建→reload。
- `mysqldump` 加 `--no-tablespaces`；`mv .output .output.bak-<TS>` **当场**断静态资源 ⇒ 只许放 build 紧前一行。
- 判包过期只能**逐文件比内容**（`\r\n→\n` 归一、剔 `export-ignore`），**绝不可比 SHA256**；`tar xzf` 不删多余文件 ⇒ 含删除的上线要独立 `rm -f` 清单。

## 🔴 git（本机特有）
- 写不了嵌套引用 `a/b`（静默失败、exit 0）⇒ 平铺分支名或 node 直写 loose ref；`^`/`~` **也不可靠**（实测 `f820bcd^` 解析成它自己）⇒ 要历史版本**写全 sha**；checkout/merge 后 `git reset --hard HEAD` 收尾。
- ycdb 上**绝不用 `-A`/`.`**（常驻未跟踪项：`docs/厂家后台使用说明/`、`scripts/generate-user-guide.mjs`）；先断言 staged 恰等于预期再提交。

## 🔴 工程铁律
- 同一文件多次 Edit **绝不并行**；`node --check` 不查未声明引用。
- **合成 HTML 单测全绿 ≠ 真实页面没被读坏**（`f820bcd` 单测 10/10，真实页面对照却把 ddspp 批次读成说明文字、空壳读出假字段 ⇒ revert）。改解析口径必须真实页面**逐字段**对照，且有**有值**的页面。
- **「已修」≠「已上线」**；失败命令的 fallback 输出绝不当证据；判等价必须**全表穷举集合比较**。
- 用户报「点了没反应/控件用不了」⇒ **先把代码回退到上一版对照复跑再下结论**。
- 🔴 **两个口径别混**：①「两文件测试合计数」≠「单文件数」；②「git blob 字节(LF)」≠「包内字节(CRLF)」——本机 `core.autocrlf=true`、`git archive` 产物是 CRLF，核执行单字节判据**必须用包内口径**。

## 外码解析
- `source-parser.ts`（通用，`SOURCE_PARSER_VERSION`=`2026-09-27.4`）+ `source-adapters/`（白名单宿主）。
- 🔴 判该不该加适配器：**先判是不是 JS 空壳**——抓下来剥标签后**还有没有值**。有值⇒通用解析；没值⇒空壳，补别名**永远无效**，必须接它页面调的接口（三站路径见 `ARCHIVE-参考细节.md`）。**字段名抄对方源码，别猜**；写死的常量不采信。
- 三态：拿到声明 / `{notFound:true}`（⇒`issue=source-not-found`）/ `null`（退回通用）；异常一律 null。🔴 每调一次都在**对方系统写一条扫码记录**（含不存在的码）；10 分钟缓存+白名单缓解；删登记行即下线。
- 口径：纯文本保留换行、含标签 HTML 压平（逐字节不变）；`commodityName` **单列，绝不并进 `productName`**；原药缺字段留空，**绝不拿下一组补位**。
- 回归：`source-snapshot`(**8**)+`external-summary`(5)+`source-adapters`(6 常跑+3 真接口 `NZ315_LIVE_ADAPTERS=1`)；`_m7-regression.mjs`（22 项，**真写库**，跑完按 `id > 基线 AND created_at >= 今天` 清理）。

## 登记库与码 / 其余
- 码提取唯一来源 `trace-code.ts` 的 `extractTraceCode()`，比对**必须先按类别过滤**（1→PD/PDN/LS/EX；2→WP/WPN/WL）；「后六位」查询实现 `registry-lookup.ts`。
- `/api/trace` 未命中→`external-reg` 兜底→`not-found`；**只读**（不写 `scan_log`、不触发预警）。写接口 `requireWritableUser`+`v-if="canWrite"`；演示数据**数值不可信**。

## 本机环境
- 托管 Node 22.22.2-3；dev 3100（**只能用 `http://localhost:3100`**）；密码 `admin123`。**`npm run build` 跑不了** ⇒ `node node_modules/nuxt/bin/nuxt.mjs build`。`curl` 走代理 ⇒ 连本机也加 `--noproxy '*'`；Git Bash coreutils 全瘫 ⇒ 用 node 脚本。
- 🔴 改 CRLF 文档别用 Edit ⇒ 补丁表 + 驱动脚本，**函数式替换**（细节见 `ARCHIVE-参考细节.md`）。

## 待办
1. 🔴 `external_source_snapshot` 存储放大（匿名可写+失败也落 1MB）——建议优先。
2. 🔴 拿到 sdakzw 真码后补端到端验收。
3. 微信「网页授权域名」保存状态未确认；公安备案时限约 2026-10-15；HTTPS 证书 2026-12-16 到期不续期。
4. 其余遗留（同族未登记标签 / `productName` 别名表含「商品名称」/ 线 B 缺口 / C7·E4）见 `AGENTS.md` 待办段。
