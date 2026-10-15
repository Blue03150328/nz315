# 正式网站 Docker 部署

**2026-10-15 09:04（北京时间）布局优化已Docker上线**：功能 `0f9cee7bb3e520cdd9af517b1c000f27399095e1`，镜像 `nz315-production:0f9cee7bb3e5`，源目录 `/var/www/.nz315-production-layout-20261015-0f9cee7b`，有效完整备份 `/var/backups/nz315/production-layout-20261015-0f9cee7b`。容器healthy；候选及HTTPS验证全宽／填高、短数字列、完整时间列和原API／鉴权。零DDL，42表原字段指纹一致，原凭据／Nginx／14下载／cynx保持；APK未变。本机Docker和Desktop主仓同步。用户手调的列布局保留，点“恢复默认列”应用新宽度。回滚用备份目录前版Compose/env，只回滚应用，勿覆盖业务库。

**当前空任务删除补修（2026-10-14 21:51北京时间）**：运行 `nz315-production:6fcf19870bf1`，源目录 `/var/www/.nz315-line-draft-delete-20261014-6fcf1987`，有效完整备份 `/var/backups/nz315/line-draft-delete-20261014-6fcf1987`。零DDL、42表原字段指纹相同，healthy；金丝鸟001/002可删除并在确认时软删未开工空任务，未代执行生产删除。上面／下文1a和07为历史发布记录；稳定Compose入口已同步新镜像，APK及其他服务保持。

本配置用于 Linux 正式服务器，网站进 Docker，数据库继续使用服务器现有 MySQL。它与包含演示数据库的本机 `compose.yml` 分开，正式发布不运行 `docker-db-init.mjs`，也不上传本机业务数据库。

2026-10-14 20:21（北京时间）最新网站镜像为 `nz315-production:07f98af4aa3d`：主仓生产管理拆分长期产线总览与操作员扫码任务，修复已删除历史线名误拦。125单测／5既有跳过、16组隔离SQL／HTTP、构建与页面交互通过，候选和正式HTTPS验证默认产线页、四设备汇总、操作员列、旧接口与鉴权；容器healthy。

当前版本目录是 `/var/www/.nz315-management-20261014-07f98af4-r2`，Compose文件为 `compose.production.yml`。稳定操作入口 `/var/www/nz315` 的Compose和私有 `.docker-deploy.env` 已同步当前镜像，可使用下文管理命令；现役以 `.docker-release.json` 与容器交叉核对，旧.deploy-version不代表Docker现役。此前码库与扫码版本均保留在本版父提交中。

本次有效备份位于 `/var/backups/nz315/management-20261014-07f98af4-r2`，包含完整 `database.sql.gz`、原42表指纹、`previous-compose.yml` 和 `previous.env`。回滚仅切回42c8b8c应用，不恢复业务数据库或删除新增负责人列。原凭据、Nginx、14个下载文件及cynx核验保持；本轮不发布或安装APK。详细回执见[生产管理上线说明](production-line/生产管理与产线总览-20261014.md)。

**最新删除功能发布（2026-10-14 21:14北京时间）**：当前镜像为 `nz315-production:1a0e409c74aa`，实际目录 `/var/www/.nz315-line-delete-20261014-1a0e409c`，有效完整备份 `/var/backups/nz315/line-delete-20261014-1a0e409c`；上面的07f98af为上版记录。新版本增加产线单选／多选／批量软删除及旧缓存防复活，增量只加deleted_at／deleted_by两列，42表原字段全量指纹保持；候选和HTTPS入口、旧API、DELETE未登录鉴权通过，healthy，凭据／Nginx／下载／cynx保持。稳定管理入口已同步新镜像。旧版忽略删除标记，应用降级时产线可能重新显示，历史和标记仍保留。

## 运行结构

| 项目 | 配置 |
|---|---|
| 源码与 Compose 目录 | `/var/www/nz315` |
| Compose 项目 | `nz315-production` |
| 应用服务 | `app`，固定版本镜像 |
| 监听 | 主机网络，`127.0.0.1:3100` |
| 数据库 | 沿用原 `.env` 的 MySQL 地址、端口和 `nz315` 库；不新建演示 MySQL |
| 凭据副本 | `/var/lib/nz315-docker/runtime.env`，只读挂载，不提交 Git |
| 后台备份 | `/var/lib/nz315-docker/backup`，持久挂载至 `/app/backup` |
| HTTPS | 原 Nginx 继续反代3100，证书、域名及APK下载路径保持 |
| 自动恢复 | Docker `restart: unless-stopped`；移除原 nz315 PM2 启动项 |

