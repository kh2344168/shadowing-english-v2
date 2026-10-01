using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Groups;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Api.Bootstrap;

// Explicit Development command only. Never run at ordinary startup, on a GET, or on login.
public static class LocalDay2Fixture
{
    private static readonly Guid GroupId = Guid.Parse("d2000000-0000-4000-8000-000000000001");
    private static readonly Guid TemplateId = Guid.Parse("d2000000-0000-4000-8000-000000000002");
    private static readonly Guid DefinitionId = Guid.Parse("d2000000-0000-4000-8000-000000000003");
    private static readonly Guid LessonVersionId = Guid.Parse("d2000000-0000-4000-8000-000000000004");
    private static readonly Guid VersionId = Guid.Parse("d2000000-0000-4000-8000-000000000005");
    private static readonly Guid SlotId = Guid.Parse("d2000000-0000-4000-8000-000000000006");
    private static readonly Guid FutureSlotId = Guid.Parse("d2000000-0000-4000-8000-000000000007");
    private static readonly Guid OtherSlotId = Guid.Parse("d2000000-0000-4000-8000-000000000008");
    private static readonly Guid OtherGroupId = Guid.Parse("d2000000-0000-4000-8000-000000000012");
    private static readonly Guid OtherVersionId = Guid.Parse("d2000000-0000-4000-8000-000000000013");
    private static readonly Guid UnassignedVersionId = Guid.Parse("d2000000-0000-4000-8000-000000000014");
    private static readonly Guid UnassignedSlotId = Guid.Parse("d2000000-0000-4000-8000-000000000015");

