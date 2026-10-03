using System.Data;
using System.Diagnostics;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;
using ShadowingEnglish.Api.Modules.Media;

namespace ShadowingEnglish.Api.Modules.Student;

public static class StudentLearningEndpoints
{
    public static IEndpointRouteBuilder MapStudentLearningEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/student/learning")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Student" });

        group.MapGet("/curriculum", async (int? page, int? pageSize, Guid? expectedPublishedVersionId, HttpContext http,
            ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var clock = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Student.Learning");
            log.LogInformation("Student.Curriculum.Start TraceId={TraceId}", http.TraceIdentifier);
            var student = await StudentId(http, users);
            if (student is null) return Denied(log, clock);
            if (page is < 1 or > 10000 || pageSize is < 1 or > 50)
                return Reject(log, clock, "invalid_page");
            if (expectedPublishedVersionId == Guid.Empty)
                return Reject(log, clock, "invalid_published_version");
            try
            {
                var now = DateTimeOffset.UtcNow;
                var groupInfo = await (from member in db.StudentGroupMemberships.AsNoTracking()
                    join g in db.StudyGroups.AsNoTracking() on member.GroupId equals g.Id
                    where member.StudentId == student.Value && member.EndedAtUtc == null
                    select new { g.Id, g.Name }).SingleOrDefaultAsync();
                var assigned = groupInfo is null ? null : await (from assignment in db.GroupCurriculumAssignments.AsNoTracking()
                    join version in db.PublishedCurriculumVersions.AsNoTracking()
                        on assignment.PublishedCurriculumVersionId equals version.Id
                    where assignment.GroupId == groupInfo.Id && version.GroupId == groupInfo.Id &&
                        version.PublishedAtUtc <= now && version.AvailableAtUtc <= now
                    select new { version.Id, version.Title }).SingleOrDefaultAsync();
                if (expectedPublishedVersionId is Guid expectedVersionId &&
                    (assigned is null || assigned.Id != expectedVersionId))
                {
                    http.Response.Headers.CacheControl = "no-store";
                    log.LogWarning("Student.Curriculum.VersionChanged StudentId={StudentId} ExpectedVersionId={ExpectedVersionId} CurrentVersionId={CurrentVersionId} DurationMs={DurationMs}",
                        student, expectedVersionId, assigned?.Id, Ms(clock));
                    return Results.Conflict(new { error = "curriculum_version_changed" });
                }
                if (assigned is null)
                {
                    http.Response.Headers.CacheControl = "no-store";
                    log.LogInformation("Student.Curriculum.Empty StudentId={StudentId} DurationMs={DurationMs}", student, Ms(clock));
                    return Results.Ok(new CurriculumDto(groupInfo?.Name, null, null, Array.Empty<LessonCard>(), false));
                }
                var limit = pageSize ?? 20;
                var visible = await (from slot in db.PublishedLessonSlots.AsNoTracking()
                    join lesson in db.LessonVersions.AsNoTracking() on slot.LessonVersionId equals lesson.Id
                    where slot.PublishedCurriculumVersionId == assigned.Id && slot.AvailableAtUtc <= now
                    orderby slot.WeekNumber, slot.DayNumber, slot.SortOrder, slot.Id
                    select new { slot.Id, slot.WeekNumber, slot.DayNumber, slot.SortOrder, lesson.Title })
                    .Skip(((page ?? 1) - 1) * limit).Take(limit + 1).ToListAsync();
                var ids = visible.Take(limit).Select(x => x.Id).ToArray();
                var progress = await db.StudentStageProgress.AsNoTracking()
                    .Where(x => x.StudentId == student.Value && x.PublishedCurriculumVersionId == assigned.Id &&
                        x.StageKey == "shadowing" && ids.Contains(x.SlotId))
                    .Select(x => new { x.SlotId, x.CompletedSegments, x.IsComplete }).ToListAsync();
                var bySlot = progress.ToDictionary(x => x.SlotId);
                var cards = visible.Take(limit).Select(x => new LessonCard(x.Id, x.Title, x.WeekNumber,
                    x.DayNumber, x.SortOrder, bySlot.TryGetValue(x.Id, out var p) ? p.CompletedSegments : 0,
                    bySlot.TryGetValue(x.Id, out p) && p.IsComplete)).ToArray();
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Student.Curriculum.Success StudentId={StudentId} VersionId={VersionId} Count={Count} DurationMs={DurationMs}",
                    student, assigned.Id, cards.Length, Ms(clock));
                return Results.Ok(new CurriculumDto(groupInfo!.Name, assigned.Id, assigned.Title, cards, visible.Count > limit));
            }
            catch (Exception ex) { return Fail(log, ex, "Curriculum", student.Value, clock); }
        });

        group.MapGet("/slots/{slotId:guid}", async (Guid slotId, HttpContext http, ApplicationDbContext db,
            UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var clock = Stopwatch.GetTimestamp(); var log = loggers.CreateLogger("Student.Learning");
            log.LogInformation("Student.Overview.Start SlotId={SlotId} TraceId={TraceId}", slotId, http.TraceIdentifier);
            var student = await StudentId(http, users);
            if (student is null) return Denied(log, clock);
            try
            {
                var slot = await ScopedSlot(db, student.Value, slotId);
                if (slot is null) return Missing(log, clock, student.Value, slotId);
                var count = await db.LessonSegments.AsNoTracking().CountAsync(x => x.LessonVersionId == slot.LessonVersionId);
                var progress = await db.StudentStageProgress.AsNoTracking().SingleOrDefaultAsync(x =>
                    x.StudentId == student.Value && x.PublishedCurriculumVersionId == slot.VersionId &&
                    x.SlotId == slotId && x.StageKey == "shadowing");
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Student.Overview.Success StudentId={StudentId} SlotId={SlotId} DurationMs={DurationMs}", student, slotId, Ms(clock));
                return Results.Ok(new OverviewDto(slotId, slot.VersionId, slot.Title, slot.Description,
                    slot.WeekNumber, slot.DayNumber, slot.SortOrder, count,
                    progress?.CompletedSegments ?? 0, progress?.IsComplete ?? false));
            }
            catch (Exception ex) { return Fail(log, ex, "Overview", student.Value, clock); }
        });

        group.MapGet("/slots/{slotId:guid}/segments/{position:int}", async (Guid slotId, int position,
            HttpContext http, ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var clock = Stopwatch.GetTimestamp(); var log = loggers.CreateLogger("Student.Learning");
            log.LogInformation("Student.Segment.Start SlotId={SlotId} Position={Position} TraceId={TraceId}", slotId, position, http.TraceIdentifier);
            var student = await StudentId(http, users);
            if (student is null) return Denied(log, clock);
            if (position < 1) return Reject(log, clock, "invalid_position");
            try
            {
                var slot = await ScopedSlot(db, student.Value, slotId);
                if (slot is null) return Missing(log, clock, student.Value, slotId);
                var segment = await db.LessonSegments.AsNoTracking()
                    .Where(x => x.LessonVersionId == slot.LessonVersionId && x.Position == position)
                    .Select(x => new { x.Text }).SingleOrDefaultAsync();
                if (segment is null) return Missing(log, clock, student.Value, slotId);
                http.Response.Headers.CacheControl = "private, max-age=300";
                log.LogInformation("Student.Segment.Success StudentId={StudentId} SlotId={SlotId} Position={Position} DurationMs={DurationMs}", student, slotId, position, Ms(clock));
                return Results.Ok(new SegmentDto(position, segment.Text,
                    $"/api/student/learning/slots/{slotId}/segments/{position}/audio"));
            }
            catch (Exception ex) { return Fail(log, ex, "Segment", student.Value, clock); }
        });

        group.MapGet("/slots/{slotId:guid}/segments/{position:int}/audio", async (Guid slotId,
            int position, HttpContext http, ApplicationDbContext db, UserManager<ApplicationUser> users,
            IShadowingMediaStore media, ILoggerFactory loggers) =>
        {
            var clock = Stopwatch.GetTimestamp(); var log = loggers.CreateLogger("Student.Learning");
            log.LogInformation("Student.Audio.Start SlotId={SlotId} Position={Position} TraceId={TraceId}", slotId, position, http.TraceIdentifier);
            var student = await StudentId(http, users);
            if (student is null) return Denied(log, clock);
            if (position < 1) return Reject(log, clock, "invalid_position");
            try
            {
                var slot = await ScopedSlot(db, student.Value, slotId);
                if (slot is null) return Missing(log, clock, student.Value, slotId);
                var key = await db.LessonSegments.AsNoTracking()
                    .Where(x => x.LessonVersionId == slot.LessonVersionId && x.Position == position)
                    .Select(x => x.AudioStorageKey).SingleOrDefaultAsync();
                if (key is null) return Missing(log, clock, student.Value, slotId);
                // Configured trusted media root; no path characters accepted from the database key.
                if (!Regex.IsMatch(key, "^[a-z0-9-]+\\.wav$", RegexOptions.CultureInvariant))
                    return Fail(log, new InvalidOperationException("Invalid media key"), "Audio", student.Value, clock);
                if (!media.IsConfigured)
                    return MediaUnavailable(log, student.Value, clock, "media_storage_not_configured");
                var audio = await media.OpenAsync(key, http.RequestAborted);
                if (audio is null) return MediaUnavailable(log, student.Value, clock, "lesson_audio_missing");
                // Revalidate through authorization on each visit; a matching private ETag avoids retransmitting audio.
                http.Response.Headers.CacheControl = "private, no-cache";
                var tag = new EntityTagHeaderValue(audio.ETag);
                log.LogInformation("Student.Audio.Success StudentId={StudentId} SlotId={SlotId} Position={Position} DurationMs={DurationMs}", student, slotId, position, Ms(clock));
                return Results.Stream(audio.Content, "audio/wav", lastModified: audio.LastModified,
                    entityTag: tag, enableRangeProcessing: true);
            }
            catch (MediaStorageUnavailableException)
            { return MediaUnavailable(log, student.Value, clock, "media_storage_unavailable"); }
            catch (Exception ex) { return Fail(log, ex, "Audio", student.Value, clock); }
        });

        group.MapPut("/slots/{slotId:guid}/progress", async (Guid slotId, SaveProgressRequest request,
            HttpContext http, IAntiforgery antiforgery, ApplicationDbContext db,
            UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var clock = Stopwatch.GetTimestamp(); var log = loggers.CreateLogger("Student.Learning");
            log.LogInformation("Student.Progress.Save.Start SlotId={SlotId} TraceId={TraceId}", slotId, http.TraceIdentifier);
            try { await antiforgery.ValidateRequestAsync(http); }
            catch (AntiforgeryValidationException) { return Reject(log, clock, "invalid_csrf"); }
            var student = await StudentId(http, users);
            if (student is null) return Denied(log, clock);
            if (request.CompletedSegments < 1) return Reject(log, clock, "invalid_progress");
            try
            {
                // The unique composite PK plus serializable isolation prevents duplicate concurrent inserts.
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                var slot = await ScopedSlot(db, student.Value, slotId);
                if (slot is null) return Missing(log, clock, student.Value, slotId);
                var total = await db.LessonSegments.AsNoTracking().CountAsync(x => x.LessonVersionId == slot.LessonVersionId);
                if (total == 0 || request.CompletedSegments > total) return Reject(log, clock, "invalid_progress");
                var progress = await db.StudentStageProgress.SingleOrDefaultAsync(x =>
                    x.StudentId == student.Value && x.PublishedCurriculumVersionId == slot.VersionId &&
                    x.SlotId == slotId && x.StageKey == "shadowing");
                var previous = progress?.CompletedSegments ?? 0;
                if (request.CompletedSegments > previous + 1)
                {
                    log.LogWarning("Student.Progress.Save.Conflict StudentId={StudentId} SlotId={SlotId} DurationMs={DurationMs}", student, slotId, Ms(clock));
                    return Results.Conflict(new { error = "progress_out_of_order" });
                }
                if (request.CompletedSegments > previous)
                {
                    if (progress is null)
                    {
                        progress = new StudentStageProgress { StudentId = student.Value,
                            PublishedCurriculumVersionId = slot.VersionId, SlotId = slotId, StageKey = "shadowing" };
                        db.StudentStageProgress.Add(progress);
                    }
                    progress.CompletedSegments = request.CompletedSegments;
                    progress.IsComplete = request.CompletedSegments == total;
                    progress.UpdatedAtUtc = DateTimeOffset.UtcNow;
                    await db.SaveChangesAsync();
                }
                await tx.CommitAsync();
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Student.Progress.Save.Success StudentId={StudentId} SlotId={SlotId} Completed={Completed} Changed={Changed} DurationMs={DurationMs}",
                    student, slotId, progress!.CompletedSegments, request.CompletedSegments > previous, Ms(clock));
                return Results.Ok(new ProgressDto(progress.CompletedSegments, progress.IsComplete));
            }
            catch (DbUpdateConcurrencyException ex)
            { return ProgressConflict(log, ex, student.Value, slotId, clock); }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 or 1205 })
            { return ProgressConflict(log, ex, student.Value, slotId, clock); }
            catch (SqlException ex) when (ex.Number == 1205)
            { return ProgressConflict(log, ex, student.Value, slotId, clock); }
            catch (Exception ex) { return Fail(log, ex, "Progress.Save", student.Value, clock); }
        }).RequireRateLimiting("student-progress-write");

        return app;
    }

    private static async Task<Guid?> StudentId(HttpContext http, UserManager<ApplicationUser> users)
    {
        var raw = http.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(raw, out var id)) return null;
        var user = await users.FindByIdAsync(raw!);
        return user is not null && await users.IsInRoleAsync(user, "Student") ? id : null;
    }

    private static async Task<ScopedLesson?> ScopedSlot(ApplicationDbContext db, Guid studentId, Guid slotId)
    {
        var now = DateTimeOffset.UtcNow;
        return await (from member in db.StudentGroupMemberships.AsNoTracking()
            join assignment in db.GroupCurriculumAssignments.AsNoTracking() on member.GroupId equals assignment.GroupId
            join version in db.PublishedCurriculumVersions.AsNoTracking() on assignment.PublishedCurriculumVersionId equals version.Id
            join slot in db.PublishedLessonSlots.AsNoTracking() on version.Id equals slot.PublishedCurriculumVersionId
            join lesson in db.LessonVersions.AsNoTracking() on slot.LessonVersionId equals lesson.Id
            where member.StudentId == studentId && member.EndedAtUtc == null &&
                version.GroupId == member.GroupId && version.PublishedAtUtc <= now &&
                version.AvailableAtUtc <= now && slot.Id == slotId && slot.AvailableAtUtc <= now
            select new ScopedLesson(version.Id, lesson.Id, lesson.Title, lesson.Description,
                slot.WeekNumber, slot.DayNumber, slot.SortOrder)).SingleOrDefaultAsync();
    }

    private static double Ms(long start) => Stopwatch.GetElapsedTime(start).TotalMilliseconds;
    private static IResult MediaUnavailable(ILogger log, Guid studentId, long started, string reason)
    {
        log.LogWarning("Student.Audio.Unavailable StudentId={StudentId} Reason={Reason} DurationMs={DurationMs}",
            studentId, reason, Ms(started));
        return Results.Json(new { error = reason }, statusCode: 503);
    }
    private static IResult Denied(ILogger log, long start)
    { log.LogWarning("Student.Learning.Denied DurationMs={DurationMs}", Ms(start)); return Results.Forbid(); }
    private static IResult Reject(ILogger log, long start, string error)
    { log.LogWarning("Student.Learning.Rejected Error={Error} DurationMs={DurationMs}", error, Ms(start)); return Results.BadRequest(new { error }); }
    private static IResult Missing(ILogger log, long start, Guid studentId, Guid slotId)
    { log.LogWarning("Student.Learning.NotFound StudentId={StudentId} SlotId={SlotId} DurationMs={DurationMs}", studentId, slotId, Ms(start)); return Results.NotFound(new { error = "slot_not_found" }); }
    private static IResult ProgressConflict(ILogger log, Exception ex, Guid studentId, Guid slotId, long start)
    { log.LogWarning("Student.Progress.Save.Conflict ErrorCode=progress_changed ErrorType={ErrorType} StudentId={StudentId} SlotId={SlotId} DurationMs={DurationMs}", ex.GetType().Name, studentId, slotId, Ms(start)); return Results.Conflict(new { error = "progress_changed" }); }
    private static IResult Fail(ILogger log, Exception ex, string operation, Guid studentId, long start)
    { log.LogError("Student.{Operation}.Failed ErrorCode=learning_operation_failed ErrorType={ErrorType} StudentId={StudentId} DurationMs={DurationMs}", ex.GetType().Name, operation, studentId, Ms(start)); return Results.Problem(statusCode: 500); }

    private sealed record ScopedLesson(Guid VersionId, Guid LessonVersionId, string Title, string Description,
        int WeekNumber, int DayNumber, int SortOrder);
    private sealed record LessonCard(Guid SlotId, string Title, int WeekNumber, int DayNumber, int SortOrder,
        int CompletedSegments, bool IsComplete);
    private sealed record CurriculumDto(string? GroupName, Guid? PublishedVersionId, string? CurriculumTitle,
        LessonCard[] Items, bool HasMore);
    private sealed record OverviewDto(Guid SlotId, Guid VersionId, string Title, string Description,
        int WeekNumber, int DayNumber, int SortOrder, int SegmentCount, int CompletedSegments, bool IsComplete);
    private sealed record SegmentDto(int Position, string Text, string AudioUrl);
    private sealed record SaveProgressRequest(int CompletedSegments);
    private sealed record ProgressDto(int CompletedSegments, bool IsComplete);
}
