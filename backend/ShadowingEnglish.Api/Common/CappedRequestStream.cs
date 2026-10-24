namespace ShadowingEnglish.Api.Common;

internal sealed class CappedRequestStream(Stream source, long maxBytes, string errorCode) : Stream
{
    private long readBytes;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count) =>
        Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        var count = source.Read(buffer[..Allowed(buffer.Length)]);
        return Count(count);
    }

    public override Task<int> ReadAsync(byte[] buffer, int offset, int count,
        CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
        var count = await source.ReadAsync(buffer[..Allowed(buffer.Length)], cancellationToken);
        return Count(count);
    }

    private int Allowed(int requested) => requested == 0 ? 0 :
        (int)Math.Min(requested, maxBytes - readBytes + 1);

    private int Count(int count)
    {
        readBytes += count;
        if (readBytes > maxBytes)
            throw new BadHttpRequestException(errorCode, StatusCodes.Status413PayloadTooLarge);
        return count;
    }

    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
