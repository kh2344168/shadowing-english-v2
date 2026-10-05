using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.AI;

public static class AdminLessonAiEndpoints
{
    public static IEndpointRouteBuilder MapAdminLessonAiEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/lessons")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        group.MapGet("/ai-providers", (TextAiRouter ai, HttpContext http) =>
        {
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { configured = ai.ConfiguredProviders() });
        });

        group.MapGet("/{versionId:guid}/ai/segments", async (Guid versionId, ApplicationDbContext db,
            HttpContext http) =>
        {
            if (!await db.LessonVersions.AnyAsync(x => x.Id == versionId, http.RequestAborted))
                return Results.NotFound(new { error = "lesson_not_found" });
            var segments = await db.LessonSegments.AsNoTracking()
                .Where(x => x.LessonVersionId == versionId).OrderBy(x => x.Position)
                .Select(x => new { x.Position, x.Text }).ToArrayAsync(http.RequestAborted);
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(segments);
        });

        group.MapGet("/{versionId:guid}/ai", async (Guid versionId, ApplicationDbContext db, HttpContext http,
            ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp(); var log = logs.CreateLogger("Admin.LessonAI");
            log.LogInformation("Admin.AiContent.Read.Start VersionId={VersionId} TraceId={TraceId}", versionId, http.TraceIdentifier);
            try
            {
                if (!await db.LessonVersions.AnyAsync(x => x.Id == versionId, http.RequestAborted))
                    return Results.NotFound(new { error = "lesson_not_found" });
                var row = await db.LessonAiContents.AsNoTracking().Where(x => x.LessonVersionId == versionId)
                    .OrderByDescending(x => x.CreatedAtUtc).ThenByDescending(x => x.Id)
                    .FirstOrDefaultAsync(http.RequestAborted);
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation("Admin.AiContent.Read.Success VersionId={VersionId} Status={Status} DurationMs={DurationMs}",
                    versionId, row?.Status ?? "None", Ms(started));
                return Results.Ok(row is null ? null : View(row));
            }
            catch (Exception ex) { return Failure(log, ex, started, "Read"); }
        });

        group.MapPost("/{versionId:guid}/ai", async (Guid versionId, StartAiRequest request, HttpContext http,
            IAntiforgery csrf, ApplicationDbContext db, TextAiRouter ai, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp(); var log = logs.CreateLogger("Admin.LessonAI");
            log.LogInformation("Admin.AiContent.Queue.Start VersionId={VersionId} TraceId={TraceId}", versionId, http.TraceIdentifier);
            if (!await ValidCsrf(csrf, http)) return Results.BadRequest(new { error = "invalid_csrf" });
            if (!Guid.TryParse(http.User.FindFirstValue(ClaimTypes.NameIdentifier), out var adminId) ||
                request.RequestId == Guid.Empty) return Results.BadRequest(new { error = "invalid_request" });
            if (ai.ConfiguredProviders().Length == 0)
                return Results.Json(new { error = "ai_providers_not_configured" }, statusCode: 503);
            try
            {
                var existing = await db.LessonAiContents.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.RequestId, http.RequestAborted);
                if (existing is not null) return existing.LessonVersionId == versionId ? Results.Ok(View(existing)) :
                    Results.Conflict(new { error = "request_id_conflict" });
                if (!await db.LessonVersions.AnyAsync(x => x.Id == versionId, http.RequestAborted))
                    return Results.NotFound(new { error = "lesson_not_found" });
                if (await db.LessonAiContents.AnyAsync(x => x.LessonVersionId == versionId &&
                    (x.Status == "Pending" || x.Status == "Generating"), http.RequestAborted))
                    return Results.Conflict(new { error = "ai_job_in_progress" });
                var now = DateTimeOffset.UtcNow;
                var job = new LessonAiContent
                {
                    Id = request.RequestId, LessonVersionId = versionId, CreatedByAdminId = adminId,
                    Revision = Guid.NewGuid(), Status = "Pending", CreatedAtUtc = now, UpdatedAtUtc = now
                };
                db.LessonAiContents.Add(job);
                await db.SaveChangesAsync(http.RequestAborted);
                log.LogInformation("Admin.AiContent.Queue.Success JobId={JobId} VersionId={VersionId} DurationMs={DurationMs}",
                    job.Id, versionId, Ms(started));
                return Results.Json(View(job), statusCode: 202);
            }
            catch (DbUpdateException) { return Results.Conflict(new { error = "ai_job_changed" }); }
            catch (Exception ex) { return Failure(log, ex, started, "Queue"); }
        }).RequireRateLimiting("admin-lesson-write");

        group.MapPut("/{versionId:guid}/ai/{jobId:guid}", async (Guid versionId, Guid jobId,
            UpdateAiRequest request, HttpContext http, IAntiforgery csrf, ApplicationDbContext db, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp(); var log = logs.CreateLogger("Admin.LessonAI");
            log.LogInformation("Admin.AiContent.Edit.Start JobId={JobId} TraceId={TraceId}", jobId, http.TraceIdentifier);
            if (!await ValidCsrf(csrf, http)) return Results.BadRequest(new { error = "invalid_csrf" });
            if (request.ExpectedRevision == Guid.Empty || request.Material is null)
                return Results.BadRequest(new { error = "invalid_material" });
            try
            {
                var job = await db.LessonAiContents.SingleOrDefaultAsync(x => x.Id == jobId &&
                    x.LessonVersionId == versionId, http.RequestAborted);
                if (job is null) return Results.NotFound(new { error = "ai_job_not_found" });
                if (job.Status != "Draft" || job.Revision != request.ExpectedRevision)
                    return Results.Conflict(new { error = "ai_draft_changed" });
                var segments = await db.LessonSegments.AsNoTracking()
                    .Where(x => x.LessonVersionId == versionId).OrderBy(x => x.Position)
                    .Select(x => new { x.Position, x.Text }).ToArrayAsync(http.RequestAborted);
                var source = string.Join("\n", segments.Select(x => x.Text));
                if (!LessonMaterialRules.Valid(request.Material, source, segments.Select(x => x.Position).ToArray()))
                    return Results.BadRequest(new { error = "invalid_material" });
                job.PayloadJson = JsonSerializer.Serialize(request.Material, LessonMaterialRules.Json);
                job.Revision = Guid.NewGuid(); job.UpdatedAtUtc = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(http.RequestAborted);
                log.LogInformation("Admin.AiContent.Edit.Success JobId={JobId} DurationMs={DurationMs}", jobId, Ms(started));
                return Results.Ok(View(job));
            }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "ai_draft_changed" }); }
            catch (Exception ex) { return Failure(log, ex, started, "Edit"); }
        }).RequireRateLimiting("admin-lesson-write");

        group.MapPost("/{versionId:guid}/ai/{jobId:guid}/approve", async (Guid versionId, Guid jobId,
            ApproveAiRequest request, HttpContext http, IAntiforgery csrf, ApplicationDbContext db,
            ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp(); var log = logs.CreateLogger("Admin.LessonAI");
            log.LogInformation("Admin.AiContent.Approve.Start JobId={JobId} TraceId={TraceId}", jobId, http.TraceIdentifier);
            if (!await ValidCsrf(csrf, http)) return Results.BadRequest(new { error = "invalid_csrf" });
            try
            {
                var job = await db.LessonAiContents.SingleOrDefaultAsync(x => x.Id == jobId &&
                    x.LessonVersionId == versionId, http.RequestAborted);
                if (job is null) return Results.NotFound(new { error = "ai_job_not_found" });
                if (job.Status == "Approved" && job.Revision == request.ExpectedRevision) return Results.Ok(View(job));
                if (job.Status != "Draft" || job.Revision != request.ExpectedRevision ||
                    string.IsNullOrEmpty(job.PayloadJson)) return Results.Conflict(new { error = "ai_draft_changed" });
                var segments = await db.LessonSegments.AsNoTracking()
                    .Where(x => x.LessonVersionId == versionId).OrderBy(x => x.Position)
                    .Select(x => new { x.Position, x.Text }).ToArrayAsync(http.RequestAborted);
                var source = string.Join("\n", segments.Select(x => x.Text));
                var material = LessonMaterialRules.Parse(job.PayloadJson, source,
                    segments.Select(x => x.Position).ToArray());
                if (material is null)
                    return Results.BadRequest(new { error = "invalid_material" });
                if (!LessonMaterialRules.ReadyToApprove(material))
                    return Results.Conflict(new { error = "review_incomplete" });
                job.Status = "Approved"; job.ApprovedAtUtc = DateTimeOffset.UtcNow;
                job.UpdatedAtUtc = job.ApprovedAtUtc.Value;
                await db.SaveChangesAsync(http.RequestAborted);
                log.LogInformation("Admin.AiContent.Approve.Success JobId={JobId} DurationMs={DurationMs}", jobId, Ms(started));
                return Results.Ok(View(job));
            }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { error = "ai_draft_changed" }); }
            catch (Exception ex) { return Failure(log, ex, started, "Approve"); }
        }).RequireRateLimiting("admin-lesson-write");

        return app;
    }

    private static object View(LessonAiContent row) => new
    {
        row.Id, row.LessonVersionId, row.Revision, row.Status, row.ProviderName,
        row.ErrorCode, row.CreatedAtUtc, row.ApprovedAtUtc,
        material = row.PayloadJson is null ? null : JsonSerializer.Deserialize<LessonMaterial>(row.PayloadJson, LessonMaterialRules.Json)
    };
    private static async Task<bool> ValidCsrf(IAntiforgery csrf, HttpContext http)
    { try { await csrf.ValidateRequestAsync(http); return true; } catch (AntiforgeryValidationException) { return false; } }
    private static double Ms(long start) => Stopwatch.GetElapsedTime(start).TotalMilliseconds;
    private static IResult Failure(ILogger log, Exception ex, long start, string action)
    {
        log.LogError("Admin.AiContent.{Action}.Failed ErrorType={ErrorType} DurationMs={DurationMs}",
            action, ex.GetType().Name, Ms(start));
        return Results.Problem(statusCode: 500, title: "ai_content_operation_failed");
    }
    public sealed record StartAiRequest(Guid RequestId);
    public sealed record UpdateAiRequest(Guid ExpectedRevision, LessonMaterial Material);
    public sealed record ApproveAiRequest(Guid ExpectedRevision);
}
