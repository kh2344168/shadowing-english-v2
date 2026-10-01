# Shadowing English V2 Day 2 Local Validation Report

> Snapshot supplied from the Windows V2 test machine on 2026-09-29 for source revision `3f16140`. It records local observations; they cannot be reproduced in this workspace without the local SQL Server and test accounts. Terminal IDs are transient.
> Correction after importing the archive: the Playwright `--list` PASS below proves test discovery only. Its original config inherited frontend `baseURL` port `4200` even though its proxy served port `4201`, so the claim that this setup was isolated end to end was unverified. The accompanying V2 source now overrides `baseURL` to `4201`; an actual browser run is still NOT RUN. The tally remains a snapshot of the Windows checks, not a new runtime result.

**Run date:** 2026-09-29

**Source archive revision:** `3f16140`

**Workspace:** V2 extracted folder only. No V1 source or data was inspected.
**Disposition:** Day 2 remains **NOT DONE**. A new, empty V2-only test database was created and migrated. The existing `ShadowingEnglishV2` database was not queried for its data or modified. No application source was modified.

## Results

**Current tally:** 26 PASS, 1 FAIL, 10 NOT RUN. The `npm ci` failure was followed by a successful in-place dependency recovery; authenticated fixture/API/E2E checks remain blocked on private test-account setup.

