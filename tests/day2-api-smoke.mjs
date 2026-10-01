// Run against a LOCAL V2 test database with the explicit fixture; never uses production credentials.
import assert from 'node:assert/strict';

const root = process.env.DAY2_BASE_URL ?? 'http://127.0.0.1:5017';
for (const name of ['DAY2_ADMIN_EMAIL', 'DAY2_ADMIN_PASSWORD', 'DAY2_STUDENT_EMAIL', 'DAY2_STUDENT_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Set ${name} in your local shell before running this smoke test.`);
}
const path = '/api/student/learning';
function client() {
  const cookies = new Map();
  return async (url, options = {}) => {
    const headers = new Headers(options.headers);
    if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(root + url, { ...options, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';'); const i = pair.indexOf('=');
      if (i > 0) cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { response: res, csrf: () => decodeURIComponent(cookies.get('XSRF-TOKEN') ?? '') };
  };
}
async function login(request, email, password) {
  const token = await request('/api/auth/csrf');
  assert.equal(token.response.status, 204, 'csrf GET');
  const result = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token.csrf() },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(result.response.status, 200, 'local account login');
  const fresh = await request('/api/auth/csrf');
  assert.equal(fresh.response.status, 204, 'authenticated csrf');
  return fresh.csrf();
}
const anonymous = client();
assert.equal((await anonymous(`${path}/curriculum`)).response.status, 401, 'anonymous curriculum');
const admin = client();
await login(admin, process.env.DAY2_ADMIN_EMAIL, process.env.DAY2_ADMIN_PASSWORD);
assert.equal((await admin(`${path}/curriculum`)).response.status, 403, 'admin cannot read student data');
const student = client();
const csrf = await login(student, process.env.DAY2_STUDENT_EMAIL, process.env.DAY2_STUDENT_PASSWORD);
const initial = await student(`${path}/curriculum?page=1&pageSize=20`);
assert.equal(initial.response.status, 200, 'student curriculum');
const curriculum = await initial.response.json();
assert.equal(curriculum.items.length, 1, 'explicit fixture visible');
assert.ok(curriculum.groupName && curriculum.curriculumTitle);
const slot = curriculum.items[0].slotId;
for (const [id, label] of [
  ['d2000000-0000-4000-8000-000000000007', 'future slot'],
  ['d2000000-0000-4000-8000-000000000008', 'other group slot'],
  ['d2000000-0000-4000-8000-000000000015', 'unassigned published version'],
]) {
  assert.equal((await student(`${path}/slots/${id}`)).response.status, 404, label + ' concealed');
  assert.equal((await student(`${path}/slots/${id}/segments/1`)).response.status, 404, label + ' segment concealed');
}
const overview = await student(`${path}/slots/${slot}`);
assert.equal(overview.response.status, 200);
const starting = await overview.response.json();
assert.equal(starting.segmentCount, 2);
const one = await student(`${path}/slots/${slot}/segments/1`);
assert.equal(one.response.status, 200);
const segment = await one.response.json();
assert.equal((await student(segment.audioUrl, { headers: { Range: 'bytes=0-255' } })).response.status, 206, 'audio range');
const saveUrl = `${path}/slots/${slot}/progress`;
const body = n => ({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf }, body: JSON.stringify({ completedSegments: n }) });
assert.equal((await student(saveUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completedSegments: 1 }) })).response.status, 400, 'csrf enforced');
if (!starting.completedSegments) {
  assert.equal((await student(saveUrl, body(2))).response.status, 409, 'cannot skip ahead');
}
const sequence = starting.completedSegments === 0 ? [1, 1, 2, 2]
  : starting.completedSegments === 1 ? [1, 2, 2] : [2, 2];
for (const count of sequence) {
  const response = await student(saveUrl, body(count));
  assert.equal(response.response.status, 200, `idempotent save ${count}`);
  assert.equal((await response.response.json()).completedSegments, count);
}
const restored = await student(`${path}/slots/${slot}`);
const state = await restored.response.json();
assert.equal(state.completedSegments, 2);
assert.equal(state.isComplete, true);
const second = await student(`${path}/slots/${slot}/segments/2`);
assert.equal(second.response.status, 200);
if (process.env.DAY2_OTHER_STUDENT_EMAIL && process.env.DAY2_OTHER_STUDENT_PASSWORD) {
  const other = client();
  await login(other, process.env.DAY2_OTHER_STUDENT_EMAIL, process.env.DAY2_OTHER_STUDENT_PASSWORD);
  assert.equal((await other(`${path}/slots/${slot}`)).response.status, 404, 'second student cannot see slot');
}
console.log('DAY2 API PASS: 401 / 403 / group-scoped curriculum / future, other group and unassigned versions hidden / partial audio / CSRF / idempotent save / refresh.');
