namespace ShadowingEnglish.Core.Learning;

// Once referenced by a published slot, this row and its segments are a frozen snapshot.
public sealed class LessonVersion
{
    public Guid Id { get; set; }
    public Guid LessonDefinitionId { get; set; }
    public int VersionNumber { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
}
