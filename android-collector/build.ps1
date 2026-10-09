param([switch]$Release, [switch]$DeviceTests, [int]$VersionCode = 3, [string]$VersionName = '1.1.0')
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$workspaceRoot = Split-Path $projectRoot -Parent
$mappedDrive = $null
$buildRoot = $projectRoot
$originalJavaHome = $env:JAVA_HOME
$originalGradleHome = $env:GRADLE_USER_HOME
$localPropertiesPath = Join-Path $projectRoot 'local.properties'
$originalProperties = if (Test-Path -LiteralPath $localPropertiesPath) { [IO.File]::ReadAllBytes($localPropertiesPath) } else { $null }
try {
    # Windows安卓构建使用临时盘符绕开中文路径，原始源码位置保持不变。
    if ($projectRoot -match '[^\x00-\x7F]') {
        $driveLetter = @('R','S','T','U','V','W','X','Y','Z') | Where-Object { !(Test-Path ($_ + ':\')) } | Select-Object -First 1
        if (!$driveLetter) { throw '没有可用的临时构建盘符' }
        & subst.exe ($driveLetter + ':') $workspaceRoot
        if ($LASTEXITCODE -ne 0) { throw '临时盘符创建失败' }
        $mappedDrive = $driveLetter + ':'
        $buildRoot = Join-Path ($mappedDrive + '\') (Split-Path $projectRoot -Leaf)
    }
    $portableRoot = Join-Path (Split-Path $buildRoot -Parent) '.cache\toolchain'
    # Gradle测试进程的类路径同样需要ASCII路径，缓存目录随源码盘符一起映射。
    if ($mappedDrive -and $env:GRADLE_USER_HOME -and $env:GRADLE_USER_HOME.StartsWith($workspaceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $env:GRADLE_USER_HOME = $mappedDrive + $env:GRADLE_USER_HOME.Substring($workspaceRoot.Length)
    }
    if (!$env:JAVA_HOME) {
        $portableJdk = Get-ChildItem -LiteralPath (Join-Path $portableRoot 'jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($portableJdk) { $env:JAVA_HOME = $portableJdk.FullName }
    }
    if (!$env:JAVA_HOME -or !(Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw '请配置JDK17的JAVA_HOME' }
    $sdkRoot = $env:ANDROID_HOME
    if (!$sdkRoot -and (Test-Path (Join-Path $portableRoot 'sdk'))) { $sdkRoot = Join-Path $portableRoot 'sdk' }
    if ($sdkRoot) {
        [IO.File]::WriteAllText((Join-Path $projectRoot 'local.properties'), 'sdk.dir=' + $sdkRoot.Replace('\','/'), [Text.UTF8Encoding]::new($false))
    }
    if (!(Test-Path (Join-Path $projectRoot 'local.properties'))) { throw '请安装Android SDK35并配置ANDROID_HOME或local.properties' }
    $tasks = @(':core:test', ':app:lintDebug', ':app:assembleDebug')
    if ($Release) {
        if (!$env:NZ315_KEYSTORE_PATH -or !$env:NZ315_STORE_PASSWORD -or !$env:NZ315_KEY_PASSWORD) { throw '正式构建需要配置发布签名环境变量，禁止使用调试签名替代' }
        $tasks = @(':core:test', ':app:lintRelease', ':app:assembleRelease')
    }
    if ($DeviceTests) { $tasks += @(':data:connectedDebugAndroidTest', ':export:connectedDebugAndroidTest', ':scanner:connectedDebugAndroidTest') }
    Push-Location $buildRoot
    try {
        & (Join-Path $buildRoot 'gradlew.bat') @tasks "-PcollectorVersionCode=$VersionCode" "-PcollectorVersionName=$VersionName" --no-daemon --no-parallel --console=plain
        if ($LASTEXITCODE -ne 0) { throw '构建或验证失败，请查看上方错误' }
    } finally { Pop-Location }
} finally {
    if ($null -ne $originalProperties) { [IO.File]::WriteAllBytes($localPropertiesPath, $originalProperties) }
    elseif (Test-Path -LiteralPath $localPropertiesPath) { Remove-Item -LiteralPath $localPropertiesPath }
    $env:JAVA_HOME = $originalJavaHome
    $env:GRADLE_USER_HOME = $originalGradleHome
    if ($mappedDrive) { & subst.exe $mappedDrive /D }
}
