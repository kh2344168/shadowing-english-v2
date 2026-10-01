using Azure.Core;
using Azure.Identity;
using Azure.Storage.Blobs;

namespace ShadowingEnglish.Api.Modules.Media;

public static class ShadowingMediaStoreFactory
{
    public static IShadowingMediaStore Create(IWebHostEnvironment environment,
        IConfiguration configuration, ILoggerFactory logs)
    {
        var provider = configuration["Media:Provider"];
        if (string.IsNullOrEmpty(provider))
            provider = environment.IsDevelopment() ? "DevelopmentLocal" : "Disabled";
        if (provider == "DevelopmentLocal" && environment.IsDevelopment())
            return new DevelopmentShadowingMediaStore(environment, configuration,
                logs.CreateLogger<DevelopmentShadowingMediaStore>());
        if (provider != "AzureBlob") return new DisabledShadowingMediaStore();
        try
        {
            var name = configuration["Media:AzureBlob:Container"] ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$") || name.Contains("--"))
                return new DisabledShadowingMediaStore();
            var options = new BlobClientOptions();
            options.Retry.MaxRetries = 2;
            options.Retry.Delay = TimeSpan.FromMilliseconds(200);
            options.Retry.MaxDelay = TimeSpan.FromSeconds(2);
            options.Retry.NetworkTimeout = TimeSpan.FromSeconds(15);
            options.Diagnostics.IsLoggingEnabled = false;
            options.Diagnostics.IsDistributedTracingEnabled = false;
            BlobContainerClient container;
            var connection = configuration["Media:AzureBlob:ConnectionString"];
            var configuredService = configuration["Media:AzureBlob:ServiceUri"];
            if (!string.IsNullOrWhiteSpace(connection) && !string.IsNullOrWhiteSpace(configuredService))
                return new DisabledShadowingMediaStore();
            if (!string.IsNullOrWhiteSpace(connection))
                container = new BlobContainerClient(connection, name, options);
            else
            {
                if (!Uri.TryCreate(configuredService, UriKind.Absolute, out var service) ||
                    service.Scheme != "https" || service.UserInfo.Length != 0 || service.AbsolutePath != "/" ||
                    service.Query.Length != 0 || service.Fragment.Length != 0)
                    return new DisabledShadowingMediaStore();
                var clientId = configuration["Media:AzureBlob:ManagedIdentityClientId"];
                TokenCredential credential = environment.IsDevelopment()
                    ? new DefaultAzureCredential()
                    : new ManagedIdentityCredential(string.IsNullOrWhiteSpace(clientId)
                        ? ManagedIdentityId.SystemAssigned : ManagedIdentityId.FromUserAssignedClientId(clientId));
                container = new BlobServiceClient(service, credential, options).GetBlobContainerClient(name);
            }
            var trustedAzureEndpoint = container.Uri.Scheme == "https" &&
                System.Text.RegularExpressions.Regex.IsMatch(container.Uri.Host,
                    "^[a-z0-9]{3,24}\\.blob\\.core\\.windows\\.net$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var localEmulator = environment.IsDevelopment() && container.Uri.Scheme == "http" && container.Uri.IsLoopback;
            if (container.Uri.Query.Length != 0 || (!trustedAzureEndpoint && !localEmulator))
                return new DisabledShadowingMediaStore();
            return new AzureBlobShadowingMediaStore(container, logs.CreateLogger<AzureBlobShadowingMediaStore>());
        }
        catch (Exception error) when (error is ArgumentException or FormatException)
        {
            logs.CreateLogger("Media.Configuration").LogWarning("Media.Configuration.Invalid ErrorType={ErrorType}", error.GetType().Name);
            return new DisabledShadowingMediaStore();
        }
    }
}
