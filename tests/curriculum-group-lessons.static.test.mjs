import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const curriculums = read(
  'backend/ShadowingEnglish.Api/Modules/Curriculums/AdminCurriculumsEndpoints.cs',
);
const groupRead = curriculums.slice(
  curriculums.indexOf('api.MapGet("/groups/{groupId:guid}/curriculum"'),
  curriculums.indexOf('api.MapPut("/groups/{groupId:guid}/curriculum-assignment"'),
);
const groupProjection = curriculums.slice(
  curriculums.indexOf('private static async Task<GroupCurriculumState?> ReadGroup'),
  curriculums.indexOf('private static bool ValidName'),
);

test('admin group curriculum read is authorized, group scoped, uncached and read only', () => {
  assert.ok(groupRead.length > 0, 'Missing curriculum read endpoint');
  assert.match(
    curriculums.slice(0, curriculums.indexOf('api.MapGet')),
    /RequireAuthorization\(new AuthorizeAttribute \{ Roles = "Admin" \}\)/,
  );
  assert.match(groupRead, /IsAdmin\(http, users\)/);
  assert.match(groupRead, /ReadGroup\(db, groupId/);
  assert.match(groupRead, /BeginTransactionAsync\(IsolationLevel\.Serializable/);
  assert.match(curriculums, /http\.Response\.Headers\.CacheControl = "no-store"/);
  assert.doesNotMatch(
    groupRead,
    /SaveChanges|\.Add\(|\.Update\(|\.Remove\(|ExecuteUpdate|ExecuteDelete|EnsureCreated|Migrate/,
  );
});

test('student curriculum projection returns only ordered published lesson metadata', () => {
  assert.match(
    groupProjection,
    /assignment\.GroupId == groupId && published\.GroupId == groupId/,
  );
  assert.match(groupProjection, /slot\.PublishedCurriculumVersionId == version\.Id/);
  assert.match(groupProjection, /orderby slot\.WeekNumber, slot\.DayNumber, slot\.SortOrder/);
  assert.match(groupProjection, /new PublishedLesson\(lesson\.LessonDefinitionId, lesson\.Id, lesson\.Title/);
  assert.match(groupProjection, /new GroupCurriculumState\(/);
  assert.doesNotMatch(groupProjection, /LessonSegments|AudioStorageKey|StudentGroupMemberships|StudentStageProgress/);
  const dto = curriculums.match(/record PublishedLesson\(([^;]*?)\);/)?.[1];
  assert.ok(dto);
  for (const field of ['LessonId', 'LessonVersionId', 'Title', 'WeekNumber', 'DayNumber', 'SortOrder'])
    assert.ok(dto.includes(field));
  assert.doesNotMatch(dto, /Audio|Token|Credential|Student|Text|Description/);
});

test('curriculum diagnostics expose lifecycle events without raw exception or content logging', () => {
  const operation = curriculums.slice(
    curriculums.indexOf('private sealed class Operation'),
    curriculums.indexOf('public sealed record CreateCurriculum'),
  );
  for (const event of ['Start', 'Success', 'Failed']) assert.ok(operation.includes(`.{Operation}.${event}`));
  assert.match(operation, /public IResult Exception\(Exception ex\)/);
  assert.match(operation, /ex\.GetType\(\)\.Name/);
  assert.doesNotMatch(operation, /ex\.Message|ex\.ToString\(|lesson\.Title.*log/i);
});

test('publication is explicit, CSRF protected, idempotent and preserves progress snapshots', () => {
  const publish = curriculums.slice(
    curriculums.indexOf('api.MapPost("/curriculums/publish"'),
    curriculums.indexOf('private static IResult PublicationRetry'),
  );
  assert.ok(publish.length > 0, 'Missing curriculum publish endpoint');
  assert.match(publish, /AuthorizeWrite\(http, csrf, users, op\)/);
  assert.match(curriculums, /csrf\.ValidateRequestAsync\(http\)/);
  assert.match(publish, /IsolationLevel\.Serializable/);
  for (const reason of [
    'active_progress_prevents_republish',
    'publication_changed',
    'publish_request_conflict',
    'lesson_audio_missing',
  ])
    assert.ok(curriculums.includes(reason));
  assert.match(publish, /group\.AssignedCurriculumTemplateId != request\.CurriculumTemplateId/);
  assert.match(publish, /group\.CurriculumAssignmentRevision != request\.ExpectedAssignmentRevision/);
  assert.match(publish, /template\.DraftRevision != request\.ExpectedDraftRevision/);
  assert.match(publish, /StudentStageProgress\.AsNoTracking\(\)/);
  assert.doesNotMatch(publish, /StudentStageProgress\.(?:Remove|Update)|ExecuteDelete|RemoveRange/);
});
