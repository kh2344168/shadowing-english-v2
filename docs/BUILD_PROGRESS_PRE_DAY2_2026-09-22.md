# Shadowing English V2 — Build Progress & 5-Day Plan

**Status:** Active Tracker  
**Version:** 1.1  
**Start:** 2026-09-22  
**Deadline:** 5 days  
**Priority:** Student first, Admin second

---

# 1. وظيفة الملف

هذا الملف يوضح دائمًا:

- ماذا انتهى؟
- ماذا لم ينتهِ؟
- لماذا جزء معين لا يعمل الآن؟
- ما الـDependency الناقصة؟
- في أي يوم/مرحلة سيتم إكماله؟

إذا كانت Feature غير شغالة لأن خطوة مستقبلية لم تُنفذ بعد، يتم تسجيلها كـ`BLOCKED` أو`DEFERRED` مع السبب، وليس كـBug تلقائيًا.

---

# 2. الحالات

```text
⬜ NOT STARTED
🟡 IN PROGRESS
✅ DONE
⛔ BLOCKED
⏳ DEFERRED
```

---

## Update — Runnable Foundation v3 (2026-09-22)

```text
✅ Root npm workspace and install/run scripts CREATED
✅ Angular source/config and visible Student foundation shell PRESENT
✅ .NET 10 API/Core/Infrastructure .csproj and solution CREATED
✅ Read-only /health endpoint CREATED
✅ README documents actual Windows setup and expected outputs
✅ JSON/XML/solution/file-reference static checks PASSED
⏳ npm install / Angular build / lint / tests NOT RUN HERE (npm registry not reachable)
⏳ dotnet restore / build / run NOT RUN HERE (.NET SDK unavailable in build environment)
⬜ Auth / database / EF Core connection / lessons / uploads NOT IMPLEMENTED
```

This is not a completed Foundation until the developer machine runs both actual builds and the local smoke check. There are no completed business features. The approved rules were left unchanged.

---

# آخر تحديث — Tooling Foundation

```text
✅ Repository structure prepared
✅ SCSS + Tailwind policy/config prepared
✅ Angular CDK declared (selective runtime use only)
✅ ESLint configured (dev/CI only)
✅ Prettier configured (dev/CI only)
✅ Playwright configured (dev/CI only)
✅ Production hosting exclusion rules documented
⏳ npm dependency installation/build validation pending on development machine
```

# 3. الحالة الحالية العامة

| Area | Status | Priority | Planned |
|---|---|---:|---:|
| Approved Rules | ✅ DONE | P0 | Before Day 1 |
| Build Progress Tracker | ✅ DONE | P0 | Before Day 1 |
| V2 Foundation | 🟡 IN PROGRESS | P0 | Day 1 |
| Authentication | ⬜ NOT STARTED | P0 | Day 1 |
| Student Core | ⬜ NOT STARTED | P0 | Day 1–3 |
| Admin Core | ⬜ NOT STARTED | P0 | Day 3–4 |
| Teacher Full Features | ⏳ DEFERRED | P2 | After Student/Admin core |
| Supervisor Full Features | ⏳ DEFERRED | P2 | After Student/Admin core |
| Advanced Offline | ⏳ DEFERRED | P2 | Day 5 or later |
| Performance Hardening | ⬜ NOT STARTED | P0 | Every day + Day 5 |
| Security Hardening | ⬜ NOT STARTED | P0 | Every day + Day 5 |
| Staging/Deployment | ⬜ NOT STARTED | P0 | Day 5 |

---

# 4. متى نقول إن Feature خلصت؟

لكل Feature نسجل:

```text
Frontend
Backend
Database/Storage
Integration
Authorization
Validation
Diagnostics
Tests
Performance
Staging
```

Template:

```text
Feature:
Frontend:        ⬜
Backend:         ⬜
Database:        ⬜
Integration:     ⬜
Authorization:   ⬜
Diagnostics:     ⬜
Tests:           ⬜
Performance:     ⬜
Status:          ⬜ NOT STARTED
Blocked by:      None
Deferred:        None
Notes:           ...
```

---

# DAY 1 — Foundation + Auth + Entry Points

## الهدف

```text
Start app
→ Login
→ Backend authenticates
→ Session loads
→ Student enters Student area
→ Admin enters Admin area
```

## Foundation

