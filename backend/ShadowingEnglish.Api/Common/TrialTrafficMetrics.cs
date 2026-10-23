namespace ShadowingEnglish.Api.Common;

// In-memory, bounded trial telemetry. Only route templates and numeric measurements are kept;
// URLs, user IDs, request bodies, cookies, and query strings are never stored.
public sealed class TrialTrafficMetrics
{
    public const int WindowMinutes = 15;
    public const int MaxSamples = 20_000;
    private readonly Lock gate = new();
    private readonly Queue<Sample> samples = new();

    public void Record(string route, int status, double durationMs, long? requestBytes,
        long? responseBytes)
    {
        var now = DateTimeOffset.UtcNow;
        lock (gate)
        {
            Trim(now);
            samples.Enqueue(new Sample(now, route, status, durationMs,
                Math.Max(0, requestBytes ?? 0), Math.Max(0, responseBytes ?? 0)));
            while (samples.Count > MaxSamples) samples.Dequeue();
        }
    }

    public object Snapshot()
    {
        Sample[] current;
        var now = DateTimeOffset.UtcNow;
        lock (gate)
        {
            Trim(now);
            current = samples.ToArray();
        }
        var routes = current.GroupBy(sample => sample.Route, StringComparer.Ordinal)
            .Select(group =>
            {
                var durations = group.Select(item => item.DurationMs).Order().ToArray();
                return new
                {
                    route = group.Key,
                    requests = durations.Length,
                    clientErrors = group.Count(item => item.Status is >= 400 and < 500),
                    serverErrors = group.Count(item => item.Status >= 500),
                    p50Ms = Percentile(durations, 0.50),
                    p95Ms = Percentile(durations, 0.95),
                    maxMs = durations[^1],
                    knownRequestBytes = group.Sum(item => item.RequestBytes),
                    knownResponseBytes = group.Sum(item => item.ResponseBytes)
                };
            }).OrderByDescending(item => item.requests).ToArray();
        return new
        {
            windowMinutes = WindowMinutes,
            sampleLimit = MaxSamples,
            capturedRequests = current.Length,
            oldestSampleUtc = current.Length == 0 ? (DateTimeOffset?)null : current[0].AtUtc,
            routes
        };
    }

    private void Trim(DateTimeOffset now)
    {
        var oldest = now.AddMinutes(-WindowMinutes);
        while (samples.Count > 0 && samples.Peek().AtUtc < oldest) samples.Dequeue();
    }

    private static double Percentile(double[] sorted, double percentile) =>
        Math.Round(sorted[Math.Max(0, (int)Math.Ceiling(sorted.Length * percentile) - 1)], 1);

    private sealed record Sample(DateTimeOffset AtUtc, string Route, int Status,
        double DurationMs, long RequestBytes, long ResponseBytes);
}
