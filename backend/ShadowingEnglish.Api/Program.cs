using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;
using System.Text.RegularExpressions;
using ShadowingEnglish.Api.Common;
using ShadowingEnglish.Api.Modules.Admin;
using ShadowingEnglish.Api.Modules.AI;
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

// Only the local cloudflared process can supply the visitor IP and HTTPS scheme.
if (builder.Environment.IsEnvironment("Demo"))
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardedForHeaderName = "CF-Connecting-IP";
        options.KnownProxies.Add(IPAddress.Loopback);
        options.KnownProxies.Add(IPAddress.IPv6Loopback);
        options.ForwardLimit = 1;
    });

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
builder.Services.AddSingleton<AiProviderCredentialProtector>();
builder.Services.AddHttpClient<AiProviderConnectionTester>(client =>
    {
        client.Timeout = TimeSpan.FromSeconds(12);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("ShadowingEnglishV2/1.0");
    })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHttpClient(nameof(TextAiRouter), client =>
    {
        // The router owns its per-provider deadline and needs room to read the full JSON body.
        client.Timeout = TimeSpan.FromSeconds(TextAiRouter.ProviderTimeoutSeconds + 5);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("ShadowingEnglishV2/1.0");
    })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddSingleton<TextAiRouter>();
builder.Services.AddHttpClient<PexelsImageService>()
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddMemoryCache(options => options.SizeLimit = 30_000_000);
builder.Services.AddHttpClient<GroqVoiceService>()
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHttpClient<GeminiSpeechService>()
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHostedService<LessonAiWorker>();
builder.Services.AddSingleton<LessonAiJobSignal>();
builder.Services.AddHostedService<LessonMediaDeletionWorker>();

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

    options.AddPolicy("admin-ai-provider-write", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
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

    options.AddPolicy("student-ai-write", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));

    options.AddPolicy("student-voice", context => RateLimitPartition.GetFixedWindowLimiter(
        partitionKey: context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        factory: _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
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

if (app.Environment.IsEnvironment("Demo")) app.UseForwardedHeaders();

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
app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;
    headers["X-Content-Type-Options"] = "nosniff";
    headers["X-Frame-Options"] = "DENY";
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    headers["Content-Security-Policy"] = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
    headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(self)";
    if (context.Request.IsHttps && !app.Environment.IsDevelopment())
        headers["Strict-Transport-Security"] = "max-age=86400";
    if (context.Request.Path.StartsWithSegments("/api"))
        headers.CacheControl = "no-store";
    else
        context.Response.OnStarting(() =>
        {
            if (context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true)
                headers.CacheControl = "no-cache";
            return Task.CompletedTask;
        });
    await next(context);
});
// The release workflow copies the Angular browser build into the published wwwroot.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        var fileName = context.File.Name;
        context.Context.Response.Headers.CacheControl = Regex.IsMatch(fileName,
            @"[-.][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico)$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
            ? "public,max-age=31536000,immutable"
            : "no-cache";
    }
});
app.UseRouting(); // Required before endpoint-specific rate-limiting policies.
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapAdminAccountsEndpoints();
app.MapAdminAiProviderEndpoints();
app.MapAdminLessonAiEndpoints();
app.MapAdminConversationReportsEndpoints();
app.MapAdminGroupsEndpoints();
app.MapAdminCurriculumsEndpoints();
app.MapAdminShadowingEndpoints();
app.MapAdminLessonManagementEndpoints();
app.MapAdminLessonWorkflowEndpoints();
app.MapStudentLearningEndpoints();
app.MapStudentShadowingReportingEndpoints();
app.MapStudentAiLearningEndpoints();

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

// Keep unknown API paths as 404; client-side Angular routes use index.html.
app.Map("/api", () => Results.NotFound());
app.Map("/api/{**unmatched}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();

// Allows isolated HTTP tests to use the real application without starting SQL Server or Azure resources.
public partial class Program { }
