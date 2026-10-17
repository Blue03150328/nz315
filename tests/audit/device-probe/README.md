# USB实机隔离扫码探针

仅用于用户授权的扫码仪验收。独立包名`cn.nz315.production.pda.scanprobe`，无联网权限，不读取正式包或搜索测试包的凭据、数据库。复用项目原有`WorkerStore`、`TraceUrlPolicy`、`QueueDatabase`，检测页面为独立原生界面，不等同于正式WebView界面验收。

## 构建与原生测试

在项目根目录执行`powershell -File tests/audit/device-probe/build.ps1`，依赖现有JDK17、Android SDK35和本机Android调试签名。输出`.tmp/device-scan-20261017/农资315隔离扫码检测.apk`。

安装探针后可单独运行`cn.nz315.production.pda.scanprobe/com.regcode.app.QueueStoreInstrumentation`。该Instrumentation使用独立临时SQLite和测试凭据，不调用业务服务器。成功时返回`NATIVE_SQLITE_AND_KEYSTORE_PASSED`、`NATIVE_WORKERS_PASSED`和`INSTRUMENTATION_CODE: -1`。这是原生存储／授权测试，不代表光学实扫或正式业务完整流程通过。

## 实体扫码验收

用户先解锁扫码仪，进入“内外码·实机隔离检测”，点击“开始／继续检测”。页面保持亮屏，离开页面自动暂停。仅用虚构测试标签，不扫生产标签。

1. 扫内部测试码两次：有效内码1、重复1。
2. 扫外部测试码两次：有效外码1、重复累计2；对应两个不同测试瓶的各一种码。
3. 扫非法内容：异常1，有效数量不增。
4. 点击暂停再扫新码：不保存，恢复后重扫才保存。
5. 退出／停止探针进程再打开：计数、原事件UUID和队列保留，检测保持暂停。

支持与正式应用相同的五类已知广播字段及键盘回车输入。测试页原样保留广播原文，包括CR/LF终止符，用于发现硬件输出格式问题。收到重复／异常时使用原生提示音。

探针私有目录`files/probe-report.json`保存当前计数、最近输入通道、最近原文和快照，可通过探针自身的`run-as`读取；禁止将`run-as`用于获取正式包凭据。探针没有服务器回执，所有记录仅保留本地，不将“待上传”视为真实业务上传。

## 结果边界

必须以实际收到的光学扫码输入为准。ADB广播注入应单独标明为输入通道测试，不能称为扫码头识别测试。屏幕二维码、纸码、反光污损及产线最高速度分别验收；不能由其中一项推断其余全部通过。
