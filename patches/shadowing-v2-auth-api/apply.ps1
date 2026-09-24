# Run from the V2 repository root. This script changes only Program.cs and adds AuthEndpoints.cs.
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$relativeProgram = 'backend/ShadowingEnglish.Api/Program.cs'
$relativeAuth = 'backend/ShadowingEnglish.Api/Modules/Auth/AuthEndpoints.cs'
$program = Join-Path $root $relativeProgram
$auth = Join-Path $root $relativeAuth
$expected = Join-Path $PSScriptRoot "baseline/$relativeProgram"
$payload = Join-Path $PSScriptRoot 'payload'

foreach ($p in @($program, $expected, (Join-Path $payload $relativeProgram), (Join-Path $payload $relativeAuth))) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "[AuthApi.Fail] Missing required file: $p. No changes made." }
}
if (Test-Path -LiteralPath $auth) { throw "[AuthApi.Fail] AuthEndpoints.cs already exists. No changes made." }
$backup = "$program.before-auth-api.bak"
if (Test-Path -LiteralPath $backup) { throw "[AuthApi.Fail] Program.cs backup already exists. No changes made." }
$normalize = { param([string]$s) (($s -replace "`r`n", "`n") -replace "`r", "`n").Trim() }
$actual = Get-Content -LiteralPath $program -Raw
$baseline = Get-Content -LiteralPath $expected -Raw
if ((& $normalize $actual) -cne (& $normalize $baseline)) {
    throw '[AuthApi.Fail] Current Program.cs differs from the exact file reviewed. No changes made. Send the current Program.cs for a safe update.'
}
Write-Host '[AuthApi.Start] File checks passed. Applying scoped Auth API patch.'
Copy-Item -LiteralPath $program -Destination $backup
Copy-Item -LiteralPath (Join-Path $payload $relativeAuth) -Destination $auth
Copy-Item -LiteralPath (Join-Path $payload $relativeProgram) -Destination $program
Write-Host '[AuthApi.Success] Program.cs updated; AuthEndpoints.cs added; backup saved.'
Write-Host '[AuthApi.Next] Stop running API, then execute: npm run build:backend'
Write-Host '[AuthApi.Note] No database changes, migration, account creation, or Angular changes.'
