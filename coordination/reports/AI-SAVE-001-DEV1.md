# TASK AI-SAVE-001 — DEV 1

Source: DIRECT-USER

## Git

- Repository: https://github.com/kh2344168/shadowing-english-v2
- Base branch: integration/baseline-2026-10-01
- Base commit: c6e631fe63fe61c5aa3ff5c5f3432f36e53effc1
- Latest main reviewed before editing: a9afd9178cc3a85969238ab6fb505ab653a464e5
- Branch: dev1/AI-SAVE-001
- Commit: the single task commit, `feat(ai-processing): save approved lessons to library`; its exact SHA and push outcome are included in the final handoff.
- The three current AI Processing page files already contained delivered editing, waveform handles, original-media selection, transcript selection, and new-lesson cleanup changes that were not committed to the integration base. Those changes are preserved in this task commit. The new save changes were also reviewed against a separate snapshot of those input files.

## Changed files

- frontend/src/app/features/admin/ai-processing/ai-processing.page.ts
- frontend/src/app/features/admin/ai-processing/ai-processing.page.html
- frontend/src/app/features/admin/ai-processing/ai-processing.page.scss
- frontend/src/app/features/admin/ai-processing/ai-processing.page.spec.ts
- coordination/reports/AI-SAVE-001-DEV1.md

## What changed

- Replaced the transfer to Lesson Builder with explicit approve-and-save through the unchanged `ShadowingAuthoringApi.create()` and the existing CSRF flow.
- Save sends the latest trimmed title and description, reviewed segment texts, and current WAV files, including refreshed files after recut.
- The processor job UUID is the save requestId. It is stable across retries and reopening the same processor job. The existing backend create endpoint checks matching text/audio for repeated IDs and returns the existing lesson; conflicting data produces an error instead of a duplicate.
- An immediate saving guard prevents double-click requests. Saving is blocked while an editor is open or recut/cleanup/processing is running. Content changes, new processing and cleanup are blocked during save; after success the displayed saved content is read-only, while audio playback stays available.
- Failure preserves the result, files, preview URLs, review state and current metadata; the user can retry.
- Success retains the result, marks the lesson saved, and displays exactly the two requested choices: go to `/admin/lessons` or stay on AI Processing. There is no automatic navigation and no publication call.
- Choosing stay keeps the saved message visible and offers the existing explicit new-lesson action. Cleanup resets the saved state only after successful local job cleanup.
- Restored results initialize the lesson title/description. Recut of the current result preserves metadata edits.
- Added safe Save.Start/Success/Failed diagnostics containing IDs, count, status, allowlisted error code and duration. Text, audio and arbitrary server error details are excluded.

Backend changed: NO
Database/migrations changed: NO
Lesson Builder/API client changed: NO
Local Processor/AI Tools changed: NO
Routes changed: NO

## Tests actually run

| Command | Result |
| --- | --- |
| `npm test -- --include src/app/features/admin/ai-processing/ai-processing.page.spec.ts` | PASS — 15 tests |
| `npm test` | PASS — 70 tests in 38 files, including the 15 task tests |
| `npm run build:production` | PASS |
| `npx eslint src/app/features/admin/ai-processing/ai-processing.page.ts src/app/features/admin/ai-processing/ai-processing.page.html src/app/features/admin/ai-processing/ai-processing.page.spec.ts` | PASS |
| `git diff --check` | PASS |

The task tests use the real authoring API class with Angular HttpTestingController, inspect multipart POST data and WAV File identity, and exercise the rendered action buttons and router behavior. They cover review gating, edited data after recut, double click, stable retries, preserving work on save/CSRF failure, no publish/transfer/WhisperX, no automatic navigation, both success choices, visible saved state after staying, duplicate-save prevention, new-lesson reset, cleanup failure, validation and safe diagnostics.

FAIL: None in the completed checks.

NOT RUN: Browser end-to-end save against a real backend/database/object storage, and real audio playback with a connected processor. This task was validated with the frontend HTTP test harness and production build; no live persistence or audio session was performed.

## Remaining issues / known limitations

- Permanent storage depends on the existing backend and media-store configuration. Storage or connection failures are reported without clearing the current lesson.
- The saved UI marker is component state and survives choosing stay; it is not restored automatically after a full page reload. Retrying the same local job uses the same requestId to avoid a duplicate backend lesson. If data was changed after an earlier save committed but its response was lost, the backend can return `lesson_request_conflict`; the message directs the user to inspect the lesson list.
- The existing create API stores segment text and final WAV files. Absolute original-media start/end remain in the local processor result; this task does not change that API or the database schema.

## OBSERVED-BUT-NOT-CHANGED

- Original source media is held in page memory. Restored jobs may require selecting the original file again through the existing popup fallback.
- The existing new-lesson action requires local processor cleanup to succeed before clearing the page. A disconnected processor can block starting a new lesson; the saved backend lesson is unaffected.
- Browser waveform decoding still depends on support for the selected media format.

Blockers: GitHub write access is unavailable for this task. `git push -u origin dev1/AI-SAVE-001` failed because no GitHub credentials were available in the terminal. The GitHub connector then rejected the first blob write with HTTP 403, `Resource not accessible by integration`. No branch was pushed and no merge was performed.

PUSH: NOT PUSHED — GITHUB-WRITE-NOT-AVAILABLE.

Live backend/audio end-to-end verification remains unperformed.

READY FOR MANUAL COPY: YES — full replacement page files and the spec are included in the delivery archive.
