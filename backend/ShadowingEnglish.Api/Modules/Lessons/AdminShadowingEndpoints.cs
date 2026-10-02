using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Api.Modules.Curriculums;

namespace ShadowingEnglish.Api.Modules.Lessons;

// Explicit Shadowing-only authoring. Development uses local WAVs; hosting uses private object storage.
public static class AdminShadowingEndpoints
{
    private const int MaxSegments = 20;
    private const long MaxAudioBytes = 2_000_000;
    private const long MaxRequestBytes = 45_000_000;

    public static IEndpointRouteBuilder MapAdminShadowingEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/shadowing")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        group.MapGet("/lessons", async (int? page, ApplicationDbContext db, HttpContext http,
            UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.Shadowing");
            log.LogInformation("Admin.Shadowing.List.Start Page={Page} TraceId={TraceId}", page, http.TraceIdentifier);
            var actor = await AdminAsync(http, users);
            if (actor is null) return Denied(log, started);
            if (page is < 1 or > 1000) return Error(log, started, 400, "invalid_page");
            try
            {
                const int size = 20;
                var rows = await db.LessonVersions.AsNoTracking()
                    .OrderByDescending(x => x.CreatedAtUtc).ThenByDescending(x => x.Id)
                    .Skip(((page ?? 1) - 1) * size).Take(size + 1)
                    .Select(x => new LessonDto(x.LessonDefinitionId, x.Id, x.Title, x.Description,
                        db.LessonSegments.Count(segment => segment.LessonVersionId == x.Id)))
                    .ToListAsync();
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.Shadowing.List.Success ActorId={ActorId} Count={Count} DurationMs={DurationMs}",
                    actor.Id, Math.Min(rows.Count, size), Ms(started));
                return Results.Ok(new { items = rows.Take(size), hasMore = rows.Count > size });
            }
            catch (Exception ex) { return Failed(log, ex, "List", actor.Id, started); }
        });

        group.MapGet("/groups", async (int? page, ApplicationDbContext db, HttpContext http,
            UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.Shadowing");
            log.LogInformation("Admin.Shadowing.Groups.Start Page={Page} TraceId={TraceId}", page, http.TraceIdentifier);
            var actor = await AdminAsync(http, users);
            if (actor is null) return Denied(log, started);
            if (page is < 1 or > 1000) return Error(log, started, 400, "invalid_page");
            try
            {
                const int size = 50;
                var rows = await db.StudyGroups.AsNoTracking()
                    .OrderBy(x => x.Name).ThenBy(x => x.Id)
                    .Skip(((page ?? 1) - 1) * size).Take(size + 1)
                    .Select(x => new GroupDto(x.Id, x.Name, db.GroupCurriculumAssignments
                        .Where(assignment => assignment.GroupId == x.Id)
                        .Select(assignment => (Guid?)assignment.PublishedCurriculumVersionId).SingleOrDefault()))
                    .ToListAsync();
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.Shadowing.Groups.Success ActorId={ActorId} Count={Count} DurationMs={DurationMs}",
                    actor.Id, Math.Min(rows.Count, size), Ms(started));
                return Results.Ok(new { items = rows.Take(size), hasMore = rows.Count > size });
            }
            catch (Exception ex) { return Failed(log, ex, "Groups", actor.Id, started); }
        });

        group.MapGet("/groups/{groupId:guid}/curriculum", async (Guid groupId,
            ApplicationDbContext db, HttpContext http, UserManager<ApplicationUser> users,
            ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.Shadowing");
            log.LogInformation("Admin.Shadowing.Curriculum.Start GroupId={GroupId}", groupId);
            http.Response.Headers.CacheControl = "no-store";
            try
            {
                var actor = await AdminAsync(http, users);
                if (actor is null)
                {
                    log.LogWarning("Admin.Shadowing.Curriculum.Failed GroupId={GroupId} Status={Status} DurationMs={DurationMs}",
                        groupId, 403, Ms(started));
                    return Results.Forbid();
                }
                if (!await db.StudyGroups.AsNoTracking().AnyAsync(x => x.Id == groupId, http.RequestAborted))
                {
                    log.LogWarning("Admin.Shadowing.Curriculum.Failed GroupId={GroupId} Status={Status} DurationMs={DurationMs}",
                        groupId, 404, Ms(started));
                    return Results.NotFound(new { error = "group_not_found" });
                }

                // Read the current pointer once; immutable slots keep this snapshot coherent during a later publish.
                var versionId = await (from assignment in db.GroupCurriculumAssignments.AsNoTracking()
                    join version in db.PublishedCurriculumVersions.AsNoTracking()
                        on assignment.PublishedCurriculumVersionId equals version.Id
                    where assignment.GroupId == groupId && version.GroupId == groupId
                    select (Guid?)version.Id).SingleOrDefaultAsync(http.RequestAborted);
                var lessons = versionId is null ? Array.Empty<CurriculumLessonDto>() : await (
                    from slot in db.PublishedLessonSlots.AsNoTracking()
                    join lesson in db.LessonVersions.AsNoTracking() on slot.LessonVersionId equals lesson.Id
                    where slot.PublishedCurriculumVersionId == versionId.Value
                    orderby slot.WeekNumber, slot.DayNumber, slot.SortOrder, slot.Id
                    select new CurriculumLessonDto(lesson.LessonDefinitionId, lesson.Id, lesson.Title,
                        slot.WeekNumber, slot.DayNumber, slot.SortOrder)).ToArrayAsync(http.RequestAborted);
                log.LogInformation("Admin.Shadowing.Curriculum.Success ActorId={ActorId} GroupId={GroupId} VersionId={VersionId} Count={Count} Status={Status} DurationMs={DurationMs}",
                    actor.Id, groupId, versionId, lessons.Length, 200, Ms(started));
                return Results.Ok(new { versionId, groupId, lessons });
            }
            catch (Exception)
            {
                // Do not log database exception messages, lesson text, audio, or credentials.
                log.LogError("Admin.Shadowing.Curriculum.Failed GroupId={GroupId} Status={Status} DurationMs={DurationMs}",
                    groupId, 500, Ms(started));
                return Results.Problem(statusCode: 500, title: "curriculum_read_failed");
            }
        });

        group.MapPost("/lessons", async (HttpContext http, IAntiforgery antiforgery,
            ApplicationDbContext db, UserManager<ApplicationUser> users, IShadowingMediaStore media,
            ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.Shadowing");
            log.LogInformation("Admin.Shadowing.Create.Start TraceId={TraceId}", http.TraceIdentifier);
            if (!http.Request.HasFormContentType || http.Request.ContentLength is > MaxRequestBytes)
                return Error(log, started, 413, "invalid_upload");
            var bodyFeature = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (bodyFeature is { IsReadOnly: false }) bodyFeature.MaxRequestBodySize = MaxRequestBytes;
            if (!await ValidCsrfAsync(http, antiforgery)) return Error(log, started, 400, "invalid_csrf");
            var actor = await AdminAsync(http, users);
            if (actor is null) return Denied(log, started);
            if (!media.IsConfigured) return Error(log, started, 503, "media_storage_not_configured");
            var createdKeys = new List<string>();
            var committed = false;
            var databaseSaveStarted = false;
            try
            {
                var form = await http.Request.ReadFormAsync(http.RequestAborted);
                var title = form["title"].ToString().Trim();
                var description = form["description"].ToString().Trim();
                var requestIdText = form["requestId"].ToString();
                var texts = JsonSerializer.Deserialize<string[]>(form["segments"].ToString());
                if (!Guid.TryParse(requestIdText, out var requestId) || requestId == Guid.Empty ||
                    !Valid(title, 160, 2) || description.Length > 1000 ||
                    texts is null || texts.Length is < 1 or > MaxSegments ||
                    texts.Any(x => !Valid(x?.Trim(), 1000, 1)) ||
                    form.Files.Count != texts.Length ||
                    Enumerable.Range(0, texts.Length).Any(i => form.Files.GetFile($"audio{i}") is not { Length: > 12 and <= MaxAudioBytes }))
                    return Error(log, started, 400, "invalid_lesson");
                var audio = Enumerable.Range(0, texts.Length)
                    .Select(i => form.Files.GetFile($"audio{i}")!).ToArray();
                if (audio.Sum(file => file.Length) > 40_000_000)
                    return Error(log, started, 413, "invalid_upload");

                // Validate every segment before any upload, so an invalid later file leaves no stored clips.
                foreach (var file in audio)
                {
                    await using var source = file.OpenReadStream();
                    if (!await WavAudio.IsValidAsync(source, file.Length, http.RequestAborted))
                        return Error(log, started, 400, "invalid_wav_audio");
                }
                var previous = await db.LessonDefinitions.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == requestId);
                if (previous is not null)
                {
                    var version = await db.LessonVersions.AsNoTracking()
                        .SingleAsync(x => x.LessonDefinitionId == requestId && x.VersionNumber == 1);
                    var segments = await db.LessonSegments.AsNoTracking()
                        .Where(x => x.LessonVersionId == version.Id).OrderBy(x => x.Position).ToListAsync();
                    if (version.Title != title || version.Description != description ||
                        segments.Count != texts.Length ||
                        segments.Where((segment, index) => segment.Text != texts[index].Trim()).Any() ||
                        !await SameAudioAsync(media, segments, audio, http.RequestAborted))
                        return Error(log, started, 409, "lesson_request_conflict");
                    http.Response.Headers.CacheControl = "no-store";
                    log.LogInformation("Admin.Shadowing.Create.NoChange ActorId={ActorId} LessonId={LessonId} DurationMs={DurationMs}",
                        actor.Id, requestId, Ms(started));
                    return Results.Ok(new LessonDto(requestId, version.Id, title, description, texts.Length));
                }

                var versionId = Guid.NewGuid();
                var rows = new List<LessonSegment>();
                for (var i = 0; i < audio.Length; i++)
                {
                    var key = $"lesson-{Guid.NewGuid():N}.wav";
                    // Unique keys belong only to this attempt; rollback never deletes another request's audio.
                    createdKeys.Add(key);
                    await using var source = audio[i].OpenReadStream();
                    await media.WriteAsync(key, source, http.RequestAborted);
                    rows.Add(new LessonSegment { Id = Guid.NewGuid(), LessonVersionId = versionId,
                        Position = i + 1, Text = texts[i].Trim(), AudioStorageKey = key });
                }
                db.LessonDefinitions.Add(new LessonDefinition { Id = requestId, Title = title });
                db.LessonVersions.Add(new LessonVersion { Id = versionId, LessonDefinitionId = requestId,
                    VersionNumber = 1, Title = title, Description = description,
                    CreatedAtUtc = DateTimeOffset.UtcNow });
                db.LessonSegments.AddRange(rows);
                databaseSaveStarted = true;
                await db.SaveChangesAsync(http.RequestAborted);
                committed = true;
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.Shadowing.Create.Success ActorId={ActorId} LessonId={LessonId} VersionId={VersionId} Segments={Count} DurationMs={DurationMs}",
                    actor.Id, requestId, versionId, rows.Count, Ms(started));
                return Results.Json(new LessonDto(requestId, versionId, title, description, rows.Count), statusCode: 201);
            }
            catch (JsonException) { return Error(log, started, 400, "invalid_segments"); }
            catch (BadHttpRequestException) { return Error(log, started, 413, "invalid_upload"); }
            catch (InvalidDataException) { return Error(log, started, 413, "invalid_upload"); }
            catch (MediaStorageUnavailableException) { return Error(log, started, 503, "media_storage_unavailable"); }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
            { return Error(log, started, 409, "lesson_request_conflict"); }
            catch (Exception ex) { return Failed(log, ex, "Create", actor.Id, started); }
            finally
            {
                if (!committed)
                {
                    // Cleanup needs its own bounded token if the browser disconnected during Save.
                    using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                    var protectedKeys = new HashSet<string>();
                    if (databaseSaveStarted)
                    {
                        try
                        {
                            // A database commit can succeed just before the connection/caller drops.
                            // Never delete audio referenced by that commit; uncertain cleanup is deferred.
                            protectedKeys.UnionWith(await db.LessonSegments.AsNoTracking()
                                .Where(segment => createdKeys.Contains(segment.AudioStorageKey))
                                .Select(segment => segment.AudioStorageKey).ToListAsync(cleanup.Token));
                        }
                        catch (Exception)
                        {
                            protectedKeys.UnionWith(createdKeys);
                            log.LogWarning("Admin.Shadowing.Create.CleanupDeferred Count={Count}", createdKeys.Count);
                        }
                    }
                    foreach (var key in createdKeys)
                    {
                        if (protectedKeys.Contains(key)) continue;
                        try { await media.DeleteAsync(key, cleanup.Token); }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or OperationCanceledException)
                        { log.LogWarning("Admin.Shadowing.Create.CleanupFailed AssetKey={AssetKey} ErrorType={ErrorType}", key, ex.GetType().Name); }
                    }
                }
            }
        }).RequireRateLimiting("admin-lesson-write");

        // Retired write contract: historical successful requests may be confirmed without mutation.
        // All new publications must explicitly save and assign an independent curriculum first.
        group.MapPost("/publish", async (PublishRequest request, HttpContext http,
            IAntiforgery antiforgery, ApplicationDbContext db, UserManager<ApplicationUser> users,
            ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.Shadowing");
            http.Response.Headers.CacheControl = "no-store";
            log.LogInformation("Admin.Shadowing.Publish.Start GroupId={GroupId} RequestId={RequestId}",
                request.GroupId, request.RequestId);
            if (!await ValidCsrfAsync(http, antiforgery)) return Error(log, started, 400, "invalid_csrf");
            var actor = await AdminAsync(http, users);
            if (actor is null) return Denied(log, started);
            try
            {
                var previous = await db.PublishedCurriculumVersions.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.RequestId, http.RequestAborted);
                if (previous is null) return Error(log, started, 409, "curriculum_publish_required");
                var slot = await db.PublishedLessonSlots.AsNoTracking().SingleOrDefaultAsync(x =>
                    x.PublishedCurriculumVersionId == previous.Id && x.LessonVersionId == request.LessonVersionId &&
                    x.WeekNumber == request.WeekNumber && x.DayNumber == request.DayNumber && x.SortOrder == request.SortOrder,
                    http.RequestAborted);
                if (previous.GroupId != request.GroupId || previous.SourceDraftRevision is not null || slot is null)
                    return Error(log, started, 409, "publish_request_conflict");
                log.LogInformation("Admin.Shadowing.Publish.NoChange GroupId={GroupId} VersionId={VersionId} DurationMs={DurationMs}",
                    previous.GroupId, previous.Id, Ms(started));
                return Results.Ok(new PublicationDto(previous.GroupId, previous.Id, slot.Id));
            }
            catch (Exception ex)
            {
                log.LogWarning("Admin.Shadowing.Publish.Failed ErrorType={ErrorType} DurationMs={DurationMs}", ex.GetType().Name, Ms(started));
                return Error(log, started, 500, "shadowing_operation_failed");
            }
        }).RequireRateLimiting("admin-lesson-write");

        return app.MapAdminCurriculumsEndpoints();
    }

    private static bool SafeKey(string key) => ShadowingMediaKeys.IsValid(key);

    private static bool Valid(string? text, int max, int min) =>
        text is { Length: >= 1 } && text.Length >= min && text.Length <= max && !text.Any(char.IsControl);

    private static async Task<bool> SameAudioAsync(IShadowingMediaStore media, IReadOnlyList<LessonSegment> segments,
        IReadOnlyList<IFormFile> audio, CancellationToken cancellation)
    {
        for (var i = 0; i < audio.Count; i++)
        {
            if (!SafeKey(segments[i].AudioStorageKey)) return false;
            await using var incoming = audio[i].OpenReadStream();
            if (!await media.MatchesAsync(segments[i].AudioStorageKey, incoming, cancellation)) return false;
        }
        return true;
    }

    private static async Task<ApplicationUser?> AdminAsync(HttpContext http, UserManager<ApplicationUser> users)
    {
        var actor = await users.GetUserAsync(http.User);
        return actor is not null && await users.IsInRoleAsync(actor, "Admin") ? actor : null;
    }

    private static async Task<bool> ValidCsrfAsync(HttpContext http, IAntiforgery antiforgery)
    {
        try { await antiforgery.ValidateRequestAsync(http); return true; }
        catch (AntiforgeryValidationException) { return false; }
    }

    private static double Ms(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;
    private static IResult Denied(ILogger log, long started)
    { log.LogWarning("Admin.Shadowing.Denied DurationMs={DurationMs}", Ms(started)); return Results.Forbid(); }
    private static IResult Error(ILogger log, long started, int status, string reason)
    { log.LogWarning("Admin.Shadowing.Rejected Reason={Reason} DurationMs={DurationMs}", reason, Ms(started));
        return Results.Json(new { error = reason }, statusCode: status); }
    private static IResult Failed(ILogger log, Exception ex, string action, Guid actorId, long started)
    { log.LogError(ex, "Admin.Shadowing.Failed Action={Action} ActorId={ActorId} DurationMs={DurationMs}",
        action, actorId, Ms(started)); return Results.Problem(statusCode: 500, title: "shadowing_operation_failed"); }

    private sealed record LessonDto(Guid Id, Guid VersionId, string Title, string Description, int SegmentCount);
    private sealed record GroupDto(Guid Id, string Name, Guid? CurrentVersionId);
    private sealed record CurriculumLessonDto(Guid LessonId, Guid LessonVersionId, string Title,
        int WeekNumber, int DayNumber, int SortOrder);
    public sealed record PublishRequest(Guid RequestId, Guid GroupId, Guid LessonVersionId,
        Guid? ExpectedVersionId, int WeekNumber, int DayNumber, int SortOrder);
    private sealed record PublicationDto(Guid GroupId, Guid VersionId, Guid SlotId);
}
