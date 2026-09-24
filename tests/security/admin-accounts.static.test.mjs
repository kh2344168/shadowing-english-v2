// Structural checks only; NOT a substitute for a .NET build or live Auth/SQL checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const source = readFileSync(new URL('../../backend/ShadowingEnglish.Api/Modules/Admin/AdminAccountsEndpoints.cs', import.meta.url), 'utf8');
const program = readFileSync(new URL('../../backend/ShadowingEnglish.Api/Program.cs', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../frontend/src/app/app.routes.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../frontend/src/app/features/admin/accounts/admin-accounts.page.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../../frontend/src/app/features/admin/accounts/admin-accounts.page.html', import.meta.url), 'utf8');
test('admin HTTP group is role protected and route is lazy', () => {
  assert.match(source, /RequireAuthorization\(new AuthorizeAttribute \{ Roles = "Admin" \}\)/);
  assert.match(program, /app\.MapAdminAccountsEndpoints\(\)/);
  assert.match(routes, /path: 'admin\/accounts'[\s\S]*?canActivate: \[roleGuard\('Admin'\)\][\s\S]*?loadComponent/);
});
test('owner is verified from configured identity GUID; not from email or first login', () => {
  assert.match(source, /Guid\.TryParse\(config\["PrimaryAdmin:UserId"\]/);
  assert.match(source, /users\.FindByIdAsync\(id\.ToString\(\)\)/);
  assert.match(source, /users\.IsInRoleAsync\(owner, "Admin"\)/);
  assert.match(source, /primary_admin_not_configured/);
  assert.doesNotMatch(source, /FindByEmailAsync\("admin@/);
});
test('create/remove use csrf, and only verified owner can remove non-owner role', () => {
  assert.equal((source.match(/HasValidCsrfAsync\(context, antiforgery\)/g) ?? []).length, 2);
  assert.match(source, /actor\.Id != ownerId\.Value\) return Denied\(logger, "RemoveOwnerOnly"/);
  assert.match(source, /if \(id == ownerId\.Value\)/);
  assert.match(source, /users\.RemoveFromRoleAsync\(target, "Admin"\)/);
  assert.doesNotMatch(source, /users\.DeleteAsync\(/);
  assert.match(source, /RequireRateLimiting\("admin-create"\)/);
  assert.match(program, /options.AddPolicy\("admin-create"/);
});
test('all admins can list; only primary admin gets removal UI; secrets are not logged', () => {
  assert.match(page, /this\.admins\.set\(await firstValueFrom\(this\.api\.list\(\)\)\)/);
  assert.doesNotMatch(source, /ListOwnerOnly/);
  assert.match(template, /@else if \(isPrimaryAdmin\(\)\)/);
  assert.match(template, />عرض فقط</);
  assert.match(page, /if \(!this\.isPrimaryAdmin\(\)/);
  assert.doesNotMatch(page, /console\.[a-z]+\([^\n]*(?:this\.password|this\.email)/);
});
