using System.Diagnostics;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Api.Modules.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        // Angular reads XSRF-TOKEN and automatically sends X-XSRF-TOKEN for relative POST requests.
        // The antiforgery framework also sets its own protected cookie.
        auth.MapGet("/csrf", (HttpContext context, IAntiforgery antiforgery,
            IWebHostEnvironment environment, ILoggerFactory loggerFactory) =>
        {
            var started = Stopwatch.GetTimestamp();
            var tokens = antiforgery.GetAndStoreTokens(context);
            context.Response.Cookies.Append("XSRF-TOKEN", tokens.RequestToken!, new CookieOptions
            {
                HttpOnly = false, // Intentionally readable by Angular; this is NOT the auth cookie.
                Secure = !environment.IsDevelopment() || context.Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                Path = "/"
            });
            context.Response.Headers.CacheControl = "no-store";
            loggerFactory.CreateLogger("Auth.Csrf").LogInformation(
                "Auth.Csrf.Success DurationMs={DurationMs}", Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            return Results.NoContent();
        }).AllowAnonymous();

        auth.MapPost("/login", async (LoginRequest request, HttpContext context,
            IAntiforgery antiforgery, UserManager<ApplicationUser> users,
            SignInManager<ApplicationUser> signIn, ILoggerFactory loggerFactory) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggerFactory.CreateLogger("Auth.Login");
            logger.LogInformation("Auth.Login.Start");
            try
            {
                await antiforgery.ValidateRequestAsync(context);
            }
            catch (AntiforgeryValidationException)
            {
                logger.LogWarning("Auth.Login.Rejected Reason=InvalidCsrf DurationMs={DurationMs}",
                    Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.BadRequest(new { error = "invalid_csrf" });
            }

            var email = request.Email?.Trim();
            if (string.IsNullOrWhiteSpace(email) || email.Length > 256 || string.IsNullOrWhiteSpace(request.Password))
            {
                logger.LogWarning("Auth.Login.Rejected Reason=InvalidInput DurationMs={DurationMs}",
                    Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.BadRequest(new { error = "invalid_request" });
            }

            // Never log a password, an email address, or an antiforgery token.
            var user = await users.FindByEmailAsync(email);
            if (user is null)
            {
                logger.LogWarning("Auth.Login.Failed Reason=InvalidCredentials DurationMs={DurationMs}",
                    Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.Unauthorized();
            }

            var result = await signIn.PasswordSignInAsync(user, request.Password!,
                isPersistent: false, lockoutOnFailure: true);
            if (!result.Succeeded)
            {
                logger.LogWarning("Auth.Login.Failed Reason=Rejected DurationMs={DurationMs}",
                    Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.Unauthorized();
            }

            var roles = await users.GetRolesAsync(user);
            context.Response.Headers.CacheControl = "no-store";
            logger.LogInformation("Auth.Login.Success UserId={UserId} DurationMs={DurationMs}",
                user.Id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            return Results.Ok(new { authenticated = true, userId = user.Id, roles });
        }).AllowAnonymous();

        auth.MapGet("/session", async (HttpContext context, UserManager<ApplicationUser> users,
            ILoggerFactory loggerFactory) =>
        {
            var started = Stopwatch.GetTimestamp();
            context.Response.Headers.CacheControl = "no-store";
            if (context.User.Identity?.IsAuthenticated != true)
            {
                loggerFactory.CreateLogger("Auth.Session").LogInformation(
                    "Auth.Session.Anonymous DurationMs={DurationMs}", Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.Ok(new { authenticated = false, userId = (Guid?)null, roles = Array.Empty<string>() });
            }

            var user = await users.GetUserAsync(context.User);
            if (user is null)
            {
                loggerFactory.CreateLogger("Auth.Session").LogWarning(
                    "Auth.Session.UnknownUser DurationMs={DurationMs}", Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.Unauthorized();
            }

            var roles = await users.GetRolesAsync(user);
            loggerFactory.CreateLogger("Auth.Session").LogInformation(
                "Auth.Session.Success UserId={UserId} DurationMs={DurationMs}",
                user.Id, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            return Results.Ok(new { authenticated = true, userId = user.Id, roles });
        }).AllowAnonymous();

        auth.MapPost("/logout", async (HttpContext context, IAntiforgery antiforgery,
            SignInManager<ApplicationUser> signIn, ILoggerFactory loggerFactory) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = loggerFactory.CreateLogger("Auth.Logout");
            logger.LogInformation("Auth.Logout.Start");
            try
            {
                await antiforgery.ValidateRequestAsync(context);
            }
            catch (AntiforgeryValidationException)
            {
                logger.LogWarning("Auth.Logout.Rejected Reason=InvalidCsrf DurationMs={DurationMs}",
                    Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return Results.BadRequest(new { error = "invalid_csrf" });
            }

            await signIn.SignOutAsync();
            context.Response.Headers.CacheControl = "no-store";
            logger.LogInformation("Auth.Logout.Success DurationMs={DurationMs}",
                Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            return Results.NoContent();
        }).RequireAuthorization();

        return app;
    }

    public sealed record LoginRequest(string? Email, string? Password);
}
