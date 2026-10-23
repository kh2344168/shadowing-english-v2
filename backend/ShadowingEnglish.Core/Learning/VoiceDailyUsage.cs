namespace ShadowingEnglish.Core.Learning;

public sealed class VoiceDailyUsage
{
    public Guid UserId { get; set; }
    public DateOnly DayUtc { get; set; }
    public int TranscriptionRequests { get; set; }
    public int SynthesisCharacters { get; set; }
}
