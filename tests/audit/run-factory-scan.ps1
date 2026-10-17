param([string]$JavaHome)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if(!$JavaHome){$JavaHome=Join-Path $taskRoot '.cache/toolchain/jdk/jdk-17.0.20.1+1'}
if(!(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))){throw '请通过-JavaHome指定JDK17目录'}
$taskOutput=Join-Path $taskRoot '.tmp/factory-scan-20261017'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskClasses=Join-Path $taskOutput 'classes'
New-Item -ItemType Directory -Path $taskClasses -Force | Out-Null
$taskJarNames=@('junit-4.13.2.jar','hamcrest-core-1.3.jar','json-20240303.jar','sqlite-jdbc-3.46.1.0.jar','slf4j-api-2.0.13.jar','slf4j-nop-2.0.13.jar')
$taskCache=Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1'
$taskJars=@(Get-ChildItem -LiteralPath $taskCache -Recurse -File | Where-Object {$_.Name -in $taskJarNames})
foreach($taskName in $taskJarNames){if(!($taskJars.Name -contains $taskName)){throw ('本机Gradle缓存缺少依赖：'+$taskName)}}
$taskCp=($taskJars.FullName -join ';')
$taskSources=@(Get-ChildItem (Join-Path $taskRoot 'regcode-production/collection-core/src/main/java'),(Join-Path $taskRoot 'regcode-production/collection-core/src/test/java') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
$taskSources+=(Join-Path $PSScriptRoot 'FactoryScanRiskTest.java')
& (Join-Path $JavaHome 'bin/javac.exe') -encoding UTF-8 -cp $taskCp -d $taskClasses @taskSources
if($LASTEXITCODE -ne 0){throw 'JVM测试编译失败'}
$taskRuntimeCp=$taskClasses+';'+$taskCp
$taskTests=@(Get-ChildItem (Join-Path $taskRoot 'regcode-production/collection-core/src/test/java') -Recurse -Filter '*Test.java' | ForEach-Object {'com.regcode.collection.'+$_.BaseName})
$taskTests+='com.regcode.collection.FactoryScanRiskTest'
& (Join-Path $JavaHome 'bin/java.exe') '-Dfile.encoding=UTF-8' "-Dtest.runtime.classpath=$taskRuntimeCp" -cp $taskRuntimeCp org.junit.runner.JUnitCore @taskTests
if($LASTEXITCODE -ne 0){throw 'JVM风险测试失败'}
Push-Location $taskRoot
try{
 & node --test --test-isolation=none (Join-Path $PSScriptRoot 'factory-scan-risk.test.mjs')
 if($LASTEXITCODE -ne 0){throw '服务器风险测试失败'}
}finally{Pop-Location}
