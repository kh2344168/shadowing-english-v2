namespace ShadowingEnglish.Core.Learning;

// Editable preparation data. Students only read separately copied published slots.
public sealed class CurriculumDraftLessonSlot
{
    public Guid Id { get; set; }
    public Guid CurriculumTemplateId { get; set; }
    public Guid LessonVersionId { get; set; }
    public int WeekNumber { get; set; }
    public int DayNumber { get; set; }
    public int SortOrder { get; set; }
}
