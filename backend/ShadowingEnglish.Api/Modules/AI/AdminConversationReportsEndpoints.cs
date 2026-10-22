using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.AI;

public static class AdminConversationReportsEndpoints
{
    public static IEndpointRouteBuilder MapAdminConversationReportsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/reports/conversations")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });
        group.MapGet("", async (int? page, Guid? studentId, Guid? lessonVersionId,
            ApplicationDbContext db, HttpContext http) =>
        {
            var currentPage = Math.Clamp(page ?? 1, 1, 10000);
            var query = from attempt in db.StudentPracticeAttempts.AsNoTracking()
                join slot in db.PublishedLessonSlots.AsNoTracking() on attempt.SlotId equals slot.Id
                join assignment in db.GroupCurriculumAssignments.AsNoTracking()
                    on slot.PublishedCurriculumVersionId equals assignment.PublishedCurriculumVersionId
                join lesson in db.LessonVersions.AsNoTracking() on slot.LessonVersionId equals lesson.Id
                join student in db.Users.AsNoTracking() on attempt.StudentId equals student.Id
                where attempt.StageKey == "conversation-result" &&
                    attempt.PublishedCurriculumVersionId == slot.PublishedCurriculumVersionId &&
                    (!studentId.HasValue || attempt.StudentId == studentId.Value) &&
                    (!lessonVersionId.HasValue || slot.LessonVersionId == lessonVersionId.Value)
                select new { attempt.StudentId, StudentEmail = student.Email, attempt.SlotId,
                    slot.LessonVersionId, LessonTitle = lesson.Title, attempt.CreatedAtUtc,
                    attempt.FeedbackJson };
            var rows = await query.OrderByDescending(x => x.CreatedAtUtc)
                .Skip((currentPage - 1) * 30).Take(31).ToArrayAsync(http.RequestAborted);
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { page = currentPage, hasMore = rows.Length > 30,
                items = rows.Take(30).Select(x => new { x.StudentId, x.StudentEmail, x.SlotId,
                    x.LessonVersionId, x.LessonTitle, x.CreatedAtUtc,
                    result = JsonSerializer.Deserialize<ConversationResult>(x.FeedbackJson,
                        LessonMaterialRules.Json) }) });
        });
        return app;
    }
}
