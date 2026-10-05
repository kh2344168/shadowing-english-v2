namespace ShadowingEnglish.Core.Learning;

public sealed class StudentAiDailyUsage
{
    public Guid StudentId { get; set; }
    public DateOnly DayUtc { get; set; }
    public int UsedRequests { get; set; }
}
