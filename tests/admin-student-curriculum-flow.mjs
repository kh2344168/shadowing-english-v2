// REAL test-DB smoke test for ADMIN-STUDENTS-TO-STUDENT-CURRICULUM-001.
// It creates persistent test rows. Never point DAY2_BASE_URL at production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = process.env.DAY2_BASE_URL ?? 'http://127.0.0.1:5017';
const adminEmail = process.env.DAY2_ADMIN_EMAIL;
const adminPassword = process.env.DAY2_ADMIN_PASSWORD;
const studentPassword = process.env.FLOW_STUDENT_PASSWORD;
if (!adminEmail || !adminPassword || !studentPassword)
  throw new Error('Set DAY2_ADMIN_EMAIL, DAY2_ADMIN_PASSWORD and FLOW_STUDENT_PASSWORD in the local test shell.');
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run test-data flow in production mode.');

function client() {
  const cookies = new Map();
  return async (url, options = {}) => {
    const headers = new Headers(options.headers);
    if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const response = await fetch(root + url, { ...options, headers, redirect: 'manual' });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { response, csrf: () => decodeURIComponent(cookies.get('XSRF-TOKEN') ?? '') };
  };
}

async function login(request, email, password) {
  const csrf = await request('/api/auth/csrf');
  assert.equal(csrf.response.status, 204, 'csrf GET');
  const result = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf.csrf() },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(result.response.status, 200, 'login');
  const fresh = await request('/api/auth/csrf');
  assert.equal(fresh.response.status, 204, 'authenticated csrf');
  return fresh.csrf();
}

async function json(request, url, options = {}) {
  const result = await request(url, options);
  const body = await result.response.json().catch(() => null);
  return { ...result, body };
}

function write(method, csrf, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf },
    body: JSON.stringify(body),
  };
}

const admin = client();
let adminCsrf = await login(admin, adminEmail, adminPassword);
const lessonsResult = await json(admin, '/api/admin/shadowing/lessons?page=1');
assert.equal(lessonsResult.response.status, 200, 'admin lesson list');
assert.ok(lessonsResult.body.items?.length, 'test DB needs at least one saved lesson with valid audio');
const lesson = lessonsResult.body.items[0];

const run = Date.now().toString(36);
const studentEmail = `flow-${run}@shadowing.test`;
const createdStudent = await json(
  admin,
  '/api/admin/groups/students',
  write('POST', adminCsrf, { email: studentEmail, password: studentPassword }),
);
assert.equal(createdStudent.response.status, 201, 'create student');
const studentId = createdStudent.body.id;

let adminDetail = await json(admin, `/api/admin/groups/students/${studentId}?lessonPage=1&pageSize=20`);
assert.equal(adminDetail.response.status, 200, 'admin detail for new student');
assert.equal(adminDetail.body.activeGroup, null, 'admin detail starts without active group');
assert.equal(adminDetail.body.publication, null, 'admin detail starts without publication');
assert.equal(adminDetail.body.lessons.length, 0, 'admin detail has no visible lessons without group');

const student = client();
await login(student, studentEmail, studentPassword);
let studentCurriculum = await json(student, '/api/student/learning/curriculum?page=1&pageSize=20');
assert.equal(studentCurriculum.response.status, 200, 'no-group curriculum');
assert.equal(studentCurriculum.body.groupName, null, 'student starts without a group');
assert.equal(studentCurriculum.body.curriculumTitle, null, 'no-group has no published curriculum');
assert.equal(studentCurriculum.body.items.length, 0, 'no-group has no lessons');

const groupRequestId = randomUUID();
const createdGroup = await json(
  admin,
  '/api/admin/groups',
  write('POST', adminCsrf, { requestId: groupRequestId, name: `Flow Group ${run}` }),
);
assert.ok([200, 201].includes(createdGroup.response.status), 'create group');
const groupId = createdGroup.body.id;

adminCsrf = (await admin('/api/auth/csrf')).csrf();
const moved = await json(
  admin,
  `/api/admin/groups/students/${studentId}/membership`,
  write('PUT', adminCsrf, { groupId, expectedMembershipId: null }),
);
assert.equal(moved.response.status, 200, 'assign student to group');

adminCsrf = (await admin('/api/auth/csrf')).csrf();
const createdCurriculum = await json(
  admin,
  '/api/admin/shadowing/curriculums',
  write('POST', adminCsrf, {
    requestId: randomUUID(),
    name: `Flow Curriculum ${run}`,
    description: 'Real test database flow',
  }),
);
assert.equal(createdCurriculum.response.status, 201, 'create curriculum draft');
const curriculumId = createdCurriculum.body.id;

