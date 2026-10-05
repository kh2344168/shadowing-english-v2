namespace ShadowingEnglish.Infrastructure.AIProviders;

public sealed class AiProviderConfiguration
{
    public Guid Id { get; set; }
    public string Capability { get; set; } = "";
    public string ProviderKey { get; set; } = "";
    public string? EncryptedApiKey { get; set; }
    public string? KeyLast4 { get; set; }
    public string? AccountId { get; set; }
    public string? ProjectId { get; set; }
    public string? Model { get; set; }
    public int Priority { get; set; }
    public bool Enabled { get; set; }
    public string Status { get; set; } = "not_configured";
    public DateTimeOffset? LastSuccessfulRequestUtc { get; set; }
    public DateTimeOffset? LastFailedRequestUtc { get; set; }
    public string? LastFailureReason { get; set; }
    public Guid UpdatedByAdminId { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public Guid Revision { get; set; }
    public Guid? LastMutationRequestId { get; set; }
    public string? LastMutationRequestHash { get; set; }
}
