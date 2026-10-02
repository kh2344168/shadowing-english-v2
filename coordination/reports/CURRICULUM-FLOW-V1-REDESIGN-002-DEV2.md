# CURRICULUM-FLOW-V1-REDESIGN-002 — DEV 2

TASK ID: CURRICULUM-FLOW-V1-REDESIGN-002
Source: TEAM-LEAD (explicit approved independent Curriculum Draft / Backend / DB scope)
Branch: dev2/CURRICULUM-FLOW-V1-REDESIGN-002
Base Commit: c6e631fe63fe61c5aa3ff5c5f3432f36e53effc1
Base Branch: integration/baseline-2026-10-01
Main reviewed before editing: a9afd9178cc3a85969238ab6fb505ab653a464e5
Commit: the single implementation commit containing this report; resolve with `git log -1 --format=%H -- coordination/reports/CURRICULUM-FLOW-V1-REDESIGN-002-DEV2.md`.

## Current flow found

The authoritative integration base contained a placeholder `/admin/curriculums`, with direct single-lesson publication in Lesson Builder. CurriculumTemplate stored Id/Name only. PublishedCurriculumVersion, PublishedLessonSlot and GroupCurriculumAssignment already represented immutable group-scoped published snapshots. There were no independent persisted draft lesson slots or pending curriculum selection for a group.

The workspace had been cleaned before this implementation. Source was cloned again from the authoritative repository and the integration base above. Earlier local-only artifacts/commits were unavailable; no stale file was reused. AGENTS.md, coordination/WORKBOARD.md and prior coordination reports were absent at this base.

## Implemented / What changed

- Saved Lessons → independent database Curriculum Draft → ordered Week/Day/SortOrder → explicit Save → separate Assign → explicit full Publish.
- CurriculumTemplate now stores draft metadata and a server-generated revision. One new CurriculumDraftLessonSlot entity/table holds independent draft order. StudyGroup stores pending curriculum selection and its revision separately from the existing published pointer.
- Every successful save replaces the draft slots atomically, including indexed position swaps. Name/description/position validation, duplicate lesson/slot protection and saved lesson existence checks are enforced in the backend.
- Assignment changes only the pending curriculum selection. It never changes the version students read.
- Publication checks all audio, then rechecks draft/assignment/publication revisions inside a serializable transaction. It creates one immutable full version with all slots and switches the published pointer atomically. Old versions/slots and existing student progress stay intact. Active progress continues to block silent replacement.
- Creation, last draft save and last assignment keep exact retry receipts. Publish receipts stay with every immutable version and confirm the original request even after a later publication. A stale retry after a subsequent draft/assignment write receives a conflict rather than overwriting newer data.
- No automatic create/save/assign/publish on page load or refresh. No localStorage for draft persistence. The UI stages edits until explicit Save and restores persisted state using GETs.
- Double clicks are blocked before CSRF requests and writes begin. Lost-response retries keep the original request ID and complete request body. Conflict responses require explicit review. A new saved revision starts a new publish attempt. Failed loads do not produce a false empty state.
- The old single-lesson `/publish` write flow is retired for ALL new requests, including groups without a pending assignment. It returns `409 curriculum_publish_required`. Historical successful legacy requests can still be confirmed read-only; they cannot create or change a published pointer.
- Groups keep student assignment/move/history responsibilities. Cards add actual draft/publication status and a curriculum-management link.
- Lessons Library gets only its justified integration link: add the selected saved lesson to a curriculum. Lesson Builder keeps saving/import/audio behavior and replaces its direct publish UI with navigation to the independent curriculum flow.
- Safe diagnostics cover Load/Create/Update/AddLesson/RemoveLesson/ReorderLesson/Assign/Publish. Logs contain validated IDs, count, status/result, duration and safe error type/code; no lesson content/audio, credentials or tokens.

## V1 design reference

Read the supplied V1 HTML sources in project_sources (matching curriculum/group templates across the supplied archives): admin-curriculums, admin-curriculum-details, admin-groups and admin-group-details.

Transferred RTL, 1520px content width, header/toolbar hierarchy, white rounded cards, #00685F primary, #EFF4FF surfaces, spacing, status pills, modal picker, week accordion/day cards, order numbers, and mobile-first layout. The existing V2 shared shell and APIs remain in use.

Unsupported CEFR filters/badges, archive/duplicate/delete, scheduled publishing, supervisor/start-date controls, repetition/required flags and standalone empty named weeks/days are hidden/deferred. No dead button or fake feature was added. Browser screenshot/pixel comparison is NOT VERIFIED because the browser could not launch in this environment.

## DB CHANGED

