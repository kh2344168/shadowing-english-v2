# Handoff checkpoint — 2026-09-23 / before Day2 business slices

- Read `docs/APPROVED_RULES.md` v1.5 and `docs/BUILD_PROGRESS.md`. Day1 local auth acceptance was 15 PASS + summary (prior session, not rerun here).
- New source added for Primary Admin and Admin account management. Actual runtime status **PENDING** local builds/API tests. Do not call it production-ready or marked DONE.
- Setup: `docs/RUNBOOKS/PRIMARY_ADMIN_SETUP.md`. The owner is the EXISTING Admin GUID configured explicitly in the API environment; no auto seed, no password disclosure, no new migration.
- Browser path after local setup: `/admin/accounts`. Ordinary Admin can create but cannot list/revoke; owner can list and revoke ordinary Admin role (user is retained).
- Start Day2 main work only after verifying this patch locally; then implement content/publishing and Student Shadowing feature-by-feature. Keep the five-day plan. No SaaS.
- Sanitized code ZIP excludes local `appsettings.Development.json`, compiled bin/obj, npm caches, passwords, and private credential notes. Preserve local config separately when copying files to the Windows project.
