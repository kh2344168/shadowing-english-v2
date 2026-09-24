# Changelog — Shadowing English V2

## 2026-09-23 — Pre-Day2 protected Primary Admin implementation (source patch)

**Approved product scope:** one existing Khaled Admin as protected Primary Admin per independent deployment. Ordinary Admins may add new Admins; owner can add/revoke ordinary Admin roles; owner cannot be removed through the application. No SaaS/multi-tenancy/owner-transfer.

**Source changes:**
- `backend/ShadowingEnglish.Api/Modules/Admin/AdminAccountsEndpoints.cs` NEW — authenticated Admin management endpoints; config-based verified owner UserId; CSRF; account-creation transaction; role-revocation transaction; structured diagnostics.
- `backend/ShadowingEnglish.Api/Program.cs` — registers endpoint and built-in per-user rate limiter; no changes to existing login contracts.
- `frontend/src/app/features/admin/accounts/*` NEW — Angular API + page, HTML/SCSS; owner-only list/revoke, common create.
- `frontend/src/app/app.routes.ts`, `features/admin/dashboard/admin-dashboard.page.ts` — lazy route + navigation.
- `.gitignore` — excludes local environment appsettings files from future accidental staging (tracked secrets must be handled separately).
- `tests/security/admin-accounts.static.test.mjs` NEW — structural source checks only.

**Documentation:** replace older embedded rules with separately approved v1.5, preserve historical tracker, update current progress, project map and setup runbook.

**Tests here:** 4/4 structural checks pass; no .NET SDK; npm install unavailable; actual builds/runtime/SQL pending Windows verification.

**Important:** No EF schema change, no migration or seed; do not infer that source changes have already modified the user's local project or DB.

## 2026-09-23 — Admin visibility correction
- جميع مستخدمي Role `Admin` يمكنهم الآن رؤية قائمة الأدمنز.
- جميع الأدمنز يظلون قادرين على إضافة Admin جديد.
- سحب صلاحية Admin يظل محصورًا في الـPrimary Admin على مستوى Backend والواجهة.
- حساب الـPrimary Admin يظل محميًا من سحب صلاحية Admin.
- لا Migration ولا تغيير Database schema.
