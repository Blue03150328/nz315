param([int]$Port=3101,[switch]$NoBuild)
$ErrorActionPreference='Stop'
if($Port -lt 1024 -or $Port -gt 65535){throw 'Port must be between 1024 and 65535'}
Push-Location $PSScriptRoot
try {
    $taskEnvFile=Join-Path $PSScriptRoot 'docker.env'
    if(!(Test-Path -LiteralPath $taskEnvFile)){
        function New-DockerSecret {
            $taskBytes=New-Object byte[] 32
            $taskRandom=[Security.Cryptography.RandomNumberGenerator]::Create()
            try {$taskRandom.GetBytes($taskBytes)} finally {$taskRandom.Dispose()}
            return 'd'+[BitConverter]::ToString($taskBytes).Replace('-','').ToLowerInvariant()
        }
        $taskLines=@(
            ('DOCKER_APP_PORT='+$Port)
            ('DOCKER_DB_PASSWORD='+(New-DockerSecret))
            ('DOCKER_DB_ROOT_PASSWORD='+(New-DockerSecret))
            ('DOCKER_SESSION_SECRET='+(New-DockerSecret))
            'DOCKER_SEED_DEMO=1'
        )
        [IO.File]::WriteAllLines($taskEnvFile,$taskLines,[Text.UTF8Encoding]::new($false))
        Write-Host 'Created private docker.env for this isolated local deployment.'
    }
    $env:DOCKER_APP_PORT=[string]$Port
    $taskArguments=@('compose','--env-file','docker.env','up','-d','--wait','--wait-timeout','180')
    if(!$NoBuild){$taskArguments+='--build'}
    & docker @taskArguments
    if($LASTEXITCODE -ne 0){throw 'Docker startup failed; inspect docker compose logs.'}
    Write-Host ('Open http://127.0.0.1:'+ $Port +'/login')
} finally {Remove-Item Env:DOCKER_APP_PORT -ErrorAction SilentlyContinue; Pop-Location}
