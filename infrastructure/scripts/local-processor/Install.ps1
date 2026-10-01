$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'This installer supports Windows x64. ARM and 32-bit installers are not included in this version.'
}
$processorRoot = Join-Path $env:LOCALAPPDATA 'ShadowingEnglishV2\LocalProcessor'
$linkSource = Join-Path $PSScriptRoot 'shadowing-link.json'
if (-not (Test-Path $linkSource)) { throw 'Download the connected package from your Admin processing page first.' }
$link = Get-Content $linkSource -Raw | ConvertFrom-Json
if ($link.schemaVersion -ne 1 -or $link.protocolVersion -ne 1 -or $link.token -notmatch '^[a-f0-9]{64}$') {
    throw 'The connection file is invalid.'
}
$siteUri = $null
if (-not [Uri]::TryCreate($link.origin, [UriKind]::Absolute, [ref]$siteUri) -or
    $siteUri.UserInfo -or $siteUri.AbsolutePath -ne '/' -or $siteUri.Query -or $siteUri.Fragment -or
    ($siteUri.Scheme -ne 'https' -and -not ($siteUri.Scheme -eq 'http' -and $siteUri.Host -in @('localhost', '127.0.0.1')))) {
    throw 'The website origin in the connection file is invalid.'
}
if (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 43127 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Close the running Local Processor window before installing or updating its connection.'
}
# Loopback-only processor. Register per-user hidden auto-start; no firewall rule or Windows service is required.
New-Item -ItemType Directory -Force $processorRoot | Out-Null
New-Item -ItemType Directory -Force (Join-Path $processorRoot 'models') | Out-Null
$files = @('contracts.py', 'worker.py', 'server.py', 'prepare.py', 'requirements.txt', 'Install.cmd', 'Install.ps1', 'Start.cmd', 'Start.ps1', 'StartHidden.ps1', 'PrepareLesson.cmd', 'PrepareLesson.ps1', 'README_AR.md', 'shadowing-link.json')
foreach ($file in $files) {
    $source = Join-Path $PSScriptRoot $file
    $destination = Join-Path $processorRoot $file
    if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($destination)) { Copy-Item $source $destination -Force }
}

function Refresh-ProcessorPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}
function Install-ProcessorDependency([string]$id, [string]$scope = 'user') {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Install $id from its official website, then run Install.cmd again."
    }
    & winget install --id $id --exact --scope $scope --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed: $id. Run Install.cmd again after installing it." }
    Refresh-ProcessorPath
}

$basePython = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    try { $basePython = & py -3.12 -c 'import sys; print(sys.executable)' 2>$null } catch { $basePython = $null }
}
if (-not $basePython) {
    Install-ProcessorDependency 'Python.Python.3.12'
    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (Test-Path $candidate) { $basePython = $candidate }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { $basePython = & py -3.12 -c 'import sys; print(sys.executable)' }
}
if (-not $basePython -or -not (Test-Path $basePython)) { throw 'Python 3.12 was not found. Install it, then retry Install.cmd.' }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Install-ProcessorDependency 'Gyan.FFmpeg' }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'FFmpeg was installed but is not in PATH. Close this window and run Install.cmd again.' }
if (-not (Test-Path (Join-Path $env:WINDIR 'System32\msvcp140.dll')) -or -not (Test-Path (Join-Path $env:WINDIR 'System32\vcruntime140_1.dll'))) {
    Write-Host 'Preparing the Microsoft Visual C++ runtime required by PyTorch. Windows may request permission.'
    Install-ProcessorDependency 'Microsoft.VCRedist.2015+.x64' 'machine'
}

$venvPython = Join-Path $processorRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    & $basePython -m venv (Join-Path $processorRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the isolated Python environment.' }
}
Write-Host 'Installing the processing engine locally. First setup downloads several GB of dependencies.'
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $processorRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Engine installation failed. Your existing lessons/models are kept; retry Install.cmd.' }
Write-Host 'Preparing the English alignment model. Future runs reuse the model on this computer.'
& $venvPython (Join-Path $processorRoot 'worker.py') --root $processorRoot --models (Join-Path $processorRoot 'models') --warmup
if ($LASTEXITCODE -ne 0) { throw 'Model preparation failed. Check the internet connection and retry Install.cmd.' }

