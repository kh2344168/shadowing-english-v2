using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Azure.Core.Pipeline;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using ShadowingEnglish.Api.Common;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Core.Groups;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.MediaChecks;

// Deliberately a console acceptance suite: no test framework dependency and no live SQL/Azure credentials.
internal static class Runner
{
    private static readonly List<object> Results = [];
    private static int failures;
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }
    private static async Task Check(string name, Func<Task> action)
    {
        var started = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            await action();
            Results.Add(new { name, status = "PASS", durationMs = started.ElapsedMilliseconds });
            Console.WriteLine("PASS " + name);
        }
        catch (Exception error)
        {
            failures++;
            Results.Add(new { name, status = "FAIL", errorType = error.GetType().Name,
                reason = error is InvalidOperationException ? error.Message : "operation_failed" });
            Console.WriteLine("FAIL " + name + " " + error.GetType().Name +
                (error is InvalidOperationException ? " " + error.Message : ""));
        }
    }

    public static async Task<int> Main(string[] args)
    {
        if (args.SequenceEqual(new[] { "--traffic-check" }))
        {
            var apiRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
            using var trafficLogs = new SafeLogs();
            using var app = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), trafficLogs);
            await app.SetupAsync();
            using var anonymous = app.Client();
            using var student = await app.LoginAsync("student");
            using var admin = await app.LoginAsync("admin");
            await Check("Trial traffic records route templates and protects its report", async () =>
            {
                using var live = await anonymous.GetAsync("/health/live");
                using var missing = await anonymous.GetAsync("/api/unknown/" + Guid.NewGuid());
                using var lesson = await student.GetAsync("/api/student/learning/curriculum");
                using var blocked = await anonymous.GetAsync("/api/admin/diagnostics/traffic");
                using var forbidden = await student.GetAsync("/api/admin/diagnostics/traffic");
                using var report = await admin.GetAsync("/api/admin/diagnostics/traffic");
                Assert(live.StatusCode == HttpStatusCode.OK && missing.StatusCode == HttpStatusCode.NotFound &&
                    lesson.StatusCode == HttpStatusCode.OK && blocked.StatusCode == HttpStatusCode.Unauthorized &&
                    forbidden.StatusCode == HttpStatusCode.Forbidden && report.StatusCode == HttpStatusCode.OK,
                    "traffic_report_roles_or_probe_failed");
                Assert(report.Headers.CacheControl?.NoStore == true, "traffic_report_cacheable");
                var payload = await report.Content.ReadFromJsonAsync<JsonElement>();
                var routes = payload.GetProperty("traffic").GetProperty("routes");
                Assert(payload.GetProperty("traffic").GetProperty("capturedRequests").GetInt32() >= 5 &&
                    routes.EnumerateArray().Any(row => row.GetProperty("route").GetString() == "/health/live") &&
                    routes.EnumerateArray().Any(row => row.GetProperty("route").GetString() ==
                        "/api/{**unmatched}" && row.GetProperty("clientErrors").GetInt32() >= 1) &&
                    payload.GetProperty("dailyUsageUtc").GetProperty("aiRequests").GetInt32() == 0,
                    "traffic_report_missing_measurements");
                Assert(!(await report.Content.ReadAsStringAsync()).Contains(missing.RequestMessage!.RequestUri!.ToString(),
                    StringComparison.Ordinal), "traffic_report_leaked_request_url");
            });
            return failures == 0 ? 0 : 1;
        }
        if (args.Length == 2 && args[0] == "--processor-real-e2e")
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures);
        if (args.Length == 3 && args[0] == "--processor-republish-load" &&
            int.TryParse(args[2], out var students) && students is >= 1 and <= 3000)
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures, students);
        if (args.Length == 4 && args[0] == "--processor-republish-load" &&
            int.TryParse(args[2], out var studentsWithAttempts) && studentsWithAttempts is >= 1 and <= 3000 &&
            int.TryParse(args[3], out var attemptsPerStudent) && attemptsPerStudent is >= 1 and <= 20)
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures,
                studentCount: studentsWithAttempts, republishAttempts: attemptsPerStudent);
        if (args.Length == 5 && args[0] == "--processor-group-republish-load" &&
            int.TryParse(args[2], out var groups) && groups is >= 2 and <= 30 &&
            int.TryParse(args[3], out var studentsPerGroup) && studentsPerGroup is >= 1 and <= 100 &&
            int.TryParse(args[4], out var groupAttempts) && groupAttempts is >= 1 and <= 10)
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures,
                groupCount: groups, groupStudents: studentsPerGroup, groupAttempts: groupAttempts);
        if (args.Length == 6 && args[0] == "--processor-group-republish-load" &&
            int.TryParse(args[2], out var multiGroups) && multiGroups is >= 2 and <= 30 &&
            int.TryParse(args[3], out var multiStudents) && multiStudents is >= 1 and <= 100 &&
            int.TryParse(args[4], out var multiAttempts) && multiAttempts is >= 1 and <= 10 &&
            int.TryParse(args[5], out var multiLessons) && multiLessons is >= 1 and <= 10 &&
            multiGroups * multiStudents * multiAttempts * multiLessons <= 50_000)
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures,
                groupCount: multiGroups, groupStudents: multiStudents,
                groupAttempts: multiAttempts, groupLessons: multiLessons);
        if (args.Length == 6 && args[0] == "--processor-group-read-probe" &&
            int.TryParse(args[2], out var readGroups) && readGroups is >= 2 and <= 30 &&
            int.TryParse(args[3], out var readStudents) && readStudents is >= 1 and <= 100 &&
            int.TryParse(args[4], out var readAttempts) && readAttempts is >= 1 and <= 10 &&
            int.TryParse(args[5], out var readLessons) && readLessons is >= 1 and <= 10 &&
            readGroups * readStudents * readAttempts * readLessons <= 50_000)
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures,
                groupCount: readGroups, groupStudents: readStudents,
                groupAttempts: readAttempts, groupLessons: readLessons, probeReads: true);
        if (args.Length == 4 && args[0] == "--processor-student-load" &&
            int.TryParse(args[2], out var loadStudents) && loadStudents is >= 1 and <= 3000 &&
            int.TryParse(args[3], out var concurrency) && concurrency >= 1 && concurrency <= loadStudents)
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures,
                concurrentStudents: loadStudents, maxConcurrency: concurrency);
        if (args.Length == 5 && args[0] == "--processor-student-read-load" &&
            int.TryParse(args[2], out var distinctStudents) && distinctStudents is >= 1 and <= 3000 &&
            int.TryParse(args[3], out var loginLimit) && loginLimit is >= 1 and <= 300 &&
            int.TryParse(args[4], out var readLimit) && readLimit is >= 1 && readLimit <= distinctStudents)
            return await ProcessorRealE2EChecks.RunAsync(args[1], Check, () => failures,
                concurrentStudents: distinctStudents, maxConcurrency: loginLimit,
                readConcurrency: readLimit);
        if (args.SequenceEqual(new[] { "--health-check" }))
        {
            var apiRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
            using var healthLogs = new SafeLogs();
            using var disabled = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), healthLogs);
            await disabled.SetupAsync();
            await Check("Liveness stays available while readiness detects missing media", async () =>
            {
                using var client = disabled.Client();
                using var live = await client.GetAsync("/health/live");
                using var ready = await client.GetAsync("/health");
                Assert(live.StatusCode == HttpStatusCode.OK && ready.StatusCode == HttpStatusCode.ServiceUnavailable,
                    "missing_media_not_reported");
                Assert(ready.Headers.CacheControl?.NoStore == true, "health_response_cached");
            });
            var probe = new HealthProbeMediaStore();
            using var healthy = new MediaApp(apiRoot, probe, healthLogs);
            await healthy.SetupAsync();
            await Check("Readiness checks database and private media probe", async () =>
            {
                using var client = healthy.Client();
                using var ready = await client.GetAsync("/health");
                Assert(ready.StatusCode == HttpStatusCode.OK && probe.Probes == 1,
                    "ready_dependencies_not_checked");
                using var cached = await client.GetAsync("/health");
                Assert(cached.StatusCode == HttpStatusCode.OK && probe.Probes == 1,
                    "repeated_health_check_hit_media_again");
            });
            var failingMedia = new HealthProbeMediaStore { Fail = true };
            using var unavailableMedia = new MediaApp(apiRoot, failingMedia, healthLogs);
            await unavailableMedia.SetupAsync();
            await Check("Readiness reports unavailable media", async () =>
            {
                using var client = unavailableMedia.Client();
                using var unavailable = await client.GetAsync("/health");
                Assert(unavailable.StatusCode == HttpStatusCode.ServiceUnavailable && failingMedia.Probes == 1,
                    "unavailable_media_not_reported");
            });
            using var unavailableDb = new MediaApp(apiRoot, new HealthProbeMediaStore(), healthLogs);
            await unavailableDb.SetupAsync();
            unavailableDb.BreakDatabaseForHealthCheck();
            await Check("Readiness reports database failure without exposing details", async () =>
            {
                using var client = unavailableDb.Client();
                using var ready = await client.GetAsync("/health");
                Assert(ready.StatusCode == HttpStatusCode.ServiceUnavailable,
                    "unavailable_database_not_reported");
                var body = await ready.Content.ReadAsStringAsync();
                Assert(!body.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) &&
                    !body.Contains("Exception", StringComparison.OrdinalIgnoreCase),
                    "database_error_details_exposed");
            });
            return failures == 0 ? 0 : 1;
        }
        if (args.SequenceEqual(new[] { "--security-check" }))
        {
            var apiRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
            using var securityLogs = new SafeLogs();
            using var app = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), securityLogs);
            await app.SetupAsync();
            using var anonymous = app.Client();
            using var admin = await app.LoginAsync("admin");
            using var student = await app.LoginAsync("student");
            await Check("Admin and student endpoints reject anonymous and wrong roles", async () =>
            {
                foreach (var (path, authorized, wrongRole) in new[]
                {
                    ("/api/admin/accounts/me", admin, student),
                    ("/api/admin/shadowing/curriculums", admin, student),
                    ("/api/student/learning/curriculum", student, admin)
                })
                {
                    using var unauthenticated = await anonymous.GetAsync(path);
                    using var forbidden = await wrongRole.GetAsync(path);
                    Assert(unauthenticated.StatusCode == HttpStatusCode.Unauthorized,
                        "anonymous_endpoint_allowed_" + path);
                    Assert(forbidden.StatusCode == HttpStatusCode.Forbidden,
                        "wrong_role_endpoint_allowed_" + path);
                }
            });
            await Check("Cookie-authenticated writes require CSRF on both roles", async () =>
            {
                var before = await app.FingerprintAsync();
                admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
                student.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
                using var adminWrite = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums",
                    new { requestId = Guid.NewGuid(), name = "CSRF probe", description = "" });
                using var studentWrite = await student.PutAsJsonAsync(
                    $"/api/student/learning/slots/{Guid.NewGuid()}/progress",
                    new { completedSegments = 1 });
                Assert(adminWrite.StatusCode == HttpStatusCode.BadRequest,
                    "admin_write_without_csrf_" + adminWrite.StatusCode);
                Assert(studentWrite.StatusCode == HttpStatusCode.BadRequest,
                    "student_write_without_csrf_" + studentWrite.StatusCode);
                Assert(before == await app.FingerprintAsync(), "csrf_probe_mutated_database");
            });
            await Check("Removing a student's live role blocks an existing cookie immediately", async () =>
            {
                using var scope = app.Services.CreateScope();
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                var account = await users.FindByEmailAsync("student@v2-test.invalid");
                Assert(account is not null &&
                    (await users.RemoveFromRoleAsync(account, "Student")).Succeeded,
                    "student_role_revocation_failed");
                using var response = await student.GetAsync("/api/student/learning/curriculum");
                using var ai = await student.GetAsync(
                    $"/api/student/learning/slots/{Guid.NewGuid()}/ai-material");
                await app.RefreshCsrfAsync(student);
                using var form = new MultipartFormDataContent
                    { { new StringContent(Guid.NewGuid().ToString()), "requestId" } };
                using var recording = await student.PostAsync(
                    $"/api/student/learning/slots/{Guid.NewGuid()}/shadowing/completion", form);
                Assert(response.StatusCode == HttpStatusCode.Forbidden &&
                    ai.StatusCode == HttpStatusCode.Forbidden &&
                    recording.StatusCode == HttpStatusCode.Forbidden,
                    "removed_student_role_still_reads_or_writes_learning_data");
            });
            return failures == 0 ? 0 : 1;
        }
        if (args.SequenceEqual(new[] { "--voice-budget-check" }))
        {
            await Check("Daily voice budget persists and rejects requests beyond the limit",
                VoiceBudgetChecks.RunAsync);
            return failures == 0 ? 0 : 1;
        }
        if (args.SequenceEqual(new[] { "--auth-rate-check" }))
        {
            var apiRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
            using var authLogs = new SafeLogs();
            using var app = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), authLogs);
            await app.SetupAsync();
            await Check("Unknown-account login attempts are rate limited", async () =>
            {
                using var client = app.Client();
                await app.RefreshCsrfAsync(client);
                for (var attempt = 0; attempt < 20; attempt++)
                {
                    using var response = await client.PostAsJsonAsync("/api/auth/login",
                        new { email = "absent@v2-test.invalid", password = app.Password });
                    Assert(response.StatusCode == HttpStatusCode.Unauthorized,
                        "unexpected_login_result_before_limit");
                }
                using var limited = await client.PostAsJsonAsync("/api/auth/login",
                    new { email = "absent@v2-test.invalid", password = app.Password });
                Assert(limited.StatusCode == HttpStatusCode.TooManyRequests,
                    "unknown_account_attempts_not_limited");
            });
            await Check("Valid school logins remain available behind one public IP", async () =>
            {
                for (var attempt = 0; attempt < 25; attempt++)
                {
                    using var student = await app.LoginAsync("student");
                    using var role = await student.GetAsync("/api/auth/check/student");
                    Assert(role.StatusCode == HttpStatusCode.OK,
                        "successful_school_login_limited_" + attempt);
                }
            });
            await Check("API responses have browser security and private cache headers", async () =>
            {
                using var client = app.Client();
                using var response = await client.GetAsync("/api/auth/session");
                Assert(response.Headers.TryGetValues("X-Content-Type-Options", out var nosniff) &&
                    nosniff.Single() == "nosniff", "missing_nosniff");
                Assert(response.Headers.TryGetValues("X-Frame-Options", out var frame) &&
                    frame.Single() == "DENY", "missing_frame_protection");
                Assert(response.Headers.TryGetValues("Content-Security-Policy", out var csp) &&
                    csp.Single().Contains("frame-ancestors 'none'") &&
                    csp.Single().Contains("script-src 'self'") &&
                    csp.Single().Contains("script-src-attr 'none'") &&
                    csp.Single().Contains("connect-src 'self' http://127.0.0.1:43127") &&
                    csp.Single().Contains("form-action 'self'"), "missing_script_or_connect_csp");
                Assert(response.Headers.CacheControl?.NoStore == true, "private_api_response_cached");
            });
            await Check("Removing an admin's live role blocks the old cookie on all admin routes", async () =>
            {
                using var revokedApp = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), authLogs);
                await revokedApp.SetupAsync();
                using var client = await revokedApp.LoginAsync("admin");
                using var before = await client.GetAsync("/api/admin/shadowing/lessons");
                Assert(before.StatusCode == HttpStatusCode.OK, "admin_read_before_revocation_failed");
                using (var scope = revokedApp.Services.CreateScope())
                {
                    var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                    var account = await users.FindByEmailAsync("admin@v2-test.invalid");
                    Assert(account is not null &&
                        (await users.RemoveFromRoleAsync(account, "Admin")).Succeeded,
                        "admin_role_revocation_failed");
                }
                using var read = await client.GetAsync("/api/admin/shadowing/lessons");
                using var report = await client.GetAsync("/api/admin/diagnostics/traffic");
                using var write = await client.PostAsJsonAsync("/api/admin/shadowing/curriculums",
                    new { requestId = Guid.NewGuid(), name = "Revoked admin", description = "" });
                Assert(read.StatusCode == HttpStatusCode.Forbidden &&
                    report.StatusCode == HttpStatusCode.Forbidden &&
                    write.StatusCode == HttpStatusCode.Forbidden,
                    "stale_admin_cookie_retained_access");
            });
            using var uploadApp = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), authLogs);
            await uploadApp.SetupAsync();
            await Check("Oversized student recordings are rejected before form parsing", async () =>
            {
                using var client = await uploadApp.LoginAsync("student");
                using var request = new HttpRequestMessage(HttpMethod.Post,
                    $"/api/student/learning/slots/{Guid.NewGuid()}/shadowing/completion");
                request.Content = new ByteArrayContent([]);
                request.Content.Headers.ContentLength = 8 * 1024 * 1024 + 128 * 1024 + 1;
                using var response = await client.SendAsync(request);
                Assert(response.StatusCode == HttpStatusCode.RequestEntityTooLarge,
                    "large_recording_not_rejected_early");
            });
            await Check("Chunked student uploads without Content-Length stop at the body limit", async () =>
            {
                using var client = await uploadApp.LoginAsync("student");
                using var form = new MultipartFormDataContent();
                var recording = new ByteArrayContent(new byte[8 * 1024 * 1024 + 128 * 1024 + 1]);
                recording.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/webm");
                form.Add(recording, "recording", "large.webm");
                using var request = new HttpRequestMessage(HttpMethod.Post,
                    $"/api/student/learning/slots/{Guid.NewGuid()}/shadowing/completion")
                { Content = form };
                request.Headers.TransferEncodingChunked = true;
                request.Content.Headers.ContentLength = null;
                Assert(request.Content.Headers.ContentLength is null, "chunked_upload_has_content_length");
                using var response = await client.SendAsync(request);
                Assert(response.StatusCode == HttpStatusCode.RequestEntityTooLarge,
                    "chunked_upload_limit_status_" + response.StatusCode);
            });
            await Check("Several individually valid chunks cannot exceed the whole recording request limit", async () =>
            {
                using var client = await uploadApp.LoginAsync("student");
                using var form = new MultipartFormDataContent();
                for (var index = 0; index < 2; index++)
                {
                    var part = new ByteArrayContent(new byte[5 * 1024 * 1024]);
                    part.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/webm");
                    form.Add(part, $"recording{index}", $"part{index}.webm");
                }
                using var request = new HttpRequestMessage(HttpMethod.Post,
                    $"/api/student/learning/slots/{Guid.NewGuid()}/shadowing/completion")
                { Content = form };
                request.Headers.TransferEncodingChunked = true;
                request.Content.Headers.ContentLength = null;
                using var response = await client.SendAsync(request);
                Assert(response.StatusCode == HttpStatusCode.RequestEntityTooLarge,
                    "multipart_aggregate_limit_status_" + response.StatusCode);
            });
            using var demo = new MediaApp(apiRoot, new DisabledShadowingMediaStore(), authLogs,
                environment: "Demo");
            await demo.SetupAsync();
            await Check("Demo login limiter separates trusted tunnel visitor addresses", async () =>
            {
                using var client = demo.Client();
                await demo.RefreshCsrfAsync(client);
                async Task<HttpStatusCode> LoginFrom(string visitorIp)
                {
                    using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login");
                    request.Headers.Add("CF-Connecting-IP", visitorIp);
                    request.Headers.Add("X-Forwarded-Proto", "https");
                    request.Content = JsonContent.Create(new
                    { email = "absent@v2-test.invalid", password = demo.Password });
                    using var response = await client.SendAsync(request);
                    return response.StatusCode;
                }
                for (var attempt = 0; attempt < 20; attempt++)
                    Assert(await LoginFrom("203.0.113.10") == HttpStatusCode.Unauthorized,
                        "visitor_limited_too_early");
                Assert(await LoginFrom("203.0.113.10") == HttpStatusCode.TooManyRequests,
                    "first_visitor_not_limited");
                Assert(await LoginFrom("203.0.113.11") == HttpStatusCode.Unauthorized,
                    "independent_visitor_shared_limit");
            });
            return failures == 0 ? 0 : 1;
        }
        if (args.SequenceEqual(new[] { "--curriculum-migrations" }))
            return await CurriculumMigrationChecks.RunAsync(Check, () => failures);
        if (args.SequenceEqual(new[] { "--ai-text-check" }))
            return await AiTextChecks.RunAsync(Check, () => failures);
        if (args.SequenceEqual(new[] { "--voice-fallback-check" }))
            return await VoiceFallbackChecks.RunAsync(Check, () => failures);
        if (args.SequenceEqual(new[] { "--ai-publication-check" }))
            return await AiPublicationChecks.RunAsync(Check, () => failures);
        if (args.SequenceEqual(new[] { "--shadowing-save-check" }))
            return await ShadowingSaveChecks.RunAsync(Check, () => failures);
        var api = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
        Assert(File.Exists(Path.Combine(api, "ShadowingEnglish.Api.csproj")), "Run from the V2 root.");
        await Check("Uncaught exceptions return redacted diagnostics", async () =>
        {
            const string marker = "password=synthetic-secret-token=private-cookie=lesson-transcript";
            using var logs = new SafeLogs();
            using var logFactory = LoggerFactory.Create(builder => builder.AddProvider(logs));
            var context = new DefaultHttpContext();
            context.TraceIdentifier = "safe-trace-id";
            context.Response.Body = new MemoryStream();
            var middleware = new SafeExceptionMiddleware(
                _ => Task.FromException(new InvalidOperationException(marker)),
                logFactory.CreateLogger<SafeExceptionMiddleware>());
            await middleware.InvokeAsync(context);
            context.Response.Body.Position = 0;
            var response = await new StreamReader(context.Response.Body).ReadToEndAsync();
            Assert(context.Response.StatusCode == StatusCodes.Status500InternalServerError &&
                response.Contains("internal_error") && response.Contains("safe-trace-id"),
                "uncaught_exception_response_contract_invalid");
            Assert(!response.Contains(marker) && !logs.Messages.Any(message => message.Contains(marker)),
                "uncaught_exception_details_leaked");
            Assert(logs.Messages.Any(message => message.Contains("ErrorCode=internal_error") &&
                message.Contains("ErrorType=InvalidOperationException") && message.Contains("DurationMs=")),
                "safe_exception_diagnostics_missing");
        });
        var wave = await File.ReadAllBytesAsync(Path.Combine(api, "DevelopmentMedia/day2-hello.wav"));
        // Microsoft's documented Azurite development key. Never a user/storage-account secret.
        const string emulatorKey = "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
        var connection = Environment.GetEnvironmentVariable("V2_MEDIA_TEST_CONNECTION_STRING") ??
            $"DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey={emulatorKey};BlobEndpoint=http://127.0.0.1:10027/devstoreaccount1;";
        var reads = new BlobTraffic();
        var options = new BlobClientOptions { Transport = new HttpClientTransport(new HttpClient(reads)) };
        options.Retry.MaxRetries = 0;
        options.Diagnostics.IsLoggingEnabled = false;
        options.Diagnostics.IsDistributedTracingEnabled = false;
        var service = new BlobServiceClient(connection, options);
        Assert(service.Uri.IsLoopback && service.Uri.Scheme == "http", "Tests accept loopback Azurite only.");
        var container = service.GetBlobContainerClient("v2media-" + Guid.NewGuid().ToString("N"));
        var publicContainer = service.GetBlobContainerClient("v2public-" + Guid.NewGuid().ToString("N"));
        var logs = new SafeLogs();
        using var logFactory = LoggerFactory.Create(builder => builder.AddProvider(logs));
        var store = new AzureBlobShadowingMediaStore(container, logFactory.CreateLogger<AzureBlobShadowingMediaStore>());
        try
        {
            await Check("WAV structure rejects forged, truncated and empty audio", async () =>
            {
                Assert(await ValidWave(wave), "real_wave_rejected");
                var forged = wave.ToArray(); forged[4] ^= 1;
                Assert(!await ValidWave(forged), "forged_riff_accepted");
                Assert(!await ValidWave(wave[..^1]), "truncated_wave_accepted");
                var wrongFormat = wave.ToArray(); wrongFormat[22] = 0;
                Assert(!await ValidWave(wrongFormat), "zero_channels_accepted");
                var signatureOnly = new byte[12]; wave[..12].CopyTo(signatureOnly, 0);
                Assert(!await ValidWave(signatureOnly), "signature_only_accepted");
            });
            await Check("Production refuses local storage, plaintext endpoints and URL credentials", () =>
            {
                var environment = new TestEnvironment(api, "Production");
                foreach (var configuration in new Dictionary<string, string?>[]
                {
                    new(), new() { ["Media:Provider"] = "DevelopmentLocal", ["Media:LocalRoot"] = api },
                    new() { ["Media:Provider"] = "DemoLocal", ["Media:LocalRoot"] = api },
                    new() { ["Media:Provider"] = "AzureBlob", ["Media:AzureBlob:Container"] = "lessons",
                        ["Media:AzureBlob:ConnectionString"] = connection },
                    new() { ["Media:Provider"] = "AzureBlob", ["Media:AzureBlob:Container"] = "lessons",
                        ["Media:AzureBlob:ServiceUri"] = "https://example.blob.core.windows.net/?sig=invalid" },
                    new() { ["Media:Provider"] = "AzureBlob", ["Media:AzureBlob:Container"] = "lessons",
                        ["Media:AzureBlob:ServiceUri"] = "https://untrusted.example/" },
                    new() { ["Media:Provider"] = "AzureBlob", ["Media:AzureBlob:Container"] = "lessons",
                        ["Media:AzureBlob:ServiceUri"] = "https://example.blob.core.windows.net/",
                        ["Media:AzureBlob:ConnectionString"] = connection }
                }) Assert(!ShadowingMediaStoreFactory.Create(environment,
                    new ConfigurationBuilder().AddInMemoryCollection(configuration).Build(), logFactory).IsConfigured,
                    "unsafe_production_configuration_accepted");
                return Task.CompletedTask;
            });
            // Explicit isolated test setup. The application never creates containers at startup or GET.
            await container.CreateAsync(PublicAccessType.None);
            await publicContainer.CreateAsync(PublicAccessType.Blob);
            var sentinel = "lesson-" + Guid.NewGuid().ToString("N") + ".wav";
            await Check("Private blobs retain SHA-256, seek lazily and cannot be overwritten", async () =>
            {
                await store.WriteAsync(sentinel, new MemoryStream(wave), default);
                var blob = container.GetBlobClient("shadowing-v2/" + sentinel);
                var properties = (await blob.GetPropertiesAsync()).Value;
                Assert(properties.ContentType == "audio/wav" && properties.ContentLength == wave.Length,
                    "blob_properties_invalid");
                Assert(properties.Metadata["sha256"] == Convert.ToHexStringLower(SHA256.HashData(wave)), "blob_hash_invalid");
                Assert(await store.MatchesAsync(sentinel, new MemoryStream(wave), default), "same_hash_rejected");
                var changed = wave.ToArray(); changed[^1] ^= 1;
                Assert(!await store.MatchesAsync(sentinel, new MemoryStream(changed), default), "changed_hash_accepted");
                var rejected = false;
                try { await store.WriteAsync(sentinel, new MemoryStream(changed), default); }
                catch (MediaStorageUnavailableException) { rejected = true; }
                Assert(rejected && await store.MatchesAsync(sentinel, new MemoryStream(wave), default), "immutable_blob_overwritten");
                var opened = await store.OpenAsync(sentinel, default);
                Assert(opened is not null && opened.Content.CanSeek, "blob_stream_cannot_seek");
                await using var content = opened!.Content;
                content.Seek(100, SeekOrigin.Begin); var small = new byte[10];
                await content.ReadExactlyAsync(small);
                Assert(small.SequenceEqual(wave[100..110]), "range_data_invalid");
                Assert(await store.OpenAsync("lesson-missing.wav", default) is null, "missing_blob_not_null");
            });
            await Check("Public containers and unauthenticated direct blob access are rejected", async () =>
            {
                var publicStore = new AzureBlobShadowingMediaStore(publicContainer,
                    logFactory.CreateLogger<AzureBlobShadowingMediaStore>());
                var rejected = false;
                try { await publicStore.WriteAsync(sentinel, new MemoryStream(wave), default); }
                catch (MediaStorageUnavailableException) { rejected = true; }
                Assert(rejected, "public_container_accepted");
                using var http = new HttpClient();
                using var anonymous = await http.GetAsync(container.GetBlobClient("shadowing-v2/" + sentinel).Uri);
                Assert(anonymous.StatusCode != HttpStatusCode.OK, "private_blob_anonymously_accessible");
            });
            using var app = new MediaApp(api, store, logs);
            await app.SetupAsync();
            using var admin = await app.LoginAsync("admin");
            using var student = await app.LoginAsync("student");
            using var other = await app.LoginAsync("other");
            using var anonymousApp = app.Client();
            var saveId = Guid.NewGuid(); var versionId = Guid.Empty; var slotId = Guid.Empty;
            var publishId = Guid.NewGuid();
            var curriculumId = Guid.NewGuid();
            var draftRevision = Guid.Empty;
            var assignmentRevision = Guid.Empty;
            await Check("Real Identity roles and CSRF protect authoring", async () =>
            {
                using var anonymous = await anonymousApp.PostAsync("/api/admin/shadowing/lessons", Upload(Guid.NewGuid(), wave));
                Assert(anonymous.StatusCode == HttpStatusCode.Unauthorized, "anonymous_authoring_allowed");
                using var forbidden = await student.PostAsync("/api/admin/shadowing/lessons", Upload(Guid.NewGuid(), wave));
                Assert(forbidden.StatusCode == HttpStatusCode.Forbidden, "student_authoring_allowed");
                var csrf = admin.DefaultRequestHeaders.GetValues("X-XSRF-TOKEN").Single();
                admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
                using var noToken = await admin.PostAsync("/api/admin/shadowing/lessons", Upload(Guid.NewGuid(), wave));
                admin.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf);
                Assert(noToken.StatusCode == HttpStatusCode.BadRequest, "csrf_missing_allowed");
            });
            await Check("Admin curriculum reads enforce roles, distinguish missing groups and leave empty groups unchanged", async () =>
            {
                var path = $"/api/admin/shadowing/groups/{app.GroupId}/curriculum";
                var before = await app.FingerprintAsync(); var assets = await BlobFingerprint(container);
                using var anonymous = await anonymousApp.GetAsync(path);
                using var forbidden = await student.GetAsync(path);
                Assert(anonymous.StatusCode == HttpStatusCode.Unauthorized && forbidden.StatusCode == HttpStatusCode.Forbidden,
                    "curriculum_read_roles_not_enforced");
                using var missing = await admin.GetAsync($"/api/admin/shadowing/groups/{Guid.NewGuid()}/curriculum");
                Assert(missing.StatusCode == HttpStatusCode.NotFound &&
                    (await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString() == "group_not_found",
                    "missing_curriculum_group_not_distinguished");
                using var empty = await admin.GetAsync(path);
                Assert(empty.StatusCode == HttpStatusCode.OK && empty.Headers.CacheControl?.NoStore == true,
                    "empty_curriculum_read_or_cache_invalid");
                var result = await empty.Content.ReadFromJsonAsync<JsonElement>();
                Assert(result.GetProperty("groupId").GetGuid() == app.GroupId &&
                    result.GetProperty("versionId").ValueKind == JsonValueKind.Null &&
                    result.GetProperty("lessons").GetArrayLength() == 0, "empty_curriculum_fabricated_publication");
                Assert(before == await app.FingerprintAsync() && assets == await BlobFingerprint(container),
                    "curriculum_get_mutated_empty_group");
            });
            await Check("GETs leave database rows and blob versions unchanged", async () =>
            {
                var before = await app.FingerprintAsync(); var assets = await BlobFingerprint(container);
                foreach (var (client, path) in new[] { (admin, "/api/admin/shadowing/lessons?page=1"),
                    (admin, "/api/admin/shadowing/groups?page=1"), (student, "/api/student/learning/curriculum"),
                    (student, "/api/auth/session"), (student, "/api/auth/csrf") })
                {
                    using var response = await client.GetAsync(path);
                    Assert(response.IsSuccessStatusCode, "read_failed_" + response.StatusCode);
                }
                Assert(before == await app.FingerprintAsync() && assets == await BlobFingerprint(container), "get_mutated_state");
            });
            await Check("A malformed second WAV produces no first upload or SQL rows", async () =>
            {
                var before = await app.FingerprintAsync(); var assets = await BlobFingerprint(container);
                using var invalid = await admin.PostAsync("/api/admin/shadowing/lessons", Upload(Guid.NewGuid(), wave, new byte[50]));
                Assert(invalid.StatusCode == HttpStatusCode.BadRequest, "invalid_wave_not_rejected");
                Assert(before == await app.FingerprintAsync() && assets == await BlobFingerprint(container), "invalid_upload_persisted");
            });
            await Check("Production Save stores reviewed audio without publishing it", async () =>
            {
                using var response = await admin.PostAsync("/api/admin/shadowing/lessons", Upload(saveId, wave));
                Assert(response.StatusCode == HttpStatusCode.Created, "save_status_" + response.StatusCode);
                var saved = await response.Content.ReadFromJsonAsync<JsonElement>();
                versionId = saved.GetProperty("versionId").GetGuid();
                using var beforePublish = await student.GetAsync("/api/student/learning/curriculum");
                var curriculum = await beforePublish.Content.ReadFromJsonAsync<JsonElement>();
                Assert(curriculum.GetProperty("items").GetArrayLength() == 0, "save_published_implicitly");
            });
            await Check("Save retries compare real blob bytes without duplicate lessons", async () =>
            {
                var before = await app.FingerprintAsync(); var assets = await BlobFingerprint(container);
                using var retry = await admin.PostAsync("/api/admin/shadowing/lessons", Upload(saveId, wave));
                Assert(retry.StatusCode == HttpStatusCode.OK, "save_retry_status_" + retry.StatusCode);
                var changed = wave.ToArray(); changed[^1] ^= 1;
                using var conflict = await admin.PostAsync("/api/admin/shadowing/lessons", Upload(saveId, changed));
                Assert(conflict.StatusCode == HttpStatusCode.Conflict, "changed_retry_accepted");
                Assert(before == await app.FingerprintAsync() && assets == await BlobFingerprint(container), "retry_mutated_state");
            });
            await Check("Explicit Publish makes a lesson visible and retry is idempotent", async () =>
            {
                using var created = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums", new
                    { requestId = curriculumId, name = "Prepared curriculum", description = "" });
                Assert(created.StatusCode == HttpStatusCode.Created, "curriculum_setup_failed");
                draftRevision = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("draftRevision").GetGuid();
                using var saved = await admin.PutAsJsonAsync($"/api/admin/shadowing/curriculums/{curriculumId}", new
                {
                    requestId = Guid.NewGuid(), expectedDraftRevision = draftRevision, name = "Prepared curriculum", description = "",
                    lessons = new[] { new { lessonVersionId = versionId, weekNumber = 1, dayNumber = 1, sortOrder = 1 } }
                });
                Assert(saved.StatusCode == HttpStatusCode.OK, "curriculum_save_setup_failed");
                draftRevision = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("draftRevision").GetGuid();
                using var assigned = await admin.PutAsJsonAsync($"/api/admin/shadowing/groups/{app.GroupId}/curriculum-assignment", new
                    { requestId = Guid.NewGuid(), curriculumTemplateId = curriculumId, expectedAssignmentRevision = Guid.Empty });
                Assert(assigned.StatusCode == HttpStatusCode.OK, "curriculum_assignment_setup_failed");
                assignmentRevision = (await assigned.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("assignmentRevision").GetGuid();
                var request = new { requestId = publishId, groupId = app.GroupId,
                    curriculumTemplateId = curriculumId, expectedDraftRevision = draftRevision,
                    expectedAssignmentRevision = assignmentRevision, expectedVersionId = (Guid?)null };
                using var publish = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", request);
                Assert(publish.StatusCode == HttpStatusCode.Created, "publish_status_" + publish.StatusCode);
                var before = await app.FingerprintAsync();
                using var retry = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", request);
                Assert(retry.StatusCode == HttpStatusCode.OK && before == await app.FingerprintAsync(), "publish_retry_mutated_state");
                using var curriculum = await student.GetAsync("/api/student/learning/curriculum");
                var cards = (await curriculum.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items");
                Assert(cards.GetArrayLength() == 1,
                    "published_lesson_invisible");
                slotId = cards[0].GetProperty("slotId").GetGuid();
                using var overview = await student.GetAsync($"/api/student/learning/slots/{slotId}");
                var overviewData = await overview.Content.ReadFromJsonAsync<JsonElement>();
                Assert(overviewData.GetProperty("studentId").GetGuid() != Guid.Empty,
                    "recording_owner_missing_from_overview");
                using var segment = await student.GetAsync($"/api/student/learning/slots/{slotId}/segments/1");
                Assert(segment.StatusCode == HttpStatusCode.OK, "published_segment_invisible");
                using var adminCurriculum = await admin.GetAsync($"/api/admin/shadowing/groups/{app.GroupId}/curriculum");
                Assert(adminCurriculum.StatusCode == HttpStatusCode.OK, "published_admin_curriculum_read_failed");
                var current = await adminCurriculum.Content.ReadFromJsonAsync<JsonElement>();
                Assert(current.GetProperty("versionId").GetGuid() == publishId &&
                    current.GetProperty("lessons")[0].GetProperty("lessonVersionId").GetGuid() == versionId,
                    "admin_curriculum_not_current_publication");
            });
            await Check("Authorized audio remains scoped and cannot be reused from the browser cache", async () =>
            {
                var url = $"/api/student/learning/slots/{slotId}/segments/1/audio";
                var before = await app.FingerprintAsync(); var assets = await BlobFingerprint(container);
                using var full = await student.GetAsync(url);
                Assert(full.StatusCode == HttpStatusCode.OK && (await full.Content.ReadAsByteArrayAsync()).SequenceEqual(wave),
                    "full_audio_invalid");
                Assert(full.Headers.CacheControl?.NoStore == true, "student_audio_cacheable_after_account_change");
                reads.Reads.Clear();
                using var request = new HttpRequestMessage(HttpMethod.Get, url); request.Headers.Range = new(0, 43);
                using var range = await student.SendAsync(request);
                Assert(range.StatusCode == HttpStatusCode.PartialContent &&
                    (await range.Content.ReadAsByteArrayAsync()).SequenceEqual(wave[..44]), "audio_range_invalid");
                Assert(reads.Reads.Where(x => x.Method == "GET").All(x => x.Bytes <= 65536), "range_downloaded_full_blob");
                reads.Reads.Clear();
                using var conditional = new HttpRequestMessage(HttpMethod.Get, url);
                conditional.Headers.IfNoneMatch.Add(full.Headers.ETag!);
                using var cached = await student.SendAsync(conditional);
                Assert(cached.StatusCode == HttpStatusCode.NotModified && !reads.Reads.Any(x => x.Method == "GET"),
                    "conditional_request_downloaded_blob");
                using var invalidRange = new HttpRequestMessage(HttpMethod.Get, url);
                invalidRange.Headers.Range = new(wave.Length + 1, wave.Length + 2);
                using var outside = await student.SendAsync(invalidRange);
                Assert(outside.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable, "invalid_range_accepted");
                Assert(before == await app.FingerprintAsync() && assets == await BlobFingerprint(container), "audio_get_mutated_state");
            });
            await Check("Another group and anonymous requests cannot access published audio", async () =>
            {
                reads.Reads.Clear();
                var url = $"/api/student/learning/slots/{slotId}/segments/1/audio";
                using var forbidden = await other.GetAsync(url);
                using var anonymous = await anonymousApp.GetAsync(url);
                Assert(forbidden.StatusCode == HttpStatusCode.NotFound && anonymous.StatusCode == HttpStatusCode.Unauthorized,
                    "audio_scope_not_enforced");
                Assert(reads.Reads.Count == 0, "unauthorized_request_reached_blob");
            });
            await Check("Student progress persists idempotently and prevents silent republishing", async () =>
            {
                await app.RefreshCsrfAsync(student);
                var url = $"/api/student/learning/slots/{slotId}/progress";
                foreach (var completed in new[] { 1, 2 })
                {
                    using var save = await student.PutAsJsonAsync(url, new { completedSegments = completed });
                    Assert(save.StatusCode == HttpStatusCode.OK, "progress_save_failed");
                }
                var before = await app.FingerprintAsync();
                using var retry = await student.PutAsJsonAsync(url, new { completedSegments = 2 });
                Assert(retry.StatusCode == HttpStatusCode.OK && before == await app.FingerprintAsync(), "progress_retry_mutated_state");
                using var overview = await student.GetAsync($"/api/student/learning/slots/{slotId}");
                Assert((await overview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("isComplete").GetBoolean(), "progress_not_restored");
                using var publish = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", new {
                    requestId = Guid.NewGuid(), groupId = app.GroupId, curriculumTemplateId = curriculumId,
                    expectedDraftRevision = draftRevision, expectedAssignmentRevision = assignmentRevision, expectedVersionId = publishId });
                Assert(publish.StatusCode == HttpStatusCode.Conflict && before == await app.FingerprintAsync(),
                    "republish_changed_active_progress");
            });
            await Check("Retired legacy publish requires curriculum assignment and leaves state unchanged", async () =>
            {
                using var orderedApp = new MediaApp(api, store, logs);
                await orderedApp.SetupAsync(); using var writer = await orderedApp.LoginAsync("admin");
                using var save = await writer.PostAsync("/api/admin/shadowing/lessons", Upload(Guid.NewGuid(), wave));
                Assert(save.StatusCode == HttpStatusCode.Created, "legacy_publish_setup_save_failed");
                var lesson = await save.Content.ReadFromJsonAsync<JsonElement>();
                var before = await orderedApp.FingerprintAsync();
                var assets = await BlobFingerprint(container);
                using var publish = await writer.PostAsJsonAsync("/api/admin/shadowing/publish", new {
                    requestId = Guid.NewGuid(), groupId = orderedApp.GroupId,
                    lessonVersionId = lesson.GetProperty("versionId").GetGuid(), expectedVersionId = (Guid?)null,
                    weekNumber = 1, dayNumber = 1, sortOrder = 1 });
                var result = await publish.Content.ReadFromJsonAsync<JsonElement>();
                Assert(publish.StatusCode == HttpStatusCode.Conflict &&
                    result.GetProperty("error").GetString() == "curriculum_publish_required",
                    "legacy_publish_bypassed_curriculum_assignment");
                Assert(before == await orderedApp.FingerprintAsync() && assets == await BlobFingerprint(container),
                    "legacy_publish_mutated_database_or_audio");
            });
            await Check("A failed second blob upload rolls back only that attempt", async () =>
            {
                var assets = await BlobFingerprint(container);
                using var failingApp = new MediaApp(api, new FailSecondWrite(store), logs);
                await failingApp.SetupAsync(); using var writer = await failingApp.LoginAsync("admin");
                var before = await failingApp.FingerprintAsync();
                using var failed = await writer.PostAsync("/api/admin/shadowing/lessons", Upload(Guid.NewGuid(), wave));
                Assert(failed.StatusCode == HttpStatusCode.ServiceUnavailable, "storage_failure_not_503");
                Assert(before == await failingApp.FingerprintAsync() && assets == await BlobFingerprint(container),
                    "failed_save_left_sql_or_blobs_or_deleted_other_assets");
            });
            await Check("A commit with a lost response retains its audio and the same save can be retried", async () =>
            {
                using var uncertain = new MediaApp(api, store, logs, new CommitThenDisconnect());
                await uncertain.SetupAsync(); using var writer = await uncertain.LoginAsync("admin");
                var id = Guid.NewGuid();
                using var lost = await writer.PostAsync("/api/admin/shadowing/lessons", Upload(id, wave));
                Assert(lost.StatusCode == HttpStatusCode.InternalServerError, "simulated_commit_response_not_lost");
                var lostBody = await lost.Content.ReadAsStringAsync();
                Assert(!lostBody.Contains(CommitThenDisconnect.SensitiveMarker), "caught_exception_response_leaked");
                var leakingCategories = logs.Messages
                    .Where(message => message.Contains(CommitThenDisconnect.SensitiveMarker))
                    .Select(message => message.Split(':', 2)[0]).Distinct().ToArray();
                Assert(leakingCategories.Length == 0,
                    "caught_exception_log_leaked:" + string.Join(",", leakingCategories));
                var committedRows = await uncertain.FingerprintAsync(); var committedAssets = await BlobFingerprint(container);
                using var retry = await writer.PostAsync("/api/admin/shadowing/lessons", Upload(id, wave));
                Assert(retry.StatusCode == HttpStatusCode.OK && committedRows == await uncertain.FingerprintAsync() &&
                    committedAssets == await BlobFingerprint(container), "uncertain_commit_audio_deleted_or_retry_duplicated");
            });
            await Check("Unconfigured Production returns 503 and safe diagnostics omit secrets and text", async () =>
            {
                using var disabled = new MediaApp(api, new DisabledShadowingMediaStore(), logs);
                await disabled.SetupAsync(); using var writer = await disabled.LoginAsync("admin");
                var before = await disabled.FingerprintAsync();
                using var blocked = await writer.PostAsync("/api/admin/shadowing/lessons", Upload(Guid.NewGuid(), wave));
                Assert(blocked.StatusCode == HttpStatusCode.ServiceUnavailable && before == await disabled.FingerprintAsync(),
                    "unconfigured_host_wrote_data");
                Assert(!logs.Messages.Any(message => message.Contains(emulatorKey) || message.Contains("Hello private transcript") ||
                    message.Contains("AccountKey=") || message.Contains(app.Password)), "sensitive_value_in_logs");
                Assert(logs.Messages.Any(x => x.Contains("Media.Write.Start")) && logs.Messages.Any(x => x.Contains("Media.Write.Success")),
                    "media_diagnostics_missing");
            });
            await CurriculumChecks.RunAsync(api, store, logs, wave, Check);
            await PurgeChecks.RunAsync(api, store, logs, wave, Check);
        }
        finally
        {
            await container.DeleteIfExistsAsync();
            await publicContainer.DeleteIfExistsAsync();
        }
        Console.WriteLine(JsonSerializer.Serialize(new { checks = Results.Count, pass = Results.Count - failures,
            fail = failures, database = "isolated SQLite", storage = "loopback Azurite", checksDetail = Results }));
        return failures == 0 ? 0 : 1;
    }

    private static Task<bool> ValidWave(byte[] data) => WavAudio.IsValidAsync(new MemoryStream(data), data.Length, default);
    private static MultipartFormDataContent Upload(Guid requestId, byte[] first, byte[]? second = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(requestId.ToString()), "requestId" }, { new StringContent("Local prepared lesson"), "title" },
            { new StringContent(""), "description" },
            { new StringContent(JsonSerializer.Serialize(new[] { "Hello private transcript", "Good morning." })), "segments" },
            { new ByteArrayContent(first), "audio0", "first.wav" },
            { new ByteArrayContent(second ?? first), "audio1", "second.wav" }
        };
        return form;
    }
    private static async Task<string> BlobFingerprint(BlobContainerClient container)
    {
        var values = new List<string>();
        await foreach (var blob in container.GetBlobsAsync())
            values.Add(blob.Name + ":" + blob.Properties.ETag + ":" + blob.Properties.ContentLength);
        values.Sort(StringComparer.Ordinal);
        return JsonSerializer.Serialize(values);
    }
}

