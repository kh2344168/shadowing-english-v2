namespace ShadowingEnglish.Core.Learning;

public sealed class StudentStageProgress
{
    public Guid StudentId { get; set; }
    public Guid PublishedCurriculumVersionId { get; set; }
    public Guid SlotId { get; set; }
    public string StageKey { get; set; } = "shadowing";
    // Number of completed segments; 0 is not saved. A replay never moves this backwards.
    public int CompletedSegments { get; set; }
    public bool IsComplete { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
