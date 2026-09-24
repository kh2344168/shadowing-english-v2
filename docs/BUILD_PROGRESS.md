# Shadowing English V2 — Build Progress

**Updated:** 2026-09-23  | **Plan:** 5 days, unchanged  | **Source:** Latest uploaded code ZIP + approved rules v1.5 + Day1 local acceptance handoff.

## Verified BEFORE this patch (on Khaled's Windows environment)
- ✅ Day1 functional foundation, .NET/Angular/Identity/CSRF/login/logout; reported local auth suite **15 PASS + PASS summary**.
- ✅ Existing `20260923074328_InitialIdentity` migration reported applied to LOCAL V2 SQL database. No new migration is introduced in this patch.
- ⚠️ These results are prior handoff evidence, not tests rerun in this environment. CI, production readiness and broad security audit remain unverified.

## Pre-Day2 Primary Admin feature (this delivery)
- 🟡 Backend source: protected existing owner GUID from `PrimaryAdmin:UserId`; fail closed if absent/invalid; owner and ordinary Admin role checks against SQL; CSRF on writes; transactional create and role revoke; throttled creation; audit-style structured diagnostic logs.
- 🟡 Angular source: one lazy `/admin/accounts` page; ordinary Admin add form; owner add/list/revoke; 2-step revoke confirmation; owner blocked from self-revocation.
- ✅ Structural source checks: 4/4 PASS via `node --test tests/security/admin-accounts.static.test.mjs`.
- ⛔ Real Backend compilation/SQL/API/browser tests not performed here (.NET SDK unavailable). Frontend build also not performed (npm dependency installation failed in this environment). Do not mark the feature DONE yet.
- ⬜ Local configuration `PrimaryAdmin__UserId` requires the owner to enter their **existing** Admin userId in their API process environment. No accounts or migrations were created or run automatically.
- ⏳ Public release requires secure administrator invitation/password setup, email verification, integration tests, dependency/secret scans, and deployment review.

## Day2 main scope (NOT STARTED)
- Admin minimal content/group/publishing flow → Student Dashboard/Curriculum/Overview/Shadowing/Basic Progress as integrated feature slices. No full SaaS, tenant architecture, or unrelated role modules.
- Progress data and lesson publishing must remain Backend source of truth; no hidden writes or fake student progress.

## Supporting documents
- `docs/APPROVED_RULES.md` v1.5 (approved product decisions)
- `docs/RUNBOOKS/PRIMARY_ADMIN_SETUP.md` (how to activate/test this patch)
- `docs/CHANGELOG.md` (changed files and behavior)
- `docs/PROJECT_MAP.md` (new endpoints/components)
- `docs/BUILD_PROGRESS_PRE_DAY2_2026-09-22.md` (older tracker preserved for history; **not current status**)

### Primary Admin — visibility correction (2026-09-23)
- 🟡 Code updated: all Admins can list Admin accounts; only Primary Admin can remove Admin role.
- ✅ Structural Node security test passed locally in delivered source.
- ⬜ Windows/.NET build + live browser verification still required before marking DONE.
