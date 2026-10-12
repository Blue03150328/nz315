param([string]$AndroidSdk, [string]$JavaHome, [string]$TestServer, [switch]$Online)
$ErrorActionPreference='Stop'
if (!$JavaHome) { $JavaHome=$env:JAVA_HOME }
if (!$JavaHome -or !(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) { throw '请配置JDK17的JAVA_HOME，或传入-JavaHome参数' }
if (!$AndroidSdk) { $AndroidSdk=$env:ANDROID_HOME }
if (!$AndroidSdk) { $AndroidSdk=Join-Path (Split-Path $PSScriptRoot -Parent) '.tools/android-sdk' }
if (!(Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms/android-35/android.jar'))) { throw '请配置Android SDK35，或传入-AndroidSdk参数' }
$taskOriginalJava=$env:JAVA_HOME
try {
    $env:JAVA_HOME=$JavaHome
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'local.properties'),'sdk.dir='+$AndroidSdk.Replace('\','/'),[Text.UTF8Encoding]::new($false))
    Push-Location $PSScriptRoot
    try {
        $taskGradleArguments=@(':collection-core:test',':app:testDebugUnitTest',':app:lintDebug',':app:assembleDebug','--no-daemon','--no-parallel','--console=plain')
        if($Online){$taskGradleArguments+=@(':app:lintOnline',':app:assembleOnline')}
        if($TestServer){$taskGradleArguments+=('-PpdaTestServer='+$TestServer)}
        & .\gradlew.bat @taskGradleArguments
        if ($LASTEXITCODE -ne 0) { throw '构建或验证失败，请查看日志' }
    } finally { Pop-Location }
} finally { $env:JAVA_HOME=$taskOriginalJava }
