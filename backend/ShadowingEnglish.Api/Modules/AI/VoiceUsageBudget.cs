using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Learning;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.AI;

internal static class VoiceUsageBudget
{
    internal static async Task<bool> TryReserveTranscriptionAsync(ApplicationDbContext db,
        IConfiguration config, Guid userId, CancellationToken cancellationToken) =>
        await TryReserveAsync(db, userId, transcription: 1, characters: 0,
            Math.Clamp(config.GetValue<int?>("VoiceBudget:StudentDailyTranscriptions") ?? 12, 1, 100),
            0, config, cancellationToken);

    internal static async Task<bool> TryReserveSynthesisAsync(ApplicationDbContext db,
        IConfiguration config, Guid userId, int characters, bool admin, CancellationToken cancellationToken) =>
        await TryReserveAsync(db, userId, transcription: 0, characters,
            0, Math.Clamp(config.GetValue<int?>(admin
                ? "VoiceBudget:AdminDailyCharacters" : "VoiceBudget:StudentDailyCharacters") ??
                (admin ? 3_000 : 10_000), 100, 100_000), config, cancellationToken);

    private static async Task<bool> TryReserveAsync(ApplicationDbContext db, Guid userId,
        int transcription, int characters, int transcriptionLimit, int characterLimit,
        IConfiguration config,
        CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var globalTranscriptionLimit = Math.Clamp(
            config.GetValue<int?>("VoiceBudget:GlobalDailyTranscriptions") ?? 500, 0, 100_000);
        var globalCharacterLimit = Math.Clamp(
            config.GetValue<int?>("VoiceBudget:GlobalDailyCharacters") ?? 100_000, 0, 10_000_000);
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                await using var transaction = await db.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                // SQL Server needs a shared lock across users before reading the daily total.
                // A serializable transaction alone does not serialize inserts for different UserIds.
                if (db.Database.IsSqlServer())
                    await db.Database.ExecuteSqlInterpolatedAsync(
                        $"DECLARE @result int; EXEC @result = sp_getapplock @Resource = {"voice-budget-" + today.ToString("yyyyMMdd")}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; IF @result < 0 THROW 51000, 'voice_budget_lock_failed', 1;",
                        cancellationToken);
                var totals = await db.VoiceDailyUsages.AsNoTracking()
                    .Where(x => x.DayUtc == today)
                    .GroupBy(_ => 1)
                    .Select(rows => new
                    {
                        Transcriptions = rows.Sum(x => (long)x.TranscriptionRequests),
                        Characters = rows.Sum(x => (long)x.SynthesisCharacters)
                    }).SingleOrDefaultAsync(cancellationToken);
                if (transcription > 0 && (totals?.Transcriptions ?? 0) > globalTranscriptionLimit - transcription ||
                    characters > 0 && (totals?.Characters ?? 0) > globalCharacterLimit - characters)
                    return false;
                var usage = await db.VoiceDailyUsages.SingleOrDefaultAsync(x =>
                    x.UserId == userId && x.DayUtc == today, cancellationToken);
                if (usage is null)
                {
                    usage = new VoiceDailyUsage { UserId = userId, DayUtc = today };
                    db.VoiceDailyUsages.Add(usage);
                }
                if (transcription > 0 && usage.TranscriptionRequests > transcriptionLimit - transcription ||
                    characters > 0 && usage.SynthesisCharacters > characterLimit - characters)
                {
                    if (db.Entry(usage).State == EntityState.Added) db.Entry(usage).State = EntityState.Detached;
                    return false;
                }
                usage.TranscriptionRequests += transcription;
                usage.SynthesisCharacters += characters;
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return true;
            }
            catch (Exception error) when (attempt < 2 &&
                (error is DbUpdateException || error is SqlException sql &&
                    sql.Number is 1205 or 2601 or 2627))
            {
                // Two first requests for the same day may race to create the row.
                db.ChangeTracker.Clear();
            }
        }
        throw new InvalidOperationException("voice_budget_reservation_failed");
    }
}
