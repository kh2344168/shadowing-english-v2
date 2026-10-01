import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const context = read('backend/ShadowingEnglish.Infrastructure/Database/ApplicationDbContext.cs');
const migration = read('backend/ShadowingEnglish.Infrastructure/Database/Migrations/20260928213000_AddStudentCore.cs');
const snapshot = read('backend/ShadowingEnglish.Infrastructure/Database/Migrations/ApplicationDbContextModelSnapshot.cs');
const api = read('backend/ShadowingEnglish.Api/Modules/Student/StudentLearningEndpoints.cs');
const program = read('backend/ShadowingEnglish.Api/Program.cs');
const fixture = read('backend/ShadowingEnglish.Api/Bootstrap/LocalDay2Fixture.cs');

test('published copies, slots and scoped progress are relational with an exact logical key', () => {
  for (const table of ['LessonDefinitions','LessonVersions','LessonSegments','CurriculumTemplates','PublishedCurriculumVersions','GroupCurriculumAssignments','PublishedLessonSlots','StudentStageProgress']) {
    assert.match(migration, new RegExp(`CreateTable\\(name: "${table}"`));
    assert.match(snapshot, new RegExp(`ToTable\\("${table}"`));
  }
  assert.match(context, /HasKey\(x => new \{ x\.StudentId, x\.PublishedCurriculumVersionId, x\.SlotId, x\.StageKey \}\)/);
  assert.match(migration, /table\.PrimaryKey\("PK_StudentStageProgress", x => new \{ x\.StudentId, x\.PublishedCurriculumVersionId, x\.SlotId, x\.StageKey \}\)/);
  assert.match(context, /RejectPublishedMutations\(\)/);
  assert.doesNotMatch(migration.split('protected override void Down')[0], /DropTable|DropColumn|DeleteData|Sql\(/);
});

test('student reads require real current membership, published availability and the same group; writes require CSRF', () => {
  assert.match(api, /RequireAuthorization\(new AuthorizeAttribute \{ Roles = "Student" \}\)/);
  assert.match(api, /member\.StudentId == studentId && member\.EndedAtUtc == null/);
  assert.match(api, /version\.GroupId == member\.GroupId && version\.PublishedAtUtc <= now/);
  assert.match(api, /slot\.Id == slotId && slot\.AvailableAtUtc <= now/);
  assert.match(api, /antiforgery\.ValidateRequestAsync\(http\)/);
  assert.match(api, /BeginTransactionAsync\(IsolationLevel\.Serializable\)/);
  assert.match(api, /request\.CompletedSegments > previous \+ 1/);
  assert.match(api, /request\.CompletedSegments > previous/);
  assert.match(api, /enableRangeProcessing: true/);
  assert.match(api, /private, no-cache/);
  assert.match(program, /app\.MapStudentLearningEndpoints\(\)/);
});

test('explicit fixture is development-only and never runs at startup without its CLI flag', () => {
  assert.match(program, /args\.Contains\("--provision-day2-fixture"/);
  assert.match(fixture, /if \(!app\.Environment\.IsDevelopment\(\)\)/);
  assert.match(fixture, /GetPendingMigrationsAsync\(\)/);
  assert.match(fixture, /active is not null && active\.GroupId != GroupId/);
  assert.doesNotMatch(program, /MigrateAsync\(|EnsureCreatedAsync\(/);
});