Linux 主机网络允许容器连接只监听本机的现有 MySQL。参见 [Docker host 网络文档](https://docs.docker.com/engine/network/drivers/host/)。本配置不使用端口映射，程序本身限制在127.0.0.1，公网访问由Nginx提供。

启动器 `scripts/start-production-container.mjs` 从只读文件读取配置，映射到Nuxt运行时变量；密码和会话密钥以字符串传递，避免数值密码或特殊字符被Compose插值。凭据不复制进镜像，参考 [Docker配置与凭据说明](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)。

## 发布前准备

1. 确认主仓 `master`、本地已验收源码及目标提交一致，无未解决冲突。
2. 核对线上当前版本、端口、数据库、磁盘空间及其他服务，保留原Nginx与PM2配置的受限备份。
3. 备份原数据库与应用。正式备份放受限发布目录；需要腾空间时仅处理本项目已停用副本，先验证归档，不清理数据库或其他项目。
4. 构建Linux/amd64镜像，标记目标提交；服务器内存或空间不足时在本机构建，导出、校验后上传并加载。
5. 从原 `.env` 制作只读凭据副本，所有内容保持，原会话密钥沿用；凭据文件与备份目录供镜像内UID1000读取／写入。原 `.env` 不进入镜像或Git。

服务器私有 `.docker-deploy.env` 示例（仅路径和版本号）：

```dotenv
NZ315_IMAGE=nz315-production:目标提交
NZ315_SECRET_FILE=/var/lib/nz315-docker/runtime.env
NZ315_BACKUP_DIR=/var/lib/nz315-docker/backup
NZ315_PORT=3100
```

## 数据库增量

当前生产管理增量只在已有 `production_line_runtime` 增加空默认 `supervisor_name`，未改42表原列数据。此前产线协调表和8个心跳字段已存在并保留；原业务资料、采集事件、收据和任务不变，本机业务数据不复制到正式库。

暂停原网站写入后记录旧表原列的数据指纹，执行专用脚本：

```bash
cd /var/www/nz315
/usr/local/node22/bin/node scripts/migrate-production-monitor.mjs --database=nz315
```

脚本只读取该目录原 `.env` 并校验显式数据库名，不运行seed、不删除字段、不回填历史生产资料。执行后比对41张原表的原列数据，允许新增空结构；不以正式库运行隔离验收脚本。

新监控结构可与旧版本共存。回滚应用时通常保留这些空表／默认列，避免为恢复网站而删表。

## 验证与切换

1. 用同一正式配置在临时本机端口（例如3102）启动候选容器，监听仍为127.0.0.1。
2. 检查登录HTML、静态资源、未登录接口401、后台生产任务／产品／设备／码库查询，以及备份客户端可用。临时验收账号需清理；不改真实产品生产资料或冒充实机扫描。
3. 保留旧服务回滚配置，停止旧 `nz315` 以释放3100。
4. 用正式端口启动容器并等待healthy：

```bash
cd /var/www/nz315
docker compose --env-file .docker-deploy.env -f compose.production.yml up -d --wait
```

5. 验证HTTPS域名、管理员页面、扫码接口鉴权、原APK下载哈希和数据库原资料。失败则停止候选／正式容器，按备份恢复旧应用，不同时占用3100。
6. 验收成功后执行 `pm2 delete nz315` 与 `pm2 save`，只移除农资315启动项；其他应用保持。确认3100由容器持有，Docker服务开机启用。
7. 记录 `.docker-release.json` 的提交、镜像ID、原版本、备份路径、数据库迁移和验证结果；清理临时候选容器，保留回滚档案。

## 日常管理

```bash
cd /var/www/nz315
docker compose --env-file .docker-deploy.env -f compose.production.yml ps
docker compose --env-file .docker-deploy.env -f compose.production.yml logs --tail 100 app
docker compose --env-file .docker-deploy.env -f compose.production.yml restart app
```

更新时指定已验收的新镜像，再 `up -d --wait`。不要同时再用PM2启动该网站。容器日志最多保留3个10MB文件，后台备份存持久目录，重建容器不删除数据库或备份。

## 回滚

- 后续Docker版本回滚：把 `.docker-deploy.env` 的镜像改为留存的上一版本，执行 `up -d --wait` 并检查域名。
- 首次由PM2切换Docker的应急回滚：停止Docker网站，恢复发布备份中的旧源码／`.output`及仅nz315的PM2启动配置，启动旧服务并保存进程列表。不要恢复其他项目的完整进程列表。
- 只做应用回滚时不恢复数据库全库备份，避免覆盖发布后的正常生产记录。只有明确的数据损坏才另行安排数据库恢复。
- APK不随网站容器回滚或升级，本次保留原下载版本；新版自动归线及心跳需单独实机验收APK。
