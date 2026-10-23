using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using ShadowingEnglish.Api.Modules.AI;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.MediaChecks;

internal static class VoiceBudgetChecks
{
    internal static async Task RunAsync()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite(connection).ReplaceService<IModelCustomizer, UtcTestModelCustomizer>().Options;
        var student = Guid.NewGuid();
        var admin = Guid.NewGuid();
        await using (var db = new ApplicationDbContext(options))
        {
            await db.Database.EnsureCreatedAsync();
            db.Users.AddRange(new ApplicationUser { Id = student, UserName = "budget-student" },
                new ApplicationUser { Id = admin, UserName = "budget-admin" });
            await db.SaveChangesAsync();
        }
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["VoiceBudget:StudentDailyTranscriptions"] = "2",
            ["VoiceBudget:StudentDailyCharacters"] = "100",
            ["VoiceBudget:AdminDailyCharacters"] = "100"
        }).Build();
        await using (var db = new ApplicationDbContext(options))
        {
            Require(await VoiceUsageBudget.TryReserveTranscriptionAsync(db, config, student, default));
            Require(await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, student, 60, false, default));
        }
        await using (var db = new ApplicationDbContext(options))
        {
            Require(await VoiceUsageBudget.TryReserveTranscriptionAsync(db, config, student, default));
            Require(!await VoiceUsageBudget.TryReserveTranscriptionAsync(db, config, student, default));
            Require(!await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, student, 41, false, default));
            Require(await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, student, 40, false, default));
            Require(!await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, student, 1, false, default));
            Require(await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, admin, 100, true, default));
            Require(!await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, admin, 1, true, default));
        }
        static void Require(bool condition)
        {
            if (!condition) throw new InvalidOperationException("voice_budget_boundary_failed");
        }
    }
}
