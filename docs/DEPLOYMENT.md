# 生产部署指南

> 目标环境：单台 Linux/Windows 服务器 + MySQL 8 + Node.js（Nuxt SSR）。
> 合规硬节点：**2026-11-01**（1049 号公告执行日），请提前至少 2 周完成部署与验证。

## 一、环境要求

| 组件 | 要求 |
|---|---|
| Node.js | ≥ 18（建议 20 LTS 或 24） |
| MySQL | 8.0（utf8mb4） |
| 服务器 | 2 核 4G 起（按扫码量扩展；亿级数据需按 D1 决策分库分表/归档） |
| 域名 | www.nz315.cn（扫码 URL 使用） |
| 证书 | HTTPS（Let's Encrypt 或商业证书） |

## 二、部署步骤

### 1. 准备代码与依赖

```bash
git clone <仓库地址> 二维码管理
cd 二维码管理
npm ci
```

> Windows 本机 npm wrapper 损坏时使用：`node "<npm安装路径>/npm-cli.js" install`

**⚠️ 必须额外拷贝 `public/tools/`（不要跳过）**

生成页的「二维码图片输出」提供离线二维码生成工具下载，该 EXE 约 **90.6 MB**，因体积过大**已被 `.gitignore` 排除**（`public/tools/*.exe`）——`git clone` 拿不到它，跳过后页面下载按钮会 **404**。

```bash
# 从本机（或发布机）单独上传，目录结构要对齐
scp -r public/tools/ root@<服务器IP>:/srv/二维码管理/public/tools/
```

| 文件 | 版本 | 大小 | SHA256 |
|---|---|---|---|
| `public/tools/nz315-qr-tool-v1.1.0.exe` | v1.1.0 便携版 | 90.6 MB | `df9cd9ea79cd67d545ee3f4161d1175c1197344c2dba3509e5b27a46347f59a7` |

> 换新版本时：上传新文件 → 改 `app/pages/admin/generator/index.vue` 顶部的 `OFFLINE_TOOL` 常量（`url`/`version`/`size`/`sha256`）→ 重新 `npm run build`。**若用 `git archive` 打部署包，该目录同样不会被包含。**

### 2. 配置环境变量（.env）

```bash
cp .env.example .env
```

| 变量 | 说明 |
|---|---|
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | MySQL 连接（数据库名建议 `nz315`） |
| `SESSION_SECRET` | **必须改为强随机值**（`openssl rand -base64 48`），会话签名密钥 |
| `SITE_URL` | 站点对外地址（https://www.nz315.cn） |

> ⚠️ **配置验证（实战踩坑）**：若 `SESSION_SECRET` 保持 `.env.example` 的默认值 `dev-session-secret-change-me` 未修改，生产环境**登录接口将返回 500**「生产环境必须配置独立 SESSION_SECRET」——这是服务端安全保护（防会话伪造）的正确拦截。务必改为强随机值后**重新构建**（runtimeConfig 在构建时内嵌进产物）。

### 3. 创建数据库账号并初始化

```sql
CREATE USER 'nz315'@'localhost' IDENTIFIED BY '<强密码>';
GRANT ALL PRIVILEGES ON nz315.* TO 'nz315'@'localhost';
FLUSH PRIVILEGES;
```

```bash
node scripts/db-init.mjs   # 建库建表 + 演示数据（幂等）；生产可仅建表后清理演示数据
```

### 3.5 导入农药登记数据源（产品弹窗自动回填必需）

产品管理「新增/编辑」依赖登记数据源字典表 pesticide_reg（97,471 条登记记录）。数据源 xlsx 文件**不随仓库分发**（6.9MB，.gitignore 排除），由部署方取得「2026农药登记证大全2.xlsx」后放入项目根目录执行：

```bash
node scripts/import-regdata.mjs            # 读取根目录 2026农药登记证大全2.xlsx → 入库（幂等重灌）
node scripts/import-regdata.mjs /path/to/xxx.xlsx   # 或指定文件路径
```

> 说明：表由 db-init 创建；导入脚本幂等可重跑（TRUNCATE 重灌）；未导入该表时产品弹窗搜索/回填不可用（接口返回空）。

### 4. 构建与启动

```bash
npm run build              # 产物在 .output/（构建前务必确保 .env 配置正确！）
npm run preview            # 验证生产构建（默认 3000 端口）
```

> **重要**：Nitro 的 runtimeConfig（数据库凭据、SESSION_SECRET 等）在**构建时**从 `.env` 读取并内嵌进产物；构建产物启动时**不会自动加载 `.env`**。因此：① 构建前必须确认 `.env` 为最终正确配置；② 运行期如需覆盖（如轮换密钥），通过 `NUXT_<键名>` 环境变量注入（例：`NUXT_SESSION_SECRET`、`NUXT_DB_PASSWORD`）。

**进程守护（PM2）**：

