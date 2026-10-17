using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShadowingEnglish.Api.Modules.AI;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.MediaChecks;

internal static class AiPublicationChecks
{
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }

    public static async Task<int> RunAsync(Func<string, Func<Task>, Task> check, Func<int> failures)
    {
        var root = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
        using var logs = new SafeLogs();
        using var app = new MediaApp(root, new AvailableMediaStore(), logs);
        await app.SetupAsync();
        using var admin = await app.LoginAsync("admin");
        using var student = await app.LoginAsync("student");
        var lessonId = Guid.NewGuid(); var definitionId = Guid.NewGuid(); var templateId = Guid.NewGuid();
        var firstAiId = Guid.NewGuid(); var firstRevision = Guid.NewGuid();
        var draftRevision = Guid.NewGuid(); var assignmentRevision = Guid.NewGuid();
        var material = new LessonMaterial(
            [new VocabularyCard("Hello", "مرحبًا", "Hello world", "مرحبًا بالعالم")],
            [new QuizCard("Choose Hello", ["Hello", "Bye", "Thanks", "Sorry"], 0, "تحية")],
            "Greeting", "Greet a friend") with
        { ReviewedStages = ["vocabulary", "conversation"] };
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var adminId = await db.Users.Where(x => x.Email == "admin@v2-test.invalid")
                .Select(x => x.Id).SingleAsync();
            var group = await db.StudyGroups.SingleAsync(x => x.Id == app.GroupId);
            group.AssignedCurriculumTemplateId = templateId;
            group.CurriculumAssignmentRevision = assignmentRevision;
            db.CurriculumTemplates.Add(new CurriculumTemplate
            { Id = templateId, Name = "AI publish test", DraftRevision = draftRevision });
            db.LessonDefinitions.Add(new LessonDefinition { Id = definitionId, Title = "AI publish test" });
            db.LessonVersions.Add(new LessonVersion
            { Id = lessonId, LessonDefinitionId = definitionId, VersionNumber = 1, Title = "AI publish test" });
            db.LessonSegments.Add(new LessonSegment
            { Id = Guid.NewGuid(), LessonVersionId = lessonId, Position = 1, Text = "Hello world",
                AudioStorageKey = "ai-publication-test.wav" });
            db.CurriculumDraftLessonSlots.Add(new CurriculumDraftLessonSlot
            { Id = Guid.NewGuid(), CurriculumTemplateId = templateId, LessonVersionId = lessonId,
                WeekNumber = 1, DayNumber = 1, SortOrder = 1 });
            db.LessonWorkflows.Add(new LessonWorkflow
            {
                LessonVersionId = lessonId, Revision = Guid.NewGuid(), UpdatedAtUtc = DateTimeOffset.UtcNow,
                StagesJson = JsonSerializer.Serialize(new[]
                {
                    new { id = Guid.NewGuid(), type = "shadowing", title = "الشادوينج", position = 1, enabled = true, required = true }
                })
            });
            db.LessonAiContents.Add(new LessonAiContent
            { Id = firstAiId, LessonVersionId = lessonId, CreatedByAdminId = adminId,
                Revision = firstRevision, Status = "Draft", PayloadJson = JsonSerializer.Serialize(material, LessonMaterialRules.Json),
                CreatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(-2), UpdatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(-2) });
            db.LessonAiContents.Add(new LessonAiContent
            { Id = Guid.NewGuid(), LessonVersionId = lessonId, CreatedByAdminId = adminId,
                Revision = Guid.NewGuid(), Status = "Failed", CreatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(-3),
                UpdatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(-3) });
            await db.SaveChangesAsync();
        }
        var groupPath = $"/api/admin/shadowing/groups/{app.GroupId}/curriculum";
        var publishPath = "/api/admin/shadowing/curriculums/publish";
        async Task<JsonElement> Group() => await admin.GetFromJsonAsync<JsonElement>(groupPath);
        async Task<Guid> Publish(JsonElement group)
        {
            using var response = await admin.PostAsJsonAsync(publishPath, new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId, curriculumTemplateId = templateId,
                expectedDraftRevision = draftRevision,
                expectedAssignmentRevision = group.GetProperty("assignmentRevision").GetGuid(),
                expectedVersionId = group.GetProperty("versionId").ValueKind == JsonValueKind.Null
                    ? (Guid?)null : group.GetProperty("versionId").GetGuid()
            });
            Assert(response.StatusCode == HttpStatusCode.Created, "ai_publish_failed_" + response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("versionId").GetGuid();
        }
        async Task<Guid> CurrentSlot()
        {
            var curriculum = await student.GetFromJsonAsync<JsonElement>("/api/student/learning/curriculum");
            return curriculum.GetProperty("items")[0].GetProperty("slotId").GetGuid();
        }
        Guid initialVersion = Guid.Empty, initialSlot = Guid.Empty;
        await check("Draft and Failed AI are excluded from publication", async () =>
        {
            var group = await Group();
            Assert(group.GetProperty("aiContentStates")[0].GetProperty("status").GetString() == "draft_needs_approval",
                "draft_status_missing");
            initialVersion = await Publish(group);
            initialSlot = await CurrentSlot();
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await db.PublishedLessonSlots.AnyAsync(x => x.Id == initialSlot && x.AiContentId == null),
                "draft_or_failed_ai_published");
            using var progress = await student.PutAsJsonAsync($"/api/student/learning/slots/{initialSlot}/progress",
                new { completedSegments = 1 });
            Assert(progress.StatusCode == HttpStatusCode.OK, "shadowing_progress_missing");
        });
        await check("Approving Draft enables republish and pins approved AI for Vocabulary", async () =>
        {
            using var approval = await admin.PostAsJsonAsync(
                $"/api/admin/lessons/{lessonId}/ai/{firstAiId}/approve", new { expectedRevision = firstRevision });
            Assert(approval.StatusCode == HttpStatusCode.OK &&
                (await approval.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString() == "Approved",
                "draft_not_approved");
            using (var editScope = app.Services.CreateScope())
            {
                var editDb = editScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var workflow = await editDb.LessonWorkflows.SingleAsync(x => x.LessonVersionId == lessonId);
                workflow.StagesJson = JsonSerializer.Serialize(new[]
                {
                    new { id = Guid.NewGuid(), type = "shadowing", title = "الشادوينج", position = 1, enabled = true, required = true },
                    new { id = Guid.NewGuid(), type = "vocabulary", title = "الكلمات", position = 2, enabled = true, required = true },
                    new { id = Guid.NewGuid(), type = "conversation", title = "المحادثة", position = 3, enabled = true, required = false }
                });
                workflow.Revision = Guid.NewGuid();
                await editDb.SaveChangesAsync();
            }
            var group = await Group();
            Assert(group.GetProperty("hasUnpublishedChanges").GetBoolean() &&
                group.GetProperty("aiContentStates")[0].GetProperty("status").GetString() == "approved_needs_publish",
                "approved_ai_did_not_enable_republish");
            var nextVersion = await Publish(group);
            var nextSlot = await CurrentSlot();
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(nextVersion != initialVersion &&
                await db.PublishedLessonSlots.AnyAsync(x => x.Id == initialSlot && x.AiContentId == null) &&
                await db.PublishedLessonSlots.AnyAsync(x => x.Id == nextSlot && x.AiContentId == firstAiId),
                "approved_ai_not_pinned_or_old_version_mutated");
            var overview = await student.GetFromJsonAsync<JsonElement>($"/api/student/learning/slots/{nextSlot}");
            Assert(overview.GetProperty("hasAiContent").GetBoolean(), "student_ai_missing");
            // This publication also changed the stage plan, so the old shadowing
            // completion is intentionally not carried across the new snapshot.
            using var progress = await student.PutAsJsonAsync($"/api/student/learning/slots/{nextSlot}/progress",
                new { completedSegments = 1 });
            Assert(progress.StatusCode == HttpStatusCode.OK, "new_shadowing_progress_missing");
            using var vocabulary = await student.GetAsync($"/api/student/learning/slots/{nextSlot}/ai-material");
            Assert(vocabulary.StatusCode == HttpStatusCode.OK, "vocabulary_not_available_after_publish");
        });
        await check("A newer Approved AI creates a new immutable publication", async () =>
        {
            var secondAiId = Guid.NewGuid(); var secondRevision = Guid.NewGuid();
            using (var seedScope = app.Services.CreateScope())
            {
                var seedDb = seedScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var adminId = await seedDb.Users.Where(x => x.Email == "admin@v2-test.invalid")
                    .Select(x => x.Id).SingleAsync();
                seedDb.LessonAiContents.Add(new LessonAiContent
                { Id = secondAiId, LessonVersionId = lessonId, CreatedByAdminId = adminId,
                    Revision = secondRevision, Status = "Draft", PayloadJson = JsonSerializer.Serialize(material, LessonMaterialRules.Json),
                    CreatedAtUtc = DateTimeOffset.UtcNow, UpdatedAtUtc = DateTimeOffset.UtcNow });
                await seedDb.SaveChangesAsync();
            }
            using var approval = await admin.PostAsJsonAsync(
                $"/api/admin/lessons/{lessonId}/ai/{secondAiId}/approve", new { expectedRevision = secondRevision });
            Assert(approval.StatusCode == HttpStatusCode.OK, "new_ai_approval_failed");
            using (var failedScope = app.Services.CreateScope())
            {
                var failedDb = failedScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var adminId = await failedDb.Users.Where(x => x.Email == "admin@v2-test.invalid")
                    .Select(x => x.Id).SingleAsync();
                failedDb.LessonAiContents.Add(new LessonAiContent
                { Id = Guid.NewGuid(), LessonVersionId = lessonId, CreatedByAdminId = adminId,
                    Revision = Guid.NewGuid(), Status = "Failed", CreatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(1),
                    UpdatedAtUtc = DateTimeOffset.UtcNow.AddMinutes(1) });
                await failedDb.SaveChangesAsync();
            }
            var oldSlot = await CurrentSlot();
            var group = await Group();
            Assert(group.GetProperty("hasUnpublishedChanges").GetBoolean(), "new_approval_not_detected");
            await Publish(group);
            var newSlot = await CurrentSlot();
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await db.PublishedLessonSlots.AnyAsync(x => x.Id == oldSlot && x.AiContentId == firstAiId) &&
                await db.PublishedLessonSlots.AnyAsync(x => x.Id == newSlot && x.AiContentId == secondAiId),
                "ai_snapshot_changed_or_latest_not_selected");
            group = await Group();
            Assert(!group.GetProperty("hasUnpublishedChanges").GetBoolean() &&
                group.GetProperty("aiContentStates")[0].GetProperty("status").GetString() == "approved_published",
                "published_ai_status_incorrect");
            using var unchanged = await admin.PostAsJsonAsync(publishPath, new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId, curriculumTemplateId = templateId,
                expectedDraftRevision = draftRevision,
                expectedAssignmentRevision = group.GetProperty("assignmentRevision").GetGuid(),
                expectedVersionId = group.GetProperty("versionId").GetGuid()
            });
            Assert(unchanged.StatusCode == HttpStatusCode.Conflict &&
                (await unchanged.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString() ==
                "no_unpublished_changes", "unchanged_ai_allowed_republish");
        });
        await check("Workflow edits require republish and cannot change the current student path", async () =>
        {
            var oldSlot = await CurrentSlot();
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                var workflow = await db.LessonWorkflows.SingleAsync(x => x.LessonVersionId == lessonId);
                var stages = JsonNode.Parse(workflow.StagesJson)!.AsArray();
                stages[1]!["title"] = "مفردات جديدة";
                workflow.StagesJson = stages.ToJsonString();
                workflow.Revision = Guid.NewGuid();
                await db.SaveChangesAsync();
            }
            var oldOverview = await student.GetFromJsonAsync<JsonElement>($"/api/student/learning/slots/{oldSlot}");
            Assert(oldOverview.GetProperty("stages")[1].GetProperty("title").GetString() == "الكلمات",
                "admin_edit_changed_published_student_path");
            var group = await Group();
            Assert(group.GetProperty("hasUnpublishedChanges").GetBoolean(),
                "workflow_edit_did_not_enable_republish");
            await Publish(group);
            var newSlot = await CurrentSlot();
            var newOverview = await student.GetFromJsonAsync<JsonElement>($"/api/student/learning/slots/{newSlot}");
            Assert(newOverview.GetProperty("stages")[1].GetProperty("title").GetString() == "مفردات جديدة",
                "republished_workflow_not_visible_to_student");
            using var verifyScope = app.Services.CreateScope();
            var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var snapshots = await verifyDb.PublishedLessonSlots.AsNoTracking()
                .Where(x => x.Id == oldSlot || x.Id == newSlot)
                .ToDictionaryAsync(x => x.Id, x => x.WorkflowStagesJson);
            Assert(JsonNode.Parse(snapshots[oldSlot]!)!.AsArray()[1]!["title"]!.GetValue<string>() == "الكلمات" &&
                JsonNode.Parse(snapshots[newSlot]!)!.AsArray()[1]!["title"]!.GetValue<string>() == "مفردات جديدة",
                "workflow_snapshot_was_mutated");
        });
        return failures() == 0 ? 0 : 1;
    }

    private sealed class AvailableMediaStore : IShadowingMediaStore
    {
        public bool IsConfigured => true;
        public Task<bool> ExistsAsync(string key, CancellationToken cancellation) => Task.FromResult(true);
        public Task WriteAsync(string key, Stream source, CancellationToken cancellation) => throw new NotSupportedException();
        public Task<bool> MatchesAsync(string key, Stream source, CancellationToken cancellation) => throw new NotSupportedException();
        public Task<ShadowingMediaRead?> OpenAsync(string key, CancellationToken cancellation) => throw new NotSupportedException();
        public Task DeleteAsync(string key, CancellationToken cancellation) => throw new NotSupportedException();
    }
}
