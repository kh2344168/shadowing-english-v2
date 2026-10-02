using System.Data;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Api.Modules.Curriculums;

public static class AdminCurriculumsEndpoints
{
    public static IEndpointRouteBuilder MapAdminCurriculumsEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/admin/shadowing")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        api.MapGet("/curriculums", async (int? page, HttpContext http, ApplicationDbContext db,
            UserManager<ApplicationUser> users, ILoggerFactory logs) =>
        {
            var op = new Operation(logs, "Load", http);
            if (!await IsAdmin(http, users)) return op.Fail(403, "forbidden");
            if (page is < 1 or > 1000) return op.Fail(400, "invalid_page");
            try
            {
                const int size = 20;
                var rows = await db.CurriculumTemplates.AsNoTracking()
                    .OrderByDescending(x => x.DraftUpdatedAtUtc).ThenBy(x => x.Name).ThenBy(x => x.Id)
                    .Skip(((page ?? 1) - 1) * size).Take(size + 1)
                    .Select(x => new CurriculumSummary(x.Id, x.Name, x.Description, x.DraftRevision,
                        x.DraftUpdatedAtUtc, db.CurriculumDraftLessonSlots.Count(s => s.CurriculumTemplateId == x.Id),
                        db.CurriculumDraftLessonSlots.Where(s => s.CurriculumTemplateId == x.Id)
                            .Select(s => s.WeekNumber).Distinct().Count()))
                    .ToArrayAsync(http.RequestAborted);
                return op.Ok(new { items = rows.Take(size), hasMore = rows.Length > size }, count: Math.Min(size, rows.Length));
            }
            catch (Exception ex) { return op.Exception(ex); }
        });

        api.MapGet("/curriculums/{id:guid}", async (Guid id, HttpContext http, ApplicationDbContext db,
            UserManager<ApplicationUser> users, ILoggerFactory logs) =>
        {
            var op = new Operation(logs, "Load", http, id);
            if (!await IsAdmin(http, users)) return op.Fail(403, "forbidden");
            try
            {
                // Template revision and its slots are read from one consistent snapshot.
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, http.RequestAborted);
                var draft = await ReadDraft(db, id, http.RequestAborted);
                await tx.CommitAsync(http.RequestAborted);
                return draft is null ? op.Fail(404, "curriculum_not_found") : op.Ok(draft, count: draft.Lessons.Length);
            }
            catch (Exception ex) { return op.Exception(ex); }
        });

        api.MapPost("/curriculums", async (CreateCurriculum request, HttpContext http,
            IAntiforgery csrf, ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory logs) =>
        {
            var op = new Operation(logs, "Create", http, request.RequestId);
            var denied = await AuthorizeWrite(http, csrf, users, op);
            if (denied is not null) return denied;
            var name = request.Name?.Trim();
            var description = request.Description?.Trim() ?? "";
            if (request.RequestId == Guid.Empty || !ValidName(name) || !ValidDescription(description))
                return op.Fail(400, "invalid_curriculum");
            var hash = Hash(new { name, description });
            try
            {
                var current = await db.CurriculumTemplates.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.RequestId, http.RequestAborted);
                if (current is not null)
                    return current.CreateRequestHash != hash ? op.Fail(409, "curriculum_request_conflict") :
                        op.Ok((await ReadDraft(db, current.Id, http.RequestAborted))!, result: "no_change");
                var template = new CurriculumTemplate
                {
                    Id = request.RequestId, Name = name!, Description = description,
                    DraftRevision = Guid.NewGuid(), DraftUpdatedAtUtc = DateTimeOffset.UtcNow, CreateRequestHash = hash
                };
                db.CurriculumTemplates.Add(template);
                await db.SaveChangesAsync(http.RequestAborted);
                return op.Ok((await ReadDraft(db, template.Id, http.RequestAborted))!, status: 201);
            }
            catch (Exception ex) { return op.Exception(ex); }
        }).RequireRateLimiting("admin-group-write");

        api.MapPut("/curriculums/{id:guid}", async (Guid id, UpdateCurriculum request, HttpContext http,
            IAntiforgery csrf, ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory logs) =>
        {
            var op = new Operation(logs, "Update", http, id);
            var denied = await AuthorizeWrite(http, csrf, users, op);
            if (denied is not null) return denied;
            var name = request.Name?.Trim();
            var description = request.Description?.Trim() ?? "";
            if (request.RequestId == Guid.Empty || !ValidName(name) || !ValidDescription(description) ||
                request.Lessons is null || request.Lessons.Length > 52 * 7 * 100 ||
                request.Lessons.Any(x => x is null || x.LessonVersionId == Guid.Empty ||
                    x.WeekNumber is < 1 or > 52 || x.DayNumber is < 1 or > 7 || x.SortOrder is < 1 or > 100))
                return op.Fail(400, "invalid_curriculum");
            var ordered = request.Lessons.OrderBy(x => x.WeekNumber).ThenBy(x => x.DayNumber).ThenBy(x => x.SortOrder).ToArray();
            if (ordered.Select(x => x.LessonVersionId).Distinct().Count() != ordered.Length ||
                ordered.Select(x => (x.WeekNumber, x.DayNumber, x.SortOrder)).Distinct().Count() != ordered.Length)
                return op.Fail(409, "slot_conflict");
            var hash = Hash(new { request.ExpectedDraftRevision, name, description, lessons = ordered });
            try
            {
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, http.RequestAborted);
                var template = await db.CurriculumTemplates.SingleOrDefaultAsync(x => x.Id == id, http.RequestAborted);
                if (template is null) return op.Fail(404, "curriculum_not_found");
                if (template.LastUpdateRequestId == request.RequestId)
                    return template.LastUpdateRequestHash != hash ? op.Fail(409, "curriculum_request_conflict") :
                        op.Ok((await ReadDraft(db, id, http.RequestAborted))!, count: ordered.Length, result: "no_change");
                if (template.DraftRevision != request.ExpectedDraftRevision) return op.Fail(409, "draft_changed");
                var ids = ordered.Select(x => x.LessonVersionId).ToArray();
                if (await db.LessonVersions.CountAsync(x => ids.Contains(x.Id), http.RequestAborted) != ids.Length)
                    return op.Fail(404, "lesson_not_found");
                var old = await db.CurriculumDraftLessonSlots.Where(x => x.CurriculumTemplateId == id)
                    .ToArrayAsync(http.RequestAborted);
                var added = ordered.Count(x => old.All(s => s.LessonVersionId != x.LessonVersionId));
                var removed = old.Count(x => ordered.All(s => s.LessonVersionId != x.LessonVersionId));
                var reordered = ordered.Count(x => old.Any(s => s.LessonVersionId == x.LessonVersionId &&
                    (s.WeekNumber != x.WeekNumber || s.DayNumber != x.DayNumber || s.SortOrder != x.SortOrder)));
                op.Slots("Start", added, removed, reordered);
                template.Name = name!;
                template.Description = description;
                template.DraftRevision = Guid.NewGuid();
                template.DraftUpdatedAtUtc = DateTimeOffset.UtcNow;
                template.LastUpdateRequestId = request.RequestId;
                template.LastUpdateRequestHash = hash;
                // Delete/insert within this transaction makes position swaps safe under unique indexes.
                db.CurriculumDraftLessonSlots.RemoveRange(old);
                await db.SaveChangesAsync(http.RequestAborted);
                db.CurriculumDraftLessonSlots.AddRange(ordered.Select(x => new CurriculumDraftLessonSlot
                {
                    Id = Guid.NewGuid(), CurriculumTemplateId = id, LessonVersionId = x.LessonVersionId,
                    WeekNumber = x.WeekNumber, DayNumber = x.DayNumber, SortOrder = x.SortOrder
                }));
                await db.SaveChangesAsync(http.RequestAborted);
                var response = (await ReadDraft(db, id, http.RequestAborted))!;
                await tx.CommitAsync(http.RequestAborted);
                op.Slots("Success", added, removed, reordered);
                return op.Ok(response, count: ordered.Length);
            }
            catch (Exception ex) { return op.Exception(ex); }
        }).RequireRateLimiting("admin-group-write");

        api.MapGet("/groups/{groupId:guid}/curriculum", async (Guid groupId, HttpContext http,
            ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory logs) =>
        {
            var op = new Operation(logs, "Load", http, groupId: groupId);
            if (!await IsAdmin(http, users)) return op.Fail(403, "forbidden");
            try
            {
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, http.RequestAborted);
                var state = await ReadGroup(db, groupId, http.RequestAborted);
                await tx.CommitAsync(http.RequestAborted);
                return state is null ? op.Fail(404, "group_not_found") : op.Ok(state, count: state.Lessons.Length);
            }
            catch (Exception ex) { return op.Exception(ex); }
        });

        api.MapPut("/groups/{groupId:guid}/curriculum-assignment", async (Guid groupId,
            AssignCurriculum request, HttpContext http, IAntiforgery csrf, ApplicationDbContext db,
            UserManager<ApplicationUser> users, ILoggerFactory logs) =>
        {
            var op = new Operation(logs, "Assign", http, request.CurriculumTemplateId, groupId);
            var denied = await AuthorizeWrite(http, csrf, users, op);
            if (denied is not null) return denied;
            if (request.RequestId == Guid.Empty || request.CurriculumTemplateId == Guid.Empty)
                return op.Fail(400, "invalid_assignment");
            var hash = Hash(request);
            try
            {
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, http.RequestAborted);
                var group = await db.StudyGroups.SingleOrDefaultAsync(x => x.Id == groupId, http.RequestAborted);
                if (group is null) return op.Fail(404, "group_not_found");
                if (group.LastCurriculumAssignmentRequestId == request.RequestId)
                    return group.LastCurriculumAssignmentRequestHash != hash ? op.Fail(409, "assignment_request_conflict") :
                        op.Ok((await ReadGroup(db, groupId, http.RequestAborted))!, result: "no_change");
                if (group.CurriculumAssignmentRevision != request.ExpectedAssignmentRevision)
                    return op.Fail(409, "assignment_changed");
                if (!await db.CurriculumTemplates.AnyAsync(x => x.Id == request.CurriculumTemplateId, http.RequestAborted))
                    return op.Fail(404, "curriculum_not_found");
                group.AssignedCurriculumTemplateId = request.CurriculumTemplateId;
                group.CurriculumAssignmentRevision = Guid.NewGuid();
                group.LastCurriculumAssignmentRequestId = request.RequestId;
                group.LastCurriculumAssignmentRequestHash = hash;
                await db.SaveChangesAsync(http.RequestAborted);
                var response = (await ReadGroup(db, groupId, http.RequestAborted))!;
                await tx.CommitAsync(http.RequestAborted);
                return op.Ok(response);
            }
            catch (Exception ex) { return op.Exception(ex); }
        }).RequireRateLimiting("admin-group-write");

        api.MapPost("/curriculums/publish", async (PublishCurriculum request, HttpContext http,
            IAntiforgery csrf, ApplicationDbContext db, UserManager<ApplicationUser> users,
            IShadowingMediaStore media, ILoggerFactory logs) =>
        {
            var op = new Operation(logs, "Publish", http, request.CurriculumTemplateId, request.GroupId);
            var denied = await AuthorizeWrite(http, csrf, users, op);
            if (denied is not null) return denied;
            if (request.RequestId == Guid.Empty || request.GroupId == Guid.Empty || request.CurriculumTemplateId == Guid.Empty ||
                request.ExpectedVersionId == Guid.Empty) return op.Fail(400, "invalid_publication");
            var hash = Hash(request);
            try
            {
                // A confirmed retry does not depend on later audio availability, draft edits, or assignment changes.
                var previous = await db.PublishedCurriculumVersions.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.RequestId, http.RequestAborted);
                if (previous is not null) return PublicationRetry(previous, request, hash, op);
                if (!media.IsConfigured) return op.Fail(503, "media_storage_not_configured");
                var observedDraft = await db.CurriculumTemplates.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.CurriculumTemplateId, http.RequestAborted);
                if (observedDraft is null) return op.Fail(404, "curriculum_not_found");
                if (observedDraft.DraftRevision != request.ExpectedDraftRevision) return op.Fail(409, "draft_changed");
                var lessonIds = await db.CurriculumDraftLessonSlots.AsNoTracking()
                    .Where(x => x.CurriculumTemplateId == request.CurriculumTemplateId)
                    .Select(x => x.LessonVersionId).ToArrayAsync(http.RequestAborted);
                if (lessonIds.Length == 0) return op.Fail(409, "curriculum_empty");
                var audio = await db.LessonSegments.AsNoTracking().Where(x => lessonIds.Contains(x.LessonVersionId))
                    .Select(x => new { x.LessonVersionId, x.AudioStorageKey }).ToArrayAsync(http.RequestAborted);
                if (lessonIds.Any(id => audio.All(x => x.LessonVersionId != id)) ||
                    audio.Any(x => !ShadowingMediaKeys.IsValid(x.AudioStorageKey))) return op.Fail(409, "lesson_audio_missing");
                // Media I/O precedes SQL locks. Revision is rechecked inside the transaction below.
                foreach (var key in audio.Select(x => x.AudioStorageKey).Distinct())
                    if (!await media.ExistsAsync(key, http.RequestAborted)) return op.Fail(409, "lesson_audio_missing");
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, http.RequestAborted);
                previous = await db.PublishedCurriculumVersions.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.RequestId, http.RequestAborted);
                if (previous is not null) return PublicationRetry(previous, request, hash, op);
                var group = await db.StudyGroups.AsNoTracking().SingleOrDefaultAsync(x => x.Id == request.GroupId, http.RequestAborted);
                if (group is null) return op.Fail(404, "group_not_found");
                if (group.AssignedCurriculumTemplateId != request.CurriculumTemplateId ||
                    group.CurriculumAssignmentRevision != request.ExpectedAssignmentRevision)
                    return op.Fail(409, "assignment_changed");
                var template = await db.CurriculumTemplates.AsNoTracking()
                    .SingleAsync(x => x.Id == request.CurriculumTemplateId, http.RequestAborted);
                if (template.DraftRevision != request.ExpectedDraftRevision) return op.Fail(409, "draft_changed");
                var assignment = await db.GroupCurriculumAssignments.SingleOrDefaultAsync(x => x.GroupId == request.GroupId, http.RequestAborted);
                if (assignment?.PublishedCurriculumVersionId != request.ExpectedVersionId)
                    return op.Fail(409, "publication_changed");
                if (assignment is not null && await db.StudentStageProgress.AsNoTracking()
                    .AnyAsync(x => x.PublishedCurriculumVersionId == assignment.PublishedCurriculumVersionId, http.RequestAborted))
                    return op.Fail(409, "active_progress_prevents_republish");
                var slots = await db.CurriculumDraftLessonSlots.AsNoTracking()
                    .Where(x => x.CurriculumTemplateId == template.Id).ToArrayAsync(http.RequestAborted);
                var maxNumber = await db.PublishedCurriculumVersions.Where(x => x.GroupId == request.GroupId && x.CurriculumTemplateId == template.Id)
                    .Select(x => (int?)x.VersionNumber).MaxAsync(http.RequestAborted) ?? 0;
                var now = DateTimeOffset.UtcNow;
                var version = new PublishedCurriculumVersion
                {
                    Id = request.RequestId, GroupId = request.GroupId, CurriculumTemplateId = template.Id,
                    SourceDraftRevision = template.DraftRevision, PublishRequestHash = hash,
                    VersionNumber = maxNumber + 1, Title = template.Name, PublishedAtUtc = now, AvailableAtUtc = now
                };
                db.PublishedCurriculumVersions.Add(version);
                db.PublishedLessonSlots.AddRange(slots.Select(x => new PublishedLessonSlot
                {
                    Id = Guid.NewGuid(), PublishedCurriculumVersionId = version.Id, LessonVersionId = x.LessonVersionId,
                    WeekNumber = x.WeekNumber, DayNumber = x.DayNumber, SortOrder = x.SortOrder, AvailableAtUtc = now
                }));
                if (assignment is null) db.GroupCurriculumAssignments.Add(new GroupCurriculumAssignment
                    { GroupId = request.GroupId, PublishedCurriculumVersionId = version.Id });
                else assignment.PublishedCurriculumVersionId = version.Id;
                await db.SaveChangesAsync(http.RequestAborted);
                await tx.CommitAsync(http.RequestAborted);
                return op.Ok(new Publication(version.Id, version.GroupId, template.Id, template.DraftRevision, version.VersionNumber),
                    status: 201, count: slots.Length);
            }
            catch (MediaStorageUnavailableException) { return op.Fail(503, "media_storage_unavailable"); }
            catch (Exception ex) { return op.Exception(ex); }
        }).RequireRateLimiting("admin-group-write");
        return app;
    }

    private static IResult PublicationRetry(PublishedCurriculumVersion previous, PublishCurriculum request, string hash, Operation op) =>
        previous.GroupId != request.GroupId || previous.PublishRequestHash != hash || previous.SourceDraftRevision is null
            ? op.Fail(409, "publish_request_conflict")
            : op.Ok(new Publication(previous.Id, previous.GroupId, previous.CurriculumTemplateId,
                previous.SourceDraftRevision.Value, previous.VersionNumber), result: "no_change");

    private static async Task<CurriculumDraft?> ReadDraft(ApplicationDbContext db, Guid id, CancellationToken cancellation)
    {
        var template = await db.CurriculumTemplates.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, cancellation);
        if (template is null) return null;
        var lessons = await (from slot in db.CurriculumDraftLessonSlots.AsNoTracking()
            join lesson in db.LessonVersions.AsNoTracking() on slot.LessonVersionId equals lesson.Id
            where slot.CurriculumTemplateId == id
            orderby slot.WeekNumber, slot.DayNumber, slot.SortOrder
            select new CurriculumLesson(lesson.LessonDefinitionId, lesson.Id, lesson.Title, lesson.Description,
                db.LessonSegments.Count(s => s.LessonVersionId == lesson.Id), slot.WeekNumber, slot.DayNumber, slot.SortOrder))
            .ToArrayAsync(cancellation);
        return new CurriculumDraft(template.Id, template.Name, template.Description, template.DraftRevision,
            template.DraftUpdatedAtUtc, lessons);
    }

    private static async Task<GroupCurriculumState?> ReadGroup(ApplicationDbContext db, Guid groupId, CancellationToken cancellation)
    {
        var group = await db.StudyGroups.AsNoTracking().SingleOrDefaultAsync(x => x.Id == groupId, cancellation);
        if (group is null) return null;
        var template = group.AssignedCurriculumTemplateId is { } id
            ? await db.CurriculumTemplates.AsNoTracking().SingleAsync(x => x.Id == id, cancellation) : null;
        var version = await (from assignment in db.GroupCurriculumAssignments.AsNoTracking()
            join published in db.PublishedCurriculumVersions.AsNoTracking() on assignment.PublishedCurriculumVersionId equals published.Id
            where assignment.GroupId == groupId && published.GroupId == groupId select published).SingleOrDefaultAsync(cancellation);
        var lessons = version is null ? [] : await (from slot in db.PublishedLessonSlots.AsNoTracking()
            join lesson in db.LessonVersions.AsNoTracking() on slot.LessonVersionId equals lesson.Id
            where slot.PublishedCurriculumVersionId == version.Id
            orderby slot.WeekNumber, slot.DayNumber, slot.SortOrder
            select new PublishedLesson(lesson.LessonDefinitionId, lesson.Id, lesson.Title, slot.WeekNumber, slot.DayNumber, slot.SortOrder))
            .ToArrayAsync(cancellation);
        return new GroupCurriculumState(group.Id, group.Name, template?.Id, template?.Name, template?.DraftRevision,
            group.CurriculumAssignmentRevision, version?.Id, version?.CurriculumTemplateId, version?.Title,
            version?.SourceDraftRevision, version?.VersionNumber,
            template is not null && (version is null || version.CurriculumTemplateId != template.Id || version.SourceDraftRevision != template.DraftRevision), lessons);
    }

    private static bool ValidName(string? name) => name is { Length: >= 2 and <= 160 } && !name.Any(char.IsControl);
    private static bool ValidDescription(string description) => description.Length <= 1000 &&
        !description.Any(x => char.IsControl(x) && x != '\n' && x != '\r' && x != '\t');
    private static string Hash<T>(T request) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));
    private static async Task<bool> IsAdmin(HttpContext http, UserManager<ApplicationUser> users)
    {
        var actor = await users.GetUserAsync(http.User);
        return actor is not null && await users.IsInRoleAsync(actor, "Admin");
    }
    private static async Task<IResult?> AuthorizeWrite(HttpContext http, IAntiforgery csrf,
        UserManager<ApplicationUser> users, Operation op)
    {
        if (!await IsAdmin(http, users)) return op.Fail(403, "forbidden");
        try { await csrf.ValidateRequestAsync(http); return null; }
        catch (AntiforgeryValidationException) { return op.Fail(400, "invalid_csrf"); }
    }

    private sealed class Operation
    {
        private readonly ILogger log;
        private readonly string action;
        private readonly HttpContext http;
        private readonly Guid? curriculumId;
        private readonly Guid? groupId;
        private readonly long started = Stopwatch.GetTimestamp();
        private (int Added, int Removed, int Reordered)? slotCounts;
        public Operation(ILoggerFactory logs, string action, HttpContext http, Guid? curriculumId = null, Guid? groupId = null)
        {
            log = logs.CreateLogger("Admin.Shadowing.Curriculum");
            this.action = action; this.http = http; this.curriculumId = curriculumId; this.groupId = groupId;
            http.Response.Headers.CacheControl = "no-store";
            log.LogInformation("Admin.Shadowing.Curriculum.{Operation}.Start CurriculumId={CurriculumId} GroupId={GroupId}", action, curriculumId, groupId);
        }
        public IResult Ok(object response, int status = 200, int count = 0, string result = "success")
        {
            log.LogInformation("Admin.Shadowing.Curriculum.{Operation}.Success CurriculumId={CurriculumId} GroupId={GroupId} Count={Count} Status={Status} Result={Result} DurationMs={DurationMs}",
                action, curriculumId, groupId, count, status, result, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            return Results.Json(response, statusCode: status);
        }
        public IResult Fail(int status, string code, string? errorType = null)
        {
            log.LogWarning("Admin.Shadowing.Curriculum.{Operation}.Failed CurriculumId={CurriculumId} GroupId={GroupId} Status={Status} Result={Result} ErrorType={ErrorType} DurationMs={DurationMs}",
                action, curriculumId, groupId, status, code, errorType, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            if (slotCounts is { } counts) Slots("Failed", counts.Added, counts.Removed, counts.Reordered);
            return Results.Json(new { error = code }, statusCode: status);
        }
        public IResult Exception(Exception ex) => ex switch
        {
            DbUpdateConcurrencyException => Fail(409, "curriculum_changed", ex.GetType().Name),
            DbUpdateException { InnerException: SqlException { Number: 2601 or 2627 or 1205 } } => Fail(409, "curriculum_changed", ex.GetType().Name),
            SqlException { Number: 1205 } => Fail(409, "curriculum_changed", ex.GetType().Name),
            _ => Fail(500, "curriculum_operation_failed", ex.GetType().Name)
        };
        public void Slots(string result, int added, int removed, int reordered)
        {
            if (result == "Start") slotCounts = (added, removed, reordered);
            foreach (var (operation, count) in new[] { ("AddLesson", added), ("RemoveLesson", removed), ("ReorderLesson", reordered) })
                if (count > 0) log.LogInformation(
                    "Admin.Shadowing.Curriculum.{Operation}.{Result} CurriculumId={CurriculumId} Count={Count} DurationMs={DurationMs}",
                    operation, result, curriculumId, count, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
    }

    public sealed record CreateCurriculum(Guid RequestId, string? Name, string? Description);
    public sealed record LessonPosition(Guid LessonVersionId, int WeekNumber, int DayNumber, int SortOrder);
    public sealed record UpdateCurriculum(Guid RequestId, Guid ExpectedDraftRevision, string? Name, string? Description, LessonPosition[]? Lessons);
    public sealed record AssignCurriculum(Guid RequestId, Guid CurriculumTemplateId, Guid ExpectedAssignmentRevision);
    public sealed record PublishCurriculum(Guid RequestId, Guid GroupId, Guid CurriculumTemplateId, Guid ExpectedDraftRevision,
        Guid ExpectedAssignmentRevision, Guid? ExpectedVersionId);
    public sealed record CurriculumSummary(Guid Id, string Name, string Description, Guid DraftRevision,
        DateTimeOffset? UpdatedAtUtc, int LessonCount, int WeekCount);
    public sealed record CurriculumDraft(Guid Id, string Name, string Description, Guid DraftRevision,
        DateTimeOffset? UpdatedAtUtc, CurriculumLesson[] Lessons);
    public sealed record CurriculumLesson(Guid LessonId, Guid LessonVersionId, string Title, string Description,
        int SegmentCount, int WeekNumber, int DayNumber, int SortOrder);
    public sealed record PublishedLesson(Guid LessonId, Guid LessonVersionId, string Title, int WeekNumber, int DayNumber, int SortOrder);
    public sealed record GroupCurriculumState(Guid GroupId, string GroupName, Guid? AssignedCurriculumTemplateId,
        string? AssignedCurriculumName, Guid? DraftRevision, Guid AssignmentRevision, Guid? VersionId,
        Guid? PublishedCurriculumTemplateId, string? PublishedTitle, Guid? PublishedDraftRevision, int? VersionNumber,
        bool HasUnpublishedChanges, PublishedLesson[] Lessons);
    public sealed record Publication(Guid VersionId, Guid GroupId, Guid CurriculumTemplateId, Guid SourceDraftRevision, int VersionNumber);
}
