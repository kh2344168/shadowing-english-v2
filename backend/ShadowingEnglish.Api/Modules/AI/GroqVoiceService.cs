using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace ShadowingEnglish.Api.Modules.AI;

// Audio is sent only to Groq, never stored with the student's practice history.
public sealed class GroqVoiceService(HttpClient http, IConfiguration config, IMemoryCache cache,
    ILogger<GroqVoiceService> logger)
{
    private const string TranscriptionUrl = "https://api.groq.com/openai/v1/audio/transcriptions";
    private const string SpeechUrl = "https://api.groq.com/openai/v1/audio/speech";
    // Voice must be enabled with its own key; a text key must not silently start audio usage.
    private string? ApiKey => config["AiVoice:Groq:ApiKey"];
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    public async Task<string?> TranscribeAsync(Stream audio, string contentType, CancellationToken cancellation)
    {
        if (!IsConfigured) return null;
        using var request = new HttpRequestMessage(HttpMethod.Post, TranscriptionUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ApiKey!.Trim());
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

    public async Task<byte[]?> SpeakAsync(string text, string voice, CancellationToken cancellation)
    {
        // Orpheus accepts at most 200 characters per request.
        if (!IsConfigured || string.IsNullOrWhiteSpace(text) || text.Length > 200) return null;
        var groqVoice = GeminiSpeechService.NormalizeVoice(voice) switch
        {
            "Puck" => "troy",
            "Aoede" => "diana",
            _ => "hannah"
        };
        var cacheKey = "groq-voice:" + groqVoice + ":" +
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        if (cache.TryGetValue<byte[]>(cacheKey, out var cached)) return cached;
        using var request = new HttpRequestMessage(HttpMethod.Post, SpeechUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ApiKey!.Trim());
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
                logger.LogWarning("Student.Voice.SpeechFailed Status={Status}", (int)response.StatusCode);
                return null;
            }
            if (response.Content.Headers.ContentLength is > 2_000_000) return null;
            await using var body = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int count;
            while ((count = await body.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + count > 2_000_000) return null;
                buffer.Write(chunk, 0, count);
            }
            var audio = buffer.ToArray();
            if (audio.Length == 0) return null;
            cache.Set(cacheKey, audio, new MemoryCacheEntryOptions
            {
                Size = audio.Length,
                AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6)
            });
            return audio;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning("Student.Voice.SpeechFailed ErrorType={ErrorType}", ex.GetType().Name);
            return null;
        }
    }
}
