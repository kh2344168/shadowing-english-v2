# Local HTTP integration checks, after provisioning two test accounts and starting API.
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5017'
function Read-Private([string]$label) {
  $secure = Read-Host $label -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Status([scriptblock]$call) {
  try { $response = & $call; return [int]$response.StatusCode }
  catch {
    if ($_.Exception.Response -ne $null) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}
function New-CookieSession {
  return [Microsoft.PowerShell.Commands.WebRequestSession]::new()
}
function Refresh-Crf($session) {
  $response = Invoke-WebRequest -Uri "$base/api/auth/csrf" -WebSession $session -UseBasicParsing -ErrorAction Stop
  if ([int]$response.StatusCode -ne 204) { throw 'CSRF endpoint did not return 204' }
  $cookies = $session.Cookies.GetCookies([uri]$base)
  $token = @($cookies | Where-Object { $_.Name -eq 'XSRF-TOKEN' } | Select-Object -Last 1)
  if ($token.Count -ne 1 -or [string]::IsNullOrWhiteSpace($token[0].Value)) { throw 'Missing XSRF-TOKEN cookie' }
  return @{ 'X-XSRF-TOKEN' = $token[0].Value }
}
function Assert-Code([string]$name, [int]$got, [int]$want) {
  if ($got -ne $want) { throw "$name FAIL: actual=$got expected=$want" }
  Write-Host "[PASS] $name HTTP $got"
}
function Assert-Session([string]$name, $session, [bool]$expect, [string]$role) {
  $value = Invoke-RestMethod -Uri "$base/api/auth/session" -WebSession $session -ErrorAction Stop
  if ($value.authenticated -ne $expect -or ($expect -and $value.roles -notcontains $role)) {
    throw "$name FAIL: unexpected session result"
  }
  Write-Host "[PASS] $name authenticated=$expect"
}
function Login-Role([string]$role, [string]$email, [string]$password) {
  $session = New-CookieSession
  $headers = Refresh-Crf $session
  $body = @{ email = $email; password = $password } | ConvertTo-Json -Compress
  $code = Status { Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -WebSession $session -Headers $headers -ContentType 'application/json' -Body $body -UseBasicParsing -ErrorAction Stop }
  Assert-Code "$role login" $code 200
  Assert-Session "$role session" $session $true $role
  $allowed = $role.ToLowerInvariant()
  $disallowed = if ($role -eq 'Admin') { 'student' } else { 'admin' }
  Assert-Code "$role allowed route" (Status { Invoke-WebRequest -Uri "$base/api/auth/check/$allowed" -WebSession $session -UseBasicParsing -ErrorAction Stop }) 200
  Assert-Code "$role forbidden route" (Status { Invoke-WebRequest -Uri "$base/api/auth/check/$disallowed" -WebSession $session -UseBasicParsing -ErrorAction Stop }) 403
  $headers = Refresh-Crf $session
  Assert-Code "$role logout" (Status { Invoke-WebRequest -Uri "$base/api/auth/logout" -WebSession $session -Headers $headers -ContentType 'application/json' -Method POST -Body '{}' -UseBasicParsing -ErrorAction Stop }) 204
  Assert-Session "$role after logout" $session $false $role
}
Write-Host 'Local verification only. Never paste passwords into the chat.'
$anonymous = New-CookieSession
Assert-Session 'anonymous' $anonymous $false ''
Assert-Code 'anonymous admin forbidden' (Status { Invoke-WebRequest -Uri "$base/api/auth/check/admin" -WebSession $anonymous -UseBasicParsing -ErrorAction Stop }) 401
$noCsrfBody = '{"email":"nobody@example.invalid","password":"NoRealPassword123!"}'
Assert-Code 'login without CSRF' (Status { Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -WebSession $anonymous -ContentType 'application/json' -Body $noCsrfBody -UseBasicParsing -ErrorAction Stop }) 400
$adminEmail = Read-Host 'Admin email'
$adminPassword = Read-Private 'Admin password'
$studentEmail = Read-Host 'Student email'
$studentPassword = Read-Private 'Student password'
Login-Role 'Admin' $adminEmail $adminPassword
Login-Role 'Student' $studentEmail $studentPassword
Write-Host '[PASS] Day1 Auth HTTP checks completed.'