- ✅ Create new V2 repository/tree.
- 🟡 Angular scaffold/config prepared; dependency install + build verification pending on dev machine.
- ✅ Frontend tooling declarations/config: SCSS + Tailwind + Angular CDK + ESLint + Prettier + Playwright.
- ✅ Hosting guard documented: dev/test tooling excluded from production deployment.
- ⬜ Install frontend dependencies and generate lockfile on development machine.
- ⬜ Run `npm run build`, `npm run lint`, `npm run format:check`, and Playwright smoke after install.
- ⬜ ASP.NET Core scaffold.
- ⬜ Environment/config foundation.
- ⬜ Diagnostics foundation.
- ⬜ Basic CI.
- ⬜ Database baseline + first migration.
- ⬜ Shared error contract.

## Authentication

- ⬜ Login page.
- ⬜ Login endpoint.
- ⬜ Session endpoint.
- ⬜ Logout.
- ⬜ Role authorization.
- ⬜ Student/Admin route guards.
- ⬜ No hidden writes on Login/Refresh/Startup.

## Page Shells

- ⬜ Student Layout.
- ⬜ Student Dashboard shell.
- ⬜ Admin Layout.
- ⬜ Admin Dashboard shell.
- ⏳ Teacher Layout/Page shells — optional after core.
- ⏳ Supervisor Layout/Page shells — optional after core.

## Day 1 Gate

- ⬜ Frontend builds.
- ⬜ Backend builds.
- ⬜ DB migration works.
- ⬜ Login works end-to-end.
- ⬜ Student/Admin routing works.
- ⬜ Refresh causes zero unexpected writes.
- ⬜ Diagnostics are readable.

---

# DAY 2 — Student Core Flow

## الهدف

```text
Login
→ Dashboard
→ Curriculum
→ Lesson Overview
→ Shadowing
→ Save basic Progress
```

## Student Dashboard

```text
Frontend:      ⬜
Backend:       ⬜
Database:      ⬜
Integration:   ⬜
Tests:         ⬜
Performance:   ⬜
Status:        ⬜ NOT STARTED
Planned:       Day 2
```

## Student Curriculum

Must support:

- Group-based access.
- Student without Group → clear empty state.
- Lightweight metadata only.
- Pagination/progressive loading.

```text
Frontend:      ⬜
Backend:       ⬜
Database:      ⬜
Authorization: ⬜
Integration:   ⬜
Tests:         ⬜
Status:        ⬜ NOT STARTED
Planned:       Day 2
```

## Lesson Overview

- ⬜ Published Curriculum Version.
- ⬜ Lesson Slot.
- ⬜ Stage statuses.
- ⬜ No full media preload.

## Shadowing Core

Initial target:

- ⬜ Display current segment.
- ⬜ Teacher audio playback.
- ⬜ Text/chunk highlight.
- ⬜ Local recording attempt.
- ⬜ Manual Next.
- ⬜ Basic Progress save.
- ⏳ Final cloud recording upload — planned Day 4 with Object Storage.

If cloud recording upload does not work on Day 2:

```text
Status: BLOCKED/DEFERRED
Reason: Object Storage upload flow is planned for Day 4.
This is expected, not a regression.
```

---

# DAY 3 — Finish Student Experience + Start Admin

## الهدف

اكتمال أغلب Student learning path.

## Vocabulary

- ⬜ Cards/UI.
- ⬜ Meaning/examples/chunks.
- ⬜ Audio per word/chunk when available.
- ⬜ Backend/data contract.
- ⬜ Progress/state.

## Listen & Type

- ⬜ Input flow.
- ⬜ Wrong-word detection.
- ⬜ Retry wrong part only.
- ⬜ Normalization rules.
- ⬜ Save result/progress.

## Quiz

- ⬜ Question schemas.
- ⬜ Answers.
- ⬜ Drag/drop safe behavior.
- ⬜ Keyboard/touch fallback.
- ⬜ Save result idempotently.

## Conversation

- ⬜ Scenario.
- ⬜ Role selection.
- ⬜ Chat/Voice distinction.
- ⬜ 10-sentence flow supported.
- ⬜ Evaluation contract.
- ⬜ grammarFocus.
- ⬜ vocabularyFocus.
- ⬜ phrases.
- ⬜ better answer.
- ⬜ level score/result persistence.
- ⏳ Final AI provider connection may defer if external provider blocks core flow.

