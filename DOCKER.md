# 本机 Docker 启动

此配置使用独立 Compose 项目 `nz315-docker-local`，应用访问地址默认 `http://127.0.0.1:3101/login`，数据库为容器内 `nz315_docker`。原本机数据库、线上数据库及其他 Docker 项目均不参与此启动流程。使用127.0.0.1也可与localhost上运行的其他本机站点区分登录Cookie。

在 PowerShell 中进入项目目录：

```powershell
cd C:\Users\MR\Desktop\work\nz315
.\docker-start.ps1
```

首次下载镜像并构建较慢。脚本自动创建本机私有 `docker.env`（随机数据库密码及会话密钥，不进入镜像）。首次初始化包含演示企业、产品及账号；仅用于本机测试：`admin / admin123` 是总部管理员，`lvfeng / admin123` 是厂家主账号，`codeop / admin123` 是码管理员。工人账号在系统设置中创建为“生产操作员”。

2026-10-13 已按用户要求把线上 `nz315` 的一致性快照复制到本地 `nz315_docker`，当前不再是空演示库。私有 `docker.env` 的 `DOCKER_SEED_DEMO=0`，后续启动只增量迁移，不重新写演示资料。账号密码沿用快照中的线上账号；本机网站使用独立会话密钥。本地测试写入只影响容器数据库，不回传线上，也不会自动继续同步线上新增数据。

同步前备份在 `C:\Users\MR\.codex\worktrees\6ed7\nz315\.tools\local-data-sync-20261013-224641\local-before.sql.gz`；同目录的 `online.sql.gz` 和 `state.json` 保存此次快照及完整性核验。数据和凭据不进入 Git。41张原表行数与原列数据指纹一致；本地另外保留监控协调表和心跳字段，合计42张表。监控界面的旧设备没有新版心跳时按离线／未知展示，历史扫码数量不受影响。

以后使用已有镜像启动：

```powershell
.\docker-start.ps1 -NoBuild
```

查看状态和日志：

```powershell
docker compose --env-file docker.env ps -a
docker compose --env-file docker.env logs --tail 100 app database-init
```

停止、恢复：

```powershell
docker compose --env-file docker.env stop
docker compose --env-file docker.env start mysql app
```

更新本地代码后重新构建：

```powershell
.\docker-start.ps1
```

数据库和后台导出的备份保存在 Docker 命名卷中，停止/重新创建应用不会清空。保留 `docker.env`，已有数据库不能通过随意修改环境文件来更换数据库密码。不要使用 `docker compose down -v`，该命令会删除数据库卷。

应用运行在Linux容器，用Node启动Nuxt生产构建；数据库就绪并完成初始化后才启动应用。日常使用无需在容器内运行PM2。Compose未设置开机启动，按需手动启动。

MySQL使用官方8.0 Debian镜像。数据库启用`log_bin_trust_function_creators`，供限定在本库的应用账号创建码占用校验触发器；该设置只作用于本项目的独立MySQL容器。

如果Docker Hub下载中断，可使用官方镜像的ECR副本下载并标记到本机：

```powershell
docker pull public.ecr.aws/docker/library/node:22-bookworm-slim
docker tag public.ecr.aws/docker/library/node:22-bookworm-slim node:22-bookworm-slim
docker pull public.ecr.aws/docker/library/mysql:8.0-debian
docker tag public.ecr.aws/docker/library/mysql:8.0-debian mysql:8.0-debian
```

应用目前只绑定电脑本机的3101端口，扫描仪不能用自身的localhost访问它。扫描仪现有APK继续连接线上服务器；需要局域网实机测试时，另行配置电脑地址及测试APK。

## 正式服务器部署

Dockerfile可用于Linux服务器部署应用；当前Compose文件为本机演示配置。正式上线需要使用正式环境配置、保留原数据库并单独安排增量迁移，使用Nginx接入HTTPS。不要把本机演示初始化直接用于线上业务库。本次本机验证不自动迁移线上服务。

结构：`mysql` 为数据库，`database-init` 为一次性初始化，`app` 为网站；Dockerfile的runtime层包含Linux数据库备份客户端及非root应用用户。

参考：[Nitro Node运行方式](https://nitro.build/deploy/runtimes/node)、[Compose启动依赖](https://docs.docker.com/compose/how-tos/startup-order/)。
