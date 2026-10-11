using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.Lessons;

public static class AdminLessonWorkflowEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> Types =
    [
        "shadowing", "vocabulary", "listen-type", "grammar",
        "vocabulary-quiz", "grammar-quiz", "word-order", "conversation"
    ];

    public static IEndpointRouteBuilder MapAdminLessonWorkflowEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/lessons")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        group.MapGet("/{versionId:guid}/workflow", async (Guid versionId, ApplicationDbContext db,
            HttpContext http, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.LessonWorkflow");
            log.LogInformation("Admin.LessonWorkflow.Get.Start VersionId={VersionId} TraceId={TraceId}",
                versionId, http.TraceIdentifier);
            try
            {
                var lesson = await (from version in db.LessonVersions.AsNoTracking()
                    join definition in db.LessonDefinitions.AsNoTracking()
                        on version.LessonDefinitionId equals definition.Id
                    where version.Id == versionId && !definition.IsArchived
                    select new { LessonId = definition.Id, Version = version })
                    .SingleOrDefaultAsync(http.RequestAborted);
                if (lesson is null)
                    return Reject(log, started, versionId, 404, "lesson_not_found", "Get");

                var workflow = await db.LessonWorkflows.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.LessonVersionId == versionId, http.RequestAborted);
                var stages = workflow is null ? Defaults(versionId) : ReadStages(workflow.StagesJson);
                if (stages is null)
                    return Reject(log, started, versionId, 500, "invalid_workflow_data", "Get");

                var ai = await db.LessonAiContents.AsNoTracking().Where(x => x.LessonVersionId == versionId)
                    .OrderByDescending(x => x.CreatedAtUtc).ThenByDescending(x => x.Id)
                    .Select(x => new { x.Status, x.PayloadJson }).FirstOrDefaultAsync(http.RequestAborted);
                http.Response.Headers.CacheControl = "no-store";
                log.LogInformation(
                    "Admin.LessonWorkflow.Get.Success VersionId={VersionId} StageCount={StageCount} Persisted={Persisted} DurationMs={DurationMs}",
                    versionId, stages.Length, workflow is not null, Duration(started));
                return Results.Ok(new
                {
                    lessonId = lesson.LessonId,
                    versionId,
                    versionNumber = lesson.Version.VersionNumber,
                    lesson.Version.Title,
                    lesson.Version.Description,
                    revision = workflow?.Revision ?? Guid.Empty,
                    stages,
                    aiStatus = ai?.Status,
                    reviewedStages = ReadReviewedStages(ai?.PayloadJson)
                });
            }
            catch (Exception ex)
            {
                return Failure(log, started, versionId, "Get", ex);
            }
        });

        group.MapPut("/{versionId:guid}/workflow", async (Guid versionId, SaveWorkflowRequest request,
            ApplicationDbContext db, IAntiforgery antiforgery, HttpContext http,
            ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var log = loggers.CreateLogger("Admin.LessonWorkflow");
            log.LogInformation(
                "Admin.LessonWorkflow.Save.Start VersionId={VersionId} StageCount={StageCount} ExpectedRevision={ExpectedRevision} TraceId={TraceId}",
                versionId, request.Stages?.Length ?? 0, request.ExpectedRevision, http.TraceIdentifier);
            try
            {
                try { await antiforgery.ValidateRequestAsync(http); }
                catch (AntiforgeryValidationException)
                {
                    return Reject(log, started, versionId, 400, "invalid_csrf", "Save");
                }

                var normalized = Normalize(request.Stages);
                if (normalized is null)
                    return Reject(log, started, versionId, 400, "invalid_workflow", "Save");
                var lessonExists = await (from version in db.LessonVersions.AsNoTracking()
                    join definition in db.LessonDefinitions.AsNoTracking()
                        on version.LessonDefinitionId equals definition.Id
                    where version.Id == versionId && !definition.IsArchived
                    select version.Id).AnyAsync(http.RequestAborted);
                if (!lessonExists)
                    return Reject(log, started, versionId, 404, "lesson_not_found", "Save");

                var row = await db.LessonWorkflows.SingleOrDefaultAsync(
                    x => x.LessonVersionId == versionId, http.RequestAborted);
                if (row is null)
                {
                    if (request.ExpectedRevision != Guid.Empty)
                        return Reject(log, started, versionId, 409, "workflow_changed", "Save");
                    row = new LessonWorkflow { LessonVersionId = versionId };
                    db.LessonWorkflows.Add(row);
                }
                else if (row.Revision != request.ExpectedRevision)
                {
                    return Reject(log, started, versionId, 409, "workflow_changed", "Save");
                }

                row.StagesJson = JsonSerializer.Serialize(normalized, Json);
                row.Revision = Guid.NewGuid();
                row.UpdatedAtUtc = DateTimeOffset.UtcNow;
                try
                {
                    await db.SaveChangesAsync(http.RequestAborted);
                    log.LogInformation(
                        "Admin.LessonWorkflow.Save.Success VersionId={VersionId} StageCount={StageCount} Revision={Revision} DurationMs={DurationMs}",
                        versionId, normalized.Length, row.Revision, Duration(started));
                    return Results.Ok(new { revision = row.Revision, stages = normalized });
                }
                catch (DbUpdateConcurrencyException)
                {
                    return Reject(log, started, versionId, 409, "workflow_changed", "Save");
                }
                catch (DbUpdateException)
                {
                    return Reject(log, started, versionId, 409, "workflow_changed", "Save");
                }
            }
            catch (Exception ex)
            {
                return Failure(log, started, versionId, "Save", ex);
            }
        }).RequireRateLimiting("admin-lesson-write");

        return app;
    }

    private static WorkflowStage[] Defaults(Guid versionId) =>
    [
        Stage(versionId, "shadowing", "Shadowing الأساسي", 1, true, true),
        Stage(versionId, "vocabulary", "الكلمات والـ Chunks", 2, true, true),
        Stage(versionId, "listen-type", "اسمع واكتب", 3, true, false),
        Stage(versionId, "grammar", "قواعد الدرس", 4, true, false),
        Stage(versionId, "vocabulary-quiz", "اختبار الكلمات", 5, true, false),
        Stage(versionId, "grammar-quiz", "اختبار القواعد", 6, true, false),
        Stage(versionId, "word-order", "ترتيب الجمل", 7, true, false),
        Stage(versionId, "conversation", "محادثة الدرس", 8, true, false)
    ];

    private static WorkflowStage Stage(Guid versionId, string type, string title, int position,
        bool enabled, bool required) => new(StableId(versionId, type), type, title, position, enabled, required);

    private static Guid StableId(Guid versionId, string type)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{versionId:N}:{type}"));
        return new Guid(bytes[..16]);
    }

    private static WorkflowStage[]? Normalize(WorkflowStage[]? stages)
    {
        if (stages is null || stages.Length is < 1 or > 24 ||
            stages.Select(x => x.Id).Distinct().Count() != stages.Length) return null;
        // Older saved plans had a technical "content" step. It is now folded into the
        // first Shadowing step so teachers see the real learning journey only.
        var visible = stages.Where(x => x.Type != "content").OrderBy(x => x.Position).ToArray();
        var coreShadowing = visible.FirstOrDefault(x => x.Type == "shadowing");
        if (coreShadowing is null) return null;
        var ordered = new[] { coreShadowing }.Concat(visible.Where(x => x.Id != coreShadowing.Id)).ToArray();
        if (ordered.Select(x => x.Position).Distinct().Count() != ordered.Length ||
            ordered[0].Type != "shadowing" ||
            ordered.Any(x => x.Id == Guid.Empty || !Types.Contains(x.Type) ||
                string.IsNullOrWhiteSpace(x.Title) || x.Title.Trim().Length > 80)) return null;
        return ordered.Select((x, index) => x with
        {
            Title = x.Title.Trim(), Position = index + 1,
            Enabled = index == 0 || x.Enabled, Required = index == 0 || x.Required
        }).ToArray();
    }

    private static WorkflowStage[]? ReadStages(string json)
    {
        try { return Normalize(JsonSerializer.Deserialize<WorkflowStage[]>(json, Json)); }
        catch (JsonException) { return null; }
    }

    private static string[] ReadReviewedStages(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return [];
        try
        {
            using var document = JsonDocument.Parse(payload);
            return document.RootElement.TryGetProperty("reviewedStages", out var value) &&
                value.ValueKind == JsonValueKind.Array
                ? value.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
                    .Select(x => x.GetString()).Where(x => x is not null).Cast<string>().ToArray()
                : [];
        }
        catch (JsonException) { return []; }
    }

    private static IResult Reject(ILogger log, long started, Guid versionId, int status,
        string code, string operation)
    {
        log.LogWarning(
            "Admin.LessonWorkflow.{Operation}.Rejected VersionId={VersionId} Status={Status} Code={Code} DurationMs={DurationMs}",
            operation, versionId, status, code, Duration(started));
        return Results.Json(new { error = code }, statusCode: status);
    }

    private static IResult Failure(ILogger log, long started, Guid versionId, string operation,
        Exception error)
    {
        log.LogError(error,
            "Admin.LessonWorkflow.{Operation}.Failed VersionId={VersionId} DurationMs={DurationMs}",
            operation, versionId, Duration(started));
        return Results.Problem(statusCode: 500, title: "request_failed");
    }

    private static long Duration(long started) =>
        (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    public sealed record SaveWorkflowRequest(Guid ExpectedRevision, WorkflowStage[] Stages);
    public sealed record WorkflowStage(Guid Id, string Type, string Title, int Position,
        bool Enabled, bool Required);
}
