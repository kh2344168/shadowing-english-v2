using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Azure.Core.Pipeline;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.AspNetCore.Hosting;
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

    public static async Task<int> Main()
    {
        var api = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
        Assert(File.Exists(Path.Combine(api, "ShadowingEnglish.Api.csproj")), "Run from the V2 root.");
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
                var request = new { requestId = publishId, groupId = app.GroupId,
                    lessonVersionId = versionId, expectedVersionId = (Guid?)null, weekNumber = 1, dayNumber = 1, sortOrder = 1 };
                using var publish = await admin.PostAsJsonAsync("/api/admin/shadowing/publish", request);
                Assert(publish.StatusCode == HttpStatusCode.Created, "publish_status_" + publish.StatusCode);
                slotId = (await publish.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("slotId").GetGuid();
                var before = await app.FingerprintAsync();
                using var retry = await admin.PostAsJsonAsync("/api/admin/shadowing/publish", request);
                Assert(retry.StatusCode == HttpStatusCode.OK && before == await app.FingerprintAsync(), "publish_retry_mutated_state");
                using var curriculum = await student.GetAsync("/api/student/learning/curriculum");
                Assert((await curriculum.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").GetArrayLength() == 1,
                    "published_lesson_invisible");
                using var segment = await student.GetAsync($"/api/student/learning/slots/{slotId}/segments/1");
                Assert(segment.StatusCode == HttpStatusCode.OK, "published_segment_invisible");
            });
            await Check("Authorized audio returns exact Range, private ETag and 304 without body download", async () =>
            {
                var url = $"/api/student/learning/slots/{slotId}/segments/1/audio";
                var before = await app.FingerprintAsync(); var assets = await BlobFingerprint(container);
                using var full = await student.GetAsync(url);
                Assert(full.StatusCode == HttpStatusCode.OK && (await full.Content.ReadAsByteArrayAsync()).SequenceEqual(wave),
                    "full_audio_invalid");
                Assert(full.Headers.CacheControl?.Private == true && full.Headers.CacheControl.NoCache, "audio_cache_not_private");
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
                using var publish = await admin.PostAsJsonAsync("/api/admin/shadowing/publish", new {
                    requestId = Guid.NewGuid(), groupId = app.GroupId, lessonVersionId = versionId,
                    expectedVersionId = publishId, weekNumber = 1, dayNumber = 2, sortOrder = 1 });
                Assert(publish.StatusCode == HttpStatusCode.Conflict && before == await app.FingerprintAsync(),
                    "republish_changed_active_progress");
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

internal sealed class MediaApp(string contentRoot, IShadowingMediaStore store, SafeLogs logs,
    SaveChangesInterceptor? interceptor = null) : WebApplicationFactory<global::Program>
{
    private readonly SqliteConnection connection = new("Data Source=:memory:");
    public readonly Guid GroupId = Guid.NewGuid();
    public readonly string Password = "Test!9" + Guid.NewGuid().ToString("N");
    public HttpClient Client() => CreateClient(new WebApplicationFactoryClientOptions
    { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Production").UseContentRoot(contentRoot);
        builder.UseSetting("ConnectionStrings:DefaultConnection", "Server=127.0.0.1;Database=UnusedMediaCheck;Integrated Security=true;");
        builder.ConfigureLogging(logging => logging.ClearProviders().SetMinimumLevel(LogLevel.Information)
            .AddFilter("Microsoft", LogLevel.Warning).AddProvider(logs));
        builder.ConfigureServices(services =>
        {
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
        var cookie = response.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("XSRF-TOKEN="));
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
    private bool dropped;
    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData data, int result,
        CancellationToken cancellationToken = default)
    {
        if (!dropped && data.Context!.ChangeTracker.Entries<ShadowingEnglish.Core.Learning.LessonDefinition>().Any())
        { dropped = true; throw new IOException("simulated_commit_disconnect"); }
        return ValueTask.FromResult(result);
    }
}

internal sealed class SafeLogs : ILoggerProvider
{
    public readonly ConcurrentBag<string> Messages = [];
    public ILogger CreateLogger(string categoryName) => new Capture(this);
    public void Dispose() { }
    private sealed class Capture(SafeLogs owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel level) => true;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception? error, Func<TState, Exception?, string> formatter) =>
            owner.Messages.Add(formatter(state, error));
    }
}
