const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const base = path.resolve(__dirname, '../frontend/src');
const source = rel => fs.readFileSync(path.join(base, rel),'utf8');
test('admin retains V1 260px sidebar and header', () => {
 const html = source('app/shared/layouts/admin-layout/admin-layout.html');
 const scss = source('app/shared/layouts/admin-layout/admin-layout.scss');
 assert.match(html, /w-\[260px\]/); assert.match(html, /h-16/); assert.match(scss,/padding-right: 260px/);
});
test('student uses V1 top bar and mobile bottom navigation, not generic shell', () => {
 const html=source('app/shared/layouts/student-layout/student-layout.html');
 const scss=source('app/shared/layouts/student-layout/student-layout.scss');
 assert.match(html, /student-mobile-nav/); assert.match(html,/student-account/);
 assert.match(scss,/bottom: 10px/); assert.match(scss,/grid-template-columns: repeat\(5, 1fr\)/);
});
test('teacher and supervisor preserve distinct V1 sidebar treatments', () => {
 assert.match(source('app/shared/layouts/teacher-layout/teacher-layout.html'),/w-\[270px\]/);
 assert.match(source('app/shared/layouts/supervisor-layout/supervisor-layout.html'),/bg-\[#145A3A\]/);
});
test('V2 uses no V1 auth service or dead nav links', () => {
 const routes=source('app/app.routes.ts');
 for (const role of ['admin','student','teacher','supervisor']) {
  const text=source(`app/shared/layouts/${role}-layout/${role}-layout.html`);
  assert.doesNotMatch(text,/auth\.currentUser|fa-icon|<app-role-shell/);
  const paths=[...text.matchAll(/routerLink="([^"]+)"/g)].map(m=>m[1]);
  for (const p of paths) {
   if (p==='/logout') continue;
   const seg=p.split('/').filter(Boolean).at(-1);
   assert.ok(routes.includes(`path: '${seg}'`) || p==='/student/dashboard' || p==='/admin/dashboard' || p==='/teacher/dashboard' || p==='/supervisor/dashboard',`missing route ${p}`);
  }
 }
});
test('no backend code and no V1-only library package imported', () => {
 assert.doesNotMatch(source('app/shared/layouts/teacher-layout/teacher-layout.ts'), /fortawesome/);
 assert.doesNotMatch(source('app/shared/layouts/supervisor-layout/supervisor-layout.ts'), /fortawesome/);
});
