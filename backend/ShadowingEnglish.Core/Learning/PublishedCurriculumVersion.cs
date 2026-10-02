namespace ShadowingEnglish.Core.Learning;

public sealed class PublishedCurriculumVersion
{
    public Guid Id { get; set; }
    public Guid CurriculumTemplateId { get; set; }
    public Guid GroupId { get; set; }
    public int VersionNumber { get; set; }
    public string Title { get; set; } = "";
    public DateTimeOffset PublishedAtUtc { get; set; }
    public DateTimeOffset AvailableAtUtc { get; set; }
    // Nullable for pre-existing lesson-level publications. Never inferred from a later draft.
    public Guid? SourceDraftRevision { get; set; }
    public string? PublishRequestHash { get; set; }
}
