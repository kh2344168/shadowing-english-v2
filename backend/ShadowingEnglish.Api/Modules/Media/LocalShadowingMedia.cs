namespace ShadowingEnglish.Api.Modules.Media;

// Local uploads live outside bin/obj so an ordinary rebuild does not remove lesson audio.
// The fixture's built-in voice samples remain in the output-only DevelopmentMedia folder.
public static class LocalShadowingMedia
{
    private static bool IsEnabled(IWebHostEnvironment env, IConfiguration config) =>
        env.IsDevelopment() ||
        (env.IsEnvironment("Demo") &&
         string.Equals(config["Media:Provider"], "DemoLocal", StringComparison.Ordinal) &&
         Path.IsPathFullyQualified(config["Media:LocalRoot"] ?? ""));

    public static string? UploadRoot(IWebHostEnvironment env, IConfiguration config)
    {
        if (!IsEnabled(env, config)) return null;
        var configured = config["Media:LocalRoot"];
        if (!string.IsNullOrWhiteSpace(configured))
            return Path.IsPathFullyQualified(configured) ? configured : null;
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null;
             directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "ShadowingEnglish.Api.csproj")))
                return Path.Combine(directory.FullName, ".local", "media");
        foreach (var candidate in new[] { env.ContentRootPath,
                     Path.Combine(env.ContentRootPath, "backend", "ShadowingEnglish.Api") })
            if (File.Exists(Path.Combine(candidate, "ShadowingEnglish.Api.csproj")))
                return Path.Combine(candidate, ".local", "media");
        return null;
    }

    public static string? ExistingPath(IWebHostEnvironment env, IConfiguration config, string key)
    {
        if (!IsEnabled(env, config) || !ShadowingMediaKeys.IsValid(key)) return null;
        var configured = config["Media:LocalRoot"];
        if (!string.IsNullOrWhiteSpace(configured))
            return Path.IsPathFullyQualified(configured) ? Path.Combine(configured, key) : null;
        if (key.StartsWith("lesson-", StringComparison.Ordinal) ||
            key.StartsWith("student-shadowing-", StringComparison.Ordinal))
        {
            var root = UploadRoot(env, config);
            return root is null ? null : Path.Combine(root, key);
        }
        return Path.Combine(AppContext.BaseDirectory, "DevelopmentMedia", key);
    }
}
