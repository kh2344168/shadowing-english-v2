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
        var otherStudent = Guid.NewGuid();
        await using (var db = new ApplicationDbContext(options))
        {
            await db.Database.EnsureCreatedAsync();
            db.Users.AddRange(new ApplicationUser { Id = student, UserName = "budget-student" },
                new ApplicationUser { Id = admin, UserName = "budget-admin" },
                new ApplicationUser { Id = otherStudent, UserName = "budget-other" });
            await db.SaveChangesAsync();
        }
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["VoiceBudget:StudentDailyTranscriptions"] = "2",
            ["VoiceBudget:StudentDailyCharacters"] = "100",
            ["VoiceBudget:AdminDailyCharacters"] = "100",
            ["VoiceBudget:GlobalDailyTranscriptions"] = "2",
            ["VoiceBudget:GlobalDailyCharacters"] = "200"
        }).Build();
        var disabled = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["VoiceBudget:GlobalDailyTranscriptions"] = "0",
            ["VoiceBudget:GlobalDailyCharacters"] = "0"
        }).Build();
        await using (var db = new ApplicationDbContext(options))
        {
            Require(!await VoiceUsageBudget.TryReserveTranscriptionAsync(db, disabled, student, default));
            Require(!await VoiceUsageBudget.TryReserveSynthesisAsync(db, disabled, student, 1, false, default));
            Require(!await db.VoiceDailyUsages.AnyAsync());
        }
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
            Require(!await VoiceUsageBudget.TryReserveTranscriptionAsync(db, config, otherStudent, default));
            Require(!await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, otherStudent, 1, false, default));
        }
        var sqlConnection = Environment.GetEnvironmentVariable("VOICE_BUDGET_SQL_CONNECTION");
        if (!string.IsNullOrWhiteSpace(sqlConnection))
            await CheckSqlConcurrencyAsync(sqlConnection);
        static void Require(bool condition)
        {
            if (!condition) throw new InvalidOperationException("voice_budget_boundary_failed");
        }
    }

    private static async Task CheckSqlConcurrencyAsync(string connection)
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlServer(connection).Options;
        var ids = new[] { Guid.NewGuid(), Guid.NewGuid() };
        await using (var db = new ApplicationDbContext(options))
        {
            foreach (var id in ids)
                db.Users.Add(new ApplicationUser
                {
                    Id = id, UserName = $"voice-budget-{id:N}",
                    NormalizedUserName = $"VOICE-BUDGET-{id:N}",
                    SecurityStamp = Guid.NewGuid().ToString("N")
                });
            await db.SaveChangesAsync();
        }
        try
        {
            long used;
            long usedCharacters;
            await using (var db = new ApplicationDbContext(options))
            {
                used = await db.VoiceDailyUsages.AsNoTracking()
                    .Where(x => x.DayUtc == DateOnly.FromDateTime(DateTime.UtcNow))
                    .SumAsync(x => (long)x.TranscriptionRequests);
                usedCharacters = await db.VoiceDailyUsages.AsNoTracking()
                    .Where(x => x.DayUtc == DateOnly.FromDateTime(DateTime.UtcNow))
                    .SumAsync(x => (long)x.SynthesisCharacters);
            }
            if (used >= 99_999) throw new InvalidOperationException("voice_budget_test_database_too_busy");
            if (usedCharacters >= 9_999_999) throw new InvalidOperationException("voice_budget_test_database_too_busy");
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["VoiceBudget:StudentDailyTranscriptions"] = "12",
                ["VoiceBudget:GlobalDailyTranscriptions"] = (used + 1).ToString(),
                ["VoiceBudget:StudentDailyCharacters"] = "100",
                ["VoiceBudget:GlobalDailyCharacters"] = (usedCharacters + 1).ToString()
            }).Build();
            async Task<bool> Reserve(Guid id)
            {
                await using var db = new ApplicationDbContext(options);
                return await VoiceUsageBudget.TryReserveTranscriptionAsync(db, config, id, default);
            }
            var results = await Task.WhenAll(ids.Select(Reserve));
            if (results.Count(x => x) != 1)
                throw new InvalidOperationException("global_voice_budget_race_failed");
            async Task<bool> ReserveSpeech(Guid id)
            {
                await using var db = new ApplicationDbContext(options);
                return await VoiceUsageBudget.TryReserveSynthesisAsync(db, config, id, 1, false, default);
            }
            var speechResults = await Task.WhenAll(ids.Select(ReserveSpeech));
            if (speechResults.Count(x => x) != 1)
                throw new InvalidOperationException("global_speech_budget_race_failed");
            Console.WriteLine("PASS SQL Server global voice budget serializes transcription and synthesis across users");
        }
        finally
        {
            await using var db = new ApplicationDbContext(options);
            foreach (var id in ids)
            {
                var user = await db.Users.FindAsync(id);
                if (user is null) continue;
                user.LockoutEnd = DateTimeOffset.MaxValue;
                user.SecurityStamp = Guid.NewGuid().ToString("N");
            }
            await db.SaveChangesAsync();
        }
    }
}
