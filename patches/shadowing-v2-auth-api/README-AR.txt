SHADOWING ENGLISH V2 | Auth API Step 2

This is an incremental patch for the exact Program.cs supplied in the conversation after Identity Database Step 1.

Files changed in your repository:
  - backend/ShadowingEnglish.Api/Program.cs (a backup is made first)
  + backend/ShadowingEnglish.Api/Modules/Auth/AuthEndpoints.cs

Provides:
  GET  /api/auth/csrf     - Set Angular-readable XSRF-TOKEN and protected antiforgery cookie.
  POST /api/auth/login    - Identity password check, account lockout, cookie sign-in; requires X-XSRF-TOKEN.
  GET  /api/auth/session  - Check whether cookie session is authenticated.
  POST /api/auth/logout   - Authenticated, anti-CSRF validated cookie sign-out.

How to apply:
  1. Stop the API (Ctrl+C). Keep the original ZIP anywhere, but copy it into V2 repository root.
  2. Expand-Archive -LiteralPath .\shadowing-v2-auth-api-step2.zip -DestinationPath .\patches
  3. Test-Path .\patches\shadowing-v2-auth-api\apply.ps1
  4. & .\patches\shadowing-v2-auth-api\apply.ps1
  5. npm run build:backend
  6. npm run dev:api
  7. In another terminal (with Angular dev proxy running), request:
     Invoke-RestMethod http://localhost:4200/api/auth/session
     Expected before provisioning accounts: authenticated=false.

Security notes:
  - The authentication cookie is HttpOnly; XSRF-TOKEN is intentionally readable by Angular.
  - Refresh GET /api/auth/csrf after login/logout; antiforgery tokens can change with user identity.
  - No open registration route, no initial accounts, no roles seeded at startup.
  - Production requires HTTPS; reverse-proxy/header and deployment configuration are separate work.
  - Keep this script and ZIP out of production deployment artifacts.

The archive was statically inspected, but dotnet SDK is not available in the packaging environment.
The actual compilation and runtime integration must be confirmed on your Windows machine.
