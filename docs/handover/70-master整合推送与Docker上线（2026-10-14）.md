# master整合推送与Docker上线

用户明确要求将69号需求推送到Blue03150328/nz315的master并上线，宝塔浏览器终端已登录。外部页面仅统一现有采集批次，不新增派工。

发布基线为master `f435eb1a64b8d215c21e6d2ec17657e9a7092aad`。重新移植外部批次管理、离线入口、规格/商标复配命名、网格表格及批量管理，保留master的新工人上传投影、库存产品与生产快照、单次上传更正和生产监控。不引入SMXT的临时检查点历史；原工作区不切换、不清理。

## 已完成验证

- 独立生产构建及TypeScript检查通过。
- 网站115单测通过、4项既有跳过。
- 12组真实隔离SQL/HTTP通过，包含工人上传session_id为空时的产线设备快照、库存产品与生产资料筛选、批量冻结恢复；查询全选及排除、导出、权限、范围变化拒绝、审计失败整次回滚及作废终态保护。
- 69号原版本已有开发/生产页面各8组和原外部25组通过；本次整合不把这些记录冒充新版的再次验收。

## 生产事实与部署边界

宝塔终端实测现役容器`nz315-production-app-1`，镜像`nz315-production:f435eb1a64b8`，Compose项目`nz315-production`，监听127.0.0.1:3100。旧源码目录的.deploy-version不是现役版本；以容器镜像及.docker-release.json交叉核对。

沿用只读`/var/lib/nz315-docker/runtime.env`及持久`/var/lib/nz315-docker/backup`挂载。Nginx、静态下载/APK、数据库和cynx保持。相对f435eb1零DDL、零新依赖，不执行初始化/迁移或历史回填。

准备阶段服务器可用空间约1.9GB，主机package.json/package-lock.json与候选解析后JSON一致；在独立版本目录复用Linux依赖构建，再基于现役镜像生成增量运行镜像，保留旧镜像/配置。切换前私密数据库备份并验证，健康检查失败回退原镜像。实际结果见下文。

## 实际推送与上线结果

master快进推送至`b20cf06ecb1145685855863ab6ba98524f3582b8`，`git ls-remote`复核一致。本条之后的发布文档提交不改变网站业务源码。

用户中途追加先清内存、磁盘并在清理完成后再继续：释放可回收内存缓存，清理已确认可再生的`/root/.npm/_cacache`、`/root/.npm/_npx`、`/root/.cache/pip`、`/tmp/node-compile-cache`，并用`dnf clean all`清理包缓存。释放约1.4GB，空闲磁盘约1.8GB→3.2GB，发布镜像后约3.1GB；未清数据库、业务文件、日志历史、旧发布目录、Docker回滚镜像及任何正式备份。

收尾free实测总内存3568MiB、空闲2031MiB、可用2051MiB；网站持续healthy，cynx原进程保留，原本机3100登录页200。上线及资源证据截图保存在原本机logs/server-release-b20cf06-20261014.png，不提交Git。

| 项目 | 实际结果 |
|---|---|
| 发布目录 | `/var/www/.nz315-release-20261014-b20cf06` |
| 网站镜像 | `nz315-production:b20cf06ecb11` |
| 镜像ID | `sha256:41b2933062f2487de65201e839b35a22869cff830c65190a4ba99776190004` |
| 容器/健康 | `nz315-production-app-1` / healthy |
| 公网构建ID | `e5825a9e-a3fd-4a14-a9ae-a669e6ddbfa4` |
| 公网timestamp | `1791944038278` |
| 备份目录 | `/var/backups/nz315/code-management-20261014-b20cf06`，受限权限 |
| 数据库备份 | `database.sql.gz`，5,608,098字节，gzip及SHA256校验通过 |
| 部署记录 | 发布目录及`/var/www/nz315/.docker-release.json` |

GitHub精确提交归档下载后在Linux独立构建，未带真实.env；package.json/lock与原依赖按解析后JSON比较一致（Windows/归档换行差异不作为版本差异）。构建成功后，仅以原正式镜像为基底替换完整.output，运行用户、MySQL客户端、启动器沿用。旧镜像保留。切换程序有健康及公网校验失败自动应用回滚分支。

首次备份工具受默认配置影响出现认证失败，未切换网站；改为显式连接参数后成功。凭据始终只在服务器内读取，不打印、不提交。正式切换后HTTPS登录页200、两个新受保护列表匿名401、公网构建与本次产物一致；挂载/host网络、原会话密钥及静态下载文件指纹一致，cynx的原PID720326保持运行。

结构指纹一致且以下行数前后完全相等：企业4、账号13、产品8、规格11、生产批次27、内部码2999、生产任务14、码库上传批次9、外部采集批次7、外部码15。零数据库迁移或历史回填。

浏览器旧后台会话已失效，已请用户在原Edge页面重新登录后补做线上页面只读检查；当前不能把登录页正常当作全部后台页面已验收。本轮不对真实生产码执行冻结/恢复/作废，不创建测试业务数据。

日常管理：

```bash
cd /var/www/.nz315-release-20261014-b20cf06
docker compose --project-name nz315-production --env-file .docker-deploy.env -f compose.release.yml ps
docker compose --project-name nz315-production --env-file .docker-deploy.env -f compose.release.yml logs --tail 100 app
```

仅应用回滚（不恢复数据库，不覆盖发布后正常生产记录）：

```bash
docker compose --project-name nz315-production \
  --env-file /var/backups/nz315/code-management-20261014-b20cf06/previous.env \
  -f /var/backups/nz315/code-management-20261014-b20cf06/previous-compose.yml \
  up -d --wait --wait-timeout 120
```

回滚后重新核对公网构建、后台列表及.docker-release.json记录，不把旧目录.deploy-version当作现役版本。