internal sealed class BlobTraffic : DelegatingHandler
{
    public readonly ConcurrentBag<(string Method, long Bytes)> Reads = [];
    public BlobTraffic() : base(new HttpClientHandler()) { }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        var response = await base.SendAsync(request, cancellation);
        if (request.RequestUri!.AbsolutePath.Contains("/shadowing-v2/"))
            Reads.Add((request.Method.Method, response.Content.Headers.ContentLength ?? 0));
        return response;
    }
}

internal sealed class HealthProbeMediaStore : IShadowingMediaStore
{
    public bool IsConfigured => true;
    public bool Fail { get; set; }
    public int Probes { get; private set; }
    public Task<bool> ExistsAsync(string key, CancellationToken cancellation)
    {
        if (key != "health-probe.wav") throw new InvalidOperationException("unexpected_health_key");
        Probes++;
        if (Fail) throw new MediaStorageUnavailableException();
        return Task.FromResult(false);
    }
    public Task WriteAsync(string key, Stream source, CancellationToken cancellation) =>
        throw new NotSupportedException();
    public Task<bool> MatchesAsync(string key, Stream source, CancellationToken cancellation) =>
        throw new NotSupportedException();
    public Task<ShadowingMediaRead?> OpenAsync(string key, CancellationToken cancellation) =>
        throw new NotSupportedException();
    public Task DeleteAsync(string key, CancellationToken cancellation) =>
        throw new NotSupportedException();
}

