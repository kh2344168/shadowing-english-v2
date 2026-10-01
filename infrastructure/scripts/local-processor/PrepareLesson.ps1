$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Run Install.cmd first.' }
Write-Host 'Start the Local Processor from Start Menu first. This prepares a ZIP locally when browser linking is unavailable.'
$media = New-Object System.Windows.Forms.OpenFileDialog
$media.Title = 'Choose the teacher audio or video (up to 100 MB and 10 minutes)'
$media.Filter = 'Audio or video|*.wav;*.mp3;*.m4a;*.mp4;*.ogg;*.webm'
if ($media.ShowDialog() -ne 'OK') { exit 0 }
$script = New-Object System.Windows.Forms.OpenFileDialog
$script.Title = 'Choose UTF-8 English script: one training clip per line (up to 20)'
$script.Filter = 'English script|*.txt'
if ($script.ShowDialog() -ne 'OK') { exit 0 }
$title = [Microsoft.VisualBasic.Interaction]::InputBox('Lesson title (2 to 160 characters)', 'Shadowing V2')
if ([string]::IsNullOrWhiteSpace($title)) { exit 0 }
$output = New-Object System.Windows.Forms.SaveFileDialog
$output.Title = 'Save the lesson result for review and import'
$output.Filter = 'Lesson result|*.zip'
$output.FileName = 'Shadowing-Lesson-Result.zip'
if ($output.ShowDialog() -ne 'OK') { exit 0 }
& $python (Join-Path $PSScriptRoot 'prepare.py') --root $PSScriptRoot --source $media.FileName --script $script.FileName --title $title --output $output.FileName
exit $LASTEXITCODE
