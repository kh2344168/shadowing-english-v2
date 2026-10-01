/** Day2 static shell contract: runs without Angular dependencies; not a substitute for ng build/unit/E2E. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'frontend/src/app');
const read = p => fs.readFileSync(path.join(app, p), 'utf8');
let ts;
try { ts = createRequire(__filename)('typescript'); } catch { /* Angular build verifies this when dependencies are installed */ }
const routeSource = read('app.routes.ts');
const nav = ['admin','student','teacher','supervisor'].map(role => read(`shared/layouts/${role}-layout/${role}-layout.html`)).join('\n');
const routeImports = [...routeSource.matchAll(/import\(\s*'([^']+)'\s*\)\.then\(\s*\(?\w+\)?\s*=>\s*\w+\.([A-Za-z0-9_]+)\s*,?\s*\)/g)];

test('all 4 role layouts, admin accounts, and student dashboard are routed with lazy imports', () => {
  for (const role of ['admin', 'student', 'teacher', 'supervisor']) {
    assert.match(routeSource, new RegExp(`path: '${role}'`));
    assert.match(routeSource, new RegExp(`canActivateChild: \\[roleGuard\\('${role[0].toUpperCase()+role.slice(1)}'\\)\\]`));
    assert.match(routeSource, new RegExp(`shared/layouts/${role}-layout/${role}-layout`));
  }
  assert.match(routeSource, /admin\/accounts\/admin-accounts\.page/);
  assert.match(routeSource, /student\/dashboard\/student-dashboard\.page/);
  assert.match(routeSource, /lessons\/:slotId\/shadowing/);
});

test('every lazy route imports an existing file exporting the exact class', () => {
  assert.ok(routeImports.length >= 35, 'expected all confirmed pages');
  for (const [, modulePath, exported] of routeImports) {
    const file = path.resolve(app, modulePath.replace(/^\.\//, '') + '.ts');
    assert.ok(fs.existsSync(file), `missing ${file}`);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`export class ${exported}\\b`), `missing export ${exported}`);
  }
});

test('navigation targets correspond to configured routes', () => {
  const entries = [...nav.matchAll(/routerLink="\/([^"]+)"/g)].map(match => match[1]);
  assert.ok(entries.length >= 20);
  for (const entry of new Set(entries)) {
    const [role, ...rest] = entry.split('/');
    assert.ok(['admin','student','teacher','supervisor','logout'].includes(role), entry);
    if (role === 'logout') continue;
    assert.match(routeSource, new RegExp(`path: '${rest.join('/')}'`), `unrouted nav: ${entry}`);
  }
});

test('relative TypeScript imports resolve within the project', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
  const files = walk(app).filter(f => f.endsWith('.ts'));
  for (const file of files) {
    const source = fs.readFileSync(file,'utf8');
    for (const [, imp] of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const abs = path.resolve(path.dirname(file), imp);
      assert.ok(fs.existsSync(abs+'.ts') || fs.existsSync(abs+'.tsx') || fs.existsSync(path.join(abs,'index.ts')), `broken import ${imp} in ${file}`);
    }
  }
});

test('new page shells do not fetch, write, or fabricate business data', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
  const shells = walk(path.join(app,'features')).filter(f=>f.endsWith('.page.ts') && !/admin-accounts|groups|login|logout|dashboard/.test(path.basename(f)));
  assert.ok(shells.length>=30);
  for (const file of shells) {
    const content = fs.readFileSync(file,'utf8');
    assert.doesNotMatch(content, /HttpClient|localStorage|\.post\(|\.put\(|\.delete\(|fetch\(/);
    assert.match(content, /FeaturePlaceholderComponent|templateUrl:/);
  }
  assert.match(read('core/config/role-availability.ts'), /Teacher: false/);
  assert.match(read('core/config/role-availability.ts'), /Supervisor: false/);
});

test('TypeScript syntax has no parser errors (when TypeScript is installed)', t => {
  if (!ts) { t.skip('TypeScript dependency unavailable; check with npm run build'); return; }
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
  const sources = walk(app).filter(f=>f.endsWith('.ts'));
  for (const file of sources) {
    const sf=ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.equal(sf.parseDiagnostics.length,0, `${file} has parser errors`);
  }
});
