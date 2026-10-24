using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Api.Common;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.Student;

public static class StudentShadowingReportingEndpoints
{
    private const long MaxRecordingBytes = 8 * 1024 * 1024;
    private const long MaxRequestBytes = MaxRecordingBytes + 128 * 1024;
    private const int MaxCompletionReportsPerStage = 3;

    public static IEndpointRouteBuilder MapStudentShadowingReportingEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/student/learning")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Student" });

        group.MapPost("/slots/{slotId:guid}/shadowing/completion", async (
            Guid slotId,
            HttpContext http,
            IAntiforgery antiforgery,
            ApplicationDbContext db,
            IShadowingMediaStore media,
            ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Student.Shadowing.Reporting");
            log.LogInformation("Student.Shadowing.Completion.Start SlotId={SlotId} TraceId={TraceId}",
                slotId, http.TraceIdentifier);

            if (http.Request.ContentLength > MaxRequestBytes)
                return Results.Json(new { error = "recording_too_large" }, statusCode: StatusCodes.Status413PayloadTooLarge);
            var bodyLimit = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
            // Leave parser headroom so a chunked oversized file receives our JSON 413
            // instead of the host closing the upload stream mid-response.
            if (bodyLimit is { IsReadOnly: false })
                bodyLimit.MaxRequestBodySize = MaxRequestBytes + 128 * 1024;
            if (!http.Request.HasFormContentType) return Reject(log, started, slotId, "multipart_required");
            // TestServer and some reverse proxies do not expose a Kestrel body-size feature.
            // Count the aggregate stream before antiforgery or multipart parsing can read it.
            http.Request.Body = new CappedRequestStream(http.Request.Body, MaxRequestBytes,
                "recording_too_large");
            http.Features.Set<IFormFeature>(new FormFeature(http.Request,
                new FormOptions { MultipartBodyLengthLimit = MaxRecordingBytes }));

            try { await antiforgery.ValidateRequestAsync(http); }
            catch (AntiforgeryValidationException)
            {
                return Reject(log, started, slotId, "invalid_csrf");
            }
            catch (BadHttpRequestException)
            {
                return Results.Json(new { error = "recording_too_large" }, statusCode: StatusCodes.Status413PayloadTooLarge);
            }

            var student = await StudentAccess.LiveStudentIdAsync(http, db);
            if (student is null) return Results.Forbid();
            var studentId = student.Value;

            IFormCollection form;
            try { form = await http.Request.ReadFormAsync(http.RequestAborted); }
            catch (BadHttpRequestException)
            {
                return Results.Json(new { error = "recording_too_large" }, statusCode: StatusCodes.Status413PayloadTooLarge);
            }
            catch (InvalidDataException ex)
            {
                if (ex.Message.Contains("Multipart body length limit", StringComparison.OrdinalIgnoreCase))
                    return Results.Json(new { error = "recording_too_large" },
                        statusCode: StatusCodes.Status413PayloadTooLarge);
                return Results.Json(new { error = "invalid_form" }, statusCode: StatusCodes.Status400BadRequest);
            }
            if (!Guid.TryParse(form["requestId"].ToString(), out var requestId) ||
                !bool.TryParse(form["reviewMode"].ToString(), out var reviewMode) ||
                !int.TryParse(form["repetitions"].ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var repetitions) ||
                !int.TryParse(form["trainingSeconds"].ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var trainingSeconds) ||
                !bool.TryParse(form["speechRecognitionSupported"].ToString(), out var speechRecognitionSupported) ||
                repetitions is < 1 or > 20 || trainingSeconds is < 0 or > 86400)
            {
                return Reject(log, started, slotId, "invalid_completion_metadata");
            }

            int? average = ParseOptionalScore(form["averageSpeechMatchScore"].ToString());
            int? best = ParseOptionalScore(form["bestSpeechMatchScore"].ToString());
            if ((average.HasValue && (average.Value < 0 || average.Value > 100)) ||
                (best.HasValue && (best.Value < 0 || best.Value > 100)))
                return Reject(log, started, slotId, "invalid_speech_score");

            var now = DateTimeOffset.UtcNow;
            var scoped = await (from membership in db.StudentGroupMemberships.AsNoTracking()
                                join assignment in db.GroupCurriculumAssignments.AsNoTracking()
                                    on membership.GroupId equals assignment.GroupId
                                join version in db.PublishedCurriculumVersions.AsNoTracking()
                                    on assignment.PublishedCurriculumVersionId equals version.Id
                                join slot in db.PublishedLessonSlots.AsNoTracking()
                                    on version.Id equals slot.PublishedCurriculumVersionId
                                where membership.StudentId == studentId && membership.EndedAtUtc == null &&
                                      version.GroupId == membership.GroupId && version.PublishedAtUtc <= now &&
                                      version.AvailableAtUtc <= now && slot.Id == slotId && slot.AvailableAtUtc <= now
                                select new { VersionId = version.Id, slot.LessonVersionId }).SingleOrDefaultAsync();
            if (scoped is null) return Results.NotFound();

            var progressStage = reviewMode ? "shadowing-review" : "shadowing";
            var progress = await db.StudentStageProgress.AsNoTracking().SingleOrDefaultAsync(x =>
                x.StudentId == studentId && x.PublishedCurriculumVersionId == scoped.VersionId &&
                x.SlotId == slotId && x.StageKey == progressStage);
            if (progress is null || !progress.IsComplete)
                return Results.Conflict(new { error = "stage_not_complete" });

            var summaryStage = reviewMode ? "shadowing-review-summary" : "shadowing-summary";
            var requestIdText = requestId.ToString("D");
            var existing = await db.StudentPracticeAttempts.AsNoTracking().FirstOrDefaultAsync(x =>
                x.StudentId == studentId && x.PublishedCurriculumVersionId == scoped.VersionId &&
                x.SlotId == slotId && x.StageKey == summaryStage && x.Answer == requestIdText);
            if (existing is not null)
            {
                var existingMeta = ParseRecording(existing.FeedbackJson);
                log.LogInformation("Student.Shadowing.Completion.Idempotent StudentId={StudentId} SlotId={SlotId} AttemptId={AttemptId} DurationMs={DurationMs}",
                    studentId, slotId, existing.Id, Ms(started));
                return Results.Ok(new { saved = true, attemptId = existing.Id, recordedAtUtc = existing.CreatedAtUtc, recordingSaved = existingMeta.Key is not null });
            }

            // Serialize each student's reports for this published stage before writing media.
            // A bounded report count limits storage without deleting an existing recording.
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                http.RequestAborted);
            var racedExisting = await db.StudentPracticeAttempts.AsNoTracking().FirstOrDefaultAsync(x =>
                x.StudentId == studentId && x.PublishedCurriculumVersionId == scoped.VersionId &&
                x.SlotId == slotId && x.StageKey == summaryStage && x.Answer == requestIdText,
                http.RequestAborted);
            if (racedExisting is not null)
            {
                var racedMeta = ParseRecording(racedExisting.FeedbackJson);
                return Results.Ok(new { saved = true, attemptId = racedExisting.Id,
                    recordedAtUtc = racedExisting.CreatedAtUtc, recordingSaved = racedMeta.Key is not null });
            }
            var savedReports = await db.StudentPracticeAttempts.CountAsync(x =>
                x.StudentId == studentId && x.PublishedCurriculumVersionId == scoped.VersionId &&
                x.SlotId == slotId && x.StageKey == summaryStage, http.RequestAborted);
            if (savedReports >= MaxCompletionReportsPerStage)
                return Results.Conflict(new { error = "completion_report_limit",
                    limit = MaxCompletionReportsPerStage });

            var file = form.Files.GetFile("recording");
            string? recordingKey = null;
            string? recordingContentType = null;
            if (file is { Length: > 0 })
            {
                if (file.Length > MaxRecordingBytes)
                    return Results.Json(new { error = "recording_too_large" }, statusCode: StatusCodes.Status413PayloadTooLarge);
                var mediaType = NormalizeRecordingType(file.ContentType);
                if (mediaType is null) return Results.BadRequest(new { error = "unsupported_recording_type" });
                if (!media.IsConfigured)
                    return Results.Json(new { error = "media_storage_not_configured" }, statusCode: StatusCodes.Status503ServiceUnavailable);

                recordingContentType = mediaType.Value.ContentType;
                recordingKey = $"student-shadowing-{Guid.NewGuid():N}.{mediaType.Value.Extension}";
                try
                {
                    await using var stream = file.OpenReadStream();
                    await media.WriteAsync(recordingKey, stream, http.RequestAborted);
                }
                catch (MediaStorageUnavailableException)
                {
                    log.LogWarning("Student.Shadowing.Completion.RecordingUnavailable StudentId={StudentId} SlotId={SlotId} DurationMs={DurationMs}",
                        studentId, slotId, Ms(started));
                    return Results.Json(new { error = "media_storage_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
                }
            }

            try
            {
                var feedbackJson = JsonSerializer.Serialize(new
                {
                    repetitions,
                    trainingSeconds,
                    averageSpeechMatchScore = average,
                    bestSpeechMatchScore = best,
                    speechRecognitionSupported,
                    recordingKey,
                    recordingContentType,
                    metric = average.HasValue ? "browser_text_match" : null,
                    note = average.HasValue
                        ? "Text captured by browser speech recognition; not an accent or pronunciation score."
                        : "Speech text-match was unavailable for this completion."
                });

                var attempt = new StudentPracticeAttempt
                {
                    Id = Guid.NewGuid(),
                    StudentId = studentId,
                    PublishedCurriculumVersionId = scoped.VersionId,
                    SlotId = slotId,
                    StageKey = summaryStage,
                    Position = progress.CompletedSegments,
                    Answer = requestIdText,
                    FeedbackJson = feedbackJson,
                    CreatedAtUtc = DateTimeOffset.UtcNow
                };
                db.StudentPracticeAttempts.Add(attempt);
                await db.SaveChangesAsync(http.RequestAborted);
                await tx.CommitAsync(http.RequestAborted);

                log.LogInformation("Student.Shadowing.Completion.Success StudentId={StudentId} SlotId={SlotId} AttemptId={AttemptId} Repetitions={Repetitions} RecordingSaved={RecordingSaved} DurationMs={DurationMs}",
                    studentId, slotId, attempt.Id, repetitions, recordingKey is not null, Ms(started));
                return Results.Ok(new { saved = true, attemptId = attempt.Id, recordedAtUtc = attempt.CreatedAtUtc, recordingSaved = recordingKey is not null });
            }
            catch (Exception ex)
            {
                if (recordingKey is not null)
                {
                    try { await media.DeleteAsync(recordingKey, http.RequestAborted); }
                    catch (Exception cleanupError)
                    {
                        log.LogWarning("Student.Shadowing.Completion.CleanupFailed AssetKey={AssetKey} ErrorType={ErrorType}", recordingKey, cleanupError.GetType().Name);
                    }
                }
                log.LogError("Student.Shadowing.Completion.Failed StudentId={StudentId} SlotId={SlotId} ErrorType={ErrorType} DurationMs={DurationMs}",
                    studentId, slotId, ex.GetType().Name, Ms(started));
                return Results.Problem(title: "Unable to save shadowing completion report", statusCode: StatusCodes.Status500InternalServerError);
            }
        }).RequireRateLimiting("student-progress-write");

        return app;
    }

    private static int? ParseOptionalScore(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : -1;
    }

    private static (string? Key, string? ContentType) ParseRecording(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var key = root.TryGetProperty("recordingKey", out var keyElement) && keyElement.ValueKind == JsonValueKind.String
                ? keyElement.GetString() : null;
            var type = root.TryGetProperty("recordingContentType", out var typeElement) && typeElement.ValueKind == JsonValueKind.String
                ? typeElement.GetString() : null;
            return (key, type);
        }
        catch (JsonException) { return (null, null); }
    }

    private static (string ContentType, string Extension)? NormalizeRecordingType(string? contentType)
    {
        var normalized = (contentType ?? string.Empty).Split(';', 2)[0].Trim().ToLowerInvariant();
        return normalized switch
        {
            "audio/webm" => ("audio/webm", "webm"),
            "video/webm" => ("audio/webm", "webm"),
            "audio/mp4" => ("audio/mp4", "mp4"),
            "audio/x-m4a" => ("audio/mp4", "mp4"),
            _ => null
        };
    }

    private static IResult Reject(ILogger log, long started, Guid slotId, string reason)
    {
        log.LogWarning("Student.Shadowing.Completion.Rejected SlotId={SlotId} Reason={Reason} DurationMs={DurationMs}",
            slotId, reason, Ms(started));
        return Results.BadRequest(new { error = reason });
    }

    private static double Ms(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;
}
