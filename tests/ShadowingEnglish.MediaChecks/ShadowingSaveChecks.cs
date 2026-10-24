using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShadowingEnglish.Api.Modules.Media;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.MediaChecks;

internal static class ShadowingSaveChecks
{
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }

    public static async Task<int> RunAsync(Func<string, Func<Task>, Task> check, Func<int> failures)
    {
        var root = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(),
            "backend/ShadowingEnglish.Api"));
        var wave = await File.ReadAllBytesAsync(Path.Combine(root, "DevelopmentMedia/day2-hello.wav"));
        using var logs = new SafeLogs();
        var media = new MemoryMediaStore();
        using var app = new MediaApp(root, media, logs);
        await app.SetupAsync();
        using var admin = await app.LoginAsync("admin");
        var requestId = Guid.NewGuid();

        MultipartFormDataContent Upload()
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(requestId.ToString()), "requestId" },
                { new StringContent("A1 short story"), "title" },
                { new StringContent("Short beginner story"), "description" },
                { new StringContent("A1"), "level" },
                { new StringContent("Describe a simple day"), "goal" },
                { new StringContent(JsonSerializer.Serialize(Enumerable.Range(1, 12)
                    .Select(index => $"I see word {index}.").ToArray())), "segments" }
            };
            for (var index = 0; index < 12; index++)
                form.Add(new ByteArrayContent(wave), $"audio{index}", $"clip-{index}.wav");
            return form;
        }

        await check("Saving twelve processed Shadowing clips persists lesson and one-stage workflow", async () =>
        {
            using var response = await admin.PostAsync("/api/admin/shadowing/lessons", Upload());
            Assert(response.StatusCode == HttpStatusCode.Created,
                "shadowing_save_failed_" + response.StatusCode);
            var created = await response.Content.ReadFromJsonAsync<JsonElement>();
            var versionId = created.GetProperty("versionId").GetGuid();
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var version = await db.LessonVersions.AsNoTracking().SingleAsync(x => x.Id == versionId);
            var workflow = await db.LessonWorkflows.AsNoTracking()
                .SingleAsync(x => x.LessonVersionId == versionId);
            var stages = JsonDocument.Parse(workflow.StagesJson).RootElement;
            Assert(version.LessonType == "clip" && version.Level == "A1" &&
                version.Goal == "Describe a simple day" &&
                await db.LessonSegments.CountAsync(x => x.LessonVersionId == versionId) == 12 &&
                stages.GetArrayLength() == 1 &&
                stages[0].GetProperty("type").GetString() == "shadowing",
                "shadowing_save_lost_definition_or_stage_data");

            using var retry = await admin.PostAsync("/api/admin/shadowing/lessons", Upload());
            Assert(retry.StatusCode == HttpStatusCode.OK &&
                (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("versionId").GetGuid() == versionId,
                "shadowing_save_retry_not_idempotent");
        });
        await check("Chunked admin lesson create and edit reject aggregate uploads before saving", async () =>
        {
            var before = await app.FingerprintAsync();
            var storedClips = media.Count;
            var payload = new byte[23_000_000];
            foreach (var (method, path) in new[]
            {
                (HttpMethod.Post, "/api/admin/shadowing/lessons"),
                (HttpMethod.Put, $"/api/admin/shadowing/lessons/{requestId}")
            })
            {
                using var form = new MultipartFormDataContent();
                form.Add(new ByteArrayContent(payload), "audio0", "large-0.wav");
                form.Add(new ByteArrayContent(payload), "audio1", "large-1.wav");
                using var request = new HttpRequestMessage(method, path) { Content = form };
                request.Headers.TransferEncodingChunked = true;
                request.Content.Headers.ContentLength = null;
                Assert(request.Content.Headers.ContentLength is null, "admin_chunked_has_length");
                using var response = await admin.SendAsync(request);
                Assert(response.StatusCode == HttpStatusCode.RequestEntityTooLarge,
                    "admin_chunked_limit_" + method + "_" + response.StatusCode);
            }
            Assert(before == await app.FingerprintAsync() && media.Count == storedClips,
                "admin_oversize_upload_saved_data");
        });
        return failures() == 0 ? 0 : 1;
    }

    private sealed class MemoryMediaStore : IShadowingMediaStore
    {
        private readonly ConcurrentDictionary<string, byte[]> data = new();
        public int Count => data.Count;
        public bool IsConfigured => true;
        public async Task WriteAsync(string key, Stream source, CancellationToken cancellation)
        {
            using var target = new MemoryStream();
            await source.CopyToAsync(target, cancellation);
            if (!data.TryAdd(key, target.ToArray())) throw new IOException("duplicate_key");
        }
        public async Task<bool> MatchesAsync(string key, Stream source, CancellationToken cancellation)
        {
            if (!data.TryGetValue(key, out var stored)) return false;
            using var target = new MemoryStream();
            await source.CopyToAsync(target, cancellation);
            return stored.AsSpan().SequenceEqual(target.ToArray());
        }
        public Task<bool> ExistsAsync(string key, CancellationToken cancellation) =>
            Task.FromResult(data.ContainsKey(key));
        public Task<ShadowingMediaRead?> OpenAsync(string key, CancellationToken cancellation) =>
            Task.FromResult(data.TryGetValue(key, out var stored)
                ? new ShadowingMediaRead(new MemoryStream(stored), stored.Length,
                    DateTimeOffset.UtcNow, "\"test\"") : null);
        public Task DeleteAsync(string key, CancellationToken cancellation)
        { data.TryRemove(key, out _); return Task.CompletedTask; }
    }
}
