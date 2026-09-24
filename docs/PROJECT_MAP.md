# Current code map — primary admin slice / 2026-09-23

## Foundation preserved
- `AuthEndpoints` retains existing `/api/auth/csrf`, `/login`, `/session`, `/logout`, and role probes. Its API response format was not changed.
- `ApplicationUser`, `ApplicationDbContext` and the existing `InitialIdentity` migration were not modified.
- SQL Identity Admin role remains the only administrator Role; protected ownership is **not** a fifth role.

## New / changed
| Code | Purpose |
|---|---|
| `Api/Modules/Admin/AdminAccountsEndpoints.cs` | `/api/admin/accounts/me` (owner flag); GET `/api/admin/accounts` (owner only); POST `/api/admin/accounts` (any Admin); DELETE `/api/admin/accounts/{id}` (owner only, role revoke). |
| `Api/Program.cs` | Register endpoints, endpoint-specific rate limiter, routing middleware. |
| `frontend/src/app/features/admin/accounts/admin-accounts.api.ts` | API contracts. |
| `frontend/src/app/features/admin/accounts/admin-accounts.page.{ts,html,scss}` | Shared Admin accounts page. |
| `frontend/src/app/app.routes.ts` | Lazy, Admin-guarded route `/admin/accounts`. |
| `features/admin/dashboard/admin-dashboard.page.ts` | Navigation to accounts page. |

**Owner configuration:** `PrimaryAdmin:UserId` via per-deployment environment variable `PrimaryAdmin__UserId`, pointing to the existing Identity Admin GUID. Missing/invalid configuration blocks account administration (503). No login/startup writes.

**Not implemented:** lesson content, curriculum, student feature slices, Teacher/Supervisor features, organization/tenant abstraction, account invite/reset/email verification.
