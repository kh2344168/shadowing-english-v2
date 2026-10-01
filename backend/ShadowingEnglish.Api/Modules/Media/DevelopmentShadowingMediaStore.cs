using System.Security.Cryptography;

namespace ShadowingEnglish.Api.Modules.Media;

public sealed class DevelopmentShadowingMediaStore(IWebHostEnvironment environment,
    IConfiguration configuration, ILogger<DevelopmentShadowingMediaStore> logger)
    : DiagnosticMediaStore(logger, "DevelopmentLocal")
{
    public override bool IsConfigured => environment.IsDevelopment() &&
        LocalShadowingMedia.UploadRoot(environment, configuration) is not null;

    public override async Task WriteAsync(string key, Stream source, CancellationToken cancellation) =>
        await Track("Write", key, async () =>
        {
            if (!IsConfigured) throw new MediaStorageUnavailableException();
            var root = LocalShadowingMedia.UploadRoot(environment, configuration)!;
            Directory.CreateDirectory(root); // Only an explicit Save creates a directory/file.
            await using var target = new FileStream(Path.Combine(root, key), FileMode.CreateNew,
                FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous);
            await source.CopyToAsync(target, cancellation);
            return true;
        }, source.CanSeek ? source.Length : null);

    public override Task<bool> MatchesAsync(string key, Stream source, CancellationToken cancellation) =>
        Track("Match", key, async () =>
        {
            var path = LocalShadowingMedia.ExistingPath(environment, configuration, key);
            if (!IsConfigured || path is null || !File.Exists(path)) return false;
            await using var stored = File.OpenRead(path);
            var incomingHash = await SHA256.HashDataAsync(source, cancellation);
            var storedHash = await SHA256.HashDataAsync(stored, cancellation);
            return CryptographicOperations.FixedTimeEquals(incomingHash, storedHash);
        });

    public override Task<bool> ExistsAsync(string key, CancellationToken cancellation) =>
        Track("Exists", key, () => Task.FromResult(IsConfigured &&
            File.Exists(LocalShadowingMedia.ExistingPath(environment, configuration, key) ?? "")));

    public override Task<ShadowingMediaRead?> OpenAsync(string key, CancellationToken cancellation) =>
        Track<ShadowingMediaRead?>("Open", key, () =>
        {
            var path = LocalShadowingMedia.ExistingPath(environment, configuration, key);
            if (!IsConfigured || path is null || !File.Exists(path))
                return Task.FromResult<ShadowingMediaRead?>(null);
            var info = new FileInfo(path);
            return Task.FromResult<ShadowingMediaRead?>(new ShadowingMediaRead(
                new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536,
                    FileOptions.Asynchronous), info.Length, new DateTimeOffset(info.LastWriteTimeUtc),
                $"\"{info.Length:x}-{info.LastWriteTimeUtc.Ticks:x}\""));
        });

    public override async Task DeleteAsync(string key, CancellationToken cancellation) =>
        await Track("Delete", key, () =>
        {
            if (!IsConfigured) throw new MediaStorageUnavailableException();
            File.Delete(Path.Combine(LocalShadowingMedia.UploadRoot(environment, configuration)!, key));
            return Task.FromResult(true);
        });
}
