using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using ShadowingEnglish.Api.Modules.AI;

namespace ShadowingEnglish.MediaChecks;

internal static class VoiceFallbackChecks
{
    public static async Task<int> RunAsync(Func<string, Func<Task>, Task> check, Func<int> failures)
    {
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
}
