using System.Security.Cryptography;
using Azure;
using Azure.Storage;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace ShadowingEnglish.Api.Modules.Media;

// No container creation, public access, SAS, model hosting or writes during GET/startup.
public sealed class AzureBlobShadowingMediaStore(BlobContainerClient container,
    ILogger<AzureBlobShadowingMediaStore> logger) : DiagnosticMediaStore(logger, "AzureBlob")
{
    private readonly SemaphoreSlim privacyGate = new(1, 1);
    private long privateCheckedUntilTicks;
    public override bool IsConfigured => true;
    private BlobClient Blob(string key) => container.GetBlobClient("shadowing-v2/" + key);

    private async Task RequirePrivateContainer(CancellationToken cancellation)
    {
        if (DateTimeOffset.UtcNow.UtcTicks < Volatile.Read(ref privateCheckedUntilTicks)) return;
        await privacyGate.WaitAsync(cancellation);
        try
        {
            if (DateTimeOffset.UtcNow.UtcTicks < Volatile.Read(ref privateCheckedUntilTicks)) return;
            var properties = await container.GetPropertiesAsync(cancellationToken: cancellation);
            if (properties.Value.PublicAccess != PublicAccessType.None)
                throw new MediaStorageUnavailableException();
            Volatile.Write(ref privateCheckedUntilTicks, DateTimeOffset.UtcNow.AddSeconds(30).UtcTicks);
        }
        finally { privacyGate.Release(); }
    }

    public override async Task WriteAsync(string key, Stream source, CancellationToken cancellation) =>
        await Track("Write", key, async () =>
        {
            await RequirePrivateContainer(cancellation);
            if (!source.CanSeek) throw new ArgumentException("seekable_upload_required");
            var position = source.Position;
            var digest = await SHA256.HashDataAsync(source, cancellation);
            source.Position = position;
            var options = new BlobUploadOptions
            {
                // Existing assets are immutable. Retrying never overwrites a published blob.
                Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All },
                HttpHeaders = new BlobHttpHeaders { ContentType = "audio/wav", CacheControl = "private, no-cache" },
                Metadata = new Dictionary<string, string> { ["sha256"] = Convert.ToHexStringLower(digest) },
                TransferOptions = new StorageTransferOptions
                { MaximumConcurrency = 1, InitialTransferSize = 2_000_000, MaximumTransferSize = 2_000_000 },
                TransferValidation = new UploadTransferValidationOptions { ChecksumAlgorithm = StorageChecksumAlgorithm.MD5 }
            };
            await Blob(key).UploadAsync(source, options, cancellation);
            return true;
        }, source.CanSeek ? source.Length : null);

    public override Task<bool> MatchesAsync(string key, Stream source, CancellationToken cancellation) =>
        Track("Match", key, async () =>
        {
            await RequirePrivateContainer(cancellation);
            if (!(await Blob(key).ExistsAsync(cancellation)).Value) return false;
            await using var stored = await Blob(key).OpenReadAsync(
                new BlobOpenReadOptions(false) { BufferSize = 65536 }, cancellation);
            var incomingHash = await SHA256.HashDataAsync(source, cancellation);
            var storedHash = await SHA256.HashDataAsync(stored, cancellation);
            return CryptographicOperations.FixedTimeEquals(incomingHash, storedHash);
        });

    public override Task<bool> ExistsAsync(string key, CancellationToken cancellation) =>
        Track("Exists", key, async () =>
        {
            await RequirePrivateContainer(cancellation);
            return (await Blob(key).ExistsAsync(cancellation)).Value;
        });

    public override Task<ShadowingMediaRead?> OpenAsync(string key, CancellationToken cancellation) =>
        Track<ShadowingMediaRead?>("Open", key, async () =>
        {
            await RequirePrivateContainer(cancellation);
            try
            {
                var properties = (await Blob(key).GetPropertiesAsync(cancellationToken: cancellation)).Value;
                var stream = await Blob(key).OpenReadAsync(new BlobOpenReadOptions(false)
                {
                    BufferSize = 65536,
                    Conditions = new BlobRequestConditions { IfMatch = properties.ETag }
                }, cancellation);
                return new ShadowingMediaRead(stream, properties.ContentLength,
                    properties.LastModified, properties.ETag.ToString());
            }
            catch (RequestFailedException error) when (error.Status == 404) { return null; }
        });

    public override async Task DeleteAsync(string key, CancellationToken cancellation) =>
        await Track("Delete", key, async () =>
        {
            await RequirePrivateContainer(cancellation);
            return (await Blob(key).DeleteIfExistsAsync(cancellationToken: cancellation)).Value;
        });
}