adminCsrf = (await admin('/api/auth/csrf')).csrf();
const savedCurriculum = await json(
  admin,
  `/api/admin/shadowing/curriculums/${curriculumId}`,
  write('PUT', adminCsrf, {
    requestId: randomUUID(),
    expectedDraftRevision: createdCurriculum.body.draftRevision,
    name: createdCurriculum.body.name,
    description: createdCurriculum.body.description,
    lessons: [{ lessonVersionId: lesson.versionId, weekNumber: 1, dayNumber: 1, sortOrder: 1 }],
  }),
);
assert.equal(savedCurriculum.response.status, 200, 'save curriculum with lesson');

let groupState = await json(admin, `/api/admin/shadowing/groups/${groupId}/curriculum`);
assert.equal(groupState.response.status, 200, 'read group curriculum state');
assert.equal(groupState.body.versionId, null, 'new group has no publication');

adminCsrf = (await admin('/api/auth/csrf')).csrf();
const assigned = await json(
  admin,
  `/api/admin/shadowing/groups/${groupId}/curriculum-assignment`,
  write('PUT', adminCsrf, {
    requestId: randomUUID(),
    curriculumTemplateId: curriculumId,
    expectedAssignmentRevision: groupState.body.assignmentRevision,
  }),
);
assert.equal(assigned.response.status, 200, 'assign curriculum draft to group');
assert.equal(assigned.body.versionId, null, 'assignment alone does not publish');

adminDetail = await json(admin, `/api/admin/groups/students/${studentId}?lessonPage=1&pageSize=20`);
assert.equal(adminDetail.response.status, 200, 'admin detail after draft assignment');
assert.equal(adminDetail.body.activeGroup.groupId, groupId, 'admin detail current group');
assert.equal(adminDetail.body.assignedCurriculum.id, curriculumId, 'admin detail shows assigned draft');
assert.equal(adminDetail.body.publication, null, 'admin detail does not treat assignment as publication');
assert.equal(adminDetail.body.lessons.length, 0, 'admin detail hides draft-only lessons');

studentCurriculum = await json(student, '/api/student/learning/curriculum?page=1&pageSize=20');
assert.equal(studentCurriculum.response.status, 200, 'draft-only student curriculum');
assert.equal(studentCurriculum.body.curriculumTitle, null, 'draft-only curriculum is not student-visible');
assert.equal(studentCurriculum.body.items.length, 0, 'draft-only lesson is not student-visible');

groupState = await json(admin, `/api/admin/shadowing/groups/${groupId}/curriculum`);
adminCsrf = (await admin('/api/auth/csrf')).csrf();
const published = await json(
  admin,
  '/api/admin/shadowing/curriculums/publish',
  write('POST', adminCsrf, {
    requestId: randomUUID(),
    groupId,
    curriculumTemplateId: curriculumId,
    expectedDraftRevision: savedCurriculum.body.draftRevision,
    expectedAssignmentRevision: groupState.body.assignmentRevision,
    expectedVersionId: groupState.body.versionId,
  }),
);
assert.equal(published.response.status, 201, 'explicit publish');

adminDetail = await json(admin, `/api/admin/groups/students/${studentId}?lessonPage=1&pageSize=20`);
assert.equal(adminDetail.response.status, 200, 'admin detail after publish');
assert.equal(adminDetail.body.publication.versionId, published.body.versionId, 'admin detail published pointer');
assert.equal(adminDetail.body.publication.isAvailableNow, true, 'published version is currently available');
assert.equal(adminDetail.body.lessons.length, 1, 'admin detail exposes only current visible published lesson');
assert.deepEqual(
  adminDetail.body.lessons.map(({ weekNumber, dayNumber, sortOrder }) => [weekNumber, dayNumber, sortOrder]),
  [[1, 1, 1]],
  'admin detail published order',
);

studentCurriculum = await json(student, '/api/student/learning/curriculum?page=1&pageSize=20');
assert.equal(studentCurriculum.response.status, 200, 'published student curriculum');
assert.equal(studentCurriculum.body.curriculumTitle, savedCurriculum.body.name, 'published title');
assert.equal(studentCurriculum.body.items.length, 1, 'only the explicitly published test lesson is visible');
assert.deepEqual(
  studentCurriculum.body.items.map(({ weekNumber, dayNumber, sortOrder }) => [weekNumber, dayNumber, sortOrder]),
  [[1, 1, 1]],
  'published order',
);
const slotId = studentCurriculum.body.items[0].slotId;
const overview = await json(student, `/api/student/learning/slots/${slotId}`);
assert.equal(overview.response.status, 200, 'lesson overview');
assert.equal(overview.body.slotId, slotId, 'overview scoped to visible slot');

console.log('ADMIN-STUDENT-CURRICULUM REAL API FLOW PASS: no-group -> draft-only hidden -> explicit publish -> ordered curriculum -> overview.');
