$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installer = Join-Path $root 'infrastructure\scripts\local-processor\Install.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installer,
    [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw "Install.ps1 has $($errors.Count) syntax errors." }
$function = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Protect-ProcessorPath' }, $true)
if ($null -eq $function) { throw 'Protect-ProcessorPath is missing.' }
Invoke-Expression $function.Extent.Text

$probe = Join-Path $root ('.local\processor-acl-probe-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $probe -ErrorAction Stop | Out-Null
$link = Join-Path $probe 'shadowing-link.json'
Set-Content -LiteralPath $link -Value 'test-only-no-secret' -Encoding ASCII

# Make the harmless fixture overly broad, then verify the installer removes that access.
$everyone = [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::WorldSid, $null)
$acl = Get-Acl -LiteralPath $probe
$inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
    $everyone, [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
    $inheritance, [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $probe -AclObject $acl

Protect-ProcessorPath -Path $probe -IsDirectory $true
Protect-ProcessorPath -Path $link -IsDirectory $false
$replacement = Join-Path $probe 'new-settings.tmp'
Set-Content -LiteralPath $replacement -Value 'test-only-no-secret' -Encoding ASCII
$allowed = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
    'S-1-5-18',
    'S-1-5-32-544'
)
foreach ($path in @($probe, $link, $replacement)) {
    $actual = Get-Acl -LiteralPath $path
    $unwanted = @($actual.Access | Where-Object {
        $_.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]).Value -notin $allowed
    })
    if ($unwanted.Count -gt 0) { throw "Broad access remains on $path." }
}
if (-not (Get-Acl -LiteralPath $link).AreAccessRulesProtected) {
    throw 'The installed link would still inherit permissions.'
}
Write-Output 'PASS Processor directory, link and replacement file allow only user, SYSTEM and Administrators.'
Write-Output "Test fixture retained: $probe"
