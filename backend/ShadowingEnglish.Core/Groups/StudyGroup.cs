namespace ShadowingEnglish.Core.Groups;

// A group exists independently of student memberships and future published curricula.
public sealed class StudyGroup
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid CreateRequestId { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public Guid CreatedByAdminId { get; set; }
}
