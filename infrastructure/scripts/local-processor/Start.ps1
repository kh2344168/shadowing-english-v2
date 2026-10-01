$ErrorActionPreference = 'Stop'
$processorRoot = $PSScriptRoot
$env:HF_HOME = Join-Path $processorRoot 'models\huggingface'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$python = Join-Path $processorRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Run Install.cmd first.' }
Write-Host 'Shadowing V2 processor is local to this computer. Close this window to stop it.'
& $python (Join-Path $processorRoot 'server.py') --root $processorRoot
exit $LASTEXITCODE
