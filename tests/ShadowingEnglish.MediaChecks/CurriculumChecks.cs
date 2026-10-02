using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;
using static ShadowingEnglish.Api.Modules.Curriculums.AdminCurriculumsEndpoints;

namespace ShadowingEnglish.MediaChecks;

// Exercises real endpoints, Identity/CSRF, relational constraints and private audio in an isolated database.
internal static class CurriculumChecks
{
    private const string PrivateName = "Private curriculum title sentinel";
    private const string PrivateDescription = "Private curriculum description sentinel";
    private const string PrivateTranscript = "Private curriculum transcript sentinel";
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }

    public static async Task RunAsync(string root, IShadowingMediaStore media, SafeLogs logs, byte[] wave,
        Func<string, Func<Task>, Task> check)
    {
        using var app = new MediaApp(root, media, logs);
        await app.SetupAsync();
        using var admin = await app.LoginAsync("admin");
        using var student = await app.LoginAsync("student");
        using var other = await app.LoginAsync("other");
        var id = Guid.NewGuid();
        var path = $"/api/admin/shadowing/curriculums/{id}";
        var groupPath = $"/api/admin/shadowing/groups/{app.GroupId}/curriculum";
        var assignPath = $"/api/admin/shadowing/groups/{app.GroupId}/curriculum-assignment";
        CurriculumDraft draft = null!;
        GroupCurriculumState group = null!;
        Guid firstLesson = Guid.Empty, secondLesson = Guid.Empty;
        PublishCurriculum firstPublish = null!;
        Publication firstVersion = null!, secondVersion = null!;
        var create = new CreateCurriculum(id, PrivateName, PrivateDescription);

        await check("Curriculum endpoints require Admin and real CSRF", async () =>
        {
            using var anonymous = app.Client();
            using var denied = await anonymous.GetAsync("/api/admin/shadowing/curriculums");
            using var forbidden = await student.GetAsync("/api/admin/shadowing/curriculums");
            Assert(denied.StatusCode == HttpStatusCode.Unauthorized && forbidden.StatusCode == HttpStatusCode.Forbidden,
                "curriculum_read_auth_not_enforced");
            var token = admin.DefaultRequestHeaders.GetValues("X-XSRF-TOKEN").Single();
            admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
            using var noCsrf = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", create);
            admin.DefaultRequestHeaders.Add("X-XSRF-TOKEN", token);
            Assert(noCsrf.StatusCode == HttpStatusCode.BadRequest, "curriculum_write_without_csrf");
        });
        await check("Create saves an independent draft and is idempotent", async () =>
        {
            using var response = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", create);
            Assert(response.StatusCode == HttpStatusCode.Created, "create_status_" + response.StatusCode);
            draft = (await response.Content.ReadFromJsonAsync<CurriculumDraft>())!;
            Assert(draft.Id == id && draft.DraftRevision != Guid.Empty && draft.Lessons.Length == 0, "draft_not_created");
            var before = await app.FingerprintAsync();
            using var retry = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", create);
            using var conflict = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", create with { Name = "Changed title" });
            Assert(retry.StatusCode == HttpStatusCode.OK && conflict.StatusCode == HttpStatusCode.Conflict &&
                before == await app.FingerprintAsync(), "create_retry_changed_state");
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(!await db.GroupCurriculumAssignments.AnyAsync() && !await db.PublishedCurriculumVersions.AnyAsync() &&
                !await db.StudyGroups.AnyAsync(x => x.AssignedCurriculumTemplateId != null), "create_assigned_or_published");
        });
        await check("Two real saved lessons remain invisible before publication", async () =>
        {
            firstLesson = await SaveLesson(admin, wave, "First saved lesson");
            secondLesson = await SaveLesson(admin, wave, "Second saved lesson");
            Assert((await Read<JsonElement>(student, "/api/student/learning/curriculum")).GetProperty("items").GetArrayLength() == 0,
                "saved_lesson_visible_without_publish");
        });
        await check("A new legacy lesson-to-group request cannot publish even before curriculum assignment", async () =>
        {
            var before = await app.FingerprintAsync();
            using var response = await admin.PostAsJsonAsync("/api/admin/shadowing/publish", new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId, lessonVersionId = firstLesson,
                expectedVersionId = (Guid?)null, weekNumber = 1, dayNumber = 1, sortOrder = 1
            });
            Assert(await Error(response, HttpStatusCode.Conflict) == "curriculum_publish_required" &&
                before == await app.FingerprintAsync(), "legacy_new_publication_accepted");
        });
        await check("Save persists lesson order and refresh never assigns or publishes", async () =>
        {
            var save = Save(draft, [new(secondLesson, 2, 3, 4), new(firstLesson, 1, 2, 2)]);
            using var response = await admin.PutAsJsonAsync(path, save);
            Assert(response.StatusCode == HttpStatusCode.OK, "save_status_" + response.StatusCode);
            draft = await Read<CurriculumDraft>(admin, path);
            Assert(draft.Name == PrivateName && draft.Description == PrivateDescription && draft.Lessons.Length == 2 &&
                draft.Lessons[0].LessonVersionId == firstLesson && draft.Lessons[1].WeekNumber == 2 &&
                draft.Lessons[1].DayNumber == 3 && draft.Lessons[1].SortOrder == 4, "draft_refresh_order_lost");
            var before = await app.FingerprintAsync();
            using var retry = await admin.PutAsJsonAsync(path, save);
            Assert(retry.StatusCode == HttpStatusCode.OK && before == await app.FingerprintAsync(), "save_retry_not_idempotent");
            group = await Read<GroupCurriculumState>(admin, groupPath);
            Assert(group.AssignedCurriculumTemplateId is null && group.VersionId is null && group.Lessons.Length == 0,
                "save_assigned_or_published");
        });
        await check("Reorder can swap indexed positions atomically and concurrent edits are rejected", async () =>
        {
            var previousRevision = draft.DraftRevision;
            var save = Save(draft, [new(firstLesson, 2, 3, 4), new(secondLesson, 1, 2, 2)]);
            using var response = await admin.PutAsJsonAsync(path, save);
            Assert(response.StatusCode == HttpStatusCode.OK, "swap_status_" + response.StatusCode);
            draft = await Read<CurriculumDraft>(admin, path);
            Assert(draft.Lessons[0].LessonVersionId == secondLesson && draft.DraftRevision != previousRevision, "swap_not_saved");
            var before = await app.FingerprintAsync();
            using var stale = await admin.PutAsJsonAsync(path, save with { RequestId = Guid.NewGuid() });
            using var changedRetry = await admin.PutAsJsonAsync(path, save with { Name = "Changed request" });
            Assert(await Error(stale, HttpStatusCode.Conflict) == "draft_changed" &&
                await Error(changedRetry, HttpStatusCode.Conflict) == "curriculum_request_conflict" &&
                before == await app.FingerprintAsync(), "concurrent_save_overwrote_draft");
        });
        await check("Assignment persists independently and assigning never publishes", async () =>
        {
            var assign = new AssignCurriculum(Guid.NewGuid(), id, group.AssignmentRevision);
            using var response = await admin.PutAsJsonAsync(assignPath, assign);
            Assert(response.StatusCode == HttpStatusCode.OK, "assign_status_" + response.StatusCode);
            group = await Read<GroupCurriculumState>(admin, groupPath);
            Assert(group.AssignedCurriculumTemplateId == id && group.DraftRevision == draft.DraftRevision &&
                group.VersionId is null && group.HasUnpublishedChanges, "assignment_not_independent");
            Assert((await Read<JsonElement>(student, "/api/student/learning/curriculum")).GetProperty("items").GetArrayLength() == 0,
                "assignment_published_implicitly");
            var before = await app.FingerprintAsync();
            using var retry = await admin.PutAsJsonAsync(assignPath, assign);
            using var stale = await admin.PutAsJsonAsync(assignPath, assign with { RequestId = Guid.NewGuid() });
            Assert(retry.StatusCode == HttpStatusCode.OK && await Error(stale, HttpStatusCode.Conflict) == "assignment_changed" &&
                before == await app.FingerprintAsync(), "assignment_retry_or_concurrency_failed");
        });
        await check("Legacy lesson-to-group publication is blocked for assigned curriculum drafts", async () =>
        {
            var before = await app.FingerprintAsync();
            using var legacy = await admin.PostAsJsonAsync("/api/admin/shadowing/publish", new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId, lessonVersionId = firstLesson,
                expectedVersionId = (Guid?)null, weekNumber = 1, dayNumber = 1, sortOrder = 1
            });
            Assert(await Error(legacy, HttpStatusCode.Conflict) == "curriculum_publish_required" &&
                before == await app.FingerprintAsync(), "legacy_publication_bypassed_curriculum");
        });
        await check("Publish creates the full immutable snapshot and only its group can see it", async () =>
        {
            firstPublish = Publish(draft, group);
            using var response = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", firstPublish);
            Assert(response.StatusCode == HttpStatusCode.Created, "publish_status_" + response.StatusCode);
            firstVersion = (await response.Content.ReadFromJsonAsync<Publication>())!;
            group = await Read<GroupCurriculumState>(admin, groupPath);
            Assert(group.VersionId == firstVersion.VersionId && group.Lessons.Length == 2 && !group.HasUnpublishedChanges &&
                group.Lessons[0].LessonVersionId == secondLesson, "published_snapshot_incomplete");
            var visible = await Read<JsonElement>(student, "/api/student/learning/curriculum");
            Assert(visible.GetProperty("items").GetArrayLength() == 2 &&
                (await Read<JsonElement>(other, "/api/student/learning/curriculum")).GetProperty("items").GetArrayLength() == 0,
                "group_snapshot_visibility_invalid");
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await db.PublishedCurriculumVersions.CountAsync() == 1 && await db.PublishedLessonSlots.CountAsync() == 2,
                "multiple_or_partial_versions_created");
        });
        await check("Publish retries and changed request bodies preserve the committed snapshot", async () =>
        {
            var before = await app.FingerprintAsync();
            using var retry = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", firstPublish);
            using var changed = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish",
                firstPublish with { ExpectedDraftRevision = Guid.NewGuid() });
            Assert(retry.StatusCode == HttpStatusCode.OK && await Error(changed, HttpStatusCode.Conflict) == "publish_request_conflict" &&
                before == await app.FingerprintAsync(), "publish_retry_changed_snapshot");
        });
        await check("Publication and assignment revisions protect against stale clients", async () =>
        {
            var request = Publish(draft, group);
            var before = await app.FingerprintAsync();
            using var changed = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", request with { ExpectedVersionId = null });
            using var assignment = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish",
                request with { RequestId = Guid.NewGuid(), ExpectedAssignmentRevision = Guid.NewGuid() });
            Assert(await Error(changed, HttpStatusCode.Conflict) == "publication_changed" &&
                await Error(assignment, HttpStatusCode.Conflict) == "assignment_changed" &&
                before == await app.FingerprintAsync(), "stale_publish_accepted");
        });
        await check("Editing and removing draft lessons never mutates the published version", async () =>
        {
            using var response = await admin.PutAsJsonAsync(path,
                Save(draft, [new(secondLesson, 4, 7, 100)]) with { Name = "Edited independent draft" });
            Assert(response.StatusCode == HttpStatusCode.OK, "edit_published_draft_failed");
            draft = await Read<CurriculumDraft>(admin, path);
            group = await Read<GroupCurriculumState>(admin, groupPath);
            Assert(draft.Lessons.Length == 1 && group.Lessons.Length == 2 && group.PublishedTitle == PrivateName &&
                group.HasUnpublishedChanges && group.PublishedDraftRevision == firstVersion.SourceDraftRevision,
                "draft_edit_mutated_published_snapshot");
        });
        await check("A later explicit publication keeps old snapshots and old retry receipts", async () =>
        {
            using var response = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", Publish(draft, group));
            Assert(response.StatusCode == HttpStatusCode.Created, "second_publish_failed");
            secondVersion = (await response.Content.ReadFromJsonAsync<Publication>())!;
            group = await Read<GroupCurriculumState>(admin, groupPath);
            Assert(group.VersionId == secondVersion.VersionId && group.Lessons.Length == 1 && secondVersion.VersionNumber == 2,
                "second_snapshot_invalid");
            var before = await app.FingerprintAsync();
            using var oldRetry = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", firstPublish);
            Assert(oldRetry.StatusCode == HttpStatusCode.OK &&
                (await oldRetry.Content.ReadFromJsonAsync<Publication>())!.VersionId == firstVersion.VersionId &&
                before == await app.FingerprintAsync(), "old_retry_overwrote_current_snapshot");
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await db.PublishedCurriculumVersions.CountAsync() == 2 &&
                await db.PublishedLessonSlots.CountAsync(x => x.PublishedCurriculumVersionId == firstVersion.VersionId) == 2,
                "old_snapshot_deleted");
            var old = await db.PublishedCurriculumVersions.SingleAsync(x => x.Id == firstVersion.VersionId);
            old.Title = "Forbidden mutation";
            var blocked = false;
            try { await db.SaveChangesAsync(); } catch (InvalidOperationException) { blocked = true; }
            Assert(blocked, "published_mutation_guard_missing");
        });
        await check("Active student progress is preserved when republish is blocked", async () =>
        {
            var visible = await Read<JsonElement>(student, "/api/student/learning/curriculum");
            var slotId = visible.GetProperty("items")[0].GetProperty("slotId").GetGuid();
            using var progress = await student.PutAsJsonAsync($"/api/student/learning/slots/{slotId}/progress", new { completedSegments = 1 });
            Assert(progress.StatusCode == HttpStatusCode.OK, "curriculum_progress_save_failed");
            using var saved = await admin.PutAsJsonAsync(path, Save(draft, [new(secondLesson, 5, 1, 1)]));
            Assert(saved.StatusCode == HttpStatusCode.OK, "active_progress_blocked_draft_edit");
            draft = await Read<CurriculumDraft>(admin, path);
            group = await Read<GroupCurriculumState>(admin, groupPath);
            var before = await app.FingerprintAsync();
            using var blocked = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", Publish(draft, group));
            Assert(await Error(blocked, HttpStatusCode.Conflict) == "active_progress_prevents_republish" &&
                before == await app.FingerprintAsync(), "republish_reset_student_progress");
            var overview = await Read<JsonElement>(student, $"/api/student/learning/slots/{slotId}");
            Assert(overview.GetProperty("completedSegments").GetInt32() == 1 &&
                overview.GetProperty("versionId").GetGuid() == secondVersion.VersionId, "progress_version_changed");
        });
        await check("GET refresh restores drafts assignments and publications without writes", async () =>
        {
            var before = await app.FingerprintAsync();
            foreach (var url in new[] { "/api/admin/shadowing/curriculums?page=1", path, groupPath, "/api/admin/groups?page=1" })
            {
                using var response = await admin.GetAsync(url);
                Assert(response.StatusCode == HttpStatusCode.OK && response.Headers.CacheControl?.NoStore == true,
                    "curriculum_get_status_or_cache_invalid_" + response.StatusCode);
            }
            var restoredDraft = await Read<CurriculumDraft>(admin, path);
            var restoredGroup = await Read<GroupCurriculumState>(admin, groupPath);
            Assert(restoredDraft.Lessons[0].WeekNumber == 5 && restoredGroup.AssignedCurriculumTemplateId == id &&
                restoredGroup.VersionId == secondVersion.VersionId && before == await app.FingerprintAsync(), "refresh_changed_state");
        });

        await InvalidDraftChecks(root, media, logs, wave, check);
        await check("Curriculum diagnostics cover operations without lesson content or credentials", () =>
        {
            var messages = logs.Messages.Where(x => x.Contains("Admin.Shadowing.Curriculum.")).ToArray();
            foreach (var operation in new[] { "Create", "Update", "AddLesson", "RemoveLesson", "ReorderLesson", "Assign", "Publish", "Load" })
                Assert(messages.Any(x => x.Contains(operation + ".Start")) && messages.Any(x => x.Contains(operation + ".Success")),
                    "curriculum_diagnostic_missing_" + operation);
            Assert(messages.Any(x => x.Contains(".Failed")) && messages.All(x =>
                !x.Contains(PrivateName) && !x.Contains(PrivateDescription) && !x.Contains(PrivateTranscript) &&
                !x.Contains(app.Password) && !x.Contains("@v2-test.invalid") && !x.Contains("X-XSRF-TOKEN") && !x.Contains("AccountKey=")),
                "curriculum_diagnostic_exposed_private_values");
            return Task.CompletedTask;
        });
    }

    private static async Task InvalidDraftChecks(string root, IShadowingMediaStore media, SafeLogs logs, byte[] wave,
        Func<string, Func<Task>, Task> check)
    {
        using var app = new MediaApp(root, media, logs);
        await app.SetupAsync(); using var admin = await app.LoginAsync("admin");
        var id = Guid.NewGuid();
        using var created = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", new CreateCurriculum(id, "Validation draft", ""));
        var draft = (await created.Content.ReadFromJsonAsync<CurriculumDraft>())!;
        var lessonId = await SaveLesson(admin, wave, "Validation saved lesson");
        var path = $"/api/admin/shadowing/curriculums/{id}";
        await check("Backend rejects out-of-range positions duplicates and missing saved lessons without writes", async () =>
        {
            var before = await app.FingerprintAsync();
            foreach (var position in new[] { new LessonPosition(lessonId, 0, 1, 1), new(lessonId, 53, 1, 1),
                new(lessonId, 1, 0, 1), new(lessonId, 1, 8, 1), new(lessonId, 1, 1, 0), new(lessonId, 1, 1, 101) })
            {
                using var invalid = await admin.PutAsJsonAsync(path, Save(draft, [position]));
                Assert(await Error(invalid, HttpStatusCode.BadRequest) == "invalid_curriculum", "invalid_position_accepted");
            }
            using var duplicate = await admin.PutAsJsonAsync(path, Save(draft, [new(lessonId, 1, 1, 1), new(lessonId, 1, 2, 1)]));
            using var conflict = await admin.PutAsJsonAsync(path, Save(draft, [new(lessonId, 1, 1, 1), new(Guid.NewGuid(), 1, 1, 1)]));
            using var missing = await admin.PutAsJsonAsync(path, Save(draft, [new(Guid.NewGuid(), 1, 1, 1)]));
            Assert(await Error(duplicate, HttpStatusCode.Conflict) == "slot_conflict" &&
                await Error(conflict, HttpStatusCode.Conflict) == "slot_conflict" &&
                await Error(missing, HttpStatusCode.NotFound) == "lesson_not_found" && before == await app.FingerprintAsync(),
                "invalid_draft_persisted");
        });
        await check("Publishing an empty curriculum is rejected without creating a snapshot", async () =>
        {
            var group = await Read<GroupCurriculumState>(admin, $"/api/admin/shadowing/groups/{app.GroupId}/curriculum");
            using var assigned = await admin.PutAsJsonAsync($"/api/admin/shadowing/groups/{app.GroupId}/curriculum-assignment",
                new AssignCurriculum(Guid.NewGuid(), id, group.AssignmentRevision));
            Assert(assigned.IsSuccessStatusCode, "empty_draft_assignment_failed");
            group = (await assigned.Content.ReadFromJsonAsync<GroupCurriculumState>())!;
            var before = await app.FingerprintAsync();
            using var empty = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", Publish(draft, group));
            Assert(await Error(empty, HttpStatusCode.Conflict) == "curriculum_empty" && before == await app.FingerprintAsync(),
                "empty_draft_published");
        });
        await check("Missing audio blocks the whole publication without partial slots or assignments", async () =>
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var definition = new LessonDefinition { Id = Guid.NewGuid() };
            var version = new LessonVersion { Id = Guid.NewGuid(), LessonDefinitionId = definition.Id,
                Title = "Missing audio lesson", Description = "", VersionNumber = 1 };
            db.LessonDefinitions.Add(definition); db.LessonVersions.Add(version);
            db.LessonSegments.Add(new LessonSegment { Id = Guid.NewGuid(), LessonVersionId = version.Id, Position = 1,
                Text = PrivateTranscript, AudioStorageKey = "lesson-" + Guid.NewGuid().ToString("N") + ".wav" });
            await db.SaveChangesAsync();
            using var saved = await admin.PutAsJsonAsync(path, Save(draft, [new(lessonId, 1, 1, 1), new(version.Id, 1, 1, 2)]));
            Assert(saved.IsSuccessStatusCode, "missing_audio_draft_save_failed");
            draft = (await saved.Content.ReadFromJsonAsync<CurriculumDraft>())!;
            var group = await Read<GroupCurriculumState>(admin, $"/api/admin/shadowing/groups/{app.GroupId}/curriculum");
            var before = await app.FingerprintAsync();
            using var failed = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", Publish(draft, group));
            Assert(await Error(failed, HttpStatusCode.Conflict) == "lesson_audio_missing" &&
                before == await app.FingerprintAsync() && !await db.PublishedCurriculumVersions.AnyAsync() &&
                !await db.PublishedLessonSlots.AnyAsync(), "partial_missing_audio_publication");
        });
        await check("Historical legacy publish receipts can be confirmed without changing any published pointer", async () =>
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var published = Guid.NewGuid(); var slot = Guid.NewGuid(); var now = DateTimeOffset.UtcNow;
            db.PublishedCurriculumVersions.Add(new PublishedCurriculumVersion { Id = published, GroupId = app.GroupId,
                CurriculumTemplateId = id, VersionNumber = 1, Title = "Historical snapshot", PublishedAtUtc = now, AvailableAtUtc = now });
            db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = slot, PublishedCurriculumVersionId = published,
                LessonVersionId = lessonId, WeekNumber = 1, DayNumber = 1, SortOrder = 1, AvailableAtUtc = now });
            await db.SaveChangesAsync();
            var request = new { requestId = published, groupId = app.GroupId, lessonVersionId = lessonId,
                expectedVersionId = (Guid?)null, weekNumber = 1, dayNumber = 1, sortOrder = 1 };
            var before = await app.FingerprintAsync();
            using var confirmed = await admin.PostAsJsonAsync("/api/admin/shadowing/publish", request);
            using var changed = await admin.PostAsJsonAsync("/api/admin/shadowing/publish", request with { sortOrder = 2 });
            Assert(confirmed.StatusCode == HttpStatusCode.OK &&
                (await confirmed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("slotId").GetGuid() == slot &&
                await Error(changed, HttpStatusCode.Conflict) == "publish_request_conflict" &&
                before == await app.FingerprintAsync() && !await db.GroupCurriculumAssignments.AnyAsync(),
                "legacy_receipt_created_or_changed_publication");
        });
    }

    private static UpdateCurriculum Save(CurriculumDraft draft, LessonPosition[] lessons) =>
        new(Guid.NewGuid(), draft.DraftRevision, draft.Name, draft.Description, lessons);
    private static PublishCurriculum Publish(CurriculumDraft draft, GroupCurriculumState group) =>
        new(Guid.NewGuid(), group.GroupId, draft.Id, draft.DraftRevision, group.AssignmentRevision, group.VersionId);
    private static async Task<T> Read<T>(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        Assert(response.IsSuccessStatusCode, "read_status_" + response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static async Task<string> Error(HttpResponseMessage response, HttpStatusCode expected)
    {
        Assert(response.StatusCode == expected, "error_status_" + response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()!;
    }
    private static async Task<Guid> SaveLesson(HttpClient client, byte[] wave, string title)
    {
        using var form = new MultipartFormDataContent
        {
            { new StringContent(Guid.NewGuid().ToString()), "requestId" }, { new StringContent(title), "title" },
            { new StringContent(""), "description" },
            { new StringContent(JsonSerializer.Serialize(new[] { PrivateTranscript })), "segments" },
            { new ByteArrayContent(wave), "audio0", "reviewed.wav" }
        };
        using var response = await client.PostAsync("/api/admin/shadowing/lessons", form);
        Assert(response.StatusCode == HttpStatusCode.Created, "lesson_setup_status_" + response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("versionId").GetGuid();
    }
}