| Check | Status | Command / method | Actual result |
|---|---|---|---|
| Required Day 2 guidance | PASS | Read `START_HERE_AR.md`, `docs/APPROVED_RULES.md`, `docs/BUILD_PROGRESS.md`, `docs/RUNBOOKS/DAY2_STUDENT_CORE.md`, `docs/RUNBOOKS/GROUPS_FOUNDATION.md` | Read all five. The runbooks prohibit applying migrations except to a clearly identified V2 test database and require reusing existing accounts. |
| Node and npm | PASS | `node --version`; `npm --version` | Node `v24.19.0`; npm `11.17.0`. |
| .NET SDK and EF tool | PASS | `dotnet --list-sdks`; `dotnet ef --version` | SDK `10.0.302`; EF CLI `10.0.10`. |
| SQL Server availability | PASS | Windows service check; read-only `sqlcmd -S .\SQLEXPRESS -E -C ...` | `MSSQL$SQLEXPRESS` is running. Read-only enumeration succeeded after a first query hit a sanitized collation conflict. Online databases included `ShadowingEnglishV2` and other Shadowing-named databases. |
| Configured database identity | PASS | Sanitized parse of `appsettings.Development.json` | Target resolves to the local SQL Express instance and database `ShadowingEnglishV2`; no connection-string or credential values are included. The name does not establish that this is a test database. |
| Separate V2 Day 2 test database | PASS | SQL Server create database; `SELECT DB_NAME(), COUNT(*) FROM sys.tables ...` | Created `ShadowingEnglishV2_Day2Test_20260929`; verified it was empty (`0` user tables) before migration. The existing `ShadowingEnglishV2` database was not modified. |
| Installed desktop browsers | PASS | Checked common Windows install locations | Chrome `153.0.8010.53` and Edge `154.0.4258.37` are installed. |
| Playwright browser engines | PASS | `npx playwright install` (Playwright `1.63.0`) | Installed pinned Chromium/headless shell, Firefox, WebKit, FFmpeg, and Winldd. No Playwright upgrade or test-project reinitialization. |
| Playwright browser launches | PASS | Node Playwright headless launch/close for Chromium, Firefox, and WebKit | All three browser engines launched and closed successfully. |
| npm clean install | FAIL | `npm ci` | Windows `EPERM` while unlinking a locked native `lightningcss` module; Angular builder was unavailable immediately afterward. No secrets were displayed. |
| npm dependency recovery | PASS | `npm install --no-save --package-lock=false` | Restored local dependencies (`added 380`, `changed 196`; native-package cleanup warnings due open handles). Subsequent build and unit tests passed. No package-lock changes were made by this recovery command. |
| Frontend build | PASS | `npm run build:frontend` | Angular build succeeded. Initial bundle: `330.58 kB` raw, `90.52 kB` estimated transfer. This is bundle output, not observed browser-network transfer. |
| Frontend unit tests | PASS | `npm run test:frontend` after local dependency restore | `36/36` test files and `45/45` tests passed. The initial run lacked `vitest`/`jsdom`; `npm ci` then hit a Windows `EPERM` lock on a native module. An in-place `npm install --no-save --package-lock=false` restored the dependencies, and the rerun passed. |
| Frontend lint | PASS | `npm run lint` | ESLint exited successfully. |
| Frontend format check | PASS | `npm run format:check` | Prettier reported all matched files formatted. |
| Day 2 static tests | PASS | `node --test tests/day2-shell-contract.test.cjs tests/day2-v1-layout-parity.test.cjs tests/security/admin-accounts.static.test.mjs tests/groups-foundation.static.test.mjs tests/student-core.static.test.mjs` | `21/21` passed. This includes static checks for the single-active-membership constraint, Admin-only Groups writes, explicit CSRF, membership move/history behavior, Student access scoping, and explicit fixture gating. It does not prove runtime behavior. |
| .NET solution build | PASS | `dotnet build .\backend\ShadowingEnglish.sln --artifacts-path .\.day2-validation-artifacts` | Full solution build succeeded. The ordinary build first failed because an already-running API process held the default Infrastructure DLL open; the isolated-output build succeeded without stopping or replacing that process. Isolated output remains because the test API runs from it. |
| EF migration IDs | PASS | `dotnet ef migrations list --no-connect --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api` | Current source contains `20260923074328_InitialIdentity`, `20260928154813_AddGroupsFoundation`, `20260928213000_AddStudentCore`. Applied/pending database status was not available from this no-connect listing. |
| EF pending model changes | PASS | `dotnet ef migrations has-pending-model-changes --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api` | EF reported no model changes since the last migration. This is a model/snapshot check, not a database migration-status check. |
| Idempotent SQL generation and review | PASS | `dotnet ef migrations script --idempotent --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api --output .\DAY2_LOCAL_REVIEW_IDEMPOTENT.sql` | Generated and reviewed a `19,621`-byte script containing all three migration IDs. It defines the Groups filtered unique index on active membership and Student Core tables. Structural scan found no `DROP` or `TRUNCATE` statements. The temporary script was removed after review. |
| Confirm applied migrations / pending database migrations | PASS | `dotnet ef migrations list --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api` with process-local target override | EF connected to the new test database and reported `20260923074328_InitialIdentity`, `20260928154813_AddGroupsFoundation`, and `20260928213000_AddStudentCore` all pending before application. Post-apply history query confirms all three recorded at EF `10.0.10`. |
| Apply migrations | PASS | `dotnet ef database update --project .\backend\ShadowingEnglish.Infrastructure --startup-project .\backend\ShadowingEnglish.Api` | Applied only to `ShadowingEnglishV2_Day2Test_20260929` after reviewing the current-source idempotent script. Result: 18 user tables, all three expected migration IDs recorded. Connection string and credentials omitted. |
| Groups database invariants | PASS | Read-only catalog queries on the new test database | `UX_StudentGroupMemberships_ActiveStudent` exists as unique, filtered on `EndedAtUtc IS NULL`; `CK_StudentGroupMemberships_EndAfterStart` exists with the expected end-after-start rule. Runtime concurrent behavior remains unverified. |
| Groups database constraint behavior | PASS | Transactional synthetic SQL constraint probe on the new test database; transaction rolled back | A second active membership was rejected (`SecondActiveRejected=1`), exactly one active row remained after the rejected insert, and an end date before start was rejected (`InvalidEndDateRejected=1`). Post-rollback counts for groups, memberships, published versions, and progress are all `0`. This is database-constraint behavior, not API move/concurrency coverage. |
| Existing Admin and Student accounts | NOT RUN | Development-only local account provisioner; interactive masked-password prompt | Provisioner is waiting at the Admin password prompt in the local provisioner terminal. The Admin email has been entered locally; no password has been supplied through chat, and neither account is confirmed created. Type disposable test passwords directly into that terminal to continue. |
| Day 2 fixture, first run | NOT RUN | `dotnet run --project .\backend\ShadowingEnglish.Api -- --provision-day2-fixture` not run | Waiting for test Admin/Student accounts; the fixture must use existing accounts and will not provision them. |
| Day 2 fixture, repeat/idempotence | NOT RUN | Fixture command not run a second time | Blocked on successful first fixture run and local account provisioning. |
| Start a test API instance | PASS | Fresh current-source API started in Development at `http://127.0.0.1:5018` with a process-local connection override | This API is connected only to the new test database. The pre-existing process on port `5017` was not stopped or used. |
| API health and anonymous authorization | PASS | Node built-in `fetch` against the new API | `/health` returned `200` (51 response bytes); anonymous `/api/admin/groups` returned `401` (0 body bytes); anonymous `/api/student/learning/curriculum` returned `401` (0 body bytes). |
| API smoke test | NOT RUN | `node .\tests\day2-api-smoke.mjs` | Stopped before making requests because `DAY2_ADMIN_EMAIL` is unset. No password or account value was supplied. |
| Groups API runtime permissions and writes | NOT RUN | Authenticated Groups requests not issued | Anonymous list denial was verified above. Student/Admin role checks, CSRF, group create/retry idempotence, membership move/unassign/history, expected-membership conflict, and concurrent single-active-membership behavior await the accounts. |
| Student isolation and GET write audit | NOT RUN | No student API requests or before/after SQL row counts | Student-to-group/slot isolation, 404 concealment, and proof that GETs do not change `StudyGroups`, `StudentGroupMemberships`, published versions, or progress remain unverified. |
| Student E2E desktop/mobile | NOT RUN | `npm run test:e2e` not run after browser installation | Playwright browser binaries are now installed. E2E awaits the provisioned Student credentials and a real run against the corrected isolated config. |
| Isolated E2E configuration | PASS | `npx playwright test --config frontend\playwright.day2-test.config.ts --list` | Loaded successfully and discovered the existing 5 tests across Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari. This was discovery only; the inherited `baseURL` was wrong in the uploaded config and has since been corrected in the delivered V2 source. |
| Browser request counts and transferred bytes | NOT RUN | No browser journey completed | Actual request count and transferred bytes are unavailable. Only the Angular bundle estimate above was measured. |
| Browser console / API errors | NOT RUN | No authenticated E2E browser session started | No application console or API response diagnostics were collected. The pre-install E2E attempt failed at missing browser executables; all three browser engines now launch independently. |
| Physical microphone and local recording behavior | NOT RUN | Requires manual device/browser test | Not verifiable from this environment. **Please test the real microphone manually** after the V2 test API, fixture, and browser prerequisites are ready; confirm recording stays local and no recording-file POST is sent. |

