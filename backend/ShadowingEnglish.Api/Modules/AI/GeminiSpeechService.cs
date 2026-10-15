using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace ShadowingEnglish.Api.Modules.AI;

public sealed class GeminiSpeechService(HttpClient http, IConfiguration config, IMemoryCache cache,
    ILogger<GeminiSpeechService> logger)
{
    private const string Url = "https://generativelanguage.googleapis.com/v1beta/interactions";
    private static readonly string[] Models = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
    // Voice must be enabled with its own key; a text key must not silently start audio usage.
    private string? ApiKey => config["AiVoice:Gemini:ApiKey"];
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    public static string NormalizeVoice(string? voice) => voice?.ToLowerInvariant() switch
    {
        "puck" => "Puck",
        "aoede" => "Aoede",
        _ => "Kore"
    };

    public async Task<byte[]?> SpeakAsync(string text, string voice, CancellationToken cancellation)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(text) || text.Length > 500) return null;
        voice = NormalizeVoice(voice);
        var cacheKey = "gemini-voice:" + voice + ":" +
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        if (cache.TryGetValue<byte[]>(cacheKey, out var cached)) return cached;
        foreach (var model in Models)
        {
            var audio = await TryModelAsync(text, voice, model, cancellation);
            if (audio is null) continue;
            cache.Set(cacheKey, audio, new MemoryCacheEntryOptions
            {
                Size = audio.Length,
                AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6)
            });
            return audio;
        }
        return null;
    }

    private async Task<byte[]?> TryModelAsync(string text, string voice, string model,
        CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Url);
        request.Headers.Add("x-goog-api-key", ApiKey!.Trim());
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model,
            input = new[] { new { type = "user_input", content = new[] { new
            {
                type = "text", text,
                annotations = new[] { new { type = "speech_metadata", style = "warm and friendly" } }
            } } } },
            response_format = new { type = "audio" },
            generation_config = new { speech_config = new[] { new { voice } } }
        }), Encoding.UTF8, "application/json");
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Student.Voice.GeminiSpeechFailed Model={Model} Status={Status}",
                    model, (int)response.StatusCode);
                return null;
            }
            if (response.Content.Headers.ContentLength is > 8_000_000) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + count > 8_000_000) return null;
                buffer.Write(chunk, 0, count);
            }
            using var json = JsonDocument.Parse(buffer.ToArray());
            if (!json.RootElement.TryGetProperty("steps", out var steps)) return null;
            foreach (var step in steps.EnumerateArray())
            {
                if (!step.TryGetProperty("type", out var type) || type.GetString() != "model_output" ||
                    !step.TryGetProperty("content", out var content)) continue;
                foreach (var item in content.EnumerateArray())
                {
                    if (!item.TryGetProperty("type", out var kind) || kind.GetString() != "audio" ||
                        !item.TryGetProperty("mime_type", out var mime) || mime.GetString() != "audio/wav" ||
                        !item.TryGetProperty("data", out var data)) continue;
                    var encoded = data.GetString();
                    if (encoded is null || encoded.Length > 8_000_000) return null;
                    var audio = Convert.FromBase64String(encoded);
                    if (audio.Length is < 44 or > 6_000_000 ||
                        Encoding.ASCII.GetString(audio, 0, 4) != "RIFF") return null;
                    return audio;
                }
            }
            return null;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning("Student.Voice.GeminiSpeechFailed Model={Model} ErrorType={ErrorType}",
                model, ex.GetType().Name);
            return null;
        }
    }
}
