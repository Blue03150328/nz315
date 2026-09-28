# 参考细节（从 MEMORY.md 溢出；查得到即可，勿当硬约定读）

> `MEMORY.md` 有 3,000 字符上限，故把这些细节挪到这里。**硬约定仍在 `MEMORY.md`**，别只读本文件。

## 接口形状（断言前先看）
- `GET /api/admin/external-verifications` 返 `{total,page,pageSize,rows}`；`/api/admin/source-snapshots` 返 `{total,rows}`，未登录 401 / 非 platform_admin 403。
- `GET /api/trace-snapshots/<uuid>` 匿名可读、60/分、**不返 `raw_document`**；id 为小写 hex UUID；页面上的假 UUID = 页面 200 + 文案、接口 404，别混判。
- `/api/trace` 的 `sourceSnapshot` 只出现在 `not-found` / `external-reg` 两类。用户态取 `GET /api/auth/me`。
- raw mysql2 `conn.query()` 返 `[rows,fields]`，项目 `db.ts query()` 返行数组 ⇒ 统一收口 `firstRow()`。
- `external_source_snapshot` 列名是 **`code`**、**无 `status` 列**（在 `payload` JSON 里）；`scan_log` **没有 `created_at`** ⇒ 写 SQL 前先 `DESCRIBE`。

## 上限与限流
- 上限取 `shared/utils/code-limits.ts`（50 万 / 20 万；`CHUNK` 只能减不能加）；线上 PM2 800M ⇒ 线上验收只跑 5 万。
- IP 取 `clientIpOf(event)`；限流在 `rate-limit.ts`（进程内）；`feedback.post.ts` 的限流放**入参校验之后**。
- 高德配额用尽 **HTTP 仍 200**（须判 `status==='1'`）、未命中返 `[]`；仅 `ip-geo.ts` 一个调用方 ⇒ 刷爆 = 省份静默写不进。

## 本机环境细节
- 本机 dev 账号：`admin` / `lvfeng` / `codeop` / `viewer`，密码均 `admin123`（仅本机开发库）。
- 起 dev：计划任务 `NZ315 Dev Server` 本机不存在 ⇒ 手动后台 `node node_modules/nuxt/bin/nuxt.mjs dev --port 3100`；🔴 只能用 `http://localhost:3100`（`127.0.0.1:3100` 连不上）。
- 真浏览器验证用 skill `browser-ui-screenshot` 的 `scripts/ui-shot.js`，输出路径必须 ASCII（`C:/shots/`）。
- `node --experimental-strip-types` 可 import 项目 `.ts`（类型必须真剥离；给 loader 写死 `format:'module'` 会跳过剥离而报 `SyntaxError: Unexpected identifier 'as'`）；项目源码无扩展名相对导入需 `tests/_ts-loader.mjs` 那种钩子。
- DNS 被代理接管为 fake-ip（`198.18.x`，恰在 `source-fetch.ts` SSRF 黑名单内）。**已修**：DoH 取真 IP 写 `hosts` 映射块（`# === nz315-dev-source-fetch BEGIN/END ===`，含 mashangzhuisu/ddspp/nyzs315/www.wla1/cx.jilinhengda，备份 `logs/hosts.bak-*.txt`，删块即回退）⇒ 本机**能真实验收外码抓取**；仅 `www.wla1.cn` 真实 403 不可测。
- 临时脚本放 `~/.workbuddy/binaries/node/workspace`；`node -e` 的输出别接管道（Git Bash coreutils 全瘫）。

## 部署契约与其它
- `git archive` + tar 包 + SHA256；AI 不直连 SSH，用户在宝塔终端逐条粘；阶段式验证（step 0 健康检查先行）。
- 备份：服务器 `mysqldump` 必加 `--no-tablespaces`（否则因 PROCESS 权限报错）；判据 `gzip -dc 文件 | tail -3` 出现 `-- Dump completed on`；`ls -la` 才看得到 `.env`。
- `external_source_snapshot` 的**存储放大**已于 2026-09-28 收口（`source-raw-cap.ts`，提交 `5a0246f`）：成功原文按 UTF-8 字符边界截 64KB、失败不落原文且失败行也进缓存（TTL 2 分钟 < 成功的 10 分钟）。
- 工具包必须 build 前放 `public/tools/`。
- `deploy/nginx-nz315.conf` 的 `proxy_pass` 指向 cynx 的 3000 端口（**别照模板部署**）。
- 隐式耦合点：`regdata.ts` 被扫码主链路 + 建档 + 外部核验三处共用。
- `seed-abnormal-demo --verify` 必须带 `--verify-base http://localhost:3100`。
- 被撤销的「扫码结果页折叠」diff：`logs/_reverted-1c8ea0c.diff`。
- 外码构造公式、权限 5 类守卫在 68 端点的分布 ⇒ 见 `.workbuddy/memory/ARCHIVE-2026-09-23_09-27.md`。
- 文档换行符：`AGENTS.md`/`PROJECT_LOG.md`/`docs/handover/*.md` **多数**是纯 CRLF，但 **40 号单实测是 LF** ⇒ 改文档的脚本要**按文件各自的原换行符写回**，别一刀切。
