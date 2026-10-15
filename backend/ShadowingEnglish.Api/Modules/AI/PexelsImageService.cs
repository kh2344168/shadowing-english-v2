using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.AI;

// Pexels supplies existing photos, not AI-generated images. Credentials never leave the API.
public sealed class PexelsImageService(HttpClient http, ApplicationDbContext db,
    AiProviderCredentialProtector credentials, ILogger<PexelsImageService> logger)
{
    public sealed record ImageOption(string ImageUrl, string Photographer, string PhotoUrl);
    public sealed record SearchResult(ImageOption[] Options, string? Error = null);

    public async Task<bool> IsConfiguredAsync(CancellationToken cancel)
    {
        var row = await db.AiProviderConfigurations.AsNoTracking().Where(x =>
            x.Capability == AiProviderCatalog.ImageSearch && x.ProviderKey == "pexels" &&
            x.Enabled && x.EncryptedApiKey != null).OrderBy(x => x.Priority)
            .FirstOrDefaultAsync(cancel);
        return row is not null && credentials.TryUnprotect(row.EncryptedApiKey,
            AiProviderCatalog.ImageSearch, "pexels", out _);
    }

    public async Task<string?> FindAsync(string term, CancellationToken cancel) =>
        (await SearchAsync(term, 1, cancel)).FirstOrDefault()?.ImageUrl;

    public async Task<ImageOption[]> SearchAsync(string term, int page, CancellationToken cancel) =>
        (await SearchDetailedAsync(term, page, cancel)).Options;

    public async Task<SearchResult> SearchDetailedAsync(string term, int page, CancellationToken cancel)
    {
        if (string.IsNullOrWhiteSpace(term) || term.Length > 80 || page is < 1 or > 10)
            return new([], "invalid_query");
        var provider = await db.AiProviderConfigurations.AsNoTracking()
            .Where(x => x.Capability == AiProviderCatalog.ImageSearch && x.ProviderKey == "pexels" &&
                x.Enabled && x.EncryptedApiKey != null)
            .OrderBy(x => x.Priority).FirstOrDefaultAsync(cancel);
        if (provider is null || !credentials.TryUnprotect(provider.EncryptedApiKey,
                AiProviderCatalog.ImageSearch, "pexels", out var key))
            return new([], "pexels_not_configured");

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
            timeout.CancelAfter(TimeSpan.FromSeconds(7));
            using var request = new HttpRequestMessage(HttpMethod.Get,
                $"https://api.pexels.com/v1/search?query={Uri.EscapeDataString(term.Trim())}&per_page=6&page={page}");
            request.Headers.TryAddWithoutValidation("Authorization", key);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Pexels.Search.Failed Status={Status}", (int)response.StatusCode);
                return new([], (int)response.StatusCode switch
                {
                    401 or 403 => "pexels_invalid_key",
                    429 => "pexels_rate_limited",
                    _ => "pexels_unavailable"
                });
            }
            if (response.Content.Headers.ContentLength is > 128_000)
                return new([], "pexels_invalid_response");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var document = await JsonDocument.ParseAsync(stream,
                new JsonDocumentOptions { MaxDepth = 12 }, timeout.Token);
            return new(PickImageOptions(document.RootElement));
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning("Pexels.Search.Failed ErrorType={ErrorType}", ex.GetType().Name);
            return new([], "pexels_unavailable");
        }
    }

    public static ImageOption[] PickImageOptions(JsonElement root)
    {
        if (!root.TryGetProperty("photos", out var photos) || photos.ValueKind != JsonValueKind.Array)
            return [];
        var options = new List<ImageOption>();
        foreach (var photo in photos.EnumerateArray())
        {
            if (photo.ValueKind != JsonValueKind.Object ||
                !photo.TryGetProperty("src", out var src) || src.ValueKind != JsonValueKind.Object ||
                !src.TryGetProperty("medium", out var medium) || medium.ValueKind != JsonValueKind.String)
                continue;
            var value = medium.GetString();
            if (value is { Length: <= 1000 } && Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
                uri.Scheme == Uri.UriSchemeHttps && uri.Host == "images.pexels.com")
            {
                var photographer = photo.TryGetProperty("photographer", out var photographerValue) &&
                    photographerValue.ValueKind == JsonValueKind.String
                    ? photographerValue.GetString() ?? "Pexels" : "Pexels";
                var photoUrl = photo.TryGetProperty("url", out var urlValue) &&
                    urlValue.ValueKind == JsonValueKind.String ? urlValue.GetString() ?? "" : "";
                if (!Uri.TryCreate(photoUrl, UriKind.Absolute, out var source) ||
                    source.Scheme != Uri.UriSchemeHttps ||
                    source.Host is not ("www.pexels.com" or "pexels.com")) photoUrl = "https://www.pexels.com";
                options.Add(new ImageOption(value, photographer[..Math.Min(photographer.Length, 100)], photoUrl));
            }
        }
        return options.ToArray();
    }
}
