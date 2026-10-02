using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Http.Features;
using ShadowingEnglish.Api.Common;
using ShadowingEnglish.Api.Modules.Admin;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Api.Modules.Auth;
using ShadowingEnglish.Api.Modules.Groups;
using ShadowingEnglish.Api.Modules.Curriculums;
using ShadowingEnglish.Api.Modules.Lessons;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Api.Modules.Student;
using ShadowingEnglish.Api.Bootstrap;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Update", LogLevel.None);

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
builder.Services.AddSingleton<IShadowingMediaStore>(services => ShadowingMediaStoreFactory.Create(
    builder.Environment, builder.Configuration, services.GetRequiredService<ILoggerFactory>()));

// Bound sensitive authentication and write requests with built-in policies.
builder.Services.AddRateLimiter(options =>
{
    // Identity lockout protects known accounts; also bound anonymous attempts for unknown emails.
    options.AddPolicy("auth-login", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    options.AddPolicy("admin-create", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(15),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    options.AddPolicy("admin-group-write", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    options.AddPolicy("admin-lesson-write", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    options.AddPolicy("student-progress-write", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 60,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
});

// CSRF protection for cookie-authenticated state-changing requests.
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-XSRF-TOKEN";
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
});

builder.Services.Configure<FormOptions>(options =>
    options.MultipartBodyLengthLimit = 45_000_000);

// Foundation only: no database migrations, users, roles, or demo seeds are created at startup.
var app = builder.Build();

// An explicit, local-only CLI action. Ordinary startup never creates accounts.
if (args.Contains("--provision-local-accounts", StringComparer.Ordinal))
{
    await LocalAccountProvisioner.RunAsync(app);
    return;
}

if (args.Contains("--provision-day2-fixture", StringComparer.Ordinal))
{
    await LocalDay2Fixture.RunAsync(app);
    return;
}

app.UseMiddleware<SafeExceptionMiddleware>();
app.UseRouting(); // Required before endpoint-specific rate-limiting policies.
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapAdminAccountsEndpoints();
app.MapAdminGroupsEndpoints();
app.MapAdminCurriculumsEndpoints();
app.MapAdminShadowingEndpoints();
app.MapStudentLearningEndpoints();

app.MapGet("/health", (ILogger<Program> logger) =>
{
    var started = System.Diagnostics.Stopwatch.GetTimestamp();

    logger.LogInformation("Foundation.Health.Start");

    var result = Results.Ok(new
    {
        status = "ok",
        application = "ShadowingEnglish.V2"
    });

    logger.LogInformation(
        "Foundation.Health.Success DurationMs={DurationMs}",
        System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds);

    return result;
});

app.Run();

// Allows isolated HTTP tests to use the real application without starting SQL Server or Azure resources.
public partial class Program { }