```bash
# 方式一：环境变量随 PM2 注入（推荐，密钥轮换无需重新构建）
pm2 start .output/server/index.mjs --name nz315 -- -p 3000 --env NUXT_SESSION_SECRET=<强随机值>

# 方式二：ecosystem.config.cjs 统一管理（env 段注入 NUXT_* 变量）
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

> Windows 可用 NSSM 注册为系统服务；本项目 dev 用 3100 端口仅为避开本机 3000 残留实例，生产端口可任意（建议 3000 内网端口，由 nginx 反代）。

### 5. nginx 反向代理 + HTTPS

```nginx
server {
    listen 80;
    server_name www.nz315.cn;
    return 301 https://$host$request_uri;   # 强制 HTTPS
}

server {
    listen 443 ssl http2;
    server_name www.nz315.cn;
    ssl_certificate     /etc/letsencrypt/live/www.nz315.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.nz315.cn/privkey.pem;
    client_max_body_size 60m;               # 码文件上传（单文件 50MB 上限）
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> 本服务已设置 `trust proxy` 与 `X-Forwarded-Proto` 会话安全 cookie 自适应，反代后 HTTPS 自动生效。

### 6. 验证清单

| # | 检查项 | 预期 |
|---|---|---|
| 1 | `https://www.nz315.cn/trace?code=<32位码>` | SSR 秒开，正品/异常正确展示 |
| 2 | `/login` 登录 → 后台 | 各模块可用 |
| 3 | 生成 100 条码 → 生产采集导入 | 校验通过、入库 |
| 4 | 扫码 3 次（或过期登记证） | 风险预警自动生成 + 站内消息 |
| 5 | 系统设置 → 数据备份 | 备份文件生成、可下载 |
| 6 | 操作日志 | 登录/敏感操作有记录 |
| 7 | 产品管理 → 新增：委托加工搜索登记产品并保存 | 8 个登记字段自动回填只读；制剂多原药必选；保存成功 |
| 8 | 产品管理 → 新增：切换生产类型=持有人生产 | 仅出现本企业登记产品（企业名称须与登记证持有人一致） |

## 三、安全清单（上线前逐项核对）

- [ ] `.env` 中 `SESSION_SECRET` 为强随机值（非默认）；改后已重新构建
- [ ] `.output/` 内含内嵌 runtimeConfig（数据库凭据明文）——部署目录权限收紧，禁止对外分发/公开访问
- [ ] 数据库账号使用专用低权限账号（非 root），强密码
- [ ] 全站 HTTPS（nginx 已强制跳转）
- [ ] 防火墙仅开放 80/443（及运维端口）
- [ ] `backup/`、`.env` 不在 Web 可访问路径（Nuxt 仅暴露 public/ 与 .output/）
- [ ] 初始管理员密码已修改；演示账号（lvfeng/codeop）已删除或改密
- [ ] 登录失败限速生效（5 次/分钟锁定 15 分钟）
- [ ] 每日自动备份（cron 或计划任务直调 mysqldump）

## 四、备份与恢复

**手动备份**：后台「系统设置 → 数据备份」立即备份（mysqldump 全库，不锁表）。

**自动备份建议**（cron 每日 02:00）：

```bash
0 2 * * * mysqldump -u nz315 -p'<密码>' --single-transaction nz315 | gzip > /var/backups/nz315_$(date +%Y%m%d).sql.gz
```

**恢复**：

```bash
mysql -u nz315 -p nz315 < backup/nz315_YYYYMMDDHHMMSS.sql
```

> 恢复前确认服务暂停或低峰期；恢复会覆盖当前数据。

## 五、性能与容量提醒（PRD 6/10）

- 追溯码年增量预估 1 亿条（3 年 3 亿）——**上线前必须决策 D1 方案**（冷热分离/分库分表/限制查询窗口），否则列表与扫码性能不达标
- 扫码查询页要求 P95 ≤ 2s：当前实现单表查询 + 索引已覆盖百万级；亿级需归档/分片
- 上传校验 10 万条码目标 ≤ 30s：当前逐行内存校验，亿级文件建议异步任务化（V1.2 规划）

## 六、常见问题

| 问题 | 处理 |
|---|---|
| 白屏/无法访问 | 检查 PM2 状态与日志；确认 3000 端口未被占用；curl 本机验证 |
| 扫码提示"查无此码" | 码未导入或导入到了其他企业（隔离）；检查码生成/导入链路 |
| 登录提示"账号禁用" | 用户状态为禁用；联系总部管理员 |
| 登录接口 500「生产环境必须配置独立 SESSION_SECRET」 | `.env` 的 `SESSION_SECRET` 仍为默认值 `dev-session-secret-change-me`；改为强随机值（`openssl rand -base64 48`）后**重新构建**再启动 |
| 备份失败 | 确认 mysqldump 在本机路径（Windows：C:/Program Files/MySQL/MySQL Server 8.0/bin/） |