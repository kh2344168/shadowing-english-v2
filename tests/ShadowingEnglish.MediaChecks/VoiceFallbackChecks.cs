using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using ShadowingEnglish.Api.Modules.AI;
using ShadowingEnglish.Infrastructure.AIProviders;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.MediaChecks;

internal static class VoiceFallbackChecks
{
    public static async Task<int> RunAsync(Func<string, Func<Task>, Task> check, Func<int> failures)
    {
        await check("Student transcription uses the enabled encrypted voice key from the database", async () =>
        {
            await using var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlite(connection)
                .ReplaceService<IModelCustomizer, UtcTestModelCustomizer>().Options;
            await using var db = new ApplicationDbContext(options);
            await db.Database.EnsureCreatedAsync();
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["AiProviders:MasterKey"] = Convert.ToBase64String(new byte[32]) }).Build();
            using var protector = new AiProviderCredentialProtector(config);
            var admin = new ApplicationUser { Id = Guid.NewGuid(), UserName = "voice-test" };
            db.Users.Add(admin);
            var provider = new AiProviderConfiguration
            {
                Id = Guid.NewGuid(), Capability = AiProviderCatalog.Voice, ProviderKey = "groq",
                Enabled = true, Priority = 1, UpdatedByAdminId = admin.Id,
                EncryptedApiKey = protector.Protect("test-db-voice", AiProviderCatalog.Voice, "groq")
            };
            db.AiProviderConfigurations.Add(provider);
            await db.SaveChangesAsync();
            using var handler = new TranscriptionHandler();
            using var http = new HttpClient(handler);
            using var cache = new MemoryCache(new MemoryCacheOptions());
            var voice = new GroqVoiceService(http, config, cache, NullLogger<GroqVoiceService>.Instance, db, protector);
            if (!await voice.IsConfiguredAsync(CancellationToken.None))
                throw new InvalidOperationException("database_voice_key_not_available");
            using var audio = new MemoryStream(new byte[200]);
            var text = await voice.TranscribeAsync(audio, "audio/webm", CancellationToken.None);
            if (text != "Good morning" || handler.Calls != 1)
                throw new InvalidOperationException("database_voice_key_not_used_for_transcription");
            provider.Enabled = false;
            await db.SaveChangesAsync();
            if (await voice.IsConfiguredAsync(CancellationToken.None) ||
                await voice.TranscribeAsync(audio, "audio/webm", CancellationToken.None) is not null || handler.Calls != 1)
                throw new InvalidOperationException("disabled_voice_key_used_for_transcription");
        });
        await check("Natural voice is a separately configurable Groq provider", () =>
        {
            var definition = AiProviderCatalog.Find(AiProviderCatalog.Voice, "groq");
            if (definition is null || !definition.Implemented ||
                !definition.Models.Contains("canopylabs/orpheus-v1-english") ||
                AiProviderCatalog.Find(AiProviderCatalog.Text, "groq") is null)
                throw new InvalidOperationException("voice_provider_not_available");
            return Task.CompletedTask;
        });
        await check("Text provider keys do not enable student voice", () =>
        {
            using var http = new HttpClient(new FailingPrimaryHandler());
            using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 10_000 });
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AiText:Providers:Gemini:ApiKey"] = "text-only",
                ["AiText:Providers:Groq:ApiKey"] = "text-only"
            }).Build();
            if (new GeminiSpeechService(http, config, cache,
                    NullLogger<GeminiSpeechService>.Instance).IsConfigured ||
                new GroqVoiceService(http, config, cache,
                    NullLogger<GroqVoiceService>.Instance).IsConfigured)
                throw new InvalidOperationException("text_key_enabled_voice");
            return Task.CompletedTask;
        });
        await check("Groq voice reports model terms instead of generic speech failure", async () =>
        {
            using var http = new HttpClient(new TermsRequiredHandler());
            using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 10_000 });
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["AiVoice:Groq:ApiKey"] = "test-only" }).Build();
            var service = new GroqVoiceService(http, config, cache,
                NullLogger<GroqVoiceService>.Instance);
            var result = await service.SpeakDetailedAsync("Hello.", "Kore", CancellationToken.None);
            if (result.Audio is not null || result.ErrorCode != "voice_terms_required")
                throw new InvalidOperationException("voice_terms_not_reported");
        });
        await check("Voice connection test actually calls speech and detects required terms", async () =>
        {
            using var http = new HttpClient(new TermsRequiredHandler());
            var tester = new AiProviderConnectionTester(http);
            var result = await tester.TestAsync(new AiProviderConfiguration
            {
                Capability = AiProviderCatalog.Voice, ProviderKey = "groq",
                Model = "canopylabs/orpheus-v1-english"
            }, "test-only", CancellationToken.None);
            if (result.Success || result.Status != "terms_required" ||
                result.FailureReason != "voice_terms_required")
                throw new InvalidOperationException("voice_test_did_not_detect_terms");
        });
        await check("Voice generation falls back to second Gemini model and caches per voice", async () =>
        {
            using var handler = new FailingPrimaryHandler();
            using var http = new HttpClient(handler);
            using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 10_000 });
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            { ["AiVoice:Gemini:ApiKey"] = "test-only" }).Build();
            var service = new GeminiSpeechService(http, config, cache,
                NullLogger<GeminiSpeechService>.Instance);
            var puck = await service.SpeakAsync("Hello there.", "Puck", CancellationToken.None);
            if (puck is null || handler.Requests.Count != 2 ||
                handler.Requests[0] != ("gemini-3.8-flash-tts", "Puck") ||
                handler.Requests[1] != ("gemini-3.8-flash-lite-tts", "Puck"))
                throw new InvalidOperationException("primary_failure_did_not_fall_back");
            var cached = await service.SpeakAsync("Hello there.", "Puck", CancellationToken.None);
            if (cached is null || handler.Requests.Count != 2)
                throw new InvalidOperationException("voice_result_not_cached");
            var kore = await service.SpeakAsync("Hello there.", "Kore", CancellationToken.None);
            if (kore is null || handler.Requests.Count != 4 || handler.Requests[3].Voice != "Kore")
                throw new InvalidOperationException("voice_cache_not_isolated");
        });
        return failures() == 0 ? 0 : 1;
    }

    private sealed class TranscriptionHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            if (request.RequestUri?.AbsolutePath != "/openai/v1/audio/transcriptions" ||
                request.Headers.Authorization?.Parameter != "test-db-voice")
                throw new InvalidOperationException("unexpected_transcription_credentials");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent("{\"text\":\"Good morning\"}", Encoding.UTF8, "application/json") });
        }
    }

    private sealed class FailingPrimaryHandler : HttpMessageHandler
    {
        public List<(string Model, string Voice)> Requests { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            var model = json.RootElement.GetProperty("model").GetString()!;
            var voice = json.RootElement.GetProperty("generation_config")
                .GetProperty("speech_config")[0].GetProperty("voice").GetString()!;
            Requests.Add((model, voice));
            if (model == "gemini-3.8-flash-tts")
                return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
            var wav = new byte[44];
            Encoding.ASCII.GetBytes("RIFF").CopyTo(wav, 0);
            var payload = JsonSerializer.Serialize(new
            {
                steps = new[] { new { type = "model_output", content = new[]
                {
                    new { type = "audio", mime_type = "audio/wav", data = Convert.ToBase64String(wav) }
                } } }
            });
            return new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent(payload, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class TermsRequiredHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.Method != HttpMethod.Post ||
                request.RequestUri?.AbsolutePath != "/openai/v1/audio/speech")
                throw new InvalidOperationException("speech_request_not_sent");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent("{\"error\":{\"message\":\"The model requires terms acceptance.\"}}",
                    Encoding.UTF8, "application/json")
            });
        }
    }
}
