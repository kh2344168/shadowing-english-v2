# Run from the V2 repository root. All preflight checks complete before writes.
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$payload = Join-Path $PSScriptRoot 'payload'
$baseline = Join-Path $PSScriptRoot 'baseline'
$replace = @(
    'backend/ShadowingEnglish.Api/Program.cs',
    'backend/ShadowingEnglish.Api/Modules/Auth/AuthEndpoints.cs',
    'frontend/src/app/app.routes.ts'
)
$new = @(
    'backend/ShadowingEnglish.Api/Bootstrap/LocalAccountProvisioner.cs',
    'frontend/src/app/core/auth/auth.service.ts',
    'frontend/src/app/core/guards/role.guard.ts',
    'frontend/src/app/features/auth/pages/login/login.page.ts',
    'frontend/src/app/features/auth/pages/logout/logout.page.ts',
    'frontend/src/app/features/admin/dashboard/admin-dashboard.page.ts'
)
$student = Join-Path $root 'frontend/src/app/features/student/dashboard/student-dashboard.page.html'
$appConfig = Join-Path $root 'frontend/src/app/app.config.ts'
$devSettings = Join-Path $root 'backend/ShadowingEnglish.Api/appsettings.Development.json'
$normalize = { param([string]$s) (($s -replace "`r`n", "`n") -replace "`r", "`n").Trim() }

foreach ($relative in ($replace + $new)) {
    $src = Join-Path $payload $relative
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "[Day1.Fail] Payload missing: $relative" }
}
foreach ($relative in $replace) {
    $file = Join-Path $root $relative
    $old = Join-Path $baseline $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or -not (Test-Path -LiteralPath $old -PathType Leaf)) {
        throw "[Day1.Fail] Required baseline or file missing: $relative. No changes made."
    }
    if ((& $normalize (Get-Content -LiteralPath $file -Raw)) -cne
        (& $normalize (Get-Content -LiteralPath $old -Raw))) {
        throw "[Day1.Fail] $relative differs from reviewed version. No changes made. Share current file for safe integration."
    }
}
foreach ($relative in $new) {
    if (Test-Path -LiteralPath (Join-Path $root $relative)) {
        throw "[Day1.Fail] New target already exists: $relative. No changes made."
    }
}
foreach ($file in @($student, $appConfig, $devSettings)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "[Day1.Fail] Missing required file: $file" }
}
$appConfigText = Get-Content -LiteralPath $appConfig -Raw
if ($appConfigText -notmatch 'provideHttpClient\s*\(') {
    throw '[Day1.Fail] Frontend app.config.ts must already have provideHttpClient(). No changes made.'
}
$studentText = Get-Content -LiteralPath $student -Raw
if ([regex]::Matches($studentText,'</main>','IgnoreCase').Count -ne 1 -or
    $studentText.Contains('data-day1-auth-link')) {
    throw '[Day1.Fail] Student page has an unexpected main tag or already contains this link. No changes made.'
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'frontend/src/proxy.conf.json'))) {
    throw '[Day1.Fail] Expected Angular API proxy missing. No changes made.'
}
$backupRoot = Join-Path $root 'patches/_backups/day1-finish'
if (Test-Path -LiteralPath $backupRoot) {
    throw '[Day1.Fail] Backup location already exists; do not reapply. No changes made.'
}
Write-Host '[Day1.Start] Reviewed V2 files matched. Backing up three changed files and student HTML.'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($relative in $replace) {
    $target = Join-Path $backupRoot $relative
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $target
}
$studentBackup = Join-Path $backupRoot 'frontend/src/app/features/student/dashboard/student-dashboard.page.html'
New-Item -ItemType Directory -Path (Split-Path $studentBackup -Parent) -Force | Out-Null
Copy-Item -LiteralPath $student -Destination $studentBackup

# Only the reviewed exact files are replaced. Existing dashboard body and app.config are preserved.
foreach ($relative in $new) {
    $target = Join-Path $root $relative
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $payload $relative) -Destination $target
}
foreach ($relative in $replace) {
    Copy-Item -LiteralPath (Join-Path $payload $relative) -Destination (Join-Path $root $relative)
}
$authLink = @'
  <div data-day1-auth-link class="mx-auto max-w-4xl px-4 pb-8 text-right"><a href="/logout" class="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white">Sign out</a></div>
'@
$studentUpdated = [regex]::Replace($studentText, '</main>', "$authLink`r`n</main>", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
Set-Content -LiteralPath $student -Value $studentUpdated -Encoding UTF8
Write-Host '[Day1.Success] Local-only account CLI, role checks, Angular login/logout/guards/admin shell added.'
Write-Host '[Day1.Scope] No migrations, startup seeds, unrelated features, or development SQL settings changed.'
Write-Host '[Day1.Next] Stop the API. Run: npm run build:backend ; npm run build:frontend'
Write-Host '[Day1.Note] Build and browser integration still need to be tested on your machine.'
