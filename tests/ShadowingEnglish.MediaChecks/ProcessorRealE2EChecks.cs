using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using ShadowingEnglish.Core.Groups;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.MediaChecks;

// Explicit local check. It uses an isolated SQL Server database and the unmodified result of
// the installed WhisperX processor. Neither the database nor its saved WAV files are removed.
internal static class ProcessorRealE2EChecks
{
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }

    public static async Task<int> RunAsync(string manifestPath, Func<string, Func<Task>, Task> check,
        Func<int> failures)
    {
        var apiRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "backend/ShadowingEnglish.Api"));
        var manifestFile = Path.GetFullPath(manifestPath);
        using var document = JsonDocument.Parse(await File.ReadAllBytesAsync(manifestFile));
        var manifest = document.RootElement;
        Assert(manifest.GetProperty("reviewRequired").GetBoolean(), "processor_review_not_required");
        var clips = manifest.GetProperty("segments");
        Assert(clips.GetArrayLength() == 1, "expected_one_real_processor_clip");
        var clip = clips[0];
        var text = clip.GetProperty("text").GetString()!;
        var fileName = clip.GetProperty("audioFile").GetString()!;
        Assert(Regex.IsMatch(fileName, "^segment-[0-9]{2}\\.wav$"), "unexpected_audio_file");
        var wave = await File.ReadAllBytesAsync(Path.Combine(Path.GetDirectoryName(manifestFile)!, fileName));
        Assert(Convert.ToHexStringLower(SHA256.HashData(wave)) == clip.GetProperty("sha256").GetString(),
            "processor_audio_hash_mismatch");

        var original = new ConfigurationBuilder().AddJsonFile(Path.Combine(apiRoot,
            "appsettings.Development.json")).Build().GetConnectionString("DefaultConnection")!;
        var connection = Regex.Replace(original,
            "(?i)(Database|Initial Catalog)=ShadowingEnglishV2(?=;|$)",
            "$1=ShadowingEnglishV2_ProcessorE2E_20261023");
        Assert(connection != original && connection.Contains("ShadowingEnglishV2_ProcessorE2E_20261023"),
            "refusing_nonisolated_database");
        var mediaRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(),
            ".local/processor-e2e-20261023/media"));
        using var app = new SqlProcessorApp(apiRoot, connection, mediaRoot);
        await app.SetupAsync();
        using var admin = await app.LoginAsync("admin");
        using var student = await app.LoginAsync("student");

        var requestId = Guid.NewGuid();
        Guid versionId = Guid.Empty;
        await check("Installed processor WAV saves to real SQL and local media", async () =>
        {
            using var form = new MultipartFormDataContent
            {
                { new StringContent(requestId.ToString()), "requestId" },
                { new StringContent("Processor integration check"), "title" },
                { new StringContent("Real local WhisperX output"), "description" },
                { new StringContent("A1"), "level" },
                { new StringContent("Verify local processing"), "goal" },
                { new StringContent(JsonSerializer.Serialize(new[] { text })), "segments" }
            };
            form.Add(new ByteArrayContent(wave), "audio0", fileName);
            using var response = await admin.PostAsync("/api/admin/shadowing/lessons", form);
            Assert(response.StatusCode == HttpStatusCode.Created,
                "real_processor_save_status_" + (int)response.StatusCode);
            versionId = (await response.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("versionId").GetGuid();
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert(await db.LessonSegments.AnyAsync(x => x.LessonVersionId == versionId && x.Text == text),
                "real_processor_segment_not_in_sql");
        });

        await check("Published real processor audio is available to its student", async () =>
        {
            Assert(versionId != Guid.Empty, "lesson_save_did_not_complete");
            var curriculumId = Guid.NewGuid();
            using var created = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums",
                new { requestId = curriculumId, name = "Processor check", description = "" });
            Assert(created.StatusCode == HttpStatusCode.Created, "curriculum_create_failed");
            var revision = (await created.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("draftRevision").GetGuid();
            using var saved = await admin.PutAsJsonAsync($"/api/admin/shadowing/curriculums/{curriculumId}", new
            {
                requestId = Guid.NewGuid(), expectedDraftRevision = revision,
                name = "Processor check", description = "",
                lessons = new[] { new { lessonVersionId = versionId, weekNumber = 1, dayNumber = 1, sortOrder = 1 } }
            });
            Assert(saved.StatusCode == HttpStatusCode.OK, "curriculum_update_failed");
            revision = (await saved.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("draftRevision").GetGuid();
            using var assigned = await admin.PutAsJsonAsync(
                $"/api/admin/shadowing/groups/{app.GroupId}/curriculum-assignment", new
                { requestId = Guid.NewGuid(), curriculumTemplateId = curriculumId,
                    expectedAssignmentRevision = Guid.Empty });
            Assert(assigned.StatusCode == HttpStatusCode.OK, "curriculum_assignment_failed");
            var assignmentRevision = (await assigned.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("assignmentRevision").GetGuid();
            using var published = await admin.PostAsJsonAsync("/api/admin/shadowing/curriculums/publish", new
            {
                requestId = Guid.NewGuid(), groupId = app.GroupId,
                curriculumTemplateId = curriculumId, expectedDraftRevision = revision,
                expectedAssignmentRevision = assignmentRevision, expectedVersionId = (Guid?)null
            });
            Assert(published.StatusCode == HttpStatusCode.Created, "curriculum_publish_failed");
            using var list = await student.GetAsync("/api/student/learning/curriculum");
            Assert(list.StatusCode == HttpStatusCode.OK, "student_curriculum_failed");
            var items = (await list.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items");
            Assert(items.GetArrayLength() == 1, "published_processor_lesson_not_visible");
            var slotId = items[0].GetProperty("slotId").GetGuid();
            using var audio = await student.GetAsync(
                $"/api/student/learning/slots/{slotId}/segments/1/audio");
            Assert(audio.StatusCode == HttpStatusCode.OK &&
                (await audio.Content.ReadAsByteArrayAsync()).SequenceEqual(wave),
                "published_processor_audio_mismatch");
        });
        return failures() == 0 ? 0 : 1;
    }

    private sealed class SqlProcessorApp(string contentRoot, string connection, string mediaRoot)
        : WebApplicationFactory<global::Program>
    {
        public Guid GroupId { get; } = Guid.NewGuid();
        private readonly string password = "Test!9" + Guid.NewGuid().ToString("N");
        private readonly string suffix = Guid.NewGuid().ToString("N") + "@processor-e2e.invalid";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development").UseContentRoot(contentRoot);
            builder.UseSetting("ConnectionStrings:DefaultConnection", connection);
            builder.UseSetting("Media:Provider", "DevelopmentLocal");
            builder.UseSetting("Media:LocalRoot", mediaRoot);
            builder.ConfigureServices(services =>
            {
                services.AddDataProtection().UseEphemeralDataProtectionProvider();
                services.RemoveAll<IHostedService>();
            });
        }

        public async Task SetupAsync()
        {
            using var scope = Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            await db.Database.MigrateAsync();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
            foreach (var role in new[] { "Admin", "Student" })
                if (!await roles.RoleExistsAsync(role))
                    Assert((await roles.CreateAsync(new IdentityRole<Guid>(role))).Succeeded,
                        "sql_test_role_create_failed");
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var admin = new ApplicationUser { Id = Guid.NewGuid(),
                Email = "admin-" + suffix, UserName = "admin-" + suffix, EmailConfirmed = true };
            var student = new ApplicationUser { Id = Guid.NewGuid(),
                Email = "student-" + suffix, UserName = "student-" + suffix, EmailConfirmed = true };
            foreach (var (user, role) in new[] { (admin, "Admin"), (student, "Student") })
            {
                Assert((await users.CreateAsync(user, password)).Succeeded, "sql_test_user_create_failed");
                Assert((await users.AddToRoleAsync(user, role)).Succeeded, "sql_test_role_assign_failed");
            }
            db.StudyGroups.Add(new StudyGroup { Id = GroupId, Name = "Processor test group",
                CreateRequestId = Guid.NewGuid(), CreatedAtUtc = DateTimeOffset.UtcNow,
                CreatedByAdminId = admin.Id });
            db.StudentGroupMemberships.Add(new StudentGroupMembership { Id = Guid.NewGuid(),
                StudentId = student.Id, GroupId = GroupId, StartedAtUtc = DateTimeOffset.UtcNow,
                AssignedByAdminId = admin.Id });
            await db.SaveChangesAsync();
        }

        public async Task<HttpClient> LoginAsync(string role)
        {
            var client = CreateClient(new WebApplicationFactoryClientOptions
            { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
            await RefreshCsrfAsync(client);
            using var login = await client.PostAsJsonAsync("/api/auth/login",
                new { email = role + "-" + suffix, password });
            Assert(login.StatusCode == HttpStatusCode.OK, "sql_test_login_failed");
            await RefreshCsrfAsync(client);
            return client;
        }

        private static async Task RefreshCsrfAsync(HttpClient client)
        {
            using var csrf = await client.GetAsync("/api/auth/csrf");
            var cookie = csrf.Headers.GetValues("Set-Cookie")
                .Single(x => x.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal));
            var token = Uri.UnescapeDataString(cookie.Split(';')[0]["XSRF-TOKEN=".Length..]);
            client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
            client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", token);
        }
    }
}
