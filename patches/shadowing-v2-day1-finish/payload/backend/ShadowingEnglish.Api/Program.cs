using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Api.Modules.Auth;
using ShadowingEnglish.Api.Bootstrap;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:DefaultConnection. Configure it for this environment.");

builder.Services.AddDbContext<ApplicationDbContext>(options => options.UseSqlServer(connectionString));

builder.Services.AddIdentity<ApplicationUser, IdentityRole<Guid>>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 10;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.AllowedForNewUsers = true;
    })
    .AddEntityFrameworkStores<ApplicationDbContext>()
    .AddDefaultTokenProviders();

builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    // Local HTTP development only. Production cookies require HTTPS.
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = true;
    options.Events.OnRedirectToLogin = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        }

        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }

        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
});

builder.Services.AddAuthorization();
// CSRF protection for cookie-authenticated state-changing requests.
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-XSRF-TOKEN";
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
});

// Foundation only: no database migrations, users, roles, or demo seeds are created at startup.
var app = builder.Build();

// An explicit, local-only CLI action. Ordinary startup never creates accounts.
if (args.Contains("--provision-local-accounts", StringComparer.Ordinal))
{
    await LocalAccountProvisioner.RunAsync(app);
    return;
}

app.UseAuthentication();
app.UseAuthorization();

app.MapAuthEndpoints();

app.MapGet("/health", (ILogger<Program> logger) =>
{
    var started = System.Diagnostics.Stopwatch.GetTimestamp();
    logger.LogInformation("Foundation.Health.Start");
    var result = Results.Ok(new { status = "ok", application = "ShadowingEnglish.V2" });
    logger.LogInformation("Foundation.Health.Success DurationMs={DurationMs}",
        System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    return result;
});

app.Run();
