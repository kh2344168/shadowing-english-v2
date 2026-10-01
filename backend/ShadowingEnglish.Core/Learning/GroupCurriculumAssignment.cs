namespace ShadowingEnglish.Core.Learning;

// Pointer may change on later publishes; the referenced version and its slots cannot.
public sealed class GroupCurriculumAssignment
{
    public Guid GroupId { get; set; }
    public Guid PublishedCurriculumVersionId { get; set; }
}
