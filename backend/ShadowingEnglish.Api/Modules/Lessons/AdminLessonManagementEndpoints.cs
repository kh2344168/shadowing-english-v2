using System.Diagnostics;
using System.Data;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;
using ShadowingEnglish.Api.Common;

namespace ShadowingEnglish.Api.Modules.Lessons;

// Lesson library: versioned edits and explicitly-confirmed irreversible deletion.
public static class AdminLessonManagementEndpoints
{
    private const long MaxUploadBytes = 45_000_000;
    private const long MaxClipBytes = 2_000_000;

    public static IEndpointRouteBuilder MapAdminLessonManagementEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/shadowing/lessons")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        group.MapGet("/{lessonId:guid}", async (Guid lessonId, ApplicationDbContext db,
            HttpContext http, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.LessonLibrary");
            log.LogInformation("Admin.LessonLibrary.Details.Start LessonId={LessonId} TraceId={TraceId}", lessonId, http.TraceIdentifier);
            try
            {
                var definition = await db.LessonDefinitions.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == lessonId && !x.IsArchived, http.RequestAborted);
                if (definition is null) return Reject(log, started, 404, "lesson_not_found");
                var version = await db.LessonVersions.AsNoTracking()
                    .Where(x => x.LessonDefinitionId == lessonId)
                    .OrderByDescending(x => x.VersionNumber).FirstAsync(http.RequestAborted);
                var segments = await db.LessonSegments.AsNoTracking()
                    .Where(x => x.LessonVersionId == version.Id)
                    .OrderBy(x => x.Position)
                    .Select(x => new
                    {
                        x.Position, x.Text,
                        AudioUrl = $"/api/admin/shadowing/lessons/versions/{version.Id}/segments/{x.Position}/audio"
                    })
                    .ToArrayAsync(http.RequestAborted);
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.LessonLibrary.Details.Success LessonId={LessonId} VersionId={VersionId} Segments={Count} DurationMs={DurationMs}",
                    lessonId, version.Id, segments.Length, Duration(started));
                return Results.Ok(new { id = lessonId, versionId = version.Id, versionNumber = version.VersionNumber,
                    title = version.Title, description = version.Description, segments });
            }
            catch (Exception ex) { return Failure(log, started, "Details", lessonId, ex); }
        });

        group.MapGet("/versions/{versionId:guid}/segments/{position:int}/audio", async (
            Guid versionId, int position, ApplicationDbContext db, IShadowingMediaStore media,
            HttpContext http, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.LessonLibrary");
            log.LogInformation(
                "Admin.LessonLibrary.Audio.Start VersionId={VersionId} Position={Position} TraceId={TraceId}",
                versionId, position, http.TraceIdentifier);
            if (position is < 1 or > 20)
                return Reject(log, started, 404, "lesson_audio_not_found");
            try
            {
                var key = await db.LessonSegments.AsNoTracking()
                    .Where(x => x.LessonVersionId == versionId && x.Position == position)
                    .Select(x => x.AudioStorageKey).SingleOrDefaultAsync(http.RequestAborted);
                if (string.IsNullOrWhiteSpace(key) || !ShadowingMediaKeys.IsValid(key))
                    return Reject(log, started, 404, "lesson_audio_not_found");
                if (!media.IsConfigured)
                    return Reject(log, started, 503, "media_storage_not_configured");
                var audio = await media.OpenAsync(key, http.RequestAborted);
                if (audio is null) return Reject(log, started, 404, "lesson_audio_not_found");
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation(
                    "Admin.LessonLibrary.Audio.Success VersionId={VersionId} Position={Position} DurationMs={DurationMs}",
                    versionId, position, Duration(started));
                return Results.Stream(audio.Content, "audio/wav", lastModified: audio.LastModified,
                    entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue(audio.ETag),
                    enableRangeProcessing: true);
            }
            catch (MediaStorageUnavailableException)
            {
                return Reject(log, started, 503, "media_storage_unavailable");
            }
            catch (Exception ex)
            {
                log.LogError(
                    "Admin.LessonLibrary.Audio.Failed VersionId={VersionId} Position={Position} ErrorType={ErrorType} DurationMs={DurationMs}",
                    versionId, position, ex.GetType().Name, Duration(started));
                return Results.Problem(statusCode: 500, title: "lesson_audio_operation_failed");
            }
        });

        group.MapPut("/{lessonId:guid}", async (Guid lessonId, HttpContext http,
            IAntiforgery antiforgery, ApplicationDbContext db, IShadowingMediaStore media,
            UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.LessonLibrary");
            log.LogInformation("Admin.LessonLibrary.Edit.Start LessonId={LessonId} TraceId={TraceId}", lessonId, http.TraceIdentifier);
            if (!http.Request.HasFormContentType || http.Request.ContentLength is > MaxUploadBytes)
                return Reject(log, started, 413, "invalid_upload");
            var bodyFeature = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (bodyFeature is { IsReadOnly: false }) bodyFeature.MaxRequestBodySize = MaxUploadBytes;
            http.Request.Body = new CappedRequestStream(http.Request.Body, MaxUploadBytes, "invalid_upload");
            http.Features.Set<IFormFeature>(new FormFeature(http.Request,
                new FormOptions { MultipartBodyLengthLimit = MaxUploadBytes }));
            try
            {
                if (!await CsrfValid(http, antiforgery)) return Reject(log, started, 400, "invalid_csrf");
            }
            catch (BadHttpRequestException) { return Reject(log, started, 413, "invalid_upload"); }
            catch (InvalidDataException) { return Reject(log, started, 413, "invalid_upload"); }
            var actor = await users.GetUserAsync(http.User);
            if (actor is null || !await users.IsInRoleAsync(actor, "Admin")) return Results.Forbid();

            var createdKeys = new List<string>();
            var committed = false;
            var databaseSaveStarted = false;
            try
            {
                var form = await http.Request.ReadFormAsync(http.RequestAborted);
                if (!Guid.TryParse(form["expectedVersionId"].ToString(), out var expectedVersionId) || expectedVersionId == Guid.Empty ||
                    !Guid.TryParse(form["requestId"].ToString(), out var requestId) || requestId == Guid.Empty)
                    return Reject(log, started, 400, "invalid_request");
                var title = form["title"].ToString().Trim();
                var description = form["description"].ToString().Trim();
                var texts = JsonSerializer.Deserialize<string[]>(form["segments"].ToString());
                var sourcePositionsValue = form["sourcePositions"].ToString();
                var sourcePositions = string.IsNullOrWhiteSpace(sourcePositionsValue)
                    ? Enumerable.Range(1, texts?.Length ?? 0).ToArray()
                    : JsonSerializer.Deserialize<int[]>(sourcePositionsValue);
                if (!Valid(title, 2, 160) || description.Length > 1000 ||
                    texts is null || texts.Length is < 1 or > 20 || texts.Any(s => !Valid(s?.Trim(), 1, 1000)) ||
                    sourcePositions is null || sourcePositions.Length != texts.Length)
                    return Reject(log, started, 400, "invalid_lesson");
                var files = Enumerable.Range(0, texts.Length).Select(i => form.Files.GetFile($"audio{i}")).ToArray();
                if (form.Files.Count != files.Count(f => f is not null) ||
                    files.Any(f => f is { Length: <= 12 or > MaxClipBytes }) ||
                    files.Where(f => f is not null).Sum(f => f!.Length) > 40_000_000)
                    return Reject(log, started, 413, "invalid_audio");
                if (files.Any(f => f is not null) && !media.IsConfigured)
                    return Reject(log, started, 503, "media_storage_not_configured");
                foreach (var file in files)
                {
                    if (file is null) continue;
                    await using var stream = file.OpenReadStream();
                    if (!await WavAudio.IsValidAsync(stream, file.Length, http.RequestAborted))
                        return Reject(log, started, 400, "invalid_wav_audio");
                }

                var definition = await db.LessonDefinitions.SingleOrDefaultAsync(x => x.Id == lessonId, http.RequestAborted);
                if (definition is null || definition.IsArchived) return Reject(log, started, 404, "lesson_not_found");
                var latest = await db.LessonVersions.AsNoTracking()
                    .Where(x => x.LessonDefinitionId == lessonId)
                    .OrderByDescending(x => x.VersionNumber).FirstAsync(http.RequestAborted);
                if (latest.Id != expectedVersionId)
                    return Reject(log, started, 409, "lesson_version_changed");
                var oldSegments = await db.LessonSegments.AsNoTracking()
                    .Where(x => x.LessonVersionId == latest.Id)
                    .OrderBy(x => x.Position).ToArrayAsync(http.RequestAborted);
                if (sourcePositions.Where((position, index) => position < 1 || position > oldSegments.Length ||
                        (index > 0 && position <= sourcePositions[index - 1])).Any())
                    return Reject(log, started, 400, "invalid_segments");
                var selectedSegments = sourcePositions.Select(position => oldSegments[position - 1]).ToArray();
                var unchangedContent = selectedSegments.Length == oldSegments.Length &&
                    selectedSegments.Select((s, i) => s.Text == texts[i]!.Trim() && files[i] is null).All(x => x);
                if (latest.Title == title && latest.Description == description && unchangedContent)
                {
                    log.LogInformation("Admin.LessonLibrary.Edit.NoChange ActorId={ActorId} LessonId={LessonId} DurationMs={DurationMs}", actor.Id, lessonId, Duration(started));
                    return Results.Ok(new { id = lessonId, versionId = latest.Id, title, description, segmentCount = texts.Length });
                }

                var versionId = Guid.NewGuid();
                var now = DateTimeOffset.UtcNow;
                var rows = new List<LessonSegment>();
                for (var i = 0; i < texts.Length; i++)
                {
                    var key = selectedSegments[i].AudioStorageKey;
                    if (files[i] is not null)
                    {
                        key = $"lesson-{Guid.NewGuid():N}.wav";
                        createdKeys.Add(key);
                        await using var source = files[i]!.OpenReadStream();
                        await media.WriteAsync(key, source, http.RequestAborted);
                    }
                    rows.Add(new LessonSegment { Id = Guid.NewGuid(), LessonVersionId = versionId,
                        Position = i + 1, Text = texts[i]!.Trim(), AudioStorageKey = key });
                }
                var approved = unchangedContent ? await db.LessonAiContents.AsNoTracking()
                    .Where(x => x.LessonVersionId == latest.Id && x.Status == "Approved")
                    .OrderByDescending(x => x.ApprovedAtUtc).FirstOrDefaultAsync(http.RequestAborted) : null;
                var previousWorkflow = await db.LessonWorkflows.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.LessonVersionId == latest.Id, http.RequestAborted);

                // Published slots keep pointing at the old version and media; drafts never auto-publish a new edit.
                db.LessonVersions.Add(new LessonVersion { Id = versionId, LessonDefinitionId = lessonId,
                    VersionNumber = latest.VersionNumber + 1, Title = title, Description = description,
                    LessonType = latest.LessonType, Level = latest.Level, Goal = latest.Goal,
                    CreatedAtUtc = now });
                db.LessonSegments.AddRange(rows);
                definition.Title = title;
                if (approved is not null)
                    db.LessonAiContents.Add(new LessonAiContent { Id = Guid.NewGuid(), LessonVersionId = versionId,
                        CreatedByAdminId = actor.Id, Revision = Guid.NewGuid(), CreatedAtUtc = now, UpdatedAtUtc = now,
                        Status = "Approved", PayloadJson = approved.PayloadJson,
                        ProviderName = approved.ProviderName, ApprovedAtUtc = now });
                if (previousWorkflow is not null)
                    db.LessonWorkflows.Add(new LessonWorkflow { LessonVersionId = versionId,
                        Revision = Guid.NewGuid(), StagesJson = previousWorkflow.StagesJson, UpdatedAtUtc = now });
                databaseSaveStarted = true;
                await db.SaveChangesAsync(http.RequestAborted);
                committed = true;
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.LessonLibrary.Edit.Success ActorId={ActorId} LessonId={LessonId} PreviousVersionId={PreviousVersionId} VersionId={VersionId} Segments={Count} AiReprocess={AiReprocess} RequestId={RequestId} DurationMs={DurationMs}",
                    actor.Id, lessonId, latest.Id, versionId, rows.Count, approved is null, requestId, Duration(started));
                return Results.Ok(new { id = lessonId, versionId, title, description, segmentCount = rows.Count,
                    aiNeedsReview = approved is null });
            }
            catch (JsonException) { return Reject(log, started, 400, "invalid_segments"); }
            catch (BadHttpRequestException) { return Reject(log, started, 413, "invalid_upload"); }
            catch (InvalidDataException) { return Reject(log, started, 413, "invalid_upload"); }
            catch (MediaStorageUnavailableException) { return Reject(log, started, 503, "media_storage_unavailable"); }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
            { return Reject(log, started, 409, "lesson_version_changed"); }
            catch (Exception ex) { return Failure(log, started, "Edit", lessonId, ex); }
            finally
            {
                if (!committed && createdKeys.Count > 0)
                {
                    using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                    var referenced = new HashSet<string>();
                    if (databaseSaveStarted)
                    {
                        try { referenced.UnionWith(await db.LessonSegments.AsNoTracking()
                            .Where(s => createdKeys.Contains(s.AudioStorageKey))
                            .Select(s => s.AudioStorageKey).ToListAsync(cleanup.Token)); }
                        catch (Exception) { referenced.UnionWith(createdKeys);
                            log.LogWarning("Admin.LessonLibrary.Edit.CleanupDeferred Count={Count}", createdKeys.Count); }
                    }
                    foreach (var key in createdKeys.Where(key => !referenced.Contains(key)))
                    {
                        try { await media.DeleteAsync(key, cleanup.Token); }
                        catch (Exception ex) { log.LogWarning("Admin.LessonLibrary.Edit.CleanupFailed ErrorType={ErrorType}", ex.GetType().Name); }
                    }
                }
            }
        }).RequireRateLimiting("admin-lesson-write");

        // Permanent deletion is explicit. Block while any curriculum draft or active group
        // publication references the lesson. Historical superseded publications are cleaned up.
        group.MapDelete("/{lessonId:guid}", async (Guid lessonId, [FromBody] DeleteLessonRequest request,
            IAntiforgery antiforgery, HttpContext http, ApplicationDbContext db, IShadowingMediaStore media,
            UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.LessonLibrary");
            log.LogInformation("Admin.LessonLibrary.Purge.Start LessonId={LessonId} ExpectedVersionId={VersionId} TraceId={TraceId}",
                lessonId, request.ExpectedVersionId, http.TraceIdentifier);
            if (!await CsrfValid(http, antiforgery)) return PurgeReject(log, started, lessonId, null, 400, "invalid_csrf");
            var actor = await users.GetUserAsync(http.User);
            if (actor is null || !await users.IsInRoleAsync(actor, "Admin")) return Results.Forbid();
            if (lessonId == Guid.Empty || request.ExpectedVersionId == Guid.Empty || !request.PermanentlyDelete)
                return PurgeReject(log, started, lessonId, actor.Id, 400, "permanent_deletion_confirmation_required");
            if (!media.IsConfigured) return PurgeReject(log, started, lessonId, actor.Id, 503, "media_storage_not_configured");

            try
            {
                var cancellation = http.RequestAborted;
                // SERIALIZABLE + FK restrictions protect other concurrent curriculum/student writes.
                // All database mutations and media-cleanup enqueueing commit as ONE transaction.
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
                var exists = await db.LessonDefinitions.AsNoTracking().AnyAsync(x => x.Id == lessonId, cancellation);
                if (!exists) return PurgeReject(log, started, lessonId, actor.Id, 404, "lesson_not_found");

                var versions = await db.LessonVersions.AsNoTracking()
                    .Where(x => x.LessonDefinitionId == lessonId)
                    .OrderByDescending(x => x.VersionNumber)
                    .Select(x => x.Id).ToArrayAsync(cancellation);
                if (versions.Length == 0 || versions[0] != request.ExpectedVersionId)
                    return PurgeReject(log, started, lessonId, actor.Id, 409, "lesson_version_changed");

                // A lesson is removable only AFTER the admin removes ALL of its versions
                // from every saved curriculum draft. This never edits a draft on the admin's behalf.
                // Check all versions: an earlier version may still be in a draft.
                var usedByDraft = await db.CurriculumDraftLessonSlots.AsNoTracking()
                    .AnyAsync(x => versions.Contains(x.LessonVersionId), cancellation);
                if (usedByDraft)
                {
                    return PurgeReject(log, started, lessonId, actor.Id, 409, "lesson_in_curriculum_draft");
                }

                // The active publication is whatever a group CURRENTLY points to.
                // Historical superseded publications must not block permanent deletion.
                var usedByCurrentPublication = await db.GroupCurriculumAssignments.AsNoTracking()
                    .AnyAsync(assignment => db.PublishedLessonSlots.Any(slot =>
                        slot.PublishedCurriculumVersionId == assignment.PublishedCurriculumVersionId &&
                        versions.Contains(slot.LessonVersionId)), cancellation);
                if (usedByCurrentPublication)
                {
                    return PurgeReject(log, started, lessonId, actor.Id, 409, "lesson_in_published_curriculum");
                }

                // Check the outbox schema BEFORE touching any lesson data. Otherwise a missing
                // EF migration would surface as HTTP 500 when queuing audio cleanup at the end.
                var mediaOutboxReady = await OutboxReadyAsync(db, cancellation);
                if (mediaOutboxReady != 1)
                {
                    return PurgeReject(log, started, lessonId, actor.Id, 503, "media_cleanup_migration_required");
                }

                log.LogInformation("Admin.LessonLibrary.Purge.EligibilityPassed LessonId={LessonId} Versions={VersionCount} DurationMs={DurationMs}",
                    lessonId, versions.Length, Duration(started));
                var slots = await db.PublishedLessonSlots.AsNoTracking()
                    .Where(x => versions.Contains(x.LessonVersionId))
                    .Select(x => new { x.Id, x.PublishedCurriculumVersionId })
                    .ToArrayAsync(cancellation);
                var slotIds = slots.Select(x => x.Id).ToArray();
                var publicationIds = slots.Select(x => x.PublishedCurriculumVersionId).Distinct().ToArray();
                var clipKeys = await db.LessonSegments.AsNoTracking()
                    .Where(x => versions.Contains(x.LessonVersionId))
                    .Select(x => x.AudioStorageKey).Distinct().ToArrayAsync(cancellation);
                var attempts = await db.StudentPracticeAttempts.AsNoTracking()
                    .Where(x => slotIds.Contains(x.SlotId))
                    .Select(x => new { x.FeedbackJson }).ToArrayAsync(cancellation);
                var recordingKeys = new List<string>();
                foreach (var attempt in attempts)
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(attempt.FeedbackJson);
                        if (doc.RootElement.ValueKind != JsonValueKind.Object)
                            return PurgeReject(log, started, lessonId, actor.Id, 409, "invalid_recording_metadata");
                        if (doc.RootElement.TryGetProperty("recordingKey", out var element) &&
                            element.ValueKind != JsonValueKind.Null)
                        {
                            if (element.ValueKind != JsonValueKind.String || element.GetString() is not { } key ||
                                !ShadowingMediaKeys.IsValid(key))
                                return PurgeReject(log, started, lessonId, actor.Id, 409, "invalid_recording_metadata");
                            recordingKeys.Add(key);
                        }
                    }
                    catch (JsonException)
                    {
                        // No student result can be silently discarded when its media metadata is unreadable.
                        return PurgeReject(log, started, lessonId, actor.Id, 409, "invalid_recording_metadata");
                    }
                }
                var assetKeys = clipKeys.Concat(recordingKeys).Distinct(StringComparer.Ordinal).ToArray();
                if (assetKeys.Any(key => !ShadowingMediaKeys.IsValid(key)))
                    return PurgeReject(log, started, lessonId, actor.Id, 409, "invalid_media_key");

                // Delete dependents BEFORE immutable lesson versions. ExecuteDelete intentionally bypasses
                // the application's ordinary SaveChanges snapshot guard for this explicit admin purge.
                var removedAttempts = await db.StudentPracticeAttempts
                    .Where(x => slotIds.Contains(x.SlotId)).ExecuteDeleteAsync(cancellation);
                var removedProgress = await db.StudentStageProgress
                    .Where(x => slotIds.Contains(x.SlotId)).ExecuteDeleteAsync(cancellation);
                await db.PublishedLessonSlots.Where(x => slotIds.Contains(x.Id)).ExecuteDeleteAsync(cancellation);
                // Drafts were checked before any modification; the user must remove the lesson
                // there first. Historical publications can be cleaned up independently.

                // If the deleted lesson was the only lesson in a published version, remove that
                // now-empty publication and its group pointer. Keep unrelated published lessons intact.
                var emptyPublications = new List<Guid>();
                foreach (var publishedId in publicationIds)
                {
                    if (!await db.PublishedLessonSlots.AnyAsync(x => x.PublishedCurriculumVersionId == publishedId, cancellation))
                        emptyPublications.Add(publishedId);
                }
                if (emptyPublications.Count > 0)
                {
                    await db.GroupCurriculumAssignments
                        .Where(x => emptyPublications.Contains(x.PublishedCurriculumVersionId))
                        .ExecuteDeleteAsync(cancellation);
                    await db.PublishedCurriculumVersions
                        .Where(x => emptyPublications.Contains(x.Id)).ExecuteDeleteAsync(cancellation);
                }

                // Never mutate independent curriculum drafts as a side effect of lesson deletion.
                await db.LessonAiContents.Where(x => versions.Contains(x.LessonVersionId)).ExecuteDeleteAsync(cancellation);
                await db.LessonSegments.Where(x => versions.Contains(x.LessonVersionId)).ExecuteDeleteAsync(cancellation);
                await db.LessonVersions.Where(x => versions.Contains(x.Id)).ExecuteDeleteAsync(cancellation);
                await db.LessonDefinitions.Where(x => x.Id == lessonId).ExecuteDeleteAsync(cancellation);

                // Durable outbox: never delete audio before DB commit (which could otherwise
                // leave a published lesson pointing at missing media after a rollback).
                // A background worker retries cleanup if media storage is temporarily unavailable.
                var queuedMediaCount = 0;
                foreach (var key in assetKeys)
                {
                    // A clip can be shared by other versions/lessons. Never delete a live reference.
                    var referenced = await db.LessonSegments.AsNoTracking()
                        .AnyAsync(x => x.AudioStorageKey == key, cancellation);
                    if (!referenced)
                        referenced = await db.StudentPracticeAttempts.AsNoTracking()
                            .AnyAsync(x => x.FeedbackJson.Contains(key), cancellation);
                    if (referenced) continue;
                    queuedMediaCount += await QueueMediaDeletionAsync(db, key, cancellation);
                }
                await db.SaveChangesAsync(cancellation);
                await transaction.CommitAsync(cancellation);
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.LessonLibrary.Purge.Success ActorId={ActorId} LessonId={LessonId} Versions={VersionCount} Slots={SlotCount} Progress={ProgressCount} Attempts={AttemptCount} MediaQueued={MediaCount} DurationMs={DurationMs}",
                    actor.Id, lessonId, versions.Length, slots.Length, removedProgress, removedAttempts, queuedMediaCount, Duration(started));
                return Results.Accepted(value: new { deleted = true, mediaCleanupQueued = true });
            }
            catch (DbUpdateConcurrencyException) { return PurgeReject(log, started, lessonId, actor.Id, 409, "lesson_version_changed"); }
            catch (SqlException ex) when (ex.Number == 208 &&
                ex.Message.Contains("PendingLessonMediaDeletions", StringComparison.OrdinalIgnoreCase))
            {
                log.LogError("Admin.LessonLibrary.Purge.MigrationMissing LessonId={LessonId} Table=PendingLessonMediaDeletions DurationMs={DurationMs}",
                    lessonId, Duration(started));
                return PurgeReject(log, started, lessonId, actor.Id, 503, "media_cleanup_migration_required");
            }
            catch (SqlException ex) when (ex.Number == 547)
            { return PurgeReject(log, started, lessonId, actor.Id, 409, "lesson_has_other_dependencies"); }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 547 })
            { return PurgeReject(log, started, lessonId, actor.Id, 409, "lesson_has_other_dependencies"); }
            catch (Exception ex) { return Failure(log, started, "Purge", lessonId, ex); }
        }).RequireRateLimiting("admin-lesson-write");

        return app;
    }

    public sealed record DeleteLessonRequest(Guid ExpectedVersionId, bool PermanentlyDelete);

    private static bool Valid(string? text, int min, int max) => text is not null &&
        text.Length >= min && text.Length <= max && !text.Any(char.IsControl);
    private static async Task<bool> CsrfValid(HttpContext http, IAntiforgery antiforgery)
    {
        try { await antiforgery.ValidateRequestAsync(http); return true; }
        catch (AntiforgeryValidationException) { return false; }
    }
    private static double Duration(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;
    private static IResult PurgeReject(ILogger log, long started, Guid lessonId, Guid? actorId, int status, string reason)
    {
        log.LogWarning("Admin.LessonLibrary.Purge.End ActorId={ActorId} LessonId={LessonId} Result=Rejected Reason={Reason} StatusCode={StatusCode} DurationMs={DurationMs}",
            actorId, lessonId, reason, status, Duration(started));
        return Results.Json(new { error = reason }, statusCode: status);
    }
    private static async Task<int> OutboxReadyAsync(ApplicationDbContext db, CancellationToken cancellation)
    {
        var query = IsSqlite(db)
            ? "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='PendingLessonMediaDeletions') THEN 1 ELSE 0 END AS [Value]"
            : "SELECT CASE WHEN OBJECT_ID(N'dbo.PendingLessonMediaDeletions', N'U') IS NULL THEN 0 ELSE 1 END AS [Value]";
        return await db.Database.SqlQueryRaw<int>(query).SingleAsync(cancellation);
    }
    private static Task<int> QueueMediaDeletionAsync(ApplicationDbContext db, string key, CancellationToken cancellation) =>
        IsSqlite(db)
            ? db.Database.ExecuteSqlInterpolatedAsync($@"
                INSERT OR IGNORE INTO PendingLessonMediaDeletions (StorageKey, QueuedAtUtc, NextAttemptAtUtc, Attempts)
                VALUES ({key}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)", cancellation)
            : db.Database.ExecuteSqlInterpolatedAsync($@"
                IF NOT EXISTS (SELECT 1 FROM dbo.PendingLessonMediaDeletions WITH (UPDLOCK, HOLDLOCK)
                               WHERE StorageKey = {key})
                INSERT dbo.PendingLessonMediaDeletions (StorageKey, QueuedAtUtc, NextAttemptAtUtc, Attempts)
                VALUES ({key}, SYSUTCDATETIME(), SYSUTCDATETIME(), 0)", cancellation);
    private static bool IsSqlite(ApplicationDbContext db) =>
        db.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true;
    private static IResult Reject(ILogger log, long started, int status, string reason)
    { log.LogWarning("Admin.LessonLibrary.Rejected Reason={Reason} DurationMs={DurationMs}", reason, Duration(started));
        return Results.Json(new { error = reason }, statusCode: status); }
    private static IResult Failure(ILogger log, long started, string action, Guid lessonId, Exception ex)
    { log.LogError("Admin.LessonLibrary.Failed Action={Action} LessonId={LessonId} ErrorType={ErrorType} DurationMs={DurationMs}",
        action, lessonId, ex.GetType().Name, Duration(started));
        return Results.Problem(statusCode: 500, title: "lesson_library_operation_failed"); }
}

// Durable outbox consumer: worker never runs database lesson deletion; only removes safely
// unreferenced blobs that were queued by the successful transaction above.
public sealed class LessonMediaDeletionWorker(
    IServiceScopeFactory scopeFactory, IShadowingMediaStore media,
    ILogger<LessonMediaDeletionWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var started = Stopwatch.GetTimestamp();
            try
            {
                await ProcessPendingAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning("Admin.LessonLibrary.MediaCleanup.BatchFailed ErrorType={ErrorType} DurationMs={DurationMs}",
                    ex.GetType().Name, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            }
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    public async Task ProcessPendingAsync(CancellationToken cancellationToken)
    {
        if (!media.IsConfigured) return;
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var query = db.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true
            ? "SELECT [StorageKey] AS [Value] FROM PendingLessonMediaDeletions WHERE julianday([NextAttemptAtUtc]) <= julianday('now') ORDER BY [QueuedAtUtc] LIMIT 20"
            : "SELECT TOP (20) [StorageKey] AS [Value] FROM dbo.PendingLessonMediaDeletions WHERE [NextAttemptAtUtc] <= SYSUTCDATETIME() ORDER BY [QueuedAtUtc]";
        var keys = await db.Database.SqlQueryRaw<string>(query).ToArrayAsync(cancellationToken);
        foreach (var key in keys)
        {
            if (cancellationToken.IsCancellationRequested) break;
            var began = Stopwatch.GetTimestamp();
            log.LogInformation("Admin.LessonLibrary.MediaCleanup.Start AssetKey={AssetKey}", key);
            try
            {
                if (!ShadowingMediaKeys.IsValid(key))
                    throw new InvalidOperationException("invalid_media_key");
                var stillUsed = await db.LessonSegments.AsNoTracking()
                    .AnyAsync(x => x.AudioStorageKey == key, cancellationToken) ||
                    await db.StudentPracticeAttempts.AsNoTracking()
                        .AnyAsync(x => x.FeedbackJson.Contains(key), cancellationToken);
                if (stillUsed)
                    throw new InvalidOperationException("media_still_referenced");
                await media.DeleteAsync(key, cancellationToken);
                if (db.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true)
                    await db.Database.ExecuteSqlInterpolatedAsync(
                        $"DELETE FROM PendingLessonMediaDeletions WHERE StorageKey = {key}", cancellationToken);
                else
                    await db.Database.ExecuteSqlInterpolatedAsync(
                        $"DELETE dbo.PendingLessonMediaDeletions WHERE StorageKey = {key}", cancellationToken);
                log.LogInformation("Admin.LessonLibrary.MediaCleanup.Success AssetKey={AssetKey} DurationMs={DurationMs}",
                    key, Stopwatch.GetElapsedTime(began).TotalMilliseconds);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                try
                {
                    if (db.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true)
                        await db.Database.ExecuteSqlInterpolatedAsync($@"
                            UPDATE PendingLessonMediaDeletions
                            SET Attempts = Attempts + 1, NextAttemptAtUtc = datetime('now', '+30 minutes')
                            WHERE StorageKey = {key}", cancellationToken);
                    else
                    {
                        var next = DateTimeOffset.UtcNow.AddMinutes(30);
                        await db.Database.ExecuteSqlInterpolatedAsync($@"
                            UPDATE dbo.PendingLessonMediaDeletions
                            SET Attempts = Attempts + 1, NextAttemptAtUtc = {next}
                            WHERE StorageKey = {key}", cancellationToken);
                    }
                }
                catch (Exception databaseError) when (databaseError is not OperationCanceledException)
                {
                    log.LogWarning("Admin.LessonLibrary.MediaCleanup.UpdateFailed AssetKey={AssetKey} ErrorType={ErrorType}",
                        key, databaseError.GetType().Name);
                }
                log.LogWarning("Admin.LessonLibrary.MediaCleanup.Failed AssetKey={AssetKey} ErrorType={ErrorType} DurationMs={DurationMs}",
                    key, ex.GetType().Name, Stopwatch.GetElapsedTime(began).TotalMilliseconds);
            }
        }
    }
}
