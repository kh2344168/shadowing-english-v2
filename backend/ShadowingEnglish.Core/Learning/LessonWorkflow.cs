namespace ShadowingEnglish.Core.Learning;

// Mutable authoring plan for an immutable lesson version. Published curriculum snapshots
// continue to point at their reviewed content and are never changed by this plan.
public sealed class LessonWorkflow
{
    public Guid LessonVersionId { get; set; }
    public Guid Revision { get; set; }
    public string StagesJson { get; set; } = "[]";
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
