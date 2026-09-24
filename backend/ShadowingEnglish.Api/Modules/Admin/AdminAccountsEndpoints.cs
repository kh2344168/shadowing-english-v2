using System.ComponentModel.DataAnnotations;
using System.Diagnostics;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Api.Modules.Admin;

// The protected owner is configured per deployment using the EXISTING Identity user GUID.
// Never infer ownership from a name/email, and never create/promote an owner through HTTP.
public static class AdminAccountsEndpoints
{
    public static IEndpointRouteBuilder MapAdminAccountsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/accounts")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        group.MapGet("/me", async (HttpContext context, UserManager<ApplicationUser> users,
            IConfiguration config, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Accounts");
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Results.Forbid();
            var ownerId = await VerifiedOwnerIdAsync(users, config);
            if (ownerId is null) return Unconfigured(logger, started);
            logger.LogInformation("Admin.Accounts.Me.Success ActorId={ActorId} DurationMs={DurationMs}",
                actor.Id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            context.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { isPrimaryAdmin = actor.Id == ownerId.Value });
        });

        group.MapGet("", async (HttpContext context, UserManager<ApplicationUser> users,
            IConfiguration config, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Accounts");
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Results.Forbid();
            var ownerId = await VerifiedOwnerIdAsync(users, config);
            if (ownerId is null) return Unconfigured(logger, started);
            var admins = (await users.GetUsersInRoleAsync("Admin"))
                .OrderBy(user => user.NormalizedEmail)
                .Select(user => new { id = user.Id, email = user.Email ?? "", isPrimaryAdmin = user.Id == ownerId.Value })
                .ToArray();
            context.Response.Headers.CacheControl = "no-store";
            logger.LogInformation("Admin.Accounts.List.Success ActorId={ActorId} Count={Count} DurationMs={DurationMs}",
                actor.Id, admins.Length, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            return Results.Ok(admins);
        });

        group.MapPost("", async (CreateAdminRequest request, HttpContext context,
            IAntiforgery antiforgery, UserManager<ApplicationUser> users,
            ApplicationDbContext db, IConfiguration config, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Accounts");
            logger.LogInformation("Admin.Accounts.Create.Start TraceId={TraceId}", context.TraceIdentifier);
            if (!await HasValidCsrfAsync(context, antiforgery))
                return Rejected(logger, "InvalidCsrf", started, StatusCodes.Status400BadRequest, "invalid_csrf");
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Results.Forbid();
            if (await VerifiedOwnerIdAsync(users, config) is null) return Unconfigured(logger, started);

            var email = request.Email?.Trim();
            if (string.IsNullOrWhiteSpace(email) || email.Length > 256 ||
                !new EmailAddressAttribute().IsValid(email) ||
                string.IsNullOrWhiteSpace(request.Password) || request.Password.Length > 256)
                return Rejected(logger, "InvalidInput", started, 400, "invalid_request");

            if (await users.FindByEmailAsync(email) is not null)
                return Rejected(logger, "Duplicate", started, 409, "admin_email_exists");

            // One database transaction: account and role are created together, or neither is.
            await using var tx = await db.Database.BeginTransactionAsync();
            try
            {
                var user = new ApplicationUser
                {
                    Id = Guid.NewGuid(), UserName = email, Email = email,
                    EmailConfirmed = false // No implicit email verification or invitation delivery.
                };
                var created = await users.CreateAsync(user, request.Password!);
                if (!created.Succeeded)
                {
                    logger.LogWarning("Admin.Accounts.Create.ValidationFailed ActorId={ActorId} Codes={Codes} DurationMs={DurationMs}",
                        actor.Id, string.Join(",", created.Errors.Select(x => x.Code)),
                        Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                    return Results.BadRequest(new { error = "invalid_admin_account", codes = created.Errors.Select(x => x.Code) });
                }
                var assigned = await users.AddToRoleAsync(user, "Admin");
                if (!assigned.Succeeded)
                    throw new InvalidOperationException("Could not assign Admin role: " +
                        string.Join(",", assigned.Errors.Select(x => x.Code)));
                await tx.CommitAsync();
                logger.LogInformation("Admin.Accounts.Create.Success ActorId={ActorId} CreatedId={CreatedId} DurationMs={DurationMs}",
                    actor.Id, user.Id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                context.Response.Headers.CacheControl = "no-store";
                return Results.Json(new { id = user.Id }, statusCode: StatusCodes.Status201Created);
            }
            catch (DbUpdateException ex)
            {
                await tx.RollbackAsync();
                logger.LogWarning(ex, "Admin.Accounts.Create.Conflict ActorId={ActorId} DurationMs={DurationMs}",
                    actor.Id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.Conflict(new { error = "admin_email_exists" });
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync();
                logger.LogError(ex, "Admin.Accounts.Create.Failed ActorId={ActorId} DurationMs={DurationMs}",
                    actor.Id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.Problem(statusCode: 500, title: "admin_creation_failed");
            }
        }).RequireRateLimiting("admin-create");

        // Remove ADMIN ACCESS, not the identity row/history. Only the Primary Admin can do it.
        group.MapDelete("/{id:guid}", async (Guid id, HttpContext context,
            IAntiforgery antiforgery, UserManager<ApplicationUser> users,
            ApplicationDbContext db, IConfiguration config, ILoggerFactory loggers) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggers.CreateLogger("Admin.Accounts");
            logger.LogInformation("Admin.Accounts.Remove.Start TargetId={TargetId} TraceId={TraceId}",
                id, context.TraceIdentifier);
            if (!await HasValidCsrfAsync(context, antiforgery))
                return Rejected(logger, "InvalidCsrf", started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(context, users);
            if (actor is null) return Results.Forbid();
            var ownerId = await VerifiedOwnerIdAsync(users, config);
            if (ownerId is null) return Unconfigured(logger, started);
            if (actor.Id != ownerId.Value) return Denied(logger, "RemoveOwnerOnly", actor.Id, started);
            if (id == ownerId.Value)
                return Rejected(logger, "ProtectedOwner", started, 409, "primary_admin_protected");

            var target = await users.FindByIdAsync(id.ToString());
            if (target is null || !await users.IsInRoleAsync(target, "Admin"))
                return Results.NotFound(new { error = "admin_not_found" });
            await using var tx = await db.Database.BeginTransactionAsync();
            try
            {
                var removed = await users.RemoveFromRoleAsync(target, "Admin");
                if (!removed.Succeeded)
                    throw new InvalidOperationException("Could not revoke Admin role: " +
                        string.Join(",", removed.Errors.Select(x => x.Code)));
                // Role-checks query the DB on every admin action; the stamp also invalidates old cookies on validation.
                var stamped = await users.UpdateSecurityStampAsync(target);
                if (!stamped.Succeeded)
                    throw new InvalidOperationException("Could not rotate target security stamp.");
                await tx.CommitAsync();
                logger.LogInformation("Admin.Accounts.Remove.Success ActorId={ActorId} TargetId={TargetId} DurationMs={DurationMs}",
                    actor.Id, id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.NoContent();
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync();
                logger.LogError(ex, "Admin.Accounts.Remove.Failed ActorId={ActorId} TargetId={TargetId} DurationMs={DurationMs}",
                    actor.Id, id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.Problem(statusCode: 500, title: "admin_removal_failed");
            }
        });

        return app;
    }

    private static async Task<ApplicationUser?> CurrentAdminAsync(HttpContext context, UserManager<ApplicationUser> users)
    {
        var actor = await users.GetUserAsync(context.User);
        return actor is not null && await users.IsInRoleAsync(actor, "Admin") ? actor : null;
    }

    private static async Task<Guid?> VerifiedOwnerIdAsync(UserManager<ApplicationUser> users, IConfiguration config)
    {
        if (!Guid.TryParse(config["PrimaryAdmin:UserId"], out var id) || id == Guid.Empty) return null;
        var owner = await users.FindByIdAsync(id.ToString());
        return owner is not null && await users.IsInRoleAsync(owner, "Admin") ? id : null;
    }

    private static async Task<bool> HasValidCsrfAsync(HttpContext context, IAntiforgery antiforgery)
    {
        try { await antiforgery.ValidateRequestAsync(context); return true; }
        catch (AntiforgeryValidationException) { return false; }
    }

    private static IResult Unconfigured(ILogger logger, long started)
    {
        logger.LogWarning("Admin.Accounts.Blocked Reason=OwnerUnconfigured DurationMs={DurationMs}",
            Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        return Results.Json(new { error = "primary_admin_not_configured" }, statusCode: 503);
    }

    private static IResult Denied(ILogger logger, string reason, Guid actorId, long started)
    {
        logger.LogWarning("Admin.Accounts.Denied Reason={Reason} ActorId={ActorId} DurationMs={DurationMs}",
            reason, actorId, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        return Results.Forbid();
    }

    private static IResult Rejected(ILogger logger, string reason, long started, int status, string error)
    {
        logger.LogWarning("Admin.Accounts.Rejected Reason={Reason} DurationMs={DurationMs}",
            reason, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        return Results.Json(new { error }, statusCode: status);
    }

    public sealed record CreateAdminRequest(string? Email, string? Password);
}
