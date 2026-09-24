# Shadowing English V2 — Day 2 decision delta (2026-09-23)

## Source of truth
`docs/APPROVED_RULES.md` v1.5 is derived from the user-provided **verified v1.4** copy, NOT the older v1.3 embedded in the latest uploaded code ZIP. Replace the old file with the supplied v1.5 only after comparing local changes; never overwrite newer edits blindly.

## Approved decisions
- Feature-first vertical slices across relevant roles, not role-by-role implementation.
- One protected Primary Admin (Khaled) per independent deployment, within existing Admin role.
- Primary Admin may add/remove ordinary Admins; ordinary Admins may add other ordinary Admins but may not remove/disable/demote the Primary Admin; removal of ordinary Admins is reserved to Primary Admin.
- Shared Admin dashboard and simple admin-management entry; no new overarching SaaS dashboard or tenant architecture.
- Five-day plan unchanged. No new SaaS, Organizations, TenantId, automatic account provisioning, or ownership-transfer feature.

## Implementation state
**NOT IMPLEMENTED / NOT TESTED.** This package changes documentation only. Day 1 local acceptance evidence remains 15 PASS + summary, as recorded in the prior handoff; this update does not rerun tests or change runtime code.

## Day 2 dependency
Review the actual current ZIP tree, routes, API, models, migrations and progress document before any code changes. Implement the minimum secure admin-account management only within an approved slice; use backend authorization and diagnostics. Preserve Day 1 Auth behavior and do not apply migrations/provisioning without explicit review.

## Package scope
- `docs/APPROVED_RULES.md` — v1.5, approved rules.
- `docs/DAY2_DECISION_DELTA_2026-09-23.md` — documentation of the decision and implementation status.
- No credentials, source-code changes, binaries, or database changes included.
