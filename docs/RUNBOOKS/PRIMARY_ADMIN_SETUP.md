# Primary Admin — local setup and acceptance (V2)

**Scope:** One protected Khaled account per independent deployment, not SaaS. This patch creates no new Role, database table or EF migration. Never provision or migrate automatically to activate it.

## Setup on Windows / PowerShell

1. Keep your existing local `appsettings.Development.json` in its location. It is excluded from the sanitized delivery because it may contain a local connection string. Do not publish it or commit it.
2. Start your **existing** API/Angular normally and sign in with the **existing** Admin account. In browser DevTools, inspect the JSON response of `GET /api/auth/session` and copy **your own** `userId` (GUID). Do not send the session cookie, XSRF token, or password to anybody.
3. Stop the API. In the **same PowerShell session** that will start the API, enter:

   ```powershell
   $env:PrimaryAdmin__UserId = '<paste your existing Admin userId GUID here>'
   npm run dev:api
   ```

   Replace the placeholder with the actual existing Admin `userId`. This is per-process configuration, not a secret or an automatic database write. For each independent deployment, configure that deployment's own owner GUID securely in its hosting environment.
4. In another terminal run `npm run dev:frontend`, sign in, then visit `http://localhost:4200/admin/accounts` or use the Admin Dashboard link.
5. If the page returns `primary_admin_not_configured`, verify the GUID and that it belongs to an existing Admin user. The API intentionally refuses account-management mutations while the owner is invalid or missing.

## Accepted actions

- Khaled/owner: GET `/api/admin/accounts/me` reports true; GET `/api/admin/accounts` lists Admin accounts; POST `/api/admin/accounts` creates an ordinary Admin; DELETE `/api/admin/accounts/{id}` **removes Admin role only** for an ordinary Admin.
- Ordinary Admin: GET `/me` reports false; POST creates ordinary Admin; GET list and DELETE return 403. Owner cannot be deleted/demoted by these endpoints (409 with `primary_admin_protected` even from the owner account).
- Student/anonymous: access forbidden (403 or 401). POST/DELETE require CSRF and reject missing/invalid token (400). Duplicate email returns 409. Missing/invalid owner config returns 503; creation rate limit 5 per 15 minutes per user.
- POST creates `EmailConfirmed=false`, with an operator-chosen password meeting Identity rules. This quick implementation **does not send invitations or password-reset email**. Exchange initial credentials securely; before public deployment implement a production-grade invitation/reset flow and confirm the account's email ownership.

## Validation required on the user's machine (not yet completed here)

Run `npm run build:backend` and `npm run build:frontend`; then use two actual Admin accounts and one Student in a disposable LOCAL database to verify all cases above. Re-run the existing Day1 `verify-auth.ps1` checks. Inspect runtime logs `Admin.Accounts.*` (IDs/outcomes/duration; never secrets). Check that repeated GETs do not create/update business records and that removing an Admin leaves their user row/history intact.

This delivery did **not** execute SQL migrations, provision users, modify the user's local database, or test against the user's actual browser/SQL Server.