## Manual Microphone Checklist

Status: **NOT RUN**. Requires a real microphone and a user-controlled browser session after the account, fixture, and login E2E steps are complete.

- [ ] Open a fixture lesson and grant microphone permission only when prompted.
- [ ] Record a short sample; confirm the UI shows recording and then stopped states.
- [ ] Navigate to the next segment while recording; confirm capture stops and the next segment does not receive the prior recording.
- [ ] Inspect browser Network requests; confirm no recording/blob/file upload request is sent.
- [ ] Navigate away from Shadowing; confirm the microphone indicator turns off.
- [ ] Return to the lesson and refresh; confirm saved progress restores while the local recording is not uploaded or persisted as server media.

## Migration IDs

- `20260923074328_InitialIdentity`
- `20260928154813_AddGroupsFoundation`
- `20260928213000_AddStudentCore`

## Changed Files

- Updated `DAY2_LOCAL_TEST_REPORT.md`; added temporary test-only `frontend/playwright.day2-test.config.ts` and `frontend/src/proxy.day2-test.conf.json` for safe routing around the pre-existing API/frontend listeners. Local ignored `node_modules` dependencies were restored; no application source was changed.
- `package-lock.json` was already modified in the worktree at the start of this continuation and was preserved. The in-place dependency restore used `--package-lock=false`.
- No application source or `docs/APPROVED_RULES.md` was changed. A new V2 test database was created and migrated; the pre-existing databases were not modified. No V2 ZIP was created because no source code was changed.
- Temporary EF routing and generated review SQL were removed. Isolated build output remains because the test API is running from it. No Playwright test-results were generated in this continuation.

## Remaining Blockers

1. Finish entering disposable test-only Admin and Student credentials into the currently waiting masked provisioner terminal; do not share passwords in chat or report.
2. Run the explicit fixture twice, then authenticated API smoke and Groups authorization/create/retry/move/unassign/history/concurrency checks.
3. Compare read-only SQL row counts before and after Student GET requests and record that no business rows changed.
4. Run desktop/mobile Playwright E2E with the separate test proxy and capture request count, transferred bytes, console errors, and API errors.
5. Manually test the physical microphone and verify recording stays local with no recording upload.

Day 2 is not marked DONE, and no Day 3 work was started.
