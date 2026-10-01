using System.Data;
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

        group.MapPost("/publish", async (PublishRequest request, HttpContext http,
            IAntiforgery antiforgery, ApplicationDbContext db, UserManager<ApplicationUser> users,
            IShadowingMediaStore media, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.Shadowing");
            log.LogInformation("Admin.Shadowing.Publish.Start GroupId={GroupId} LessonVersionId={LessonVersionId} RequestId={RequestId} TraceId={TraceId}",
                request.GroupId, request.LessonVersionId, request.RequestId, http.TraceIdentifier);
            if (!await ValidCsrfAsync(http, antiforgery)) return Error(log, started, 400, "invalid_csrf");
            var actor = await AdminAsync(http, users);
            if (actor is null) return Denied(log, started);
            if (!media.IsConfigured) return Error(log, started, 503, "media_storage_not_configured");
            if (request.RequestId == Guid.Empty || request.GroupId == Guid.Empty ||
                request.LessonVersionId == Guid.Empty || request.ExpectedVersionId == Guid.Empty ||
                request.WeekNumber is < 1 or > 52 || request.DayNumber is < 1 or > 7 ||
                request.SortOrder is < 1 or > 100)
                return Error(log, started, 400, "invalid_publication");
            try
            {
                LessonVersion? lesson = null;
                // Blob I/O happens before SQL's serializable transaction; don't hold group locks over the network.
                if (!await db.PublishedCurriculumVersions.AsNoTracking().AnyAsync(x => x.Id == request.RequestId))
                {
                    lesson = await db.LessonVersions.AsNoTracking()
                        .SingleOrDefaultAsync(x => x.Id == request.LessonVersionId);
                    if (lesson is null) return Error(log, started, 404, "lesson_not_found");
                    var keys = await db.LessonSegments.AsNoTracking()
                        .Where(x => x.LessonVersionId == lesson.Id).Select(x => x.AudioStorageKey).ToArrayAsync();
                    if (keys.Length == 0 || keys.Any(key => !SafeKey(key)))
                        return Error(log, started, 409, "lesson_audio_missing");
                    foreach (var key in keys)
                        if (!await media.ExistsAsync(key, http.RequestAborted))
                            return Error(log, started, 409, "lesson_audio_missing");
                }
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                var groupName = await db.StudyGroups.AsNoTracking().Where(x => x.Id == request.GroupId)
                    .Select(x => x.Name).SingleOrDefaultAsync();
                if (groupName is null) return Error(log, started, 404, "group_not_found");
                var assignment = await db.GroupCurriculumAssignments
                    .SingleOrDefaultAsync(x => x.GroupId == request.GroupId);
                var previousRequest = await db.PublishedCurriculumVersions.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.RequestId);
                if (previousRequest is not null)
                {
                    var publishedSlot = await db.PublishedLessonSlots.AsNoTracking()
                        .SingleOrDefaultAsync(x => x.PublishedCurriculumVersionId == previousRequest.Id &&
                            x.LessonVersionId == request.LessonVersionId && x.WeekNumber == request.WeekNumber &&
                            x.DayNumber == request.DayNumber && x.SortOrder == request.SortOrder);
                    if (previousRequest.GroupId != request.GroupId ||
                        assignment?.PublishedCurriculumVersionId != previousRequest.Id || publishedSlot is null)
                        return Error(log, started, 409, "publish_request_conflict");
                    http.Response.Headers.CacheControl = "no-store";
                    log.LogInformation("Admin.Shadowing.Publish.NoChange ActorId={ActorId} GroupId={GroupId} VersionId={VersionId} DurationMs={DurationMs}",
                        actor.Id, request.GroupId, previousRequest.Id, Ms(started));
                    return Results.Ok(new PublicationDto(request.GroupId, previousRequest.Id, publishedSlot.Id));
                }
                if (assignment?.PublishedCurriculumVersionId != request.ExpectedVersionId)
                    return Error(log, started, 409, "publication_changed");
                if (lesson is null) return Error(log, started, 409, "publication_changed");

                PublishedCurriculumVersion? current = null;
                var previousSlots = new List<PublishedLessonSlot>();
                if (assignment is not null)
                {
                    current = await db.PublishedCurriculumVersions.AsNoTracking()
                        .SingleAsync(x => x.Id == assignment.PublishedCurriculumVersionId);
                    // The old snapshot and progress stay intact. Do not silently reset an active student's progress.
                    if (await db.StudentStageProgress.AsNoTracking()
                        .AnyAsync(x => x.PublishedCurriculumVersionId == current.Id))
                        return Error(log, started, 409, "active_progress_prevents_republish");
                    previousSlots = await db.PublishedLessonSlots.AsNoTracking()
                        .Where(x => x.PublishedCurriculumVersionId == current.Id).ToListAsync();
                    if (previousSlots.Any(x => x.LessonVersionId == lesson.Id ||
                        (x.WeekNumber == request.WeekNumber && x.DayNumber == request.DayNumber &&
                         x.SortOrder == request.SortOrder)))
                        return Error(log, started, 409, "slot_conflict");
                }
                var now = DateTimeOffset.UtcNow;
                var templateId = current?.CurriculumTemplateId ?? Guid.NewGuid();
                if (current is null)
                    db.CurriculumTemplates.Add(new CurriculumTemplate { Id = templateId, Name = groupName });
                var nextNumber = current is null ? 1 :
                    1 + await db.PublishedCurriculumVersions.AsNoTracking()
                        .Where(x => x.GroupId == request.GroupId && x.CurriculumTemplateId == templateId)
                        .MaxAsync(x => x.VersionNumber);
                var version = new PublishedCurriculumVersion { Id = request.RequestId,
                    CurriculumTemplateId = templateId, GroupId = request.GroupId,
                    VersionNumber = nextNumber,
                    Title = current?.Title ?? groupName, PublishedAtUtc = now, AvailableAtUtc = now };
                db.PublishedCurriculumVersions.Add(version);
                foreach (var old in previousSlots)
                    db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = Guid.NewGuid(),
                        PublishedCurriculumVersionId = version.Id, LessonVersionId = old.LessonVersionId,
                        WeekNumber = old.WeekNumber, DayNumber = old.DayNumber,
                        SortOrder = old.SortOrder, AvailableAtUtc = old.AvailableAtUtc });
                var slot = new PublishedLessonSlot { Id = Guid.NewGuid(),
                    PublishedCurriculumVersionId = version.Id, LessonVersionId = lesson.Id,
                    WeekNumber = request.WeekNumber, DayNumber = request.DayNumber,
                    SortOrder = request.SortOrder, AvailableAtUtc = now };
                db.PublishedLessonSlots.Add(slot);
                if (assignment is null)
                    db.GroupCurriculumAssignments.Add(new GroupCurriculumAssignment { GroupId = request.GroupId,
                        PublishedCurriculumVersionId = version.Id });
                else assignment.PublishedCurriculumVersionId = version.Id;
                await db.SaveChangesAsync();
                await tx.CommitAsync();
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.Shadowing.Publish.Success ActorId={ActorId} GroupId={GroupId} VersionId={VersionId} SlotId={SlotId} Count={Count} DurationMs={DurationMs}",
                    actor.Id, request.GroupId, version.Id, slot.Id, previousSlots.Count + 1, Ms(started));
                return Results.Json(new PublicationDto(request.GroupId, version.Id, slot.Id), statusCode: 201);
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 or 1205 })
            { return Conflict(log, ex, actor.Id, started); }
            catch (SqlException ex) when (ex.Number == 1205)
            { return Conflict(log, ex, actor.Id, started); }
            catch (MediaStorageUnavailableException) { return Error(log, started, 503, "media_storage_unavailable"); }
            catch (Exception ex) { return Failed(log, ex, "Publish", actor.Id, started); }
        }).RequireRateLimiting("admin-lesson-write");

        return app;
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
    private static IResult Conflict(ILogger log, Exception ex, Guid actorId, long started)
    { log.LogWarning(ex, "Admin.Shadowing.Publish.Conflict ActorId={ActorId} DurationMs={DurationMs}",
        actorId, Ms(started)); return Results.Conflict(new { error = "publication_changed" }); }

    private sealed record LessonDto(Guid Id, Guid VersionId, string Title, string Description, int SegmentCount);
    private sealed record GroupDto(Guid Id, string Name, Guid? CurrentVersionId);
    public sealed record PublishRequest(Guid RequestId, Guid GroupId, Guid LessonVersionId,
        Guid? ExpectedVersionId, int WeekNumber, int DayNumber, int SortOrder);
    private sealed record PublicationDto(Guid GroupId, Guid VersionId, Guid SlotId);
}
