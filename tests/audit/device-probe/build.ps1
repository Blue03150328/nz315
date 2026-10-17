param([string]$JavaHome)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if(!$JavaHome){$JavaHome=Join-Path $taskRoot '.cache/toolchain/jdk/jdk-17.0.20.1+1'}
$taskSdk=Join-Path $taskRoot '.cache/toolchain/sdk'
$taskTools=Join-Path $taskSdk 'build-tools/35.0.0'
$taskAndroid=Join-Path $taskSdk 'platforms/android-35/android.jar'
$taskOut=Join-Path $taskRoot '.tmp/device-scan-20261017'
$taskClasses=Join-Path $taskOut 'classes'
$taskDex=Join-Path $taskOut 'dex'
New-Item -ItemType Directory -Path $taskClasses,$taskDex -Force | Out-Null
$taskSourceRoot=Join-Path $taskRoot 'regcode-production/app/src/main/java/com/regcode/app'
$taskSources=@(Get-ChildItem (Join-Path $taskRoot 'regcode-production/collection-core/src/main/java') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
foreach($taskName in @('QueueDatabase.java','DeviceCredentials.java','WorkerVault.java')){$taskSources+=(Join-Path $taskSourceRoot $taskName)}
$taskSources+=(Join-Path $taskRoot 'regcode-production/app/src/androidTest/java/com/regcode/app/QueueStoreInstrumentation.java')
$taskSources+=(Join-Path $PSScriptRoot 'ScannerProbeActivity.java')
& (Join-Path $JavaHome 'bin/javac.exe') -encoding UTF-8 -source 17 -target 17 -cp $taskAndroid -d $taskClasses @taskSources
if($LASTEXITCODE -ne 0){throw '隔离检测包编译失败'}
$taskJar=Join-Path $taskOut 'classes.jar'
& (Join-Path $JavaHome 'bin/jar.exe') cf $taskJar -C $taskClasses .
if($LASTEXITCODE -ne 0){throw '隔离检测类打包失败'}
& (Join-Path $JavaHome 'bin/java.exe') -cp (Join-Path $taskTools 'lib/d8.jar') com.android.tools.r8.D8 --lib $taskAndroid --min-api 26 --output $taskDex $taskJar
if($LASTEXITCODE -ne 0){throw '隔离检测DEX编译失败'}
$taskUnsigned=Join-Path $taskOut 'probe-unsigned.apk'
& (Join-Path $taskTools 'aapt2.exe') link -o $taskUnsigned --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') -I $taskAndroid --min-sdk-version 26 --target-sdk-version 32 --version-code 1 --version-name '1.0-isolated'
if($LASTEXITCODE -ne 0){throw '隔离检测APK资源打包失败'}
& (Join-Path $JavaHome 'bin/jar.exe') uf $taskUnsigned -C $taskDex classes.dex
if($LASTEXITCODE -ne 0){throw '隔离检测DEX装入失败'}
$taskAligned=Join-Path $taskOut 'probe-aligned.apk'
& (Join-Path $taskTools 'zipalign.exe') -f 4 $taskUnsigned $taskAligned
if($LASTEXITCODE -ne 0){throw '隔离检测APK对齐失败'}
$taskFinal=Join-Path $taskOut '农资315隔离扫码检测.apk'
& (Join-Path $JavaHome 'bin/java.exe') -jar (Join-Path $taskTools 'lib/apksigner.jar') sign --ks (Join-Path $env:USERPROFILE '.android/debug.keystore') --ks-pass 'pass:android' --key-pass 'pass:android' --out $taskFinal $taskAligned
if($LASTEXITCODE -ne 0){throw '隔离检测APK签名失败'}
& (Join-Path $JavaHome 'bin/java.exe') -jar (Join-Path $taskTools 'lib/apksigner.jar') verify $taskFinal
if($LASTEXITCODE -ne 0){throw '隔离检测APK签名验证失败'}
Write-Output $taskFinal