    public static async Task RunAsync(WebApplication app)
    {
        if (!app.Environment.IsDevelopment())
            throw new InvalidOperationException("Day 2 fixture is restricted to Development.");
        Console.Write("Existing Admin email: ");
        var adminEmail = Console.ReadLine()?.Trim() ?? "";
        Console.Write("Existing Student email: ");
        var studentEmail = Console.ReadLine()?.Trim() ?? "";
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        if ((await db.Database.GetPendingMigrationsAsync()).Any())
            throw new InvalidOperationException("Apply and review migrations explicitly before running this fixture.");
        var admin = await users.FindByEmailAsync(adminEmail);
        var student = await users.FindByEmailAsync(studentEmail);
        if (admin is null || student is null || !await users.IsInRoleAsync(admin, "Admin") ||
            !await users.IsInRoleAsync(student, "Student"))
            throw new InvalidOperationException("Existing Admin and Student accounts with correct roles are required.");
        foreach (var file in new[] { "day2-hello.wav", "day2-practice.wav" })
            if (!File.Exists(Path.Combine(AppContext.BaseDirectory, "DevelopmentMedia", file)))
                throw new InvalidOperationException("Fixture voice asset is missing: " + file);

        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var existingGroup = await db.StudyGroups.SingleOrDefaultAsync(x => x.Id == GroupId);
        var active = await db.StudentGroupMemberships.SingleOrDefaultAsync(x =>
            x.StudentId == student.Id && x.EndedAtUtc == null);
        if (active is not null && active.GroupId != GroupId)
            throw new InvalidOperationException("Student has another active group. The fixture will not move them.");
        if (existingGroup is not null && existingGroup.CreatedByAdminId != admin.Id)
            throw new InvalidOperationException("Fixture group belongs to another Admin.");
        var exists = await db.PublishedCurriculumVersions.AnyAsync(x => x.Id == VersionId);
        if (exists)
        {
            var assignment = await db.GroupCurriculumAssignments.SingleOrDefaultAsync(x => x.GroupId == GroupId);
            if (assignment?.PublishedCurriculumVersionId != VersionId ||
                !await db.PublishedLessonSlots.AnyAsync(x => x.Id == SlotId && x.PublishedCurriculumVersionId == VersionId) ||
                !await db.PublishedLessonSlots.AnyAsync(x => x.Id == FutureSlotId) ||
                !await db.PublishedLessonSlots.AnyAsync(x => x.Id == OtherSlotId) ||
                !await db.PublishedLessonSlots.AnyAsync(x => x.Id == UnassignedSlotId) ||
                await db.LessonSegments.CountAsync(x => x.LessonVersionId == LessonVersionId) != 2)
                throw new InvalidOperationException("Fixture data is inconsistent; no changes were made.");
        }
        else
        {
            if (existingGroup is not null || await db.StudyGroups.AnyAsync(x => x.Id == OtherGroupId) ||
                await db.GroupCurriculumAssignments.AnyAsync(x => x.GroupId == GroupId) ||
                await db.LessonDefinitions.AnyAsync(x => x.Id == DefinitionId))
                throw new InvalidOperationException("Fixture IDs are already in use; no changes were made.");
            var now = DateTimeOffset.UtcNow;
            db.StudyGroups.Add(new StudyGroup { Id = GroupId, Name = "مجموعة تدريب اليوم الثاني",
                CreateRequestId = Guid.Parse("d2000000-0000-4000-8000-000000000009"),
                CreatedByAdminId = admin.Id, CreatedAtUtc = now });
            db.StudyGroups.Add(new StudyGroup { Id = OtherGroupId, Name = "مجموعة اختبار العزل",
                CreateRequestId = Guid.Parse("d2000000-0000-4000-8000-000000000016"),
                CreatedByAdminId = admin.Id, CreatedAtUtc = now });
            db.CurriculumTemplates.Add(new CurriculumTemplate { Id = TemplateId, Name = "محادثات البداية" });
            db.LessonDefinitions.Add(new LessonDefinition { Id = DefinitionId, Title = "التعريف بالنفس" });
            db.LessonVersions.Add(new LessonVersion { Id = LessonVersionId, LessonDefinitionId = DefinitionId,
                VersionNumber = 1, Title = "التعريف بالنفس", Description = "استمع لكل جملة، ثم كررها وسجّل صوتك محليًا.", CreatedAtUtc = now });
            db.LessonSegments.AddRange(
                new LessonSegment { Id = Guid.Parse("d2000000-0000-4000-8000-000000000010"),
                    LessonVersionId = LessonVersionId, Position = 1, Text = "Hello, my name is Alex.", AudioStorageKey = "day2-hello.wav" },
                new LessonSegment { Id = Guid.Parse("d2000000-0000-4000-8000-000000000011"),
                    LessonVersionId = LessonVersionId, Position = 2, Text = "I practice English every day.", AudioStorageKey = "day2-practice.wav" });
            db.PublishedCurriculumVersions.Add(new PublishedCurriculumVersion { Id = VersionId,
                CurriculumTemplateId = TemplateId, GroupId = GroupId, VersionNumber = 1,
                Title = "محادثات البداية", PublishedAtUtc = now, AvailableAtUtc = now });
            db.PublishedCurriculumVersions.Add(new PublishedCurriculumVersion { Id = OtherVersionId,
                CurriculumTemplateId = TemplateId, GroupId = OtherGroupId, VersionNumber = 1,
                Title = "محتوى مجموعة أخرى", PublishedAtUtc = now, AvailableAtUtc = now });
            // Published but no longer assigned: exercises version isolation without exposing it to the student.
            db.PublishedCurriculumVersions.Add(new PublishedCurriculumVersion { Id = UnassignedVersionId,
                CurriculumTemplateId = TemplateId, GroupId = GroupId, VersionNumber = 2,
                Title = "نسخة غير مخصصة", PublishedAtUtc = now, AvailableAtUtc = now });
            db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = SlotId, PublishedCurriculumVersionId = VersionId,
                LessonVersionId = LessonVersionId, WeekNumber = 1, DayNumber = 1, SortOrder = 1, AvailableAtUtc = now });
            db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = FutureSlotId, PublishedCurriculumVersionId = VersionId,
                LessonVersionId = LessonVersionId, WeekNumber = 1, DayNumber = 2, SortOrder = 1,
                AvailableAtUtc = now.AddDays(30) });
            db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = OtherSlotId, PublishedCurriculumVersionId = OtherVersionId,
                LessonVersionId = LessonVersionId, WeekNumber = 1, DayNumber = 1, SortOrder = 1, AvailableAtUtc = now });
            db.PublishedLessonSlots.Add(new PublishedLessonSlot { Id = UnassignedSlotId, PublishedCurriculumVersionId = UnassignedVersionId,
                LessonVersionId = LessonVersionId, WeekNumber = 2, DayNumber = 1, SortOrder = 1, AvailableAtUtc = now });
            db.GroupCurriculumAssignments.Add(new GroupCurriculumAssignment { GroupId = GroupId,
                PublishedCurriculumVersionId = VersionId });
            db.GroupCurriculumAssignments.Add(new GroupCurriculumAssignment { GroupId = OtherGroupId,
                PublishedCurriculumVersionId = OtherVersionId });
        }
        if (active is null)
            db.StudentGroupMemberships.Add(new StudentGroupMembership { Id = Guid.NewGuid(), StudentId = student.Id,
                GroupId = GroupId, AssignedByAdminId = admin.Id, StartedAtUtc = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        app.Logger.LogInformation("Day2.Fixture.Success AdminId={AdminId} StudentId={StudentId} GroupId={GroupId} VersionId={VersionId}",
            admin.Id, student.Id, GroupId, VersionId);
        Console.WriteLine($"Day 2 fixture ready. Group={GroupId}, PublishedVersion={VersionId}, Slot={SlotId}. No web server started.");
    }
}
