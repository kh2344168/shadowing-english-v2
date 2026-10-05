namespace ShadowingEnglish.Api.Modules.AI;

public static class AiProviderCatalog
{
    public const string Text = "text";
    public const string ImageGeneration = "image-generation";
    public const string ImageSearch = "image-search";

    public sealed record Definition(
        string ProviderKey,
        string DisplayName,
        string Capability,
        bool Implemented,
        bool RequiresAccountId,
        bool SupportsProjectId,
        string[] Models,
        int DefaultPriority,
        string? UnavailableReason = null);

    private static readonly Definition[] Definitions =
    [
        new("groq", "Groq", Text, true, false, false, ["openai/gpt-oss-20b"], 1),
        new("cloudflare", "Cloudflare Workers AI", Text, true, true, false, ["@cf/meta/llama-3.1-8b-instruct"], 2),
        new("gemini", "Google Gemini", Text, true, false, true, ["gemini-3.8-flash"], 3),
        new("mistral", "Mistral", Text, true, false, false, ["mistral-small-latest"], 4),
        new("openrouter", "OpenRouter", Text, true, false, false, ["openrouter/auto"], 5),

        // These are visible future targets only. No image-generation adapter exists in V2 yet.
        new("gemini-image", "Google Gemini / Imagen", ImageGeneration, false, false, true, [], 1, "not_implemented"),
        new("cloudflare-image", "Cloudflare Workers AI Images", ImageGeneration, false, true, false, [], 2, "not_implemented"),
        new("openrouter-image", "OpenRouter Images", ImageGeneration, false, false, false, [], 3, "not_implemented"),

        new("pexels", "Pexels", ImageSearch, true, false, false, [], 1),
        // Pixabay authenticates with the key in the URL query. Keep it unavailable until a dedicated
        // client prevents credentials from appearing in request-URL diagnostics/proxies.
        new("pixabay", "Pixabay", ImageSearch, false, false, false, [], 2, "secure_adapter_pending"),
        new("unsplash", "Unsplash", ImageSearch, true, false, false, [], 3),
    ];

    public static IReadOnlyList<Definition> All => Definitions;

    public static Definition? Find(string capability, string providerKey) => Definitions.FirstOrDefault(x =>
        string.Equals(x.Capability, capability, StringComparison.Ordinal) &&
        string.Equals(x.ProviderKey, providerKey, StringComparison.Ordinal));

    public static bool IsCapability(string value) => value is Text or ImageGeneration or ImageSearch;
}
