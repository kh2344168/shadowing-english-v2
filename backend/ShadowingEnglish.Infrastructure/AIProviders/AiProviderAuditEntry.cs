namespace ShadowingEnglish.Infrastructure.AIProviders;

public sealed class AiProviderAuditEntry
{
    public Guid Id { get; set; }
    public Guid ProviderConfigurationId { get; set; }
    public string Capability { get; set; } = "";
    public string ProviderKey { get; set; } = "";
    public string Action { get; set; } = "";
    public string ResultCode { get; set; } = "";
    public Guid ActorAdminId { get; set; }
    public DateTimeOffset OccurredAtUtc { get; set; }
}
