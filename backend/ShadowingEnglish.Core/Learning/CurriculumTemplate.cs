namespace ShadowingEnglish.Core.Learning;

public sealed class CurriculumTemplate
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public Guid DraftRevision { get; set; }
    public DateTimeOffset? DraftUpdatedAtUtc { get; set; }
    public string? CreateRequestHash { get; set; }
    public Guid? LastUpdateRequestId { get; set; }
    public string? LastUpdateRequestHash { get; set; }
}
