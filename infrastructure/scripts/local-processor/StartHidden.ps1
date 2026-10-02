$ErrorActionPreference = 'Stop'
$processorRoot = $PSScriptRoot
$env:HF_HOME = Join-Path $processorRoot 'models\huggingface'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$python = Join-Path $processorRoot '.venv\Scripts\python.exe'
$server = Join-Path $processorRoot 'server.py'
$logs = Join-Path $processorRoot 'logs'
$watchdogLog = Join-Path $logs 'local-processor-background.log'
$stdoutLog = Join-Path $logs 'local-processor-stdout.log'
$port = 43127
$mutexName = 'Local\ShadowingEnglishV2.LocalProcessor.Watchdog'

New-Item -ItemType Directory -Force $logs | Out-Null

function Write-BackgroundEvent {
    param(
        [string]$Name,
        [string]$Details = ''
    )

    $line = "[$(Get-Date -Format o)] [LocalProcessor.Background.$Name]"
    if ($Details) { $line += " $Details" }
    try {
        Add-Content -LiteralPath $watchdogLog -Value $line -ErrorAction Stop
    }
    catch {
        # Logging errors must not prevent the local processor from starting.
    }
}

function Test-ProcessorListening {
    try {
        $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction Stop)
        return $listeners.Count -gt 0
    }
    catch {
        return $false
    }
}

$watchdogMutex = $null
$ownsWatchdogMutex = $false
try {
    $watchdogMutex = [System.Threading.Mutex]::new($false, $mutexName)
    try {
        $ownsWatchdogMutex = $watchdogMutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        # The previous watchdog ended unexpectedly; this process now owns the mutex.
        $ownsWatchdogMutex = $true
    }

    if (-not $ownsWatchdogMutex) {
        Write-BackgroundEvent 'AlreadyRunning' "Port=$port Reason=WatchdogExists"
        return
    }

    if (Test-ProcessorListening) {
        Write-BackgroundEvent 'AlreadyRunning' "Port=$port Reason=ListenerExists"
        return
    }

    if (-not (Test-Path -LiteralPath $python)) {
        Write-BackgroundEvent 'Process.Failed' 'ErrorType=PythonMissing'
        return
    }
    if (-not (Test-Path -LiteralPath $server)) {
        Write-BackgroundEvent 'Process.Failed' 'ErrorType=ServerMissing'
        return
    }

    Write-BackgroundEvent 'Watchdog.Start' "Port=$port"
    while ($true) {
        $processStartedAt = Get-Date
        try {
            Write-BackgroundEvent 'Process.Start' "Port=$port"
            & $python $server --root $processorRoot 1>> $stdoutLog 2>$null
            $exitCode = $LASTEXITCODE
            $durationMs = [int]((Get-Date) - $processStartedAt).TotalMilliseconds
            Write-BackgroundEvent 'Process.Exit' "ExitCode=$exitCode DurationMs=$durationMs"
            if ($exitCode -ne 0) {
                Write-BackgroundEvent 'Process.Failed' "ErrorType=ProcessExit ExitCode=$exitCode DurationMs=$durationMs"
            }
        }
        catch {
            $durationMs = [int]((Get-Date) - $processStartedAt).TotalMilliseconds
            $errorType = $_.Exception.GetType().Name
            Write-BackgroundEvent 'Process.Failed' "ErrorType=$errorType DurationMs=$durationMs"
        }

        if (Test-ProcessorListening) {
            Write-BackgroundEvent 'AlreadyRunning' "Port=$port Reason=ListenerAppeared"
            break
        }

        Start-Sleep -Seconds 5
    }
}
finally {
    if ($ownsWatchdogMutex -and $watchdogMutex) {
        try { $watchdogMutex.ReleaseMutex() } catch { }
    }
    if ($watchdogMutex) { $watchdogMutex.Dispose() }
}