YES. Additive changes only: one draft slot table, draft metadata/revision/receipt columns, pending assignment/revision/receipt columns and publication source revision/receipt columns. Existing immutable published entities, scoped foreign keys and progress keys remain in use.

## MIGRATION

`20261002101732_AddIndependentCurriculumDraft`

Old migrations are unchanged. The model snapshot and the new migration designer were generated by EF 10.0.10. Legacy rows use nullable/empty/zero-revision defaults; no old published version, slot, membership, assignment pointer or progress row is rewritten. No migration runs at ordinary application startup.

## API CHANGES

All new endpoints are Admin-only. Writes require real CSRF and the existing admin-group-write rate policy. Responses are no-store.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | /api/admin/shadowing/curriculums?page=1 | Paged saved draft summaries and actual counts |
| GET | /api/admin/shadowing/curriculums/{id} | Persisted draft and ordered lesson metadata |
| POST | /api/admin/shadowing/curriculums | Create independent draft: requestId/name/description |
| PUT | /api/admin/shadowing/curriculums/{id} | Save entire draft: requestId/expectedDraftRevision/name/description/lessons |
| GET | /api/admin/shadowing/groups/{groupId}/curriculum | Pending assignment, current draft revision and ordered published slots |
| PUT | /api/admin/shadowing/groups/{groupId}/curriculum-assignment | Assign: requestId/curriculumTemplateId/expectedAssignmentRevision |
| POST | /api/admin/shadowing/curriculums/publish | Publish full snapshot: requestId/groupId/curriculumTemplateId/expectedDraftRevision/expectedAssignmentRevision/expectedVersionId |
| POST | /api/admin/shadowing/publish | Retired for new writes; read-only historical receipt confirmation |
| GET | /api/admin/groups | Existing paged group DTO gains actual curriculum assignment/publication status |

Read lists contain metadata only, no audio bytes. Student API/UI contracts are unchanged.

## Changed files

- `backend/ShadowingEnglish.Api/Modules/Curriculums/AdminCurriculumsEndpoints.cs`
- `backend/ShadowingEnglish.Api/Modules/Groups/AdminGroupsEndpoints.cs`
- `backend/ShadowingEnglish.Api/Modules/Lessons/AdminShadowingEndpoints.cs`
- `backend/ShadowingEnglish.Core/Groups/StudyGroup.cs`
- `backend/ShadowingEnglish.Core/Learning/CurriculumDraftLessonSlot.cs`
- `backend/ShadowingEnglish.Core/Learning/CurriculumTemplate.cs`
- `backend/ShadowingEnglish.Core/Learning/PublishedCurriculumVersion.cs`
- `backend/ShadowingEnglish.Infrastructure/Database/ApplicationDbContext.cs`
- `backend/ShadowingEnglish.Infrastructure/Database/Migrations/20261002101732_AddIndependentCurriculumDraft.Designer.cs`
- `backend/ShadowingEnglish.Infrastructure/Database/Migrations/20261002101732_AddIndependentCurriculumDraft.cs`
- `backend/ShadowingEnglish.Infrastructure/Database/Migrations/ApplicationDbContextModelSnapshot.cs`
- `coordination/reports/CURRICULUM-FLOW-V1-REDESIGN-002-DEV2.md`
- `frontend/playwright.curriculum-test.config.ts`
- `frontend/src/app/features/admin/curriculums/curriculums.page.html`
- `frontend/src/app/features/admin/curriculums/curriculums.page.scss`
- `frontend/src/app/features/admin/curriculums/curriculums.page.spec.ts`
- `frontend/src/app/features/admin/curriculums/curriculums.page.ts`
- `frontend/src/app/features/admin/groups/groups.api.ts`
- `frontend/src/app/features/admin/groups/groups.page.html`
- `frontend/src/app/features/admin/groups/groups.page.ts`
- `frontend/src/app/features/admin/lesson-builder/lesson-builder.page.html`
- `frontend/src/app/features/admin/lesson-builder/lesson-builder.page.spec.ts`
- `frontend/src/app/features/admin/lesson-builder/lesson-builder.page.ts`
- `frontend/src/app/features/admin/lesson-builder/shadowing-authoring.api.ts`
- `frontend/src/app/features/admin/lessons/lessons.page.html`
- `tests/ShadowingEnglish.MediaChecks/CurriculumChecks.cs`
- `tests/ShadowingEnglish.MediaChecks/CurriculumMigrationChecks.cs`
- `tests/ShadowingEnglish.MediaChecks/Runner.cs`
- `tests/curriculum-e2e/curriculums.spec.ts`

## Tests actually run

