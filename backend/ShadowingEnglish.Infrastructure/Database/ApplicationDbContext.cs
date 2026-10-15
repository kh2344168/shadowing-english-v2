using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Groups;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.AIProviders;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Infrastructure.Database;

public sealed class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<StudyGroup> StudyGroups => Set<StudyGroup>();
    public DbSet<StudentGroupMembership> StudentGroupMemberships => Set<StudentGroupMembership>();
    public DbSet<LessonDefinition> LessonDefinitions => Set<LessonDefinition>();
    public DbSet<LessonVersion> LessonVersions => Set<LessonVersion>();
    public DbSet<LessonSegment> LessonSegments => Set<LessonSegment>();
    public DbSet<CurriculumTemplate> CurriculumTemplates => Set<CurriculumTemplate>();
    public DbSet<CurriculumDraftLessonSlot> CurriculumDraftLessonSlots => Set<CurriculumDraftLessonSlot>();
    public DbSet<PublishedCurriculumVersion> PublishedCurriculumVersions => Set<PublishedCurriculumVersion>();
    public DbSet<GroupCurriculumAssignment> GroupCurriculumAssignments => Set<GroupCurriculumAssignment>();
    public DbSet<PublishedLessonSlot> PublishedLessonSlots => Set<PublishedLessonSlot>();
    public DbSet<StudentStageProgress> StudentStageProgress => Set<StudentStageProgress>();
    public DbSet<LessonAiContent> LessonAiContents => Set<LessonAiContent>();
    public DbSet<LessonWorkflow> LessonWorkflows => Set<LessonWorkflow>();
    public DbSet<StudentPracticeAttempt> StudentPracticeAttempts => Set<StudentPracticeAttempt>();
    public DbSet<StudentAiDailyUsage> StudentAiDailyUsages => Set<StudentAiDailyUsage>();
    public DbSet<AiProviderConfiguration> AiProviderConfigurations => Set<AiProviderConfiguration>();
    public DbSet<AiProviderAuditEntry> AiProviderAuditEntries => Set<AiProviderAuditEntry>();

    public override int SaveChanges() { RejectPublishedMutations(); return base.SaveChanges(); }
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    { RejectPublishedMutations(); return base.SaveChanges(acceptAllChangesOnSuccess); }
    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    { RejectPublishedMutations(); return base.SaveChangesAsync(cancellationToken); }
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    { RejectPublishedMutations(); return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken); }

    private void RejectPublishedMutations()
    {
        ChangeTracker.DetectChanges();
        if (ChangeTracker.Entries().Any(entry =>
            entry.State is EntityState.Modified or EntityState.Deleted &&
            entry.Entity is PublishedCurriculumVersion or PublishedLessonSlot or LessonVersion or LessonSegment))
            throw new InvalidOperationException("Published lesson and curriculum snapshots cannot be changed.");
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Identity's default EmailIndex is not unique; enforce the same requirement in SQL Server.
        builder.Entity<ApplicationUser>()
            .HasIndex(user => user.NormalizedEmail)
            .HasDatabaseName("EmailIndex")
            .IsUnique()
            .HasFilter("[NormalizedEmail] IS NOT NULL");

        builder.Entity<StudyGroup>(entity =>
        {
            entity.ToTable("StudyGroups");
            entity.HasKey(group => group.Id);
            entity.Property(group => group.Name).IsRequired().HasMaxLength(120);
            entity.HasIndex(group => group.CreateRequestId).IsUnique();
            entity.Property(group => group.CurriculumAssignmentRevision).IsConcurrencyToken();
            entity.Property(group => group.LastCurriculumAssignmentRequestHash).HasMaxLength(64);
            entity.HasOne<CurriculumTemplate>().WithMany()
                .HasForeignKey(group => group.AssignedCurriculumTemplateId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(group => group.CreatedByAdminId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<StudentGroupMembership>(entity =>
        {
            entity.ToTable("StudentGroupMemberships", table => table.HasCheckConstraint(
                "CK_StudentGroupMemberships_EndAfterStart", "[EndedAtUtc] IS NULL OR [EndedAtUtc] >= [StartedAtUtc]"));
            entity.HasKey(membership => membership.Id);
            entity.HasIndex(membership => membership.StudentId)
                .IsUnique()
                .HasFilter("[EndedAtUtc] IS NULL")
                .HasDatabaseName("UX_StudentGroupMemberships_ActiveStudent");
            entity.HasIndex(membership => new { membership.StudentId, membership.StartedAtUtc });
            entity.HasIndex(membership => new { membership.GroupId, membership.EndedAtUtc });
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(membership => membership.StudentId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<StudyGroup>().WithMany()
                .HasForeignKey(membership => membership.GroupId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(membership => membership.AssignedByAdminId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(membership => membership.EndedByAdminId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<LessonDefinition>(entity =>
        {
            entity.ToTable("LessonDefinitions"); entity.HasKey(x => x.Id);
            entity.Property(x => x.Title).IsRequired().HasMaxLength(160);
        });
        builder.Entity<LessonVersion>(entity =>
        {
            entity.ToTable("LessonVersions", t => t.HasCheckConstraint("CK_LessonVersions_Number", "[VersionNumber] > 0"));
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Title).IsRequired().HasMaxLength(160);
            entity.Property(x => x.Description).IsRequired().HasMaxLength(1000);
            entity.HasIndex(x => new { x.LessonDefinitionId, x.VersionNumber }).IsUnique();
            entity.HasOne<LessonDefinition>().WithMany().HasForeignKey(x => x.LessonDefinitionId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<LessonSegment>(entity =>
        {
            entity.ToTable("LessonSegments", t => t.HasCheckConstraint("CK_LessonSegments_Position", "[Position] > 0"));
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Text).IsRequired().HasMaxLength(1000);
            entity.Property(x => x.AudioStorageKey).IsRequired().HasMaxLength(200);
            entity.HasIndex(x => new { x.LessonVersionId, x.Position }).IsUnique();
            entity.HasOne<LessonVersion>().WithMany().HasForeignKey(x => x.LessonVersionId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<CurriculumTemplate>(entity =>
        {
            entity.ToTable("CurriculumTemplates"); entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).IsRequired().HasMaxLength(160);
            entity.Property(x => x.Description).IsRequired().HasMaxLength(1000);
            entity.Property(x => x.DraftRevision).IsConcurrencyToken();
            entity.Property(x => x.CreateRequestHash).HasMaxLength(64);
            entity.Property(x => x.LastUpdateRequestHash).HasMaxLength(64);
        });
        builder.Entity<CurriculumDraftLessonSlot>(entity =>
        {
            entity.ToTable("CurriculumDraftLessonSlots", table => table.HasCheckConstraint(
                "CK_CurriculumDraftLessonSlots_Position",
                "[WeekNumber] BETWEEN 1 AND 52 AND [DayNumber] BETWEEN 1 AND 7 AND [SortOrder] BETWEEN 1 AND 100"));
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.CurriculumTemplateId, x.WeekNumber, x.DayNumber, x.SortOrder }).IsUnique();
            entity.HasIndex(x => new { x.CurriculumTemplateId, x.LessonVersionId }).IsUnique();
            entity.HasOne<CurriculumTemplate>().WithMany().HasForeignKey(x => x.CurriculumTemplateId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<LessonVersion>().WithMany().HasForeignKey(x => x.LessonVersionId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<PublishedCurriculumVersion>(entity =>
        {
            entity.ToTable("PublishedCurriculumVersions", t => t.HasCheckConstraint("CK_PublishedCurriculumVersions_Number", "[VersionNumber] > 0"));
            entity.HasKey(x => x.Id);
            entity.HasAlternateKey(x => new { x.Id, x.GroupId });
            entity.Property(x => x.Title).IsRequired().HasMaxLength(160);
            entity.HasIndex(x => new { x.GroupId, x.CurriculumTemplateId, x.VersionNumber }).IsUnique();
            entity.Property(x => x.PublishRequestHash).HasMaxLength(64);
            entity.HasOne<StudyGroup>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CurriculumTemplate>().WithMany().HasForeignKey(x => x.CurriculumTemplateId).OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<GroupCurriculumAssignment>(entity =>
        {
            entity.ToTable("GroupCurriculumAssignments"); entity.HasKey(x => x.GroupId);
            entity.HasIndex(x => x.PublishedCurriculumVersionId);
            entity.HasOne<StudyGroup>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<PublishedCurriculumVersion>().WithMany()
                .HasForeignKey(x => new { x.PublishedCurriculumVersionId, x.GroupId })
                .HasPrincipalKey(x => new { x.Id, x.GroupId })
                .OnDelete(DeleteBehavior.Restrict);
        });
        builder.Entity<PublishedLessonSlot>(entity =>
        {
            entity.ToTable("PublishedLessonSlots", t => t.HasCheckConstraint("CK_PublishedLessonSlots_Order", "[WeekNumber] > 0 AND [DayNumber] > 0 AND [SortOrder] > 0"));
            entity.HasKey(x => x.Id);
            entity.HasAlternateKey(x => new { x.Id, x.PublishedCurriculumVersionId });
            entity.HasIndex(x => new { x.PublishedCurriculumVersionId, x.WeekNumber, x.DayNumber, x.SortOrder }).IsUnique();
            entity.HasOne<PublishedCurriculumVersion>().WithMany().HasForeignKey(x => x.PublishedCurriculumVersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<LessonVersion>().WithMany().HasForeignKey(x => x.LessonVersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<LessonAiContent>().WithMany().HasForeignKey(x => x.AiContentId).OnDelete(DeleteBehavior.Restrict);
            entity.Property(x => x.WorkflowStagesJson).HasMaxLength(16000);
        });
        builder.Entity<StudentStageProgress>(entity =>
        {
            entity.ToTable("StudentStageProgress", t => t.HasCheckConstraint("CK_StudentStageProgress_Count", "[CompletedSegments] >= 0"));
            entity.HasKey(x => new { x.StudentId, x.PublishedCurriculumVersionId, x.SlotId, x.StageKey });
            entity.Property(x => x.StageKey).IsRequired().HasMaxLength(32);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.StudentId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<PublishedCurriculumVersion>().WithMany().HasForeignKey(x => x.PublishedCurriculumVersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<PublishedLessonSlot>().WithMany()
                .HasForeignKey(x => new { x.SlotId, x.PublishedCurriculumVersionId })
                .HasPrincipalKey(x => new { x.Id, x.PublishedCurriculumVersionId })
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<LessonAiContent>(entity =>
        {
            entity.ToTable("LessonAiContents");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Status).IsRequired().HasMaxLength(16);
            entity.Property(x => x.PayloadJson).HasMaxLength(32000);
            entity.Property(x => x.ProviderName).HasMaxLength(32);
            entity.Property(x => x.ErrorCode).HasMaxLength(64);
            entity.HasIndex(x => new { x.LessonVersionId, x.CreatedAtUtc });
            entity.HasOne<LessonVersion>().WithMany().HasForeignKey(x => x.LessonVersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CreatedByAdminId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<LessonWorkflow>(entity =>
        {
            entity.ToTable("LessonWorkflows");
            entity.HasKey(x => x.LessonVersionId);
            entity.Property(x => x.StagesJson).IsRequired().HasMaxLength(16000);
            entity.Property(x => x.Revision).IsConcurrencyToken();
            entity.HasOne<LessonVersion>().WithOne().HasForeignKey<LessonWorkflow>(x => x.LessonVersionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<StudentAiDailyUsage>(entity =>
        {
            entity.ToTable("StudentAiDailyUsages", table => table.HasCheckConstraint("CK_StudentAiDailyUsages_Used", "[UsedRequests] >= 0"));
            entity.HasKey(x => new { x.StudentId, x.DayUtc });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.StudentId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<StudentPracticeAttempt>(entity =>
        {
            entity.ToTable("StudentPracticeAttempts");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.StageKey).IsRequired().HasMaxLength(32);
            entity.Property(x => x.Answer).IsRequired().HasMaxLength(600);
            entity.Property(x => x.FeedbackJson).IsRequired().HasMaxLength(3000);
            entity.HasIndex(x => x.PublishedCurriculumVersionId);
            entity.HasIndex(x => new { x.SlotId, x.PublishedCurriculumVersionId });
            entity.HasIndex(x => new { x.StudentId, x.SlotId, x.StageKey, x.CreatedAtUtc });
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.StudentId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<PublishedCurriculumVersion>().WithMany().HasForeignKey(x => x.PublishedCurriculumVersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<PublishedLessonSlot>().WithMany()
                .HasForeignKey(x => new { x.SlotId, x.PublishedCurriculumVersionId })
                .HasPrincipalKey(x => new { x.Id, x.PublishedCurriculumVersionId })
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<AiProviderConfiguration>(entity =>
        {
            entity.ToTable("AiProviderConfigurations", table => table.HasCheckConstraint(
                "CK_AiProviderConfigurations_Priority", "[Priority] BETWEEN 1 AND 100"));
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Capability).IsRequired().HasMaxLength(32);
            entity.Property(x => x.ProviderKey).IsRequired().HasMaxLength(48);
            entity.Property(x => x.EncryptedApiKey).HasMaxLength(4096);
            entity.Property(x => x.KeyLast4).HasMaxLength(4);
            entity.Property(x => x.AccountId).HasMaxLength(160);
            entity.Property(x => x.ProjectId).HasMaxLength(160);
            entity.Property(x => x.Model).HasMaxLength(200);
            entity.Property(x => x.Status).IsRequired().HasMaxLength(40);
            entity.Property(x => x.LastFailureReason).HasMaxLength(64);
            entity.Property(x => x.Revision).IsConcurrencyToken();
            entity.Property(x => x.LastMutationRequestHash).HasMaxLength(64);
            entity.HasIndex(x => new { x.Capability, x.ProviderKey }).IsUnique();
            entity.HasIndex(x => new { x.Capability, x.Enabled, x.Priority });
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(x => x.UpdatedByAdminId).OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<AiProviderAuditEntry>(entity =>
        {
            entity.ToTable("AiProviderAuditEntries");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Capability).IsRequired().HasMaxLength(32);
            entity.Property(x => x.ProviderKey).IsRequired().HasMaxLength(48);
            entity.Property(x => x.Action).IsRequired().HasMaxLength(40);
            entity.Property(x => x.ResultCode).IsRequired().HasMaxLength(64);
            entity.HasIndex(x => new { x.ProviderConfigurationId, x.OccurredAtUtc });
            entity.HasOne<AiProviderConfiguration>().WithMany()
                .HasForeignKey(x => x.ProviderConfigurationId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>().WithMany()
                .HasForeignKey(x => x.ActorAdminId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