internal sealed class MediaApp(string contentRoot, IShadowingMediaStore store, SafeLogs logs,
    SaveChangesInterceptor? interceptor = null, string environment = "Production") : WebApplicationFactory<global::Program>
{
    private readonly SqliteConnection connection = new("Data Source=:memory:");
    public void BreakDatabaseForHealthCheck()
    {
        connection.Close();
        connection.ConnectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(Path.GetTempPath(), "v2-health-missing-" + Guid.NewGuid(), "missing.db"),
            Mode = SqliteOpenMode.ReadOnly
        }.ToString();
    }
    public readonly Guid GroupId = Guid.NewGuid();
    public readonly string Password = "Test!9" + Guid.NewGuid().ToString("N");
    public HttpClient Client() => CreateClient(new WebApplicationFactoryClientOptions
    { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment).UseContentRoot(contentRoot);
        builder.UseSetting("ConnectionStrings:DefaultConnection", "Server=127.0.0.1;Database=UnusedMediaCheck;Integrated Security=true;");
        builder.ConfigureLogging(logging => logging.ClearProviders().SetMinimumLevel(LogLevel.Information)
            .AddFilter("Microsoft", LogLevel.Warning).AddProvider(logs));
        builder.ConfigureServices(services =>
        {
            services.AddDataProtection().UseEphemeralDataProtectionProvider();
            services.RemoveAll<DbContextOptions<ApplicationDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<ApplicationDbContext>>();
            services.RemoveAll<ApplicationDbContext>();
            connection.Open();
            services.AddDbContext<ApplicationDbContext>(options =>
            {
                options.UseSqlite(connection).ReplaceService<IModelCustomizer, UtcTestModelCustomizer>();
                if (interceptor is not null) options.AddInterceptors(interceptor);
            });
            services.RemoveAll<IShadowingMediaStore>();
            services.AddSingleton(store);
        });
    }
    public async Task SetupAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        await db.Database.EnsureCreatedAsync(); // Explicit disposable test database only.
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE PendingLessonMediaDeletions (
                StorageKey TEXT NOT NULL PRIMARY KEY,
                QueuedAtUtc TEXT NOT NULL,
                NextAttemptAtUtc TEXT NOT NULL,
                Attempts INTEGER NOT NULL
            )
            """);
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var role in new[] { "Admin", "Student" })
            if (!(await roles.CreateAsync(new IdentityRole<Guid>(role) { Id = Guid.NewGuid() })).Succeeded)
                throw new InvalidOperationException("test_role_setup_failed");
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var members = new Dictionary<string, ApplicationUser>();
        foreach (var name in new[] { "admin", "student", "other" })
        {
            var user = new ApplicationUser { Id = Guid.NewGuid(), Email = name + "@v2-test.invalid", UserName = name + "@v2-test.invalid" };
            if (!(await users.CreateAsync(user, Password)).Succeeded) throw new InvalidOperationException("test_account_setup_failed");
            await users.AddToRoleAsync(user, name == "admin" ? "Admin" : "Student"); members[name] = user;
        }
        var otherGroup = Guid.NewGuid();
        foreach (var groupId in new[] { GroupId, otherGroup })
            db.StudyGroups.Add(new StudyGroup { Id = groupId, Name = "Isolated group", CreateRequestId = Guid.NewGuid(),
                CreatedAtUtc = DateTimeOffset.UtcNow, CreatedByAdminId = members["admin"].Id });
        foreach (var name in new[] { "student", "other" })
            db.StudentGroupMemberships.Add(new StudentGroupMembership { Id = Guid.NewGuid(), StudentId = members[name].Id,
                GroupId = name == "student" ? GroupId : otherGroup, StartedAtUtc = DateTimeOffset.UtcNow,
                AssignedByAdminId = members["admin"].Id });
        await db.SaveChangesAsync();
    }
    public async Task<HttpClient> LoginAsync(string name)
    {
        var client = Client(); await RefreshCsrfAsync(client);
        using var response = await client.PostAsJsonAsync("/api/auth/login", new { email = name + "@v2-test.invalid", password = Password });
        if (response.StatusCode != HttpStatusCode.OK) throw new InvalidOperationException("test_login_failed_" + response.StatusCode);
        await RefreshCsrfAsync(client); return client;
    }
    public async Task RefreshCsrfAsync(HttpClient client)
    {
        using var response = await client.GetAsync("/api/auth/csrf");
        if (!response.Headers.TryGetValues("Set-Cookie", out var cookies))
            throw new InvalidOperationException("test_csrf_cookie_missing_" + (int)response.StatusCode);
        var cookie = cookies.Single(x => x.StartsWith("XSRF-TOKEN="));
        var token = Uri.UnescapeDataString(cookie.Split(';')[0]["XSRF-TOKEN=".Length..]);
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN"); client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", token);
    }
    public async Task<string> FingerprintAsync()
    {
        var rows = new List<string>();
        var tables = new List<string>();
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) tables.Add(reader.GetString(0));
        }
        foreach (var table in tables)
        {
            using var command = connection.CreateCommand(); command.CommandText = "SELECT * FROM \"" + table.Replace("\"", "\"\"") + "\"";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var values = new object[reader.FieldCount]; reader.GetValues(values);
                rows.Add(table + JsonSerializer.Serialize(values));
            }
        }
        rows.Sort(StringComparer.Ordinal);
        return Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(rows))));
    }
    protected override void Dispose(bool disposing)
    { base.Dispose(disposing); if (disposing) connection.Dispose(); }
}

// SQLite cannot order DateTimeOffset natively. Test-only UTC conversion; production model/migrations stay untouched.
internal sealed class UtcTestModelCustomizer(ModelCustomizerDependencies dependencies) : RelationalModelCustomizer(dependencies)
{
    public override void Customize(ModelBuilder model, DbContext context)
    {
        base.Customize(model, context);
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                if (property.ClrType == typeof(DateTimeOffset) || property.ClrType == typeof(DateTimeOffset?))
                    property.SetValueConverter(new DateTimeOffsetToBinaryConverter());
    }
}

internal sealed class TestEnvironment(string root, string name) : IWebHostEnvironment
{
    public string ApplicationName { get; set; } = "ShadowingEnglish.Api";
    public string EnvironmentName { get; set; } = name;
    public string ContentRootPath { get; set; } = root;
    public string WebRootPath { get; set; } = root;
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
}

internal sealed class FailSecondWrite(IShadowingMediaStore underlying) : IShadowingMediaStore
{
    private int writes;
    public bool IsConfigured => true;
    public Task WriteAsync(string key, Stream source, CancellationToken cancellation) => ++writes == 2
        ? throw new MediaStorageUnavailableException() : underlying.WriteAsync(key, source, cancellation);
    public Task<bool> MatchesAsync(string key, Stream source, CancellationToken cancellation) => underlying.MatchesAsync(key, source, cancellation);
    public Task<bool> ExistsAsync(string key, CancellationToken cancellation) => underlying.ExistsAsync(key, cancellation);
    public Task<ShadowingMediaRead?> OpenAsync(string key, CancellationToken cancellation) => underlying.OpenAsync(key, cancellation);
    public Task DeleteAsync(string key, CancellationToken cancellation) => underlying.DeleteAsync(key, cancellation);
}

internal sealed class CommitThenDisconnect : SaveChangesInterceptor
{
    public const string SensitiveMarker = "password=synthetic-secret-token=private-cookie=lesson-transcript";
    private bool dropped;
    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData data, int result,
        CancellationToken cancellationToken = default)
    {
        if (!dropped && data.Context!.ChangeTracker.Entries<ShadowingEnglish.Core.Learning.LessonDefinition>().Any())
        { dropped = true; throw new IOException(SensitiveMarker); }
        return ValueTask.FromResult(result);
    }
}

internal sealed class SafeLogs : ILoggerProvider
{
    public readonly ConcurrentBag<string> Messages = [];
    public ILogger CreateLogger(string categoryName) => new Capture(this, categoryName);
    public void Dispose() { }
    private sealed class Capture(SafeLogs owner, string categoryName) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? error, Func<TState, Exception?, string> formatter) =>
            owner.Messages.Add(categoryName + ":" + formatter(state, error));
    }
}
