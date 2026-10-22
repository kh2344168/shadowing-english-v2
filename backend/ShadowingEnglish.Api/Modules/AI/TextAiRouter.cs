using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShadowingEnglish.Api.Modules.AI;

public sealed record AiMessage(string Role, string Content);
public sealed record AiResult<T>(T Value, string Provider);

// Endpoints are fixed by the server, never supplied by an HTTP caller. Add a provider here and
// in the private AiText:Providers configuration to extend the fallback list.
public sealed class TextAiRouter(IHttpClientFactory clients, IConfiguration config, ILogger<TextAiRouter> logger)
{
    // Structured lesson stages can take longer than short chat replies on free-tier providers.
    // Keep each provider bounded so the worker can still try the remaining fallbacks.
    public const int ProviderTimeoutSeconds = 40;
    private sealed record Provider(string Name, string Url, string Model);
    private static readonly (string Name, string Url, string Model)[] Catalog =
    [
        ("Groq", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-20b"),
        ("Cloudflare", "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions", "@cf/meta/llama-3.1-8b-instruct"),
        ("Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-2.5-flash"),
        ("Mistral", "https://api.mistral.ai/v1/chat/completions", "mistral-small-latest"),
        ("OpenRouter", "https://openrouter.ai/api/v1/chat/completions", "openrouter/free")
    ];

    public string[] ConfiguredProviders() => Catalog.Where(x => Resolve(x) is not null).Select(x => x.Name).ToArray();

    public async Task<AiResult<T>?> CompleteAsync<T>(IReadOnlyList<AiMessage> messages, int maxTokens,
        Func<string, T?> validate, CancellationToken cancellation,
        Action<string>? reportFailure = null) where T : class
    {
        foreach (var entry in Catalog)
        {
            var provider = Resolve(entry);
            if (provider is null) continue;
            var started = Stopwatch.GetTimestamp();
            logger.LogInformation("Ai.Provider.Start Provider={Provider}", provider.Name);
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, provider.Url);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config[$"AiText:Providers:{provider.Name}:ApiKey"]!.Trim());
                request.Content = new StringContent(JsonSerializer.Serialize(new
                {
                    model = provider.Model, messages = messages.Select(x => new { role = x.Role, content = x.Content }),
                    max_tokens = maxTokens, stream = false
                }), Encoding.UTF8, "application/json");
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                timeout.CancelAfter(TimeSpan.FromSeconds(ProviderTimeoutSeconds));
                using var response = await clients.CreateClient(nameof(TextAiRouter)).SendAsync(
                    request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if (!response.IsSuccessStatusCode)
                {
                    reportFailure?.Invoke((int)response.StatusCode switch
                    {
                        401 or 403 => "provider_auth_rejected",
                        429 => "provider_rate_limited",
                        >= 500 => "provider_unavailable",
                        _ => "provider_request_rejected"
                    });
                    logger.LogWarning("Ai.Provider.Failed Provider={Provider} Status={Status} DurationMs={DurationMs}",
                        provider.Name, (int)response.StatusCode, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                    continue;
                }
                await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                using var buffer = new MemoryStream();
                var part = new byte[8192];
                int length;
                while ((length = await stream.ReadAsync(part, timeout.Token)) > 0)
                {
                    if (buffer.Length + length > 64_000) throw new InvalidDataException("AI response too large");
                    buffer.Write(part, 0, length);
                }
                using var document = JsonDocument.Parse(buffer.ToArray());
                var message = document.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content");
                var content = message.ValueKind == JsonValueKind.String ? message.GetString() : null;
                var result = content is null ? null : validate(content);
                if (result is null)
                {
                    reportFailure?.Invoke("provider_invalid_output");
                    logger.LogWarning("Ai.Provider.InvalidOutput Provider={Provider} DurationMs={DurationMs}",
                        provider.Name, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                    continue;
                }
                logger.LogInformation("Ai.Provider.Success Provider={Provider} DurationMs={DurationMs}",
                    provider.Name, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
                return new AiResult<T>(result, provider.Name);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
            catch (OperationCanceledException)
            {
                reportFailure?.Invoke("provider_timeout");
                logger.LogWarning("Ai.Provider.Failed Provider={Provider} ErrorType=Timeout DurationMs={DurationMs}",
                    provider.Name, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            }
            catch (Exception ex)
            {
                reportFailure?.Invoke("provider_request_failed");
                // Never log request bodies, provider responses, exception messages or API keys.
                logger.LogWarning("Ai.Provider.Failed Provider={Provider} ErrorType={ErrorType} DurationMs={DurationMs}",
                    provider.Name, ex.GetType().Name, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            }
        }
        return null;
    }

    private Provider? Resolve((string Name, string Url, string Model) entry)
    {
        var key = config[$"AiText:Providers:{entry.Name}:ApiKey"];
        if (string.IsNullOrWhiteSpace(key)) return null;
        var model = config[$"AiText:Providers:{entry.Name}:Model"] ?? entry.Model;
        if (!Regex.IsMatch(model, "^[a-zA-Z0-9@/_.:-]{1,120}$", RegexOptions.CultureInvariant)) return null;
        var url = entry.Url;
        if (entry.Name == "Cloudflare")
        {
            var accountId = config["AiText:Providers:Cloudflare:AccountId"];
            if (accountId is null || !Regex.IsMatch(accountId, "^[a-fA-F0-9]{32}$", RegexOptions.CultureInvariant)) return null;
            url = url.Replace("{accountId}", accountId, StringComparison.Ordinal);
        }
        return new Provider(entry.Name, url, model);
    }
}
