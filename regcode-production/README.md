# 农资315生产扫码 Android 2.2.0

Android 12 PDA 单产品追溯码生产采集。正式包名 cn.nz315.production.pda，versionCode 6，默认连接 https://www.nz315.cn。

## 设备认证

管理员在“生产任务与审核 → 设备管理”添加设备，指定所属公司、生产线和名称，生成十分钟有效的一次性激活二维码。APK首次打开扫描该二维码，自动提交安装标识及型号，无需抄写设备号或输入工人账号。每台设备独立认证，互不挤下线。

设备标识不充当密码。256位随机设备凭证在激活请求之前持久化，以Android Keystore的AES-GCM密钥加密，供原生HTTP客户端使用，不传给网页脚本、不导出到采集备份。激活超时使用同一凭证重试；重启自动恢复认证。ANDROID_ID仅作为登记辅助字段。

设备只能读取本公司本生产线任务、创建本机采集会话和同步本机事件，不能管理用户、审核、生成码或任意创建任务。后台管理员继续使用原账号登录，账号单登录规则不变。

启用、停用、编辑、逻辑删除、重新激活均记录管理历史。停止或凭证撤销后服务器拒绝绑定，联网检测到后本机停止采集。离线时无法实时获知管理员停用，已保存记录不自动删除。未结束的设备会话禁止调线、跨公司改派、删除或重新激活；可先恢复启用排空原队列。

升级前账号采集的旧队列仍由原账号同步，全部完成并结束本机采集后才能激活设备。不得卸载应用或清除待上传记录。

## 采集与同步

从扫码原文提取唯一完整32位追溯码，保留前导零，忽略域名、参数名和网址完整性。按码去重，缺位、多候选、未领用码记录原文和异常原因。

每次扫描先提交SQLite FULL事务，再提示已保存。首次缓存领用清单需要联网，此后可离线采集。每批最多20条同步，事件UUID与连续序号不变，响应丢失可重传。分别显示本机有效、云端绑定、待同步、重复、异常数量。

结束本机采集冻结最终序号，所有记录取得收据后才关闭会话；其他设备仍未结束时生产任务不能结束或审核。已有生产资料和原生产线快照不因改名调线改变。完整JSON备份保留已结束和待上传记录，不含设备凭证。

## 构建

需要JDK17、Android SDK35和build-tools35.0.0。使用随源码提供的Gradle wrapper。

```powershell
.\build.ps1 -JavaHome 'C:\path\to\jdk-17' -AndroidSdk 'C:\path\to\Android\Sdk' -Online
```

正式输出 app/build/outputs/apk/online/app-online.apk。沿用已交付版本签名才能覆盖升级并保留队列；密钥不包含在源码包中。不要卸载再安装。

## 独立实机测试

deviceTest变体包名 cn.nz315.production.pda.devicetest，独立于正式应用，不影响正式队列。

```powershell
.\gradlew.bat :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest -PpdaTestServer=http://127.0.0.1:38122
adb reverse tcp:38122 tcp:38122
adb install -r app/build/outputs/apk/deviceTest/app-deviceTest.apk
adb install -r app/build/outputs/apk/androidTest/deviceTest/app-deviceTest-androidTest.apk
adb shell am instrument -w cn.nz315.production.pda.devicetest.test/com.regcode.app.QueueStoreInstrumentation
```

SQLite和Keystore测试只使用独立临时数据和密钥，测试后清理，不绑定业务码。正式构建不允许公网HTTP。

## 主要代码

- MainActivity.java：设备激活、硬件广播、JS桥和本机采集。
- DeviceCredentials.java：Keystore加密凭证、幂等激活及凭证恢复。
- ProductionClient.java：设备独立认证、受限接口、旧账号协议兼容。
- CollectionSync.java：每批20条、逐条收据、重试及结束协调。
- QueueDatabase.java 与 collection-core/QueueStore.java：SQLite事务、码提取、去重和队列恢复。
- app/src/main/assets/www/：激活、任务、连续采集和备份页面。

后端须部署配套设备增量补丁后才能在正式服务器激活2.2.0。旧版账号APK仍可用原接口。