| Check | Actual result |
| --- | --- |
| Full Angular suite (`npm run test:frontend`; final equivalent frontend `npm test`) | PASS — 95/95 tests, 38 files; 39 curriculum tests |
| Real API/Identity/private-media acceptance (`tests/run_media_checks.py`) | PASS — 36/36; isolated relational SQLite and loopback Azurite |
| SQL Server migration suite (`ShadowingEnglish.MediaChecks.dll --curriculum-migrations`) | PASS — 4/4 on disposable SQL Server 2025 Developer |
| Migration from zero | PASS — all five migrations applied on a new SQL Server database; no pending migrations |
| Additive upgrade with existing published data/progress | PASS — migrate to previous baseline, insert published snapshot/slot/assignment/progress, upgrade and verify all retained |
| SQL Server draft persistence / unique slot constraints | PASS |
| SQL Server optimistic revision concurrency | PASS — second editor rejected; first editor preserved |
| EF `migrations has-pending-model-changes` | PASS — NO changes since latest migration |
| Frontend production build (`npm run build:frontend`) | PASS |
| Backend solution build (`dotnet build backend/ShadowingEnglish.sln --no-restore -m:1`) | PASS — 0 warnings / 0 errors |
| Groups/student/security/shell/V1 layout static suites (`node --test` five listed files) | PASS — 21/21 |
| ESLint for changed frontend source/spec/config | PASS |
| Prettier check for changed frontend/e2e files | PASS |
| Playwright curriculum test discovery (`--list`) | PASS — 4 cases, desktop and mobile |
| Playwright browser execution | BLOCKED — Chrome launch fails before test bodies: Unix socket() Operation not permitted |
| git diff --check | PASS; repeated on staged final changes before commit |
| Scope check / old migrations unchanged | PASS |

The API acceptance suite verifies persisted drafts/order/assignment, Save != Assign != Publish, real student visibility/group isolation, immutable full snapshots, idempotent retries including old receipts, stale revisions, position validation/conflicts, missing audio atomicity, preserved active progress, read-only refresh, CSRF/Admin authorization and safe diagnostics.

The four SQL checks use an explicit opt-in loopback connection and newly named disposable test databases, refuse pre-existing databases and clean up their own databases. SQL Server 2022 did not start on this runtime; the checks succeeded using SQL Server 2025 instead. No production database was accessed.

Static suites actually run: tests/groups-foundation.static.test.mjs, tests/student-core.static.test.mjs, tests/security/admin-accounts.static.test.mjs, tests/day2-shell-contract.test.cjs, tests/day2-v1-layout-parity.test.cjs.

## PASS / FAIL / NOT RUN

PASS: 95 frontend + 36 API/media + 4 SQL Server + 21 static checks; both builds, scoped lint/format, model consistency and diff/scope checks.
FAIL: none remaining in executed functional/database checks. An initial frontend asynchronous test wait was corrected and the full suite rerun successfully. The browser launcher run exited with four setup failures caused by environment restrictions, before any browser scenario executed.
NOT RUN: actual desktop/mobile browser scenarios and screenshot/pixel parity (browser launch blocked). Firefox/WebKit/full student browser matrix was not run; this task does not alter Student UI. Live hosted environment and user acceptance were not available.

## Remaining issues / Known limitations / Observed but not changed

- V1 visual fidelity is grounded in supplied source styles/layout; actual browser screenshots still require verification in an environment that can launch a browser. The committed Playwright suite uses an HTTP contract fixture for layout/interactions; it does not replace real DB/API tests.
- Existing legacy CurriculumTemplates are not automatically backfilled from old published versions. Their old publications/progress remain intact; prepare and save an independent draft explicitly.
- Existing active-progress protection intentionally blocks switching the published version once student progress exists. Changing the pending draft/assignment remains possible without resetting progress. A separate future approved migration/version-transition policy is needed if that business rule changes.
- Draft-save and assignment receipt storage records the most recent write. Retrying an older write after a subsequent update is rejected by revision protection; it cannot undo later work. Publish receipts remain available for every immutable version.
- Search and sorting apply to loaded paginated items, which the UI labels explicitly. Load-more buttons use real pagination.
- V1 unsupported features listed above remain deferred. No AI Processing, AI Tools, Local Processor, WhisperX, Student UI, shell or old migration files were modified.
- Backend build/API checks use .NET SDK 10.0.100; migration tooling/runtime packages are EF 10.0.10. Runtime-owned downloads/tooling are outside the repository and not delivered.

## Blockers / Push

GITHUB-WRITE-NOT-AVAILABLE. A branch-only push dry run failed because GitHub credentials were unavailable (`could not read Username`, terminal prompts disabled). Final delivery records the actual post-commit push result. No merge/force push or other developer branch modification is authorized or performed.

READY: YES for Team Lead code review and the requested functional/database flow. Browser visual/UAT verification remains outstanding as stated above. This is not a claim of deployment, merge or GitHub push.
