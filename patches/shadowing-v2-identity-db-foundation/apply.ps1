# Execute from the repository root: .\<extracted-folder>\apply.ps1
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$api = Join-Path $root 'backend/ShadowingEnglish.Api/Program.cs'
$infra = Join-Path $root 'backend/ShadowingEnglish.Infrastructure/ShadowingEnglish.Infrastructure.csproj'
$devSettings = Join-Path $root 'backend/ShadowingEnglish.Api/appsettings.Development.json'
$payload = Join-Path $PSScriptRoot 'payload'

foreach ($required in @($api, $infra, $devSettings)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required project file not found: $required. Nothing was changed."
    }
}

$original = Get-Content -LiteralPath $api -Raw
$expected = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'baseline/backend/ShadowingEnglish.Api/Program.cs') -Raw
$normalize = { param($value) (($value -replace "`r`n", "`n") -replace "`r", "`n").Trim() }
if ((& $normalize $original) -cne (& $normalize $expected)) {
    throw 'Program.cs is not the exact inspected V2 Foundation file. No changes made. Send its contents for a safe patch.'
}

try {
    $settings = Get-Content -LiteralPath $devSettings -Raw | ConvertFrom-Json
} catch {
    throw 'appsettings.Development.json is not valid JSON. No files changed.'
}
if ([string]::IsNullOrWhiteSpace($settings.ConnectionStrings.DefaultConnection)) {
    throw 'ConnectionStrings:DefaultConnection is missing. No files changed.'
}

$newFiles = @(
    'backend/ShadowingEnglish.Infrastructure/Identity/ApplicationUser.cs',
    'backend/ShadowingEnglish.Infrastructure/Database/ApplicationDbContext.cs'
)
foreach ($relative in $newFiles) {
    if (Test-Path -LiteralPath (Join-Path $root $relative)) {
        throw "New file already exists: $relative. No files changed."
    }
}

Write-Host '[IdentityDb.Start] Validated existing V2 files; no DB writes or migrations.'
$backup = "$api.before-identity-db.bak"
if (Test-Path -LiteralPath $backup) { throw "Backup already exists: $backup. Stop to avoid overwriting it." }
$packageFound = (Get-Content -LiteralPath $infra -Raw).Contains('Microsoft.AspNetCore.Identity.EntityFrameworkCore')
if (-not $packageFound) {
    & dotnet add $infra package Microsoft.AspNetCore.Identity.EntityFrameworkCore --version 10.0.10
    if ($LASTEXITCODE -ne 0) { throw '[IdentityDb.Fail] NuGet package installation failed. No C# files copied.' }
}

Copy-Item -LiteralPath $api -Destination $backup
foreach ($relative in $newFiles) {
    $destination = Join-Path $root $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
    Copy-Item -LiteralPath (Join-Path $payload $relative) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $payload 'backend/ShadowingEnglish.Api/Program.cs') -Destination $api
Write-Host '[IdentityDb.Result] 2 new C# files; Program.cs updated with backup; Identity EF package present.'
Write-Host '[IdentityDb.Next] Stop running API, then: npm run build:backend'
Write-Host '[IdentityDb.Note] No database, users, or roles have been created by this script.'
