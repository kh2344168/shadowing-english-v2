using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Api.Modules.AI;
using ShadowingEnglish.Api.Modules.Lessons;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.Curriculums;

// A reviewed lesson update may advance an already published lesson without publishing
// unrelated curriculum-draft edits. Every advance creates a new immutable snapshot.
public static class ApprovedLessonPublisher
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task<int> SyncAsync(ApplicationDbContext db, Guid lessonVersionId,
        ILogger log, CancellationToken cancellation)
    {
        var approved = await db.LessonAiContents.AsNoTracking()
            .Where(x => x.LessonVersionId == lessonVersionId && x.Status == "Approved")
            .OrderByDescending(x => x.ApprovedAtUtc).ThenByDescending(x => x.Id)
            .FirstOrDefaultAsync(cancellation);
        var workflow = await db.LessonWorkflows.AsNoTracking()
            .Where(x => x.LessonVersionId == lessonVersionId)
            .Select(x => x.StagesJson).SingleOrDefaultAsync(cancellation);
        if (approved?.PayloadJson is null || workflow is null) return 0;
        var stages = ReadStages(workflow);
        var required = stages.Where(x => x.Enabled && x.Type != "shadowing")
            .Select(x => x.Type).Distinct().ToArray();
        var material = JsonSerializer.Deserialize<LessonMaterial>(approved.PayloadJson, LessonMaterialRules.Json);
        if (material is null || !LessonMaterialRules.ReadyToApprove(material, required) ||
            required.Any(x => !LessonMaterialRules.HasStageData(material, x))) return 0;

        var groupIds = await (from pointer in db.GroupCurriculumAssignments.AsNoTracking()
            join slot in db.PublishedLessonSlots.AsNoTracking()
                on pointer.PublishedCurriculumVersionId equals slot.PublishedCurriculumVersionId
            where slot.LessonVersionId == lessonVersionId
            select pointer.GroupId).Distinct().ToArrayAsync(cancellation);
        var published = 0;
        foreach (var groupId in groupIds)
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
            var pointerWasTracked = db.ChangeTracker.Entries<GroupCurriculumAssignment>()
                .Any(entry => entry.Entity.GroupId == groupId);
            var pointer = await db.GroupCurriculumAssignments
                .SingleOrDefaultAsync(x => x.GroupId == groupId, cancellation);
            if (pointer is null) continue;
            var previous = await db.PublishedCurriculumVersions.AsNoTracking()
                .SingleAsync(x => x.Id == pointer.PublishedCurriculumVersionId, cancellation);
            var group = await db.StudyGroups.AsNoTracking().SingleAsync(x => x.Id == groupId, cancellation);
            var template = await db.CurriculumTemplates.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == previous.CurriculumTemplateId, cancellation);
            // A separate curriculum edit still requires its own explicit publication.
            if (template is null || group.AssignedCurriculumTemplateId != template.Id ||
                previous.SourceDraftRevision != template.DraftRevision) continue;
            var oldSlots = await db.PublishedLessonSlots.AsNoTracking()
                .Where(x => x.PublishedCurriculumVersionId == previous.Id).ToArrayAsync(cancellation);
            var target = oldSlots.SingleOrDefault(x => x.LessonVersionId == lessonVersionId);
            if (target is null || oldSlots.Length == 0 ||
                target.AiContentId == approved.Id && target.WorkflowStagesJson == workflow) continue;

            var number = (await db.PublishedCurriculumVersions.AsNoTracking()
                .Where(x => x.GroupId == groupId && x.CurriculumTemplateId == template.Id)
                .Select(x => (int?)x.VersionNumber).MaxAsync(cancellation) ?? 0) + 1;
            var now = DateTimeOffset.UtcNow;
            var next = new PublishedCurriculumVersion
            {
                Id = Guid.NewGuid(), GroupId = groupId, CurriculumTemplateId = template.Id,
                SourceDraftRevision = template.DraftRevision, VersionNumber = number,
                Title = previous.Title, PublishedAtUtc = now, AvailableAtUtc = now
            };
            db.PublishedCurriculumVersions.Add(next);
            var nextSlots = oldSlots.ToDictionary(x => x.Id, x => new PublishedLessonSlot
            {
                Id = Guid.NewGuid(), PublishedCurriculumVersionId = next.Id,
                LessonVersionId = x.LessonVersionId,
                AiContentId = x.Id == target.Id ? approved.Id : x.AiContentId,
                WorkflowStagesJson = x.Id == target.Id ? workflow : x.WorkflowStagesJson,
                WeekNumber = x.WeekNumber, DayNumber = x.DayNumber, SortOrder = x.SortOrder,
                AvailableAtUtc = x.AvailableAtUtc
            });
            db.PublishedLessonSlots.AddRange(nextSlots.Values);
            var oldStages = ReadStages(target.WorkflowStagesJson);
            LessonMaterial? oldMaterial = null;
            if (target.AiContentId == approved.Id) oldMaterial = material;
            else if (target.AiContentId is { } oldContentId)
            {
                var oldPayload = await db.LessonAiContents.AsNoTracking()
                    .Where(x => x.Id == oldContentId).Select(x => x.PayloadJson)
                    .SingleOrDefaultAsync(cancellation);
                if (oldPayload is not null)
                    try { oldMaterial = JsonSerializer.Deserialize<LessonMaterial>(oldPayload, LessonMaterialRules.Json); }
                    catch (JsonException) { /* Old content cannot safely carry stage-specific progress. */ }
            }
            var unchangedStages = oldStages.Where(before => before.Enabled &&
                stages.Any(stage => stage.Enabled && stage.Type == before.Type && stage.Id == before.Id) &&
                SameStageContent(before.Type, oldMaterial, material))
                .Select(x => x.Type).ToHashSet(StringComparer.Ordinal);
            if (oldStages.Any(x => x.Enabled && x.Type == "shadowing") &&
                stages.Any(x => x.Enabled && x.Type == "shadowing"))
                unchangedStages.Add("shadowing");
            bool Carry(Guid slotId, string stageKey) => slotId != target.Id ||
                unchangedStages.Contains(stageKey) ||
                stageKey == "conversation-result" && unchangedStages.Contains("conversation");
            pointer.PublishedCurriculumVersionId = next.Id;
            StudentStageProgress[] carriedProgress = [];
            StudentPracticeAttempt[] carriedAttempts = [];
            if (db.Database.IsSqlServer())
            {
                // Persist the new snapshot inside this transaction before the FK-bound copy.
                // INSERT...SELECT keeps large attempt histories out of the API heap and EF tracker.
                await db.SaveChangesAsync(cancellation);
                var mappingJson = JsonSerializer.Serialize(oldSlots.Select(slot => new
                    { oldSlotId = slot.Id, newSlotId = nextSlots[slot.Id].Id }), Json);
                var allowedStages = unchangedStages.ToHashSet(StringComparer.Ordinal);
                if (allowedStages.Contains("conversation"))
                    allowedStages.Add("conversation-result");
                var allowedStagesJson = JsonSerializer.Serialize(allowedStages, Json);
                await CopyProgressSqlAsync(db, previous.Id, next.Id, target.Id,
                    mappingJson, allowedStagesJson, cancellation);
                await CopyAttemptsSqlAsync(db, previous.Id, next.Id, target.Id,
                    mappingJson, allowedStagesJson, cancellation);
            }
            else
            {
                // SQLite remains a small, portable path for the in-memory contract tests.
                var oldIds = oldSlots.Select(x => x.Id).ToArray();
                var progress = await db.StudentStageProgress.AsNoTracking()
                    .Where(x => x.PublishedCurriculumVersionId == previous.Id && oldIds.Contains(x.SlotId))
                    .ToArrayAsync(cancellation);
                carriedProgress = progress.Where(x => Carry(x.SlotId, x.StageKey))
                    .Select(x => new StudentStageProgress
                    {
                        StudentId = x.StudentId, PublishedCurriculumVersionId = next.Id,
                        SlotId = nextSlots[x.SlotId].Id, StageKey = x.StageKey,
                        CompletedSegments = x.CompletedSegments, IsComplete = x.IsComplete,
                        UpdatedAtUtc = x.UpdatedAtUtc
                    }).ToArray();
                db.StudentStageProgress.AddRange(carriedProgress);
                var attempts = await db.StudentPracticeAttempts.AsNoTracking()
                    .Where(x => x.PublishedCurriculumVersionId == previous.Id && oldIds.Contains(x.SlotId))
                    .ToArrayAsync(cancellation);
                carriedAttempts = attempts.Where(x => Carry(x.SlotId, x.StageKey))
                    .Select(x => new StudentPracticeAttempt
                    {
                        Id = Guid.NewGuid(), StudentId = x.StudentId,
                        PublishedCurriculumVersionId = next.Id, SlotId = nextSlots[x.SlotId].Id,
                        StageKey = x.StageKey, Position = x.Position, Answer = x.Answer,
                        FeedbackJson = x.FeedbackJson, CreatedAtUtc = x.CreatedAtUtc
                    }).ToArray();
                db.StudentPracticeAttempts.AddRange(carriedAttempts);
                await db.SaveChangesAsync(cancellation);
            }
            await tx.CommitAsync(cancellation);
            // Keep the caller's pre-existing tracked entities, but do not retain every
            // generated snapshot in this DbContext while advancing many groups.
            foreach (var attempt in carriedAttempts) db.Entry(attempt).State = EntityState.Detached;
            foreach (var row in carriedProgress) db.Entry(row).State = EntityState.Detached;
            foreach (var slot in nextSlots.Values) db.Entry(slot).State = EntityState.Detached;
            db.Entry(next).State = EntityState.Detached;
            if (!pointerWasTracked) db.Entry(pointer).State = EntityState.Detached;
            published++;
            log.LogInformation("Admin.Lesson.AutoPublish GroupId={GroupId} LessonVersionId={LessonVersionId} VersionId={VersionId}",
                groupId, lessonVersionId, next.Id);
        }
        return published;
    }

    private static Task<int> CopyProgressSqlAsync(ApplicationDbContext db, Guid oldVersionId,
        Guid newVersionId, Guid changedSlotId, string mappingJson, string allowedStagesJson,
        CancellationToken cancellation) => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO [StudentStageProgress]
                ([StudentId], [PublishedCurriculumVersionId], [SlotId], [StageKey],
                 [CompletedSegments], [IsComplete], [UpdatedAtUtc])
            SELECT progress.[StudentId], {newVersionId}, mapping.[NewSlotId],
                   progress.[StageKey], progress.[CompletedSegments], progress.[IsComplete],
                   progress.[UpdatedAtUtc]
            FROM [StudentStageProgress] AS progress
            INNER JOIN OPENJSON({mappingJson}) WITH
                ([OldSlotId] uniqueidentifier '$.oldSlotId',
                 [NewSlotId] uniqueidentifier '$.newSlotId') AS mapping
                ON mapping.[OldSlotId] = progress.[SlotId]
            WHERE progress.[PublishedCurriculumVersionId] = {oldVersionId}
                AND (progress.[SlotId] <> {changedSlotId} OR progress.[StageKey] IN
                    (SELECT [value] FROM OPENJSON({allowedStagesJson})))
            """, cancellation);

    private static Task<int> CopyAttemptsSqlAsync(ApplicationDbContext db, Guid oldVersionId,
        Guid newVersionId, Guid changedSlotId, string mappingJson, string allowedStagesJson,
        CancellationToken cancellation) => db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO [StudentPracticeAttempts]
                ([Id], [StudentId], [PublishedCurriculumVersionId], [SlotId], [StageKey],
                 [Position], [Answer], [FeedbackJson], [CreatedAtUtc])
            SELECT NEWID(), attempt.[StudentId], {newVersionId}, mapping.[NewSlotId],
                   attempt.[StageKey], attempt.[Position], attempt.[Answer],
                   attempt.[FeedbackJson], attempt.[CreatedAtUtc]
            FROM [StudentPracticeAttempts] AS attempt
            INNER JOIN OPENJSON({mappingJson}) WITH
                ([OldSlotId] uniqueidentifier '$.oldSlotId',
                 [NewSlotId] uniqueidentifier '$.newSlotId') AS mapping
                ON mapping.[OldSlotId] = attempt.[SlotId]
            WHERE attempt.[PublishedCurriculumVersionId] = {oldVersionId}
                AND (attempt.[SlotId] <> {changedSlotId} OR attempt.[StageKey] IN
                    (SELECT [value] FROM OPENJSON({allowedStagesJson})))
            """, cancellation);

    private static AdminLessonWorkflowEndpoints.WorkflowStage[] ReadStages(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<AdminLessonWorkflowEndpoints.WorkflowStage[]>(json, Json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static bool SameStageContent(string stage, LessonMaterial? old, LessonMaterial current)
    {
        if (old is null) return false;
        static bool Same<T>(T a, T b) => JsonSerializer.Serialize(a, Json) == JsonSerializer.Serialize(b, Json);
        return stage switch
        {
            "shadowing" => true,
            "vocabulary" => Same(old.Vocabulary, current.Vocabulary),
            "listen-type" => Same(old.Dictation, current.Dictation),
            "grammar" => old.GrammarFocus == current.GrammarFocus,
            "quiz" => Same(old.Quiz, current.Quiz),
            "vocabulary-quiz" => Same(old.Quiz.Where(x => x.Type == "vocabulary-card"),
                current.Quiz.Where(x => x.Type == "vocabulary-card")),
            "grammar-quiz" => Same(old.Quiz.Where(x => x.Type == "multiple-choice"),
                current.Quiz.Where(x => x.Type == "multiple-choice")),
            "word-order" => Same(old.Quiz.Where(x => x.Type == "word-order"),
                current.Quiz.Where(x => x.Type == "word-order")),
            "conversation" => ConversationSignature(old) == ConversationSignature(current),
            _ => false
        };
    }

    private static string ConversationSignature(LessonMaterial x) => JsonSerializer.Serialize(new
    {
        x.ConversationScenario, x.ConversationGoals, x.AiRole, x.StudentRole,
        x.OpeningMessage, x.ConversationTurnTarget, x.ConversationLearningOutcome,
        x.ConversationFocusTense, x.ConversationTargetWords, x.ConversationCorrectionMode,
        x.ConversationSupportMode, x.ConversationHelpAr, x.ConversationModelAnswer,
        x.ConversationContextType, x.ConversationAllowedFacts, x.ConversationSuccessSteps,
        x.ConversationMinTurns, x.ConversationMaxTurns
    }, Json);
}
