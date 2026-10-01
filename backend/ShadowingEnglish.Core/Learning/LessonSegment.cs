namespace ShadowingEnglish.Core.Learning;

public sealed class LessonSegment
{
    public Guid Id { get; set; }
    public Guid LessonVersionId { get; set; }
    public int Position { get; set; }
    public string Text { get; set; } = "";
    // Relative media key, never a client-supplied filesystem path or a database BLOB.
    public string AudioStorageKey { get; set; } = "";
}
