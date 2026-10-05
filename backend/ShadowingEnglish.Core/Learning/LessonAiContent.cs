namespace ShadowingEnglish.Core.Learning;

// A reviewed snapshot is immutable. Published slots point to a specific snapshot ID.
public sealed class LessonAiContent
{
    public Guid Id { get; set; }
    public Guid LessonVersionId { get; set; }
    public Guid CreatedByAdminId { get; set; }
    public Guid Revision { get; set; }
    public string Status { get; set; } = "Pending";
    public string? PayloadJson { get; set; }
    public string? ProviderName { get; set; }
    public string? ErrorCode { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
    public DateTimeOffset? ApprovedAtUtc { get; set; }
}
