SHADOWING ENGLISH V2 - DAY 1 FINISH PATCH (local development)
===========================================================
One batch to finish the first-day Auth slice instead of many back-and-forth operations.
Only apply to the V2 repo state after the Identity step1 and Auth API step2.

HOW TO INSTALL (PowerShell from repo root):
1. Stop API with Ctrl+C.
2. Expand-Archive -LiteralPath .\shadowing-v2-day1-finish.zip -DestinationPath .\patches
3. Test-Path .\patches\shadowing-v2-day1-finish\apply.ps1
4. & .\patches\shadowing-v2-day1-finish\apply.ps1
5. npm run build:backend
6. npm run build:frontend

IF APPLY FAILS: Nothing should have been changed (preflight checks). Do not force overwrite.
Backups: patches/_backups/day1-finish/. Do NOT delete DB/migrations.

TO CREATE TWO LOCAL TEST ACCOUNTS (NO HTTP endpoint; CLI only):
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --no-launch-profile --project .\backend\ShadowingEnglish.Api\ShadowingEnglish.Api.csproj -- --provision-local-accounts
Enter separate Admin and Student emails and new dedicated passwords of 10+ characters.
Characters are hidden as typed. An existing email is never overwritten. This is DEV ONLY.
Admin/Student/Teacher/Supervisor role rows are created once; only two user accounts are created.
No account is created on normal API startup.

RUN:
Terminal A: npm run dev:api
Terminal B: npm run dev
Browser: http://localhost:4200/login
Expected: Admin -> /admin/dashboard, Student -> /student/dashboard, Sign out -> /login.

OPTIONAL HTTP INTEGRATION CHECK (after test accounts are created and API running):
& .\patches\shadowing-v2-day1-finish\verify-auth.ps1
This tests CSRF, session, cookie login/logout, and 401/403 role boundaries.

SECURITY: Development SQL TrustServerCertificate setting is unchanged; don't use it in Production.
Do not submit real passwords to ChatGPT or commit them to source control.
Production still needs HTTPS, reliable DataProtection key management, deployment config and end-to-end tests.
NOTE: This package has structural checks only in this environment; final dotnet/Angular builds and
browser tests must be run in your local repo. Do not treat its presence as a passing test.
