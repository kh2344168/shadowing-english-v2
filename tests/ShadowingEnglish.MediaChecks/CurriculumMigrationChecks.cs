using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.MediaChecks;

// Explicit opt-in only. Uses two NEW disposable databases on loopback SQL Server, never a deployed database.
internal static class CurriculumMigrationChecks
{
    private const string CurrentMigration = "20261002101732_AddIndependentCurriculumDraft";
    private const string PreviousMigration = "20261001144800_EnforceCurriculumScope";
    private static void Assert(bool condition, string reason)
    { if (!condition) throw new InvalidOperationException(reason); }
    private static ApplicationDbContext Context(string connection) => new(
        new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlServer(connection).Options);

    public static async Task<int> RunAsync(Func<string, Func<Task>, Task> check, Func<int> failures)
    {
        var connection = Environment.GetEnvironmentVariable("V2_CURRICULUM_SQL_TEST_CONNECTION");
        if (string.IsNullOrWhiteSpace(connection))
        { Console.WriteLine("NOT RUN curriculum migrations: explicit loopback test connection required."); return 2; }
        var settings = new SqlConnectionStringBuilder(connection);
        Assert(Regex.IsMatch(settings.DataSource, @"^(127\.0\.0\.1|localhost)(,\d+)?$", RegexOptions.CultureInvariant) &&
            Regex.IsMatch(settings.InitialCatalog, @"^V2_CurriculumCheck_[a-f0-9]{32}$", RegexOptions.CultureInvariant),
            "only_new_loopback_curriculum_test_databases_allowed");
        var upgradeSettings = new SqlConnectionStringBuilder(connection) { InitialCatalog = settings.InitialCatalog + "_Upgrade" };
        // Refuse to reuse/delete any database that existed before this explicitly requested test.
        await MustNotExist(settings);
        await MustNotExist(upgradeSettings);
        await using var zero = Context(settings.ConnectionString);
        await using var upgrade = Context(upgradeSettings.ConnectionString);
        try
        {
            await check("SQL Server migration from zero applies the complete migration chain", async () =>
            {
                await zero.Database.MigrateAsync();
                var applied = (await zero.Database.GetAppliedMigrationsAsync()).ToArray();
                Assert(applied.SequenceEqual(zero.Database.GetMigrations()) && applied.Last() == CurrentMigration &&
                    !(await zero.Database.GetPendingMigrationsAsync()).Any(), "migration_chain_incomplete");
                Assert(!zero.Database.HasPendingModelChanges(), "pending_model_changes");
                Assert(await zero.CurriculumDraftLessonSlots.CountAsync() == 0, "new_draft_table_not_empty");
            });
            await check("SQL Server draft positions persist and database constraints reject duplicate slots", async () =>
            {
                var template = new CurriculumTemplate { Id = Guid.NewGuid(), Name = "Migration draft", DraftRevision = Guid.NewGuid() };
                var definition = new LessonDefinition { Id = Guid.NewGuid(), Title = "Test saved lesson" };
                var version = new LessonVersion { Id = Guid.NewGuid(), LessonDefinitionId = definition.Id,
                    Title = definition.Title, VersionNumber = 1, CreatedAtUtc = DateTimeOffset.UtcNow };
                zero.CurriculumTemplates.Add(template); zero.LessonDefinitions.Add(definition); zero.LessonVersions.Add(version);
                zero.CurriculumDraftLessonSlots.Add(new CurriculumDraftLessonSlot { Id = Guid.NewGuid(),
                    CurriculumTemplateId = template.Id, LessonVersionId = version.Id, WeekNumber = 52, DayNumber = 7, SortOrder = 100 });
                await zero.SaveChangesAsync(); zero.ChangeTracker.Clear();
                await using var refresh = Context(settings.ConnectionString);
                var restored = await refresh.CurriculumDraftLessonSlots.SingleAsync();
                Assert(restored.WeekNumber == 52 && restored.DayNumber == 7 && restored.SortOrder == 100, "sql_draft_order_not_persisted");
                refresh.CurriculumDraftLessonSlots.Add(new CurriculumDraftLessonSlot { Id = Guid.NewGuid(),
                    CurriculumTemplateId = template.Id, LessonVersionId = version.Id, WeekNumber = 52, DayNumber = 7, SortOrder = 100 });
                var rejected = false;
                try { await refresh.SaveChangesAsync(); }
                catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 }) { rejected = true; }
                Assert(rejected, "sql_unique_slot_not_enforced");
            });
            await check("SQL Server revision concurrency rejects a second editor without overwriting the first", async () =>
            {
                await using var first = Context(settings.ConnectionString);
                await using var second = Context(settings.ConnectionString);
                var a = await first.CurriculumTemplates.SingleAsync(); var b = await second.CurriculumTemplates.SingleAsync();
                a.Name = "First editor"; a.DraftRevision = Guid.NewGuid(); await first.SaveChangesAsync();
                b.Name = "Stale editor"; b.DraftRevision = Guid.NewGuid();
                var rejected = false;
                try { await second.SaveChangesAsync(); } catch (DbUpdateConcurrencyException) { rejected = true; }
                await using var refreshed = Context(settings.ConnectionString);
                Assert(rejected && (await refreshed.CurriculumTemplates.SingleAsync()).Name == "First editor", "sql_concurrent_edit_overwrote_draft");
            });
            await check("SQL Server additive upgrade preserves existing published slots assignments and student progress", async () =>
            {
                await upgrade.GetService<IMigrator>().MigrateAsync(PreviousMigration);
                var user = Guid.NewGuid(); var group = Guid.NewGuid(); var template = Guid.NewGuid();
                var definition = Guid.NewGuid(); var lesson = Guid.NewGuid(); var published = Guid.NewGuid(); var slot = Guid.NewGuid();
                var now = DateTimeOffset.UtcNow;
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO AspNetUsers (Id,EmailConfirmed,PhoneNumberConfirmed,TwoFactorEnabled,LockoutEnabled,AccessFailedCount) VALUES ({user},0,0,0,0,0)");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO StudyGroups (Id,Name,CreateRequestId,CreatedAtUtc,CreatedByAdminId) VALUES ({group},{"Legacy group"},{Guid.NewGuid()},{now},{user})");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO CurriculumTemplates (Id,Name) VALUES ({template},{"Legacy curriculum"})");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO LessonDefinitions (Id,Title) VALUES ({definition},{"Legacy lesson"})");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO LessonVersions (Id,LessonDefinitionId,VersionNumber,Title,Description,CreatedAtUtc) VALUES ({lesson},{definition},1,{"Legacy lesson"},{""},{now})");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO PublishedCurriculumVersions (Id,CurriculumTemplateId,GroupId,VersionNumber,Title,PublishedAtUtc,AvailableAtUtc) VALUES ({published},{template},{group},1,{"Legacy snapshot"},{now},{now})");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO PublishedLessonSlots (Id,PublishedCurriculumVersionId,LessonVersionId,WeekNumber,DayNumber,SortOrder,AvailableAtUtc) VALUES ({slot},{published},{lesson},3,4,5,{now})");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO GroupCurriculumAssignments (GroupId,PublishedCurriculumVersionId) VALUES ({group},{published})");
                await upgrade.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO StudentStageProgress (StudentId,PublishedCurriculumVersionId,SlotId,StageKey,CompletedSegments,IsComplete,UpdatedAtUtc) VALUES ({user},{published},{slot},{"shadowing"},2,1,{now})");
                await upgrade.Database.MigrateAsync();
                var progress = await upgrade.StudentStageProgress.SingleAsync();
                var originalSlot = await upgrade.PublishedLessonSlots.SingleAsync();
                var originalVersion = await upgrade.PublishedCurriculumVersions.SingleAsync();
                var originalGroup = await upgrade.StudyGroups.SingleAsync();
                var originalTemplate = await upgrade.CurriculumTemplates.SingleAsync();
                Assert(progress.CompletedSegments == 2 && progress.IsComplete && progress.UpdatedAtUtc == now &&
                    progress.PublishedCurriculumVersionId == published && originalSlot.Id == slot && originalSlot.WeekNumber == 3 &&
                    originalSlot.DayNumber == 4 && originalSlot.SortOrder == 5 && originalVersion.Title == "Legacy snapshot" &&
                    originalVersion.SourceDraftRevision is null && originalVersion.PublishRequestHash is null &&
                    (await upgrade.GroupCurriculumAssignments.SingleAsync()).PublishedCurriculumVersionId == published &&
                    originalGroup.AssignedCurriculumTemplateId is null && originalGroup.CurriculumAssignmentRevision == Guid.Empty &&
                    originalTemplate.DraftRevision == Guid.Empty && originalTemplate.Description == "" &&
                    !await upgrade.CurriculumDraftLessonSlots.AnyAsync(), "upgrade_mutated_legacy_snapshot_or_progress");
                Assert(!upgrade.Database.HasPendingModelChanges(), "upgrade_pending_model_changes");
            });
            Console.WriteLine("Curriculum SQL Server migration checks completed; failures=" + failures());
            return failures() == 0 ? 0 : 1;
        }
        finally
        {
            await zero.Database.EnsureDeletedAsync();
            await upgrade.Database.EnsureDeletedAsync();
        }
    }

    private static async Task MustNotExist(SqlConnectionStringBuilder settings)
    {
        var master = new SqlConnectionStringBuilder(settings.ConnectionString) { InitialCatalog = "master" };
        await using var connection = new SqlConnection(master.ConnectionString); await connection.OpenAsync();
        await using var command = connection.CreateCommand(); command.CommandText = "SELECT DB_ID(@name)";
        command.Parameters.AddWithValue("@name", settings.InitialCatalog);
        Assert(await command.ExecuteScalarAsync() is DBNull, "test_database_already_exists_refusing_changes");
    }
}
