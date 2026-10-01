namespace ShadowingEnglish.Core.Groups;

// Closed rows are retained so a move never erases the student's previous group.
public sealed class StudentGroupMembership
{
    public Guid Id { get; set; }
    public Guid StudentId { get; set; }
    public Guid GroupId { get; set; }
    public DateTimeOffset StartedAtUtc { get; set; }
    public DateTimeOffset? EndedAtUtc { get; set; }
    public Guid AssignedByAdminId { get; set; }
    public Guid? EndedByAdminId { get; set; }
}
