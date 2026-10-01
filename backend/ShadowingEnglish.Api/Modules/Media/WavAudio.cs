using System.Buffers.Binary;

namespace ShadowingEnglish.Api.Modules.Media;

// Validate the complete RIFF structure before any persistent upload. No decoding or AI on the API.
public static class WavAudio
{
    public static async Task<bool> IsValidAsync(Stream source, long length, CancellationToken cancellation)
    {
        if (!source.CanSeek || length is < 46 or > 2_000_000 || source.Length != length) return false;
        var header = new byte[16];
        source.Position = 0;
        try
        {
            await source.ReadExactlyAsync(header.AsMemory(0, 12), cancellation);
            if (!header.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !header.AsSpan(8, 4).SequenceEqual("WAVE"u8) ||
                BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4, 4)) != length - 8) return false;
            var formatSeen = false;
            var dataSeen = false;
            var blockAlign = 0;
            for (var count = 0; source.Position < length && count < 64; count++)
            {
                if (source.Position + 8 > length) return false;
                await source.ReadExactlyAsync(header.AsMemory(0, 8), cancellation);
                var size = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4, 4));
                var next = source.Position + size + (size % 2);
                if (next > length) return false;
                if (header.AsSpan(0, 4).SequenceEqual("fmt "u8))
                {
                    if (formatSeen || size < 16) return false;
                    await source.ReadExactlyAsync(header, cancellation);
                    var format = BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(0, 2));
                    var channels = BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(2, 2));
                    var rate = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4, 4));
                    var byteRate = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(8, 4));
                    blockAlign = BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(12, 2));
                    var bits = BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(14, 2));
                    if (channels is < 1 or > 2 || rate is < 8000 or > 96000 ||
                        !((format == 1 && bits is 8 or 16 or 24 or 32) || (format == 3 && bits is 32 or 64)) ||
                        blockAlign != channels * bits / 8 || byteRate != rate * blockAlign) return false;
                    formatSeen = true;
                }
                else if (header.AsSpan(0, 4).SequenceEqual("data"u8))
                {
                    if (!formatSeen || dataSeen || size == 0 || size % blockAlign != 0) return false;
                    dataSeen = true;
                }
                source.Position = next;
            }
            return source.Position == length && formatSeen && dataSeen;
        }
        catch (EndOfStreamException) { return false; }
        finally { source.Position = 0; }
    }
}
