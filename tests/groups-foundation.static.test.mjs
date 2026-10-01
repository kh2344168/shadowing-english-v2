import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const db = read('backend/ShadowingEnglish.Infrastructure/Database/ApplicationDbContext.cs');
const migration = read('backend/ShadowingEnglish.Infrastructure/Database/Migrations/20260928154813_AddGroupsFoundation.cs');
const snapshot = read('backend/ShadowingEnglish.Infrastructure/Database/Migrations/ApplicationDbContextModelSnapshot.cs');
const endpoints = read('backend/ShadowingEnglish.Api/Modules/Groups/AdminGroupsEndpoints.cs');
const program = read('backend/ShadowingEnglish.Api/Program.cs');

test('a database constraint permits at most one active membership and keeps closed history', () => {
  assert.match(db, /HasIndex\(membership => membership\.StudentId\)[\s\S]*?\.IsUnique\(\)[\s\S]*?\.HasFilter\("\[EndedAtUtc\] IS NULL"\)/);
  assert.match(migration, /name: "UX_StudentGroupMemberships_ActiveStudent"[\s\S]*?column: "StudentId", unique: true, filter: "\[EndedAtUtc\] IS NULL"/);
  assert.match(migration, /table\.CheckConstraint\("CK_StudentGroupMemberships_EndAfterStart"/);
  assert.match(migration, /onDelete: ReferentialAction\.Restrict/);
  assert.match(snapshot, /"UX_StudentGroupMemberships_ActiveStudent"/);
  assert.match(snapshot, /"CK_StudentGroupMemberships_EndAfterStart"/);
  assert.match(migration, /name: "IX_StudyGroups_CreateRequestId"[\s\S]*?unique: true/);
});

test('group writes are admin-only, rate-limited and explicitly validate CSRF', () => {
  assert.match(endpoints, /MapGroup\("\/api\/admin\/groups"\)[\s\S]*?RequireAuthorization\(new AuthorizeAttribute \{ Roles = "Admin" \}\)/);
  assert.equal((endpoints.match(/ValidCsrfAsync\(context, antiforgery\)/g) ?? []).length, 2);
  assert.equal((endpoints.match(/RequireRateLimiting\("admin-group-write"\)/g) ?? []).length, 2);
  assert.match(program, /app\.MapAdminGroupsEndpoints\(\)/);
  assert.match(endpoints, /CreateRequestId == request\.RequestId\.Value/);
});

test('a move checks expected membership, closes the old row before inserting, and never deletes history', () => {
  assert.match(endpoints, /BeginTransactionAsync\(IsolationLevel\.Serializable\)/);
  assert.match(endpoints, /active\?\.Id != request\.ExpectedMembershipId[\s\S]*?membership_changed/);
  assert.match(endpoints, /active\.EndedAtUtc = now;[\s\S]*?await db\.SaveChangesAsync\(\);[\s\S]*?db\.StudentGroupMemberships\.Add\(next\)/);
  assert.doesNotMatch(endpoints, /StudentGroupMemberships\.Remove|ExecuteDeleteAsync|MigrateAsync\(/);
  assert.doesNotMatch(program, /MigrateAsync\(|EnsureCreatedAsync\(/);
});