function Save-ProcessorShortcutSafely {
    param(
        [object]$Shell,
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$WorkingDirectory,
        [string]$Name
    )

    $startedAt = Get-Date
    Write-Host "[Installer.Shortcut.Start] Name=$Name"
    try {
        $shortcutDirectory = Split-Path $ShortcutPath -Parent
        if (-not (Test-Path $shortcutDirectory)) {
            New-Item -ItemType Directory -Force $shortcutDirectory | Out-Null
        }

        $shortcut = $Shell.CreateShortcut($ShortcutPath)
        $shortcut.TargetPath = $TargetPath
        $shortcut.WorkingDirectory = $WorkingDirectory
        $shortcut.Save()

        $durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
        Write-Host "[Installer.Shortcut.Success] Name=$Name DurationMs=$durationMs"
    }
    catch {
        $durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
        Write-Warning "[Installer.Shortcut.Skipped] Name=$Name DurationMs=$durationMs ErrorType=$($_.Exception.GetType().Name)"
        Write-Warning 'Shortcut creation is optional. Installation will continue.'
    }
}

$shell = New-Object -ComObject WScript.Shell
$startMenuPrograms = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
Save-ProcessorShortcutSafely -Shell $shell -ShortcutPath (Join-Path $startMenuPrograms 'Shadowing V2 Local Processor.lnk') -TargetPath (Join-Path $processorRoot 'Start.cmd') -WorkingDirectory $processorRoot -Name 'Local Processor'
Save-ProcessorShortcutSafely -Shell $shell -ShortcutPath (Join-Path $startMenuPrograms 'Shadowing V2 Prepare Lesson ZIP.lnk') -TargetPath (Join-Path $processorRoot 'PrepareLesson.cmd') -WorkingDirectory $processorRoot -Name 'Prepare Lesson ZIP'

function Register-ProcessorAutoStart {
    $startedAt = Get-Date
    $runPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $name = 'ShadowingV2LocalProcessor'
    $hiddenScript = Join-Path $processorRoot 'StartHidden.ps1'
    $command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $hiddenScript + '"'
    Write-Host '[Installer.AutoStart.Start] Mode=HKCU-Run'
    try {
        if (-not (Test-Path $runPath)) { New-Item -Path $runPath -Force | Out-Null }
        New-ItemProperty -Path $runPath -Name $name -Value $command -PropertyType String -Force | Out-Null
        $saved = (Get-ItemProperty -Path $runPath -Name $name -ErrorAction Stop).$name
        if ($saved -ne $command) { throw 'Auto-start verification failed.' }
        $durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
        Write-Host "[Installer.AutoStart.Success] Mode=HKCU-Run DurationMs=$durationMs"
    }
    catch {
        $durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
        Write-Warning "[Installer.AutoStart.Failed] DurationMs=$durationMs ErrorType=$($_.Exception.GetType().Name)"
        throw 'Installation completed, but Windows auto-start registration failed.'
    }
}

function Start-ProcessorHiddenAndVerify {
    $startedAt = Get-Date
    $hiddenScript = Join-Path $processorRoot 'StartHidden.ps1'
    Write-Host '[Installer.BackgroundStart.Start] Port=43127'
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $hiddenScript
    ) | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $listening = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 43127 -State Listen -ErrorAction SilentlyContinue
        if ($listening) {
            $durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
            Write-Host "[Installer.BackgroundStart.Success] Port=43127 DurationMs=$durationMs"
            return
        }
    } while ((Get-Date) -lt $deadline)
    $durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
    Write-Warning "[Installer.BackgroundStart.Failed] Port=43127 DurationMs=$durationMs"
    throw 'The AI processor was installed but did not start in the background. Check logs\local-processor-background.log.'
}

Register-ProcessorAutoStart
Start-ProcessorHiddenAndVerify
Write-Host 'Installed and connected. The AI processor will start automatically with Windows in the background.'
Write-Host 'Keep shadowing-link.json private; it is only needed to restore the browser connection after clearing site data.'
Start-Process ($link.origin + '/admin/ai-tools')
