import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const backend = read('backend/ShadowingEnglish.Api/Modules/Groups/AdminGroupsEndpoints.cs');
const api = read('frontend/src/app/features/admin/groups/groups.api.ts');
const students = read('frontend/src/app/features/admin/students/students.page.ts');
const studentsHtml = read('frontend/src/app/features/admin/students/students.page.html');
const groups = read('frontend/src/app/features/admin/groups/groups.page.ts');
const curriculums = read('frontend/src/app/features/admin/curriculums/curriculums.page.ts');
const routes = read('frontend/src/app/app.routes.ts');

test('admin students route uses the real page and shared AdminGroupsApi contracts', () => {
  assert.match(routes, /path:\s*'students'[\s\S]*students\.page/);
  assert.match(students, /AdminGroupsApi/);
  for (const call of ['searchStudents', 'moveStudent', 'history', 'createStudent'])
    assert.match(students, new RegExp(`this\\.api\\.${call}\\(`));
  assert.match(api, /\/api\/admin\/groups/);
  assert.match(api, /createStudent\(email: string, password: string\)/);
});

test('student creation is Admin scoped, CSRF protected, validated, rate limited and never returns password', () => {
  assert.match(backend, /MapGroup\("\/api\/admin\/groups"\)[\s\S]*Roles = "Admin"/);
  const start = backend.indexOf('group.MapPost("/students"');
  const end = backend.indexOf('group.MapGet("/students"', start);
  assert.ok(start >= 0 && end > start, 'missing create student endpoint');
  const create = backend.slice(start, end);
  assert.match(create, /ValidCsrfAsync\(context, antiforgery\)/);
  assert.match(create, /EmailAddressAttribute/);
  assert.match(create, /users\.CreateAsync\(student, request\.Password\)/);
  assert.match(create, /users\.AddToRoleAsync\(student, "Student"\)/);
  assert.match(create, /RequireRateLimiting\("admin-create"\)/);
  assert.match(create, /new \{ id = student\.Id, email = student\.Email \}/);
  assert.doesNotMatch(create, /new \{[^}]*password/i);
  for (const logLine of create.match(/logger\.Log(?:Information|Warning|Error)\([^;]+;/gs) ?? [])
    assert.doesNotMatch(logLine, /request\.Password|\bemail\b\s*[},]/i);
});

test('membership remains one-active-group with explicit concurrency and preserved history', () => {
  assert.match(backend, /EndedAtUtc == null/);
  assert.match(backend, /active\?\.Id != request\.ExpectedMembershipId/);
  assert.match(backend, /active\.EndedAtUtc = now/);
  assert.match(backend, /new StudentGroupMembership/);
  assert.match(backend, /MapGet\("\/students\/\{studentId:guid\}\/history"/);
  assert.match(students, /confirmMoveId\(\) !== student\.id/);
  assert.match(studentsHtml, /تأكيد|التأكيد/);
});

test('admin UI never treats draft assignment alone as student-visible publication', () => {
  assert.match(students, /assignedCurriculumTemplateId[\s\S]*لم يُنشر للطلاب/);
  assert.match(students, /currentVersionId[\s\S]*Student API/);
  assert.doesNotMatch(students, /assignedCurriculumTemplateId[\s\S]{0,100}يرى المنهج/);
});

test('DEV2 page behavior keeps explicit workflow and guards pagination reads', () => {
  assert.match(curriculums, /LoadCurriculums/);
  assert.match(curriculums, /LoadLessons/);
  assert.match(curriculums, /LoadGroups/);
  assert.match(curriculums, /if \(this\.loadingCurriculums\(\)\) return false/);
  assert.match(groups, /if \(this\.loadingGroups\(\)\) return/);
  assert.match(groups, /new Map\(\[\.\.\.current, \.\.\.response\.items\]/);
  assert.match(groups, /publishedGroupsCount/);
  assert.match(groups, /assignedDraftOnlyCount/);
});
