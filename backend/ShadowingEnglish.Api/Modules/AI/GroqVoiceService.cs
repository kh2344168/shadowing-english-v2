using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.AI;

// Audio is sent only to Groq, never stored with the student's practice history.
public sealed class GroqVoiceService(HttpClient http, IConfiguration config, IMemoryCache cache,
    ILogger<GroqVoiceService> logger, ApplicationDbContext? db = null,
    AiProviderCredentialProtector? credentials = null)
{
    public sealed record SpeechResult(byte[]? Audio, string? ErrorCode);
    private const string TranscriptionUrl = "https://api.groq.com/openai/v1/audio/transcriptions";
    private const string SpeechUrl = "https://api.groq.com/openai/v1/audio/speech";
    // Voice must be enabled with its own key; a text key must not silently start audio usage.
    private string? ApiKey => config["AiVoice:Groq:ApiKey"];
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    public async Task<bool> IsConfiguredAsync(CancellationToken cancellation) =>
        await ResolveApiKeyAsync(cancellation) is not null;

    private async Task<string?> ResolveApiKeyAsync(CancellationToken cancellation)
    {
        if (db is not null && credentials?.IsConfigured == true)
        {
            var row = await db.AiProviderConfigurations.AsNoTracking()
                .Where(x => x.Capability == AiProviderCatalog.Voice && x.ProviderKey == "groq" &&
                    x.Enabled && x.EncryptedApiKey != null)
                .FirstOrDefaultAsync(cancellation);
            if (row is not null && credentials.TryUnprotect(row.EncryptedApiKey!,
                    AiProviderCatalog.Voice, "groq", out var key)) return key;
        }
        return string.IsNullOrWhiteSpace(ApiKey) ? null : ApiKey.Trim();
    }

    public async Task<string?> TranscribeAsync(Stream audio, string contentType, CancellationToken cancellation)
    {
        var apiKey = await ResolveApiKeyAsync(cancellation);
        if (apiKey is null) return null;
        using var request = new HttpRequestMessage(HttpMethod.Post, TranscriptionUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("whisper-large-v3-turbo"), "model");
        form.Add(new StringContent("en"), "language");
        using var file = new StreamContent(audio);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "file", contentType switch
        {
            "audio/ogg" => "student.ogg",
            "audio/mp4" => "student.mp4",
            "audio/wav" => "student.wav",
            _ => "student.webm"
        });
        request.Content = form;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            using var response = await http.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Student.Voice.TranscriptionFailed Status={Status}", (int)response.StatusCode);
                return null;
            }
            await using var body = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var json = await JsonDocument.ParseAsync(body, cancellationToken: timeout.Token);
            var text = json.RootElement.TryGetProperty("text", out var value) ? value.GetString()?.Trim() : null;
            return text is { Length: > 0 and <= 400 } ? text : null;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning("Student.Voice.TranscriptionFailed ErrorType={ErrorType}", ex.GetType().Name);
            return null;
        }
    }

    public async Task<byte[]?> SpeakAsync(string text, string voice, CancellationToken cancellation) =>
        (await SpeakDetailedAsync(text, voice, cancellation)).Audio;

    public async Task<SpeechResult> SpeakDetailedAsync(string text, string voice,
        CancellationToken cancellation)
    {
        // Orpheus accepts at most 200 characters per request.
        if (string.IsNullOrWhiteSpace(text) || text.Length > 200)
            return new(null, "invalid_voice_text");
        var apiKey = await ResolveApiKeyAsync(cancellation);
        if (apiKey is null) return new(null, "voice_not_configured");
        var groqVoice = GeminiSpeechService.NormalizeVoice(voice) switch
        {
            "Puck" => "troy",
            "Aoede" => "diana",
            _ => "hannah"
        };
        var cacheKey = "groq-voice:" + groqVoice + ":" +
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        if (cache.TryGetValue<byte[]>(cacheKey, out var cached)) return new(cached, null);
        using var request = new HttpRequestMessage(HttpMethod.Post, SpeechUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            model = "canopylabs/orpheus-v1-english", voice = groqVoice, input = text,
            response_format = "wav"
        }), Encoding.UTF8, "application/json");
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            using var response = await http.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                var detail = await SafeSpeechErrorAsync(response, text, timeout.Token);
                logger.LogWarning("Student.Voice.SpeechFailed Status={Status} Detail={Detail}",
                    (int)response.StatusCode, detail);
                return new(null, response.StatusCode == System.Net.HttpStatusCode.BadRequest &&
                    detail.Contains("requires terms acceptance", StringComparison.OrdinalIgnoreCase)
                    ? "voice_terms_required" : "speech_unavailable");
            }
            if (response.Content.Headers.ContentLength is > 2_000_000)
                return new(null, "speech_unavailable");
            await using var body = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int count;
            while ((count = await body.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + count > 2_000_000)
                    return new(null, "speech_unavailable");
                buffer.Write(chunk, 0, count);
            }
            var audio = buffer.ToArray();
            if (audio.Length == 0) return new(null, "speech_unavailable");
            cache.Set(cacheKey, audio, new MemoryCacheEntryOptions
            {
                Size = audio.Length,
                AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6)
            });
            return new(audio, null);
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning("Student.Voice.SpeechFailed ErrorType={ErrorType}", ex.GetType().Name);
            return new(null, "speech_unavailable");
        }
    }

    private static async Task<string> SafeSpeechErrorAsync(HttpResponseMessage response, string input,
        CancellationToken cancellation)
    {
        if (response.Content.Headers.ContentLength is > 4096) return "provider_error";
        try
        {
            var body = await response.Content.ReadAsStringAsync(cancellation);
            if (body.Length > 4096) return "provider_error";
            using var document = JsonDocument.Parse(body);
            if (!document.RootElement.TryGetProperty("error", out var error)) return "provider_error";
            var message = error.TryGetProperty("message", out var value) ? value.GetString() : null;
            if (string.IsNullOrWhiteSpace(message)) return "provider_error";
            message = message.Replace(input, "[input]", StringComparison.OrdinalIgnoreCase);
            message = System.Text.RegularExpressions.Regex.Replace(message, @"gsk_[A-Za-z0-9_-]+", "[key]");
            return new string(message.Where(ch => !char.IsControl(ch)).Take(240).ToArray());
        }
        catch (JsonException) { return "provider_error"; }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch { return "provider_error"; }
    }
}
