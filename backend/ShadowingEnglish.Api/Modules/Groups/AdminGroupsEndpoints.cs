using System.Data;
using System.Diagnostics;
using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Groups;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Api.Modules.Groups;

public static class AdminGroupsEndpoints
{
    public static IEndpointRouteBuilder MapAdminGroupsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/groups")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        group.MapGet("", async (int? page, int? pageSize, HttpContext context,
            ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Groups");
            logger.LogInformation("Admin.Groups.List.Start TraceId={TraceId}", context.TraceIdentifier);
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Denied(logger, started);
            if (!ValidPage(page, pageSize)) return Rejected(logger, started, 400, "invalid_page");

            try
            {
                var size = pageSize ?? 20;
                var groups = await db.StudyGroups.AsNoTracking()
                    .OrderBy(item => item.Name).ThenBy(item => item.Id)
                    .Skip(((page ?? 1) - 1) * size).Take(size + 1)
                    .Select(item => new GroupDto(item.Id, item.Name)).ToListAsync();
                context.Response.Headers.CacheControl = "no-store";
                logger.LogInformation("Admin.Groups.List.Success ActorId={ActorId} Count={Count} DurationMs={DurationMs}",
                    actor.Id, Math.Min(groups.Count, size), Elapsed(started));
                return Results.Ok(new { items = groups.Take(size), hasMore = groups.Count > size });
            }
            catch (Exception ex)
            {
                return Failed(logger, ex, "List", actor.Id, started);
            }
        });

        group.MapPost("", async (CreateGroupRequest request, HttpContext context, IAntiforgery antiforgery,
            ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Groups");
            logger.LogInformation("Admin.Groups.Create.Start RequestId={RequestId} TraceId={TraceId}",
                request.RequestId, context.TraceIdentifier);
            if (!await ValidCsrfAsync(context, antiforgery))
                return Rejected(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Denied(logger, started);
            var name = request.Name?.Trim();
            if (string.IsNullOrWhiteSpace(name) || name.Length < 2 || name.Length > 120 ||
                name.Any(char.IsControl))
                return Rejected(logger, started, 400, "invalid_group_name");
            if (request.RequestId is null || request.RequestId == Guid.Empty)
                return Rejected(logger, started, 400, "invalid_request_id");

            try
            {
                var previous = await db.StudyGroups.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.CreateRequestId == request.RequestId.Value);
                if (previous is not null)
                    return ExistingGroup(previous, name, context, logger, actor.Id, started);
                var newGroup = new StudyGroup
                {
                    Id = Guid.NewGuid(), Name = name, CreatedAtUtc = DateTimeOffset.UtcNow,
                    CreatedByAdminId = actor.Id, CreateRequestId = request.RequestId.Value
                };
                db.StudyGroups.Add(newGroup);
                await db.SaveChangesAsync();
                context.Response.Headers.CacheControl = "no-store";
                logger.LogInformation("Admin.Groups.Create.Success ActorId={ActorId} GroupId={GroupId} DurationMs={DurationMs}",
                    actor.Id, newGroup.Id, Elapsed(started));
                return Results.Json(new GroupDto(newGroup.Id, newGroup.Name), statusCode: 201);
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
            {
                // A previous request may have committed just before this insert.
                var previous = await db.StudyGroups.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.CreateRequestId == request.RequestId.Value);
                if (previous is not null)
                    return ExistingGroup(previous, name, context, logger, actor.Id, started);
                return Failed(logger, ex, "Create", actor.Id, started);
            }
            catch (Exception ex)
            {
                return Failed(logger, ex, "Create", actor.Id, started);
            }
        }).RequireRateLimiting("admin-group-write");

        group.MapGet("/students", async (string? query, int? page, int? pageSize, HttpContext context,
            ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Groups");
            logger.LogInformation("Admin.Groups.Students.Start TraceId={TraceId} QueryLength={QueryLength}",
                context.TraceIdentifier, query?.Length ?? 0);
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Denied(logger, started);
            if (!ValidPage(page, pageSize) || query?.Length > 100)
                return Rejected(logger, started, 400, "invalid_search");

            try
            {
                var roleId = await db.Roles.AsNoTracking().Where(role => role.NormalizedName == "STUDENT")
                    .Select(role => role.Id).SingleOrDefaultAsync();
                if (roleId == Guid.Empty)
                {
                    context.Response.Headers.CacheControl = "no-store";
                    logger.LogInformation("Admin.Groups.Students.Success ActorId={ActorId} Count=0 DurationMs={DurationMs}",
                        actor.Id, Elapsed(started));
                    return Results.Ok(new { items = Array.Empty<StudentDto>(), hasMore = false });
                }

                var size = pageSize ?? 20;
                var prefix = query?.Trim().ToUpperInvariant() ?? "";
                var studentPage = await (from user in db.Users.AsNoTracking()
                    join userRole in db.UserRoles.AsNoTracking() on user.Id equals userRole.UserId
                    where userRole.RoleId == roleId && user.NormalizedEmail != null &&
                          user.NormalizedEmail.StartsWith(prefix)
                    orderby user.NormalizedEmail, user.Id
                    select new { user.Id, user.Email })
                    .Skip(((page ?? 1) - 1) * size).Take(size + 1).ToListAsync();
                var visible = studentPage.Take(size).ToArray();
                var ids = visible.Select(student => student.Id).ToArray();
                var active = await (from membership in db.StudentGroupMemberships.AsNoTracking()
                    join studyGroup in db.StudyGroups.AsNoTracking() on membership.GroupId equals studyGroup.Id
                    where ids.Contains(membership.StudentId) && membership.EndedAtUtc == null
                    select new { membership.StudentId, membership.Id, membership.GroupId,
                        GroupName = studyGroup.Name, membership.StartedAtUtc }).ToListAsync();
                var activeByStudent = active.ToDictionary(item => item.StudentId);
                var items = visible.Select(student => new StudentDto(student.Id, student.Email ?? "",
                    activeByStudent.TryGetValue(student.Id, out var membership)
                        ? new ActiveMembershipDto(membership.Id, membership.GroupId,
                            membership.GroupName, membership.StartedAtUtc)
                        : null)).ToArray();
                context.Response.Headers.CacheControl = "no-store";
                logger.LogInformation("Admin.Groups.Students.Success ActorId={ActorId} Count={Count} DurationMs={DurationMs}",
                    actor.Id, items.Length, Elapsed(started));
                return Results.Ok(new { items, hasMore = studentPage.Count > size });
            }
            catch (Exception ex)
            {
                return Failed(logger, ex, "Students", actor.Id, started);
            }
        });

        group.MapGet("/students/{studentId:guid}/history", async (Guid studentId, int? page, int? pageSize,
            HttpContext context, ApplicationDbContext db, UserManager<ApplicationUser> users,
            ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Groups");
            logger.LogInformation("Admin.Groups.History.Start StudentId={StudentId} TraceId={TraceId}",
                studentId, context.TraceIdentifier);
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Denied(logger, started);
            if (!ValidPage(page, pageSize)) return Rejected(logger, started, 400, "invalid_page");

            try
            {
                if (!await db.Users.AsNoTracking().AnyAsync(user => user.Id == studentId))
                    return NotFound(logger, started, actor.Id, studentId, "student_not_found");
                var size = pageSize ?? 20;
                var rows = await (from membership in db.StudentGroupMemberships.AsNoTracking()
                    join studyGroup in db.StudyGroups.AsNoTracking() on membership.GroupId equals studyGroup.Id
                    where membership.StudentId == studentId
                    orderby membership.StartedAtUtc descending, membership.Id descending
                    select new HistoryDto(membership.Id, studyGroup.Id, studyGroup.Name,
                        membership.StartedAtUtc, membership.EndedAtUtc))
                    .Skip(((page ?? 1) - 1) * size).Take(size + 1).ToListAsync();
                context.Response.Headers.CacheControl = "no-store";
                logger.LogInformation("Admin.Groups.History.Success ActorId={ActorId} StudentId={StudentId} Count={Count} DurationMs={DurationMs}",
                    actor.Id, studentId, Math.Min(rows.Count, size), Elapsed(started));
                return Results.Ok(new { items = rows.Take(size), hasMore = rows.Count > size });
            }
            catch (Exception ex)
            {
                return Failed(logger, ex, "History", actor.Id, started);
            }
        });

        group.MapPut("/students/{studentId:guid}/membership", async (Guid studentId,
            MoveStudentRequest request, HttpContext context, IAntiforgery antiforgery,
            ApplicationDbContext db, UserManager<ApplicationUser> users, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Groups");
            logger.LogInformation("Admin.Groups.Move.Start StudentId={StudentId} TargetGroupId={TargetGroupId} TraceId={TraceId}",
                studentId, request.GroupId, context.TraceIdentifier);
            if (!await ValidCsrfAsync(context, antiforgery))
                return Rejected(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Denied(logger, started);
            if (request.GroupId == Guid.Empty || request.ExpectedMembershipId == Guid.Empty)
                return Rejected(logger, started, 400, "invalid_membership_request");

            // Serialize per-student reads/writes; the filtered unique index is the final DB guard.
            try
            {
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
                var student = await users.FindByIdAsync(studentId.ToString());
                if (student is null || !await users.IsInRoleAsync(student, "Student"))
                    return NotFound(logger, started, actor.Id, studentId, "student_not_found");
                var active = await db.StudentGroupMemberships
                    .SingleOrDefaultAsync(item => item.StudentId == studentId && item.EndedAtUtc == null);
                if (active?.GroupId == request.GroupId)
                {
                    logger.LogInformation("Admin.Groups.Move.NoChange ActorId={ActorId} StudentId={StudentId} DurationMs={DurationMs}",
                        actor.Id, studentId, Elapsed(started));
                    return Results.Ok(new { membershipId = active?.Id, groupId = active?.GroupId });
                }
                if (active?.Id != request.ExpectedMembershipId)
                {
                    logger.LogWarning("Admin.Groups.Move.Conflict ActorId={ActorId} StudentId={StudentId} DurationMs={DurationMs}",
                        actor.Id, studentId, Elapsed(started));
                    return Results.Conflict(new { error = "membership_changed" });
                }
                if (request.GroupId is Guid target &&
                    !await db.StudyGroups.AsNoTracking().AnyAsync(item => item.Id == target))
                    return NotFound(logger, started, actor.Id, target, "group_not_found");

                var now = DateTimeOffset.UtcNow;
                if (active is not null)
                {
                    active.EndedAtUtc = now;
                    active.EndedByAdminId = actor.Id;
                    // Closing the old row first avoids violating the filtered unique index on INSERT.
                    await db.SaveChangesAsync();
                }

                StudentGroupMembership? next = null;
                if (request.GroupId is Guid groupId)
                {
                    next = new StudentGroupMembership
                    {
                        Id = Guid.NewGuid(), StudentId = studentId, GroupId = groupId,
                        StartedAtUtc = now, AssignedByAdminId = actor.Id
                    };
                    db.StudentGroupMemberships.Add(next);
                    await db.SaveChangesAsync();
                }

                await tx.CommitAsync();
                logger.LogInformation("Admin.Groups.Move.Success ActorId={ActorId} StudentId={StudentId} GroupId={GroupId} MembershipId={MembershipId} DurationMs={DurationMs}",
                    actor.Id, studentId, request.GroupId, next?.Id, Elapsed(started));
                return Results.Ok(new { membershipId = next?.Id, groupId = next?.GroupId });
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 or 1205 })
            {
                logger.LogWarning(ex, "Admin.Groups.Move.Conflict ActorId={ActorId} StudentId={StudentId} DurationMs={DurationMs}",
                    actor.Id, studentId, Elapsed(started));
                return Results.Conflict(new { error = "membership_changed" });
            }
            catch (SqlException ex) when (ex.Number == 1205)
            {
                logger.LogWarning(ex, "Admin.Groups.Move.Conflict ActorId={ActorId} StudentId={StudentId} DurationMs={DurationMs}",
                    actor.Id, studentId, Elapsed(started));
                return Results.Conflict(new { error = "membership_changed" });
            }
            catch (Exception ex)
            {
                return Failed(logger, ex, "Move", actor.Id, started);
            }
        }).RequireRateLimiting("admin-group-write");

        return app;
    }

    private static bool ValidPage(int? page, int? pageSize) =>
        (page is null or >= 1 and <= 1000) && (pageSize is null or >= 1 and <= 50);

    private static async Task<ApplicationUser?> CurrentAdminAsync(HttpContext context,
        UserManager<ApplicationUser> users)
    {
        var actor = await users.GetUserAsync(context.User);
        return actor is not null && await users.IsInRoleAsync(actor, "Admin") ? actor : null;
    }

    private static async Task<bool> ValidCsrfAsync(HttpContext context, IAntiforgery antiforgery)
    {
        try { await antiforgery.ValidateRequestAsync(context); return true; }
        catch (AntiforgeryValidationException) { return false; }
    }

    private static double Elapsed(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    private static IResult Denied(ILogger logger, long started)
    {
        logger.LogWarning("Admin.Groups.Denied DurationMs={DurationMs}", Elapsed(started));
        return Results.Forbid();
    }

    private static IResult Rejected(ILogger logger, long started, int status, string error)
    {
        logger.LogWarning("Admin.Groups.Rejected Reason={Reason} DurationMs={DurationMs}", error, Elapsed(started));
        return Results.Json(new { error }, statusCode: status);
    }

    private static IResult NotFound(ILogger logger, long started, Guid actorId, Guid resourceId, string error)
    {
        logger.LogWarning("Admin.Groups.NotFound Reason={Reason} ActorId={ActorId} ResourceId={ResourceId} DurationMs={DurationMs}",
            error, actorId, resourceId, Elapsed(started));
        return Results.NotFound(new { error });
    }

    private static IResult ExistingGroup(StudyGroup group, string name, HttpContext context,
        ILogger logger, Guid actorId, long started)
    {
        if (!string.Equals(group.Name, name, StringComparison.Ordinal))
            return Rejected(logger, started, 409, "group_request_conflict");
        context.Response.Headers.CacheControl = "no-store";
        logger.LogInformation("Admin.Groups.Create.NoChange ActorId={ActorId} GroupId={GroupId} DurationMs={DurationMs}",
            actorId, group.Id, Elapsed(started));
        return Results.Ok(new GroupDto(group.Id, group.Name));
    }

    private static IResult Failed(ILogger logger, Exception ex, string action, Guid actorId, long started)
    {
        logger.LogError(ex, "Admin.Groups.Failed Action={Action} ActorId={ActorId} DurationMs={DurationMs}",
            action, actorId, Elapsed(started));
        return Results.Problem(statusCode: 500, title: "group_operation_failed");
    }

    public sealed record CreateGroupRequest(string? Name, Guid? RequestId);
    public sealed record MoveStudentRequest(Guid? GroupId, Guid? ExpectedMembershipId);
    private sealed record GroupDto(Guid Id, string Name);
    private sealed record ActiveMembershipDto(Guid MembershipId, Guid GroupId, string GroupName,
        DateTimeOffset StartedAtUtc);
    private sealed record StudentDto(Guid Id, string Email, ActiveMembershipDto? ActiveGroup);
    private sealed record HistoryDto(Guid MembershipId, Guid GroupId, string GroupName,
        DateTimeOffset StartedAtUtc, DateTimeOffset? EndedAtUtc);
}
