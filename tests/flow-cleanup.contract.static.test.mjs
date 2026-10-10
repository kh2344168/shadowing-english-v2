import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const builder = read('frontend/src/app/features/admin/lesson-builder/lesson-builder.page.ts');
const builderUi = read('frontend/src/app/features/admin/lesson-builder/lesson-builder.page.html');
const authoring = read('frontend/src/app/features/admin/lesson-builder/shadowing-authoring.api.ts');
const processing = read('frontend/src/app/features/admin/ai-processing/ai-processing.page.ts');
const groups = read('frontend/src/app/features/admin/groups/groups.page.html');
const curriculum = read('frontend/src/app/features/admin/curriculums/curriculums.page.ts');
const backend = read('backend/ShadowingEnglish.Api/Modules/Curriculums/AdminCurriculumsEndpoints.cs');
const legacy = read('backend/ShadowingEnglish.Api/Modules/Lessons/AdminShadowingEndpoints.cs');
const student = read('backend/ShadowingEnglish.Api/Modules/Student/StudentLearningEndpoints.cs');
const local = read('frontend/src/app/features/admin/ai-processing/local-lesson.ts');

test('lesson creation saves only a lesson and does not assign/publish automatically', () => {
  assert.match(processing, /this\.authoringApi\.create\(/);
  assert.doesNotMatch(processing, /this\.authoringApi\.publish\(/);
  assert.match(builder, /this\.api\.create\(/);
  assert.doesNotMatch(builder, /\.publishCurriculum\(|\.assignCurriculum\(/);
});

test('manual lesson builder no longer loads unused group lists', () => {
  for (const token of ['selectedGroupId', 'weekNumber =', 'dayNumber =', 'sortOrder =', 'loadGroups(', 'LocalDraftTransfer'])
    assert.ok(!builder.includes(token), `dead builder token: ${token}`);
  assert.match(builder, /async goToCurriculum\(/);
  assert.match(builderUi, /goToCurriculum\(\)/);
});

test('manual ZIP import still exists; unused memory handoff is gone', () => {
  assert.match(local, /export async function importLesson\(/);
  assert.doesNotMatch(local, /LocalDraftTransfer/);
  assert.match(builder, /await importLesson\(file\)/);
});

test('lesson to curriculum navigation does not falsely claim publication', () => {
  assert.match(builder, /router\.navigate\(\['\/admin\/curriculums'\]/);
  assert.match(builder, /تم حفظ الدرس في المكتبة/);
  assert.match(groups, /فتح المنهج/);
  assert.doesNotMatch(groups, /إدارة المنهج والنشر/);
});

test('curriculum is only active new-publication entry point in UI and API', () => {
  assert.match(curriculum, /this\.api\.saveCurriculum\(/);
  assert.match(curriculum, /this\.api\.assignCurriculum\(/);
  assert.match(curriculum, /this\.api\.publishCurriculum\(/);
  assert.match(authoring, /\/curriculums\/publish/);
  assert.doesNotMatch(authoring, /this\.base\}\/publish`/);
  const handler = legacy.slice(legacy.indexOf('group.MapPost("/publish"'));
  assert.match(handler, /curriculum_publish_required/);
  assert.doesNotMatch(handler, /PublishedCurriculumVersions\.Add/);
});

test('republish creates new immutable version and carries unchanged student progress', () => {
  assert.doesNotMatch(backend, /active_progress_prevents_republish/);
  assert.match(backend, /no_unpublished_changes/);
  assert.match(backend, /new PublishedCurriculumVersion/);
  assert.match(backend, /db\.PublishedLessonSlots\.AddRange\(publishedSlots\)/);
  assert.match(backend, /db\.StudentStageProgress\.AddRange\(rows\.Select/);
  assert.match(backend, /oldToNew\[x\.SlotId\]/);
  assert.match(backend, /assignment\.PublishedCurriculumVersionId = version\.Id/);
  assert.doesNotMatch(backend, /StudentStageProgress\.Remove|StudentStageProgress\.ExecuteDelete/);
  assert.match(backend, /Publish\.ProgressCarried/);
});

test('students read only the active group published version and slots', () => {
  assert.match(student, /GroupCurriculumAssignments\.AsNoTracking\(\)/);
  assert.match(student, /PublishedCurriculumVersions\.AsNoTracking\(\)/);
  assert.match(student, /slot\.PublishedCurriculumVersionId == assigned\.Id/);
  assert.match(student, /member\.EndedAtUtc == null/);
});

test('Publish button opens confirmation and Cancel cannot write to the backend', () => {
  const html = read('frontend/src/app/features/admin/curriculums/curriculums.page.html');
  assert.match(html, /\(click\)="openPublishConfirmation\(\)"/);
  assert.match(html, /تأكيد نشر المنهج/);
  assert.match(html, /\(click\)="cancelPublishConfirmation\(\)"/);
  assert.match(html, /\(click\)="confirmPublishCurriculum\(\)"/);
  assert.match(curriculum, /if \(!this\.publishConfirmationOpen\(\) \|\| !this\.canPublish\(\)\) return/);
  const cancel = curriculum.slice(curriculum.indexOf('cancelPublishConfirmation(): void'),curriculum.indexOf('async confirmPublishCurriculum()'));
  assert.doesNotMatch(cancel, /\.publishCurriculum\(|\.api\.|\.write\(/);
});