If AI provider is deferred:

```text
Reason:
Frontend + Backend contract + DB can be completed first.
External provider must not block the full Student path.
```

## Progress

- ⬜ Slot-based progress key.
- ⬜ Idempotent save.
- ⬜ Resume state.
- ⬜ History preserved.

## Knowledge Bank Basics

- ⬜ Vocabulary Bank.
- ⬜ Sentence Bank.
- ⬜ Known/New/Review states.

## Start Admin

- ⬜ Admin Dashboard real data.
- ⬜ Lessons list.
- ⬜ Students list.
- ⬜ Groups list.

---

# DAY 4 — Admin Core + Publish + Storage

## الهدف

```text
Create/Edit Lesson
→ Curriculum
→ Group
→ Student assignment
→ Publish
→ Student sees exact Published Version
```

## Lessons

- ⬜ List.
- ⬜ Create.
- ⬜ Edit Draft.
- ⬜ Archive.
- ⬜ Versioning.

## Lesson Builder

- ⬜ Frontend.
- ⬜ Backend.
- ⬜ Database.
- ⬜ Save Draft.
- ⬜ No automatic Publish.

## AI Processing

- ⬜ Separate from Lesson Builder.
- ⬜ Job/status model.
- ⬜ Structured validation.
- ⬜ Review.
- ⬜ Approve.
- ⬜ Automatic Publish remains disabled.

## Groups & Students

- ⬜ Create Group.
- ⬜ Create Student without Group.
- ⬜ Assign Student to Group.
- ⬜ Move Student to another Group.
- ⬜ Preserve previous Progress/History.

## Curriculum & Publishing

- ⬜ Curriculum Template.
- ⬜ Group Curriculum Draft.
- ⬜ Save Draft.
- ⬜ Publish immutable Version.
- ⬜ Student visibility.
- ⬜ Idempotent Publish.

## Object Storage & Recordings

- ⬜ Storage abstraction.
- ⬜ Authorized upload flow.
- ⬜ Final selected recording upload.
- ⬜ Metadata in DB.
- ⬜ Access authorization.

If this section is unfinished:

```text
Shadowing local recording may work.
Final recording upload remains BLOCKED.
Do not mark full recording flow DONE.
```

---

# DAY 5 — Integration + Hardening + Staging

## الهدف

لا نضيف Features كبيرة جديدة إلا لو الـCore خلص.

التركيز:

```text
Integration gaps
→ Bugs
→ Security
→ Performance
→ Responsive
→ Tests
→ Staging
→ Release candidate
```

## Student Final Pass

راجع:

- ⬜ Dashboard.
- ⬜ Curriculum.
- ⬜ Lesson Overview.
- ⬜ Shadowing.
- ⬜ Vocabulary.
- ⬜ Listen & Type.
- ⬜ Quiz.
- ⬜ Conversation.
- ⬜ Progress.
- ⬜ Recordings.
- ⬜ Knowledge Bank.

لكل جزء:

- ⬜ Loading/Error/Empty states.
- ⬜ Responsive.
- ⬜ Authorization.
- ⬜ Diagnostics.
- ⬜ No duplicate critical requests.
- ⬜ Critical test.
- ⬜ Performance measurement.

## Admin Final Pass

راجع:

- ⬜ Dashboard.
- ⬜ Lessons.
- ⬜ Lesson Builder.
- ⬜ AI Processing.
- ⬜ Curriculums.
- ⬜ Groups.
- ⬜ Students.
- ⬜ Publish.

## Teacher

```text
Role definition:        ✅ DONE
Architecture:           ✅ DONE
Full features:          ⏳ DEFERRED after Student/Admin core
```

## Supervisor

```text
Role definition:        ✅ DONE
Architecture:           ✅ DONE
Full features:          ⏳ DEFERRED after Student/Admin core
```

## Advanced Offline

```text
Offline rules:          ✅ documented
Explicit full download: ⏳ DEFERRED unless core finishes early
Workbox final decision: ⏳ DEFERRED / technical spike
```

Advanced Offline must not delay Student/Admin core.

## Deployment

- ⬜ Frontend production build.
- ⬜ Backend production build.
- ⬜ Database migration verification.
- ⬜ Secrets/config verification.
- ⬜ Staging deploy.
- ⬜ Smoke test.
- ⬜ Critical E2E.
- ⬜ Performance baseline.
- ⬜ Security check.
- ⬜ Release candidate.

