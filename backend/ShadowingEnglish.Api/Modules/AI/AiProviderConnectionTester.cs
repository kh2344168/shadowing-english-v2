using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using ShadowingEnglish.Infrastructure.AIProviders;

namespace ShadowingEnglish.Api.Modules.AI;

public sealed class AiProviderConnectionTester(HttpClient http)
{
    public sealed record Result(bool Success, string Status, string? FailureReason);

    public async Task<Result> TestAsync(
        AiProviderConfiguration configuration,
        string apiKey,
        CancellationToken cancellationToken)
    {
        var definition = AiProviderCatalog.Find(configuration.Capability, configuration.ProviderKey);
        if (definition is null || !definition.Implemented)
            return new(false, "unavailable", "not_implemented");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            using var request = BuildRequest(configuration, apiKey);
            if (request is null) return new(false, "connection_failed", "invalid_configuration");
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);

            if (response.IsSuccessStatusCode)
            {
                if (configuration.ProviderKey == "groq" && !string.IsNullOrWhiteSpace(configuration.Model))
                {
                    var body = await ReadSafeBodyAsync(response, timeout.Token);
                    if (!ContainsModelId(body, configuration.Model!))
                        return new(false, "model_unavailable", "model_unavailable");
                }
                return new(true, "connected", null);
            }

            return FromStatus(response.StatusCode, !string.IsNullOrWhiteSpace(configuration.Model));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(false, "connection_failed", "connection_timeout");
        }
        catch (HttpRequestException)
        {
            return new(false, "unavailable", "provider_unavailable");
        }
        catch (JsonException)
        {
            return new(false, "connection_failed", "invalid_provider_response");
        }
    }

    private static HttpRequestMessage? BuildRequest(AiProviderConfiguration configuration, string apiKey)
    {
        switch (configuration.ProviderKey)
        {
            case "groq":
            {
                var request = new HttpRequestMessage(HttpMethod.Get, "https://api.groq.com/openai/v1/models");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                return request;
            }
            case "cloudflare":
            {
                if (!SafeId(configuration.AccountId) || string.IsNullOrWhiteSpace(configuration.Model)) return null;
                var model = Uri.EscapeDataString(configuration.Model);
                var request = new HttpRequestMessage(HttpMethod.Get,
                    $"https://api.cloudflare.com/client/v4/accounts/{configuration.AccountId}/ai/models/schema?model={model}");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                return request;
            }
            case "gemini":
            {
                if (string.IsNullOrWhiteSpace(configuration.Model)) return null;
                var model = Uri.EscapeDataString(configuration.Model);
                var request = new HttpRequestMessage(HttpMethod.Get,
                    $"https://generativelanguage.googleapis.com/v1beta/models/{model}");
                request.Headers.TryAddWithoutValidation("x-goog-api-key", apiKey);
                return request;
            }
            case "mistral":
            {
                if (string.IsNullOrWhiteSpace(configuration.Model)) return null;
                var model = Uri.EscapeDataString(configuration.Model);
                var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.mistral.ai/v1/models/{model}");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                return request;
            }
            case "openrouter":
            {
                if (string.IsNullOrWhiteSpace(configuration.Model)) return null;
                var split = configuration.Model.Split('/', 2, StringSplitOptions.RemoveEmptyEntries);
                if (split.Length != 2 || !SafeSlug(split[0]) || !SafeSlug(split[1])) return null;
                var request = new HttpRequestMessage(HttpMethod.Get,
                    $"https://openrouter.ai/api/v1/models/{Uri.EscapeDataString(split[0])}/{Uri.EscapeDataString(split[1])}/endpoints");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                return request;
            }
            case "pexels":
            {
                var request = new HttpRequestMessage(HttpMethod.Get, "https://api.pexels.com/v1/curated?per_page=1");
                request.Headers.TryAddWithoutValidation("Authorization", apiKey);
                return request;
            }
            case "unsplash":
            {
                var request = new HttpRequestMessage(HttpMethod.Get, "https://api.unsplash.com/photos?per_page=1");
                request.Headers.TryAddWithoutValidation("Authorization", "Client-ID " + apiKey);
                request.Headers.TryAddWithoutValidation("Accept-Version", "v1");
                return request;
            }
            default:
                return null;
        }
    }

    private static Result FromStatus(HttpStatusCode status, bool hasModel)
    {
        var code = (int)status;
        if (status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return new(false, "invalid", "invalid_key");
        if (code == 429)
            return new(false, "rate_limited", "rate_limit_exceeded");
        if (status == HttpStatusCode.NotFound && hasModel)
            return new(false, "model_unavailable", "model_unavailable");
        if (code is 408 or 502 or 503 or 504 || code >= 500)
            return new(false, "unavailable", "provider_unavailable");
        return new(false, "connection_failed", "connection_failed");
    }

    private static bool SafeId(string? value) => value is { Length: >= 4 and <= 160 } &&
        value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_');

    private static bool SafeSlug(string value) => value.Length is >= 1 and <= 100 &&
        value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.' or ':');

    private static async Task<string> ReadSafeBodyAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var length = response.Content.Headers.ContentLength;
        if (length is > 1_000_000) throw new JsonException("provider_response_too_large");
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (body.Length > 1_000_000) throw new JsonException("provider_response_too_large");
        return body;
    }

    private static bool ContainsModelId(string body, string model)
    {
        using var document = JsonDocument.Parse(body);
        return Contains(document.RootElement, model);
    }

    private static bool Contains(JsonElement element, string model)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (property.NameEquals("id") && property.Value.ValueKind == JsonValueKind.String &&
                        string.Equals(property.Value.GetString(), model, StringComparison.Ordinal)) return true;
                    if (Contains(property.Value, model)) return true;
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray()) if (Contains(item, model)) return true;
                break;
        }
        return false;
    }
}
