# 生产扫码与设备登记 2.2.0

后台“生产任务与审核 → 设备管理”登记公司、生产线和设备，生成一次性激活二维码。设备扫码激活后独立认证，不占用管理员登录会话。

- [设备安装、登记和结束采集](installation.md)
- [Android 源码、构建与实机测试](../../regcode-production/README.md)

`android-collector/` 是已有离线箱瓶采集程序。本次单产品生产扫码程序位于 `regcode-production/`，包名 cn.nz315.production.pda，两者独立。

## 后端接口

管理员使用原后台 Cookie：`/api/admin/production-devices` 列表/登记、`/options`、`/:id` 编辑/启停/删除/重激活、`/:id/history` 管理历史。

设备使用原生客户端保存的独立 Bearer 凭证：`/api/device/activate`、`/context`、`/production-tasks`、`/production-tasks/:id`，以及对应采集会话启动、批量 events、complete 接口。只允许本公司、本生产线任务及本机采集会话。

新增 `production_collection_session`、`production_collection_event`、`production_device`、`production_device_activation`、`production_device_change`，并在采集会话增加可空 device_id。设备停用与生产绑定通过设备行锁协调；有未关闭会话时禁止重新激活、删除或改派。修改已生产任务名称/生产线不改变历史批次和线快照。

## 测试

普通输入测试：`node --test tests/collection-input.test.mjs`。

设备和采集接口验收：`tests/production-devices.integration.mjs`、`tests/production-collection.integration.mjs`，只允许本机隔离数据库 `pda_queue_test_数字`，通过 NZ315_TEST_BASE 指定隔离 HTTP 服务。不要在真实业务库运行。

Android 队列、HTTP 客户端和同步单测通过 build.ps1 运行；实机变体使用独立 .devicetest 包名。安装包、签名密钥、设备凭证、数据库文件和调试输出不纳入 Git。
