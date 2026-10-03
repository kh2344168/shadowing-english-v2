import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const backend = read('backend/ShadowingEnglish.Api/Modules/Groups/AdminGroupsEndpoints.cs');
const api = read('frontend/src/app/features/admin/groups/groups.api.ts');
const page = read('frontend/src/app/features/admin/students/detail/student-details.page.ts');
const html = read('frontend/src/app/features/admin/students/detail/student-details.page.html');
const routes = read('frontend/src/app/app.routes.ts');
const studentsHtml = read('frontend/src/app/features/admin/students/students.page.html');

const start = backend.indexOf('group.MapGet("/students/{studentId:guid}"');
const end = backend.indexOf('group.MapGet("/students/{studentId:guid}/history"', start);
const detailEndpoint = backend.slice(start, end);

test('student details has a real lazy route and is reachable from the students list', () => {
  assert.match(routes, /path:\s*'students\/:studentId'[\s\S]*student-details\.page/);
  assert.match(studentsHtml, /\['\/admin\/students', student\.id\]/);
  assert.match(api, /studentDetail\(studentId: string, lessonPage = 1\)/);
  assert.match(page, /this\.api\.studentDetail\(studentId, page\)/);
});

test('admin student detail read is authorized, no-store and has no business writes', () => {
  assert.ok(start >= 0 && end > start, 'missing admin student detail endpoint');
  assert.match(backend, /MapGroup\("\/api\/admin\/groups"\)[\s\S]*Roles = "Admin"/);
  assert.match(detailEndpoint, /CurrentAdminAsync\(context, users\)/);
  assert.match(detailEndpoint, /context\.Response\.Headers\.CacheControl = "no-store"/);
  assert.doesNotMatch(
    detailEndpoint,
    /SaveChanges|\.Add\(|\.Remove\(|\.Update\(|ExecuteDelete|ExecuteUpdate|Migrate|EnsureCreated/,
  );
});

test('detail visibility mirrors student publication and availability gates', () => {
  assert.match(detailEndpoint, /assignment\.GroupId == active\.GroupId && version\.GroupId == active\.GroupId/);
  assert.match(detailEndpoint, /published\.PublishedAtUtc <= now && published\.AvailableAtUtc <= now/);
  assert.match(detailEndpoint, /slot\.PublishedCurriculumVersionId == published\.Id &&[\s\S]*slot\.AvailableAtUtc <= now/);
  assert.match(detailEndpoint, /item\.StageKey == "shadowing"/);
  assert.match(detailEndpoint, /item\.PublishedCurriculumVersionId == published\.Id/);
  assert.match(detailEndpoint, /OrderBy\(item => item\.WeekNumber\)[\s\S]*ThenBy\(item => item\.DayNumber\)[\s\S]*ThenBy\(item => item\.SortOrder\)/);
});

test('UI clearly separates draft assignment from current student-visible publication', () => {
  assert.match(page, /يوجد منهج مسند كمسودة، لكنه غير منشور للطالب/);
  assert.match(page, /Student API/);
  assert.match(html, /المسودة أو الإسناد وحدهما لا يظهِران الدروس/);
  assert.match(html, /published version \+ availability rules/);
  assert.doesNotMatch(html, /مسودة[^\n]{0,120}متاح الآن/);
});

test('student detail diagnostics are safe and do not log email or lesson content', () => {
  for (const marker of [
    'Admin.Students.Detail.Start',
    'Admin.Students.Detail.Success',
    'Admin.StudentDetails.UI.Load.Start',
    'Admin.StudentDetails.UI.Load.Success',
    'Admin.StudentDetails.UI.Load.Failed',
  ]) assert.ok((backend + page).includes(marker), `missing ${marker}`);
  const logCalls = [
    ...(detailEndpoint.match(/logger\.Log(?:Information|Warning|Error)\([^;]+;/gs) ?? []),
    ...(page.match(/console\.(?:info|warn)\([^;]+;/gs) ?? []),
  ].join('\n');
  assert.doesNotMatch(logCalls, /student\.Email|lesson\.Title|response\.student\.email/);
});