---

# 5. Student Master Tracker

| Student Feature | FE | BE | DB/Storage | Integration | Tests | Status | Day |
|---|---|---|---|---|---|---|---:|
| Login | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 1 |
| Dashboard | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 1–2 |
| Curriculum | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 2 |
| Lesson Overview | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 2 |
| Shadowing | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 2–4 |
| Vocabulary | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 3 |
| Listen & Type | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 3 |
| Quiz | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 3 |
| Conversation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 3–4 |
| Progress | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 3 |
| Recordings | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| Knowledge Bank | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 3–5 |
| Messages | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ DEFERRED if needed | After core |

---

# 6. Admin Master Tracker

| Admin Feature | FE | BE | DB/Storage | Integration | Tests | Status | Day |
|---|---|---|---|---|---|---|---:|
| Login/Auth | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 1 |
| Dashboard | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 1–3 |
| Lessons | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| Lesson Builder | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| AI Processing | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| Curriculums | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| Groups | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| Students | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| Publish | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | 4 |
| Teachers | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ DEFERRED | After core |
| Supervisors | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ DEFERRED | After core |
| Subscriptions | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ DEFERRED if not required for pilot | After core |

---

# 7. Dependencies Map

```text
Auth
↓
Roles / Session
↓
Student Dashboard
↓
Group Membership
↓
Published Curriculum
↓
Lesson Slot
↓
Stages
↓
Progress
```

```text
Object Storage
↓
Final Recording Upload
↓
Recording Review
```

```text
Lesson Library
↓
Curriculum Draft
↓
Publish Version
↓
Student Curriculum Visibility
```

```text
AI Provider
↓
AI Processing Job
↓
Structured Result
↓
Admin Review
↓
Approved Content
```

---

# 8. Deferred Items

| Item | Status | Reason | Revisit |
|---|---|---|---|
| Full Teacher features | ⏳ DEFERRED | Student/Admin priority | After core |
| Full Supervisor features | ⏳ DEFERRED | Student/Admin priority | After core |
| Advanced Offline download | ⏳ DEFERRED | Must not delay core | After core / if time remains |
| Workbox final adoption | ⏳ DEFERRED | Needs technical spike | Offline phase |
| CDN design | ⏳ DEFERRED | Measure need first | Scale phase |
| SaaS/Multi-tenancy | ⏳ DEFERRED | Explicitly outside current scope | Future ADR |
| Multiple active Groups | ⏳ DEFERRED | Not supported by current rule | Future product decision |

---

# 9. Daily Update Template

```text
Date:
Day:

Completed:
✅ ...

In progress:
🟡 ...

Blocked:
⛔ ...
Reason:
Depends on:
Planned resolution:

Deferred:
⏳ ...
Reason:
Revisit on:

New bugs:
- ...

Performance notes:
- ...

Security notes:
- ...

Next exact task:
- ...
```

---

# 10. Bug vs Deferred

```text
Dependency planned for later is missing
→ BLOCKED / DEFERRED

Previously completed behavior broke
→ BUG / REGRESSION

Requirement was never implemented and is scheduled later
→ NOT STARTED / DEFERRED

Implemented feature fails its accepted contract
→ BUG
```

---

# 11. Target at End of Day 5

## Student

```text
Login
Dashboard
Curriculum
Lesson Overview
Shadowing
Vocabulary
Listen & Type
Quiz
Conversation
Progress
Recordings
Basic Knowledge Bank
```

## Admin

```text
Login
Dashboard
Lessons
Lesson Builder
AI Processing Review
Curriculums
Groups
Students
Publish
```

## System

```text
Backend
Database
Authorization
Diagnostics
Critical Tests
Performance Baseline
Staging Deployment
```

Teacher وSupervisor يظلان جزءًا أساسيًا من المنتج، لكن Full feature sets الخاصة بهما لا تؤخر Student/Admin core خلال الخمسة أيام.

---

# 12. قاعدة التحديث

بعد كل جزء نكمله، يتم تحديث هذا الملف فورًا ليعكس الحقيقة:

```text
What works
What does not work
Why
What it depends on
When it is planned
```

لا نضع ✅ على جزء غير مكتمل فقط لأن الموعد ضيق.
