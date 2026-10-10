using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ShadowingEnglish.Api.Modules.Lessons;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.MediaChecks;

internal static class PurgeChecks
{
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }

    public static async Task RunAsync(string root, IShadowingMediaStore media, SafeLogs logs, byte[] wave,
        Func<string, Func<Task>, Task> check)
    {
        await check("Permanent deletion removes an unused lesson and retries failed audio cleanup", async () =>
        {
            using var app = new MediaApp(root, media, logs);
            await app.SetupAsync();
            using var admin = await app.LoginAsync("admin");
            var lessonId = Guid.NewGuid();
            var (versionId, assetKey) = await SaveLessonAsync(app, admin, lessonId, wave);
            using var response = await DeleteAsync(admin, lessonId, versionId);
            Assert(response.StatusCode == HttpStatusCode.Accepted, "unused_delete_status_" + response.StatusCode);
            var result = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert(result.GetProperty("deleted").GetBoolean() && result.GetProperty("mediaCleanupQueued").GetBoolean(),
                "unused_delete_not_confirmed");
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(!await db.LessonDefinitions.AnyAsync(x => x.Id == lessonId) &&
                    !await db.LessonVersions.AnyAsync(x => x.Id == versionId) &&
                    !await db.LessonSegments.AnyAsync(x => x.LessonVersionId == versionId) &&
                    await db.Database.SqlQueryRaw<string>("SELECT StorageKey AS Value FROM PendingLessonMediaDeletions")
                        .AnyAsync(x => x == assetKey), "unused_delete_rows_or_outbox_invalid");
            }
            Assert(await media.ExistsAsync(assetKey, default), "audio_deleted_before_outbox_worker");
            using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(logs));
            var failingWorker = new LessonMediaDeletionWorker(app.Services.GetRequiredService<IServiceScopeFactory>(),
                new FailOnceOnDelete(media), loggerFactory.CreateLogger<LessonMediaDeletionWorker>());
            await failingWorker.ProcessPendingAsync(default);
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var pending = await db.Database.SqlQueryRaw<int>(
                    "SELECT Attempts AS Value FROM PendingLessonMediaDeletions WHERE StorageKey = {0}", assetKey)
                    .SingleAsync();
                Assert(pending == 1, "failed_audio_delete_not_tracked");
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE PendingLessonMediaDeletions SET NextAttemptAtUtc = '2000-01-01 00:00:00'");
            }
            var retryWorker = new LessonMediaDeletionWorker(app.Services.GetRequiredService<IServiceScopeFactory>(),
                media, loggerFactory.CreateLogger<LessonMediaDeletionWorker>());
            await retryWorker.ProcessPendingAsync(default);
            Assert(!await media.ExistsAsync(assetKey, default), "audio_retry_did_not_delete_file");
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(!await db.Database.SqlQueryRaw<string>(
                    "SELECT StorageKey AS Value FROM PendingLessonMediaDeletions").AnyAsync(), "successful_cleanup_left_outbox_row");
            }
            Assert(logs.Messages.Any(x => x.Contains("Admin.LessonLibrary.Purge.Success") && x.Contains(lessonId.ToString())) &&
                logs.Messages.Any(x => x.Contains("MediaCleanup.Failed") && x.Contains("DurationMs=")) &&
                logs.Messages.Any(x => x.Contains("MediaCleanup.Success") && x.Contains("DurationMs=")),
                "purge_or_cleanup_diagnostics_missing");
        });

        await check("Deletion is blocked by saved drafts and current publication", async () =>
        {
            using var app = new MediaApp(root, media, logs);
            await app.SetupAsync();
            using var admin = await app.LoginAsync("admin");
            var lessonId = Guid.NewGuid();
            var (versionId, _) = await SaveLessonAsync(app, admin, lessonId, wave);
            var curriculumId = Guid.NewGuid();
            using var created = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", new
                { requestId = curriculumId, name = "Purge test draft", description = "" });
            Assert(created.StatusCode == HttpStatusCode.Created, "draft_create_failed");
            var createdDraft = await created.Content.ReadFromJsonAsync<JsonElement>();
            var draftRevision = createdDraft.GetProperty("draftRevision").GetGuid();
            using var saved = await admin.PutAsJsonAsync($"/api/admin/shadowing/curriculums/{curriculumId}", new
            {
                requestId = Guid.NewGuid(), expectedDraftRevision = draftRevision, name = "Purge test draft", description = "",
                lessons = new[] { new { lessonVersionId = versionId, weekNumber = 1, dayNumber = 1, sortOrder = 1 } }
            });
            Assert(saved.StatusCode == HttpStatusCode.OK, "draft_save_failed");
            draftRevision = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("draftRevision").GetGuid();
            using var blockedDraft = await DeleteAsync(admin, lessonId, versionId);
            Assert(await ErrorAsync(blockedDraft) == "lesson_in_curriculum_draft", "draft_delete_not_blocked");
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(await db.LessonDefinitions.AnyAsync(x => x.Id == lessonId), "draft_block_changed_lesson");
            }
            using var assigned = await admin.PutAsJsonAsync($"/api/admin/shadowing/groups/{app.GroupId}/curriculum-assignment", new
                { requestId = Guid.NewGuid(), curriculumTemplateId = curriculumId, expectedAssignmentRevision = Guid.Empty });
            Assert(assigned.StatusCode == HttpStatusCode.OK, "curriculum_assignment_failed");
            var assignmentRevision = (await assigned.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("assignmentRevision").GetGuid();
            using var published = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId, curriculumTemplateId = curriculumId,
                expectedDraftRevision = draftRevision, expectedAssignmentRevision = assignmentRevision, expectedVersionId = (Guid?)null
            });
            Assert(published.StatusCode == HttpStatusCode.Created, "curriculum_publish_failed");
            using var removedFromDraft = await admin.PutAsJsonAsync($"/api/admin/shadowing/curriculums/{curriculumId}", new
            {
                requestId = Guid.NewGuid(), expectedDraftRevision = draftRevision, name = "Purge test draft", description = "",
                lessons = Array.Empty<object>()
            });
            Assert(removedFromDraft.StatusCode == HttpStatusCode.OK, "lesson_remove_from_draft_failed");
            using var blockedCurrent = await DeleteAsync(admin, lessonId, versionId);
            Assert(await ErrorAsync(blockedCurrent) == "lesson_in_published_curriculum", "current_publication_delete_not_blocked");
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(await db.LessonDefinitions.AnyAsync(x => x.Id == lessonId) &&
                    !await db.Database.SqlQueryRaw<string>("SELECT StorageKey AS Value FROM PendingLessonMediaDeletions").AnyAsync(),
                    "blocked_delete_mutated_lesson_or_outbox");
            }
        });

        await check("An old published lesson can be deleted without affecting current lessons or students", async () =>
        {
            using var app = new MediaApp(root, media, logs);
            await app.SetupAsync();
            using var admin = await app.LoginAsync("admin");
            var targetLessonId = Guid.NewGuid();
            var survivorLessonId = Guid.NewGuid();
            var (targetVersionId, targetAudioKey) = await SaveLessonAsync(app, admin, targetLessonId, wave);
            var (survivorVersionId, _) = await SaveLessonAsync(app, admin, survivorLessonId, wave);
            var curriculumId = Guid.NewGuid();
            using var created = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", new
                { requestId = curriculumId, name = "Historical purge curriculum", description = "" });
            var draftRevision = (await created.Content.ReadFromJsonAsync<JsonElement>())!.GetProperty("draftRevision").GetGuid();
            using var savedFirst = await SaveDraftAsync(admin, curriculumId, draftRevision, [targetVersionId, survivorVersionId]);
            Assert(savedFirst.StatusCode == HttpStatusCode.OK, "historical_first_draft_failed");
            draftRevision = (await savedFirst.Content.ReadFromJsonAsync<JsonElement>())!.GetProperty("draftRevision").GetGuid();
            using var assigned = await admin.PutAsJsonAsync($"/api/admin/shadowing/groups/{app.GroupId}/curriculum-assignment", new
                { requestId = Guid.NewGuid(), curriculumTemplateId = curriculumId, expectedAssignmentRevision = Guid.Empty });
            var assignmentRevision = (await assigned.Content.ReadFromJsonAsync<JsonElement>())!.GetProperty("assignmentRevision").GetGuid();
            var firstPublicationId = Guid.NewGuid();
            using var firstPublish = await PublishAsync(admin, app.GroupId, curriculumId, draftRevision, assignmentRevision,
                null, firstPublicationId);
            Assert(firstPublish.StatusCode == HttpStatusCode.Created, "historical_first_publish_failed");
            using var savedSecond = await SaveDraftAsync(admin, curriculumId, draftRevision, [survivorVersionId]);
            Assert(savedSecond.StatusCode == HttpStatusCode.OK, "historical_second_draft_failed");
            draftRevision = (await savedSecond.Content.ReadFromJsonAsync<JsonElement>())!.GetProperty("draftRevision").GetGuid();
            using var secondPublish = await PublishAsync(admin, app.GroupId, curriculumId, draftRevision, assignmentRevision,
                firstPublicationId, Guid.NewGuid());
            Assert(secondPublish.StatusCode == HttpStatusCode.Created, "historical_second_publish_failed");
            var secondPublicationId = (await secondPublish.Content.ReadFromJsonAsync<JsonElement>())!.GetProperty("versionId").GetGuid();
            var recordingKey = $"student-shadowing-{Guid.NewGuid():N}.wav";
            await media.WriteAsync(recordingKey, new MemoryStream(wave), default);
            Guid historicalSlotId;
            Guid survivorSlotId;
            Guid studentId;
            var invalidAttemptId = Guid.NewGuid();
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var slot = await db.PublishedLessonSlots.SingleAsync(x =>
                    x.PublishedCurriculumVersionId == firstPublicationId && x.LessonVersionId == targetVersionId);
                historicalSlotId = slot.Id;
                survivorSlotId = await db.PublishedLessonSlots.Where(x =>
                    x.PublishedCurriculumVersionId == firstPublicationId && x.LessonVersionId == survivorVersionId)
                    .Select(x => x.Id).SingleAsync();
                studentId = await db.Users.Where(x => x.Email == "student@v2-test.invalid").Select(x => x.Id).SingleAsync();
                var now = DateTimeOffset.UtcNow;
                db.StudentPracticeAttempts.Add(new StudentPracticeAttempt
                {
                    Id = Guid.NewGuid(), StudentId = studentId, PublishedCurriculumVersionId = firstPublicationId,
                    SlotId = historicalSlotId, StageKey = "shadowing", Position = 1, Answer = "test",
                    FeedbackJson = JsonSerializer.Serialize(new { recordingKey }), CreatedAtUtc = now
                });
                db.StudentStageProgress.Add(new StudentStageProgress
                {
                    StudentId = studentId, PublishedCurriculumVersionId = firstPublicationId, SlotId = historicalSlotId,
                    StageKey = "shadowing", CompletedSegments = 1, IsComplete = true, UpdatedAtUtc = now
                });
                db.StudentPracticeAttempts.Add(new StudentPracticeAttempt
                {
                    Id = invalidAttemptId, StudentId = studentId, PublishedCurriculumVersionId = firstPublicationId,
                    SlotId = historicalSlotId, StageKey = "shadowing", Position = 1, Answer = "test",
                    FeedbackJson = JsonSerializer.Serialize(new { recordingKey = "../outside.wav" }), CreatedAtUtc = now
                });
                db.StudentPracticeAttempts.Add(new StudentPracticeAttempt
                {
                    Id = Guid.NewGuid(), StudentId = studentId, PublishedCurriculumVersionId = firstPublicationId,
                    SlotId = survivorSlotId, StageKey = "shadowing", Position = 1, Answer = "unrelated",
                    FeedbackJson = "{}", CreatedAtUtc = now
                });
                db.StudentStageProgress.Add(new StudentStageProgress
                {
                    StudentId = studentId, PublishedCurriculumVersionId = firstPublicationId, SlotId = survivorSlotId,
                    StageKey = "shadowing", CompletedSegments = 1, IsComplete = true, UpdatedAtUtc = now
                });
                await db.SaveChangesAsync();
            }
            using (var invalidMetadata = await DeleteAsync(admin, targetLessonId, targetVersionId))
            {
                Assert(invalidMetadata.StatusCode == HttpStatusCode.Conflict &&
                    await ErrorAsync(invalidMetadata) == "invalid_recording_metadata", "invalid_recording_metadata_not_blocked");
            }
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(await db.LessonDefinitions.AnyAsync(x => x.Id == targetLessonId) &&
                    await db.StudentPracticeAttempts.AnyAsync(x => x.Id == invalidAttemptId),
                    "invalid_recording_metadata_lost_lesson_or_attempt");
                await db.StudentPracticeAttempts.Where(x => x.Id == invalidAttemptId).ExecuteDeleteAsync();
            }
            using var deleted = await DeleteAsync(admin, targetLessonId, targetVersionId);
            Assert(deleted.StatusCode == HttpStatusCode.Accepted, "historical_unused_delete_status_" + deleted.StatusCode);
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(!await db.LessonDefinitions.AnyAsync(x => x.Id == targetLessonId) &&
                    !await db.LessonVersions.AnyAsync(x => x.Id == targetVersionId) &&
                    !await db.LessonSegments.AnyAsync(x => x.LessonVersionId == targetVersionId) &&
                    !await db.LessonAiContents.AnyAsync(x => x.LessonVersionId == targetVersionId) &&
                    !await db.StudentPracticeAttempts.AnyAsync(x => x.SlotId == historicalSlotId) &&
                    !await db.StudentStageProgress.AnyAsync(x => x.SlotId == historicalSlotId),
                    "historical_lesson_or_student_rows_remain");
                Assert(await db.StudentPracticeAttempts.AnyAsync(x => x.StudentId == studentId && x.SlotId == survivorSlotId) &&
                    await db.StudentStageProgress.AnyAsync(x => x.StudentId == studentId && x.SlotId == survivorSlotId),
                    "unrelated_student_results_changed");
                Assert(await db.LessonDefinitions.AnyAsync(x => x.Id == survivorLessonId) &&
                    await db.LessonVersions.AnyAsync(x => x.Id == survivorVersionId) &&
                    await db.PublishedLessonSlots.AnyAsync(x => x.PublishedCurriculumVersionId == firstPublicationId &&
                        x.LessonVersionId == survivorVersionId) &&
                    await db.GroupCurriculumAssignments.AnyAsync(x => x.GroupId == app.GroupId &&
                        x.PublishedCurriculumVersionId == secondPublicationId),
                    "unrelated_lesson_or_active_publication_changed");
                var queued = await db.Database.SqlQueryRaw<string>(
                    "SELECT StorageKey AS Value FROM PendingLessonMediaDeletions").ToArrayAsync();
                Assert(queued.Contains(targetAudioKey) && queued.Contains(recordingKey), "historical_media_not_queued");
            }
            using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(logs));
            var worker = new LessonMediaDeletionWorker(app.Services.GetRequiredService<IServiceScopeFactory>(), media,
                loggerFactory.CreateLogger<LessonMediaDeletionWorker>());
            await worker.ProcessPendingAsync(default);
            Assert(!await media.ExistsAsync(targetAudioKey, default) && !await media.ExistsAsync(recordingKey, default),
                "historical_audio_or_recording_left_on_storage");
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                Assert(!await db.StudentPracticeAttempts.AnyAsync(x => x.StudentId == studentId && x.SlotId == historicalSlotId &&
                    x.PublishedCurriculumVersionId == firstPublicationId) &&
                    await db.StudentPracticeAttempts.AnyAsync(x => x.StudentId == studentId && x.SlotId == survivorSlotId &&
                        x.PublishedCurriculumVersionId == firstPublicationId) &&
                    await db.PublishedCurriculumVersions.AnyAsync(x => x.Id == firstPublicationId),
                    "historical_receipt_deleted_or_student_attempt_retained");
            }
        });
    }

    private static async Task<(Guid VersionId, string AudioKey)> SaveLessonAsync(
        MediaApp app, HttpClient admin, Guid lessonId, byte[] wave)
    {
        using var form = new MultipartFormDataContent
        {
            { new StringContent(lessonId.ToString()), "requestId" },
            { new StringContent("Purge test lesson"), "title" },
            { new StringContent(""), "description" },
            { new StringContent(JsonSerializer.Serialize(new[] { "Purge test transcript" })), "segments" },
            { new ByteArrayContent(wave), "audio0", "lesson.wav" }
        };
        using var response = await admin.PostAsync("/api/admin/shadowing/lessons", form);
        if (response.StatusCode != HttpStatusCode.Created)
            throw new InvalidOperationException("purge_test_lesson_save_failed_" + response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<JsonElement>())!;
        var versionId = result.GetProperty("versionId").GetGuid();
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var audioKey = await db.LessonSegments.Where(x => x.LessonVersionId == versionId)
            .Select(x => x.AudioStorageKey).SingleAsync();
        return (versionId, audioKey);
    }

    private static Task<HttpResponseMessage> DeleteAsync(HttpClient admin, Guid lessonId, Guid versionId) =>
        admin.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/admin/shadowing/lessons/{lessonId}")
        { Content = JsonContent.Create(new { expectedVersionId = versionId, permanentlyDelete = true }) });

    private static async Task<string> ErrorAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("error").GetString() ?? "";
    }

    private static Task<HttpResponseMessage> SaveDraftAsync(HttpClient admin, Guid curriculumId, Guid revision, Guid[] versions) =>
        admin.PutAsJsonAsync($"/api/admin/shadowing/curriculums/{curriculumId}", new
        {
            requestId = Guid.NewGuid(), expectedDraftRevision = revision, name = "Historical purge curriculum", description = "",
            lessons = versions.Select((version, index) => new
                { lessonVersionId = version, weekNumber = 1, dayNumber = index + 1, sortOrder = 1 }).ToArray()
        });

    private static Task<HttpResponseMessage> PublishAsync(HttpClient admin, Guid groupId, Guid curriculumId,
        Guid draftRevision, Guid assignmentRevision, Guid? expectedVersionId, Guid requestId) =>
        admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", new
        {
            requestId, groupId, curriculumTemplateId = curriculumId, expectedDraftRevision = draftRevision,
            expectedAssignmentRevision = assignmentRevision, expectedVersionId
        });

    private sealed class FailOnceOnDelete(IShadowingMediaStore inner) : IShadowingMediaStore
    {
        private bool failed;
        public bool IsConfigured => inner.IsConfigured;
        public Task WriteAsync(string key, Stream source, CancellationToken cancellation) => inner.WriteAsync(key, source, cancellation);
        public Task<bool> MatchesAsync(string key, Stream source, CancellationToken cancellation) => inner.MatchesAsync(key, source, cancellation);
        public Task<bool> ExistsAsync(string key, CancellationToken cancellation) => inner.ExistsAsync(key, cancellation);
        public Task<ShadowingMediaRead?> OpenAsync(string key, CancellationToken cancellation) => inner.OpenAsync(key, cancellation);
        public Task DeleteAsync(string key, CancellationToken cancellation)
        {
            if (!failed) { failed = true; throw new MediaStorageUnavailableException(); }
            return inner.DeleteAsync(key, cancellation);
        }
    }
}
