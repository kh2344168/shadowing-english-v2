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
            0, cancellationToken);

    internal static async Task<bool> TryReserveSynthesisAsync(ApplicationDbContext db,
        IConfiguration config, Guid userId, int characters, bool admin, CancellationToken cancellationToken) =>
        await TryReserveAsync(db, userId, transcription: 0, characters,
            0, Math.Clamp(config.GetValue<int?>(admin
                ? "VoiceBudget:AdminDailyCharacters" : "VoiceBudget:StudentDailyCharacters") ??
                (admin ? 3_000 : 10_000), 100, 100_000), cancellationToken);

    private static async Task<bool> TryReserveAsync(ApplicationDbContext db, Guid userId,
        int transcription, int characters, int transcriptionLimit, int characterLimit,
        CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                await using var transaction = await db.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var usage = await db.VoiceDailyUsages.SingleOrDefaultAsync(x =>
                    x.UserId == userId && x.DayUtc == today, cancellationToken);
                if (usage is null)
                {
                    usage = new VoiceDailyUsage { UserId = userId, DayUtc = today };
                    db.VoiceDailyUsages.Add(usage);
                }
                if (transcription > 0 && usage.TranscriptionRequests > transcriptionLimit - transcription ||
                    characters > 0 && usage.SynthesisCharacters > characterLimit - characters)
                    return false;
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
