$ErrorActionPreference = 'Stop'
$processorRoot = $PSScriptRoot
$env:HF_HOME = Join-Path $processorRoot 'models\huggingface'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$python = Join-Path $processorRoot '.venv\Scripts\python.exe'
$server = Join-Path $processorRoot 'server.py'
$logs = Join-Path $processorRoot 'logs'
$logFile = Join-Path $logs 'local-processor-background.log'
$port = 43127

if (-not (Test-Path $python)) { exit 2 }
if (-not (Test-Path $server)) { exit 3 }
New-Item -ItemType Directory -Force $logs | Out-Null

function Test-ProcessorListening {
    return [bool](Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (Test-ProcessorListening) {
    Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] [LocalProcessor.Background.AlreadyRunning] Port=$port"
    exit 0
}

Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] [LocalProcessor.Background.Watchdog.Start] Port=$port"
while ($true) {
    try {
        Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] [LocalProcessor.Background.Process.Start]"
        & $python $server --root $processorRoot 1>> $logFile 2>> $logFile
        $exitCode = $LASTEXITCODE
        Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] [LocalProcessor.Background.Process.Exit] ExitCode=$exitCode"
    }
    catch {
        Add-Content -Path $logFile -Value "[$(Get-Date -Format o)] [LocalProcessor.Background.Process.Failed] ErrorType=$($_.Exception.GetType().Name)"
    }
    Start-Sleep -Seconds 5
}
