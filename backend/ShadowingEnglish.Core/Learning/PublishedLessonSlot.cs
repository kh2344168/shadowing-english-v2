namespace ShadowingEnglish.Core.Learning;

public sealed class PublishedLessonSlot
{
    public Guid Id { get; set; }
    public Guid PublishedCurriculumVersionId { get; set; }
    public Guid LessonVersionId { get; set; }
    public int WeekNumber { get; set; }
    public int DayNumber { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset AvailableAtUtc { get; set; }
}
