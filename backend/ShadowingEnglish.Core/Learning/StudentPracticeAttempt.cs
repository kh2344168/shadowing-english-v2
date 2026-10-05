namespace ShadowingEnglish.Core.Learning;

public sealed class StudentPracticeAttempt
{
    public Guid Id { get; set; }
    public Guid StudentId { get; set; }
    public Guid PublishedCurriculumVersionId { get; set; }
    public Guid SlotId { get; set; }
    public string StageKey { get; set; } = "";
    public int Position { get; set; }
    public string Answer { get; set; } = "";
    public string FeedbackJson { get; set; } = "";
    public DateTimeOffset CreatedAtUtc { get; set; }
}
