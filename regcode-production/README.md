# 农资315生产扫码 Android 3.0.1

包名 `cn.nz315.production.pda`，versionCode 8，默认服务器 https://www.nz315.cn。支持Android12 UROVO i6310 Pro / CT58 广播和键盘扫码。

设备登记厂家和生产线，不绑定固定员工。每位工人用个人 `production_operator` 账号登录；同设备支持多个工人的加密离线授权。交班继续原批，扫码事件保留原工人和设备归属。工人不能调用管理员接口。

后台先按设备、产品分配具体码清单。工人选择缓存产品，填写生产日期、有效期和瓶盖批号，开始采集。本批使用开始时该设备该产品的全部预配码，不能中途扩大范围。首次联网完整下载本厂启用产品和设备预配码，每15分钟更新缓存；下载中断保留旧快照。工人离线授权72小时，过期或设备时间明显回退停止新采集，已有记录保留。

每扫一件提交SQLite事务（DELETE日志、synchronous=FULL）后才提示已保存。提取唯一完整32位数字码，保留前导零，网址不影响判断；按码去重，重复和异常保存原文与原因。随机10～15分钟同步，每批最多20条；事件UUID和序号保持不变。立即上传、恢复联网、重开和结束触发补传。Android前台服务支持熄屏上传，关机/强制停止时暂停，重开恢复。不要卸载或清除数据。

云端已保存不代表已质检或正式绑定。实际采集码始终占用，管理员确认合格及合格证号后正式绑定。结束整批需收齐所有会话及结束序号，只能释放未扫描码；交班不结束整批。外码采集独立保存、分类、导出，不绑定生产，不消耗码池，不访问第三方网址。

工人可导出本人本机JSON备份和本人外码UTF-8 TXT。备份保留原文、归属、生产资料和收据，不含密码或设备凭证。旧接口和本机队列保留；存在旧队列时先完成旧队列，再进入新工人流程。新流程没有设置页或手动领码。

## 构建

JDK17、Android SDK35 / build-tools35.0.0，使用项目Gradle wrapper：

```powershell
.\build.ps1 -JavaHome 'C:\path\to\jdk-17' -AndroidSdk 'C:\path\to\Android\Sdk' -Online
```

输出 `app/build/outputs/apk/online/app-online.apk`。覆盖更新须沿用原安装签名，密钥不在源码包内；新电脑的默认debug签名不能覆盖既有安装。

## 独立实机验收

测试包名 `cn.nz315.production.pda.workertest`，与正式应用独立。先启动隔离测试服务器。

```powershell
.\gradlew.bat :collection-core:test :app:assembleDeviceTest :app:assembleDeviceTestAndroidTest -PpdaTestServer=http://127.0.0.1:38124
adb reverse tcp:38124 tcp:38124
adb install -r app/build/outputs/apk/deviceTest/app-deviceTest.apk
adb install -r app/build/outputs/apk/androidTest/deviceTest/app-deviceTest-androidTest.apk
adb shell am instrument -w cn.nz315.production.pda.workertest.test/com.regcode.app.QueueStoreInstrumentation
```
