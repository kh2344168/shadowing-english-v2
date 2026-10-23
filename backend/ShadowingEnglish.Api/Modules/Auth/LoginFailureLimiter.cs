using System.Diagnostics;
using System.Net;

namespace ShadowingEnglish.Api.Modules.Auth;

// Successful school logins never consume a shared public-IP quota. Failed attempts still
// have a bounded per-IP window; Identity separately locks accounts after repeated failures.
public sealed class LoginFailureLimiter
{
    private const int MaxFailuresPerMinute = 20;
    private const int MaxTrackedAddresses = 10_000;
    private readonly Lock gate = new();
    private readonly Dictionary<string, FailureWindow> windows = new(StringComparer.Ordinal);
    private int observed;

    public bool RecordFailure(IPAddress? address)
    {
        var key = address?.ToString() ?? "unknown";
        var now = Stopwatch.GetTimestamp();
        lock (gate)
        {
            if (++observed % 256 == 0)
                foreach (var expired in windows.Where(x => Stopwatch.GetElapsedTime(x.Value.Started, now) >=
                    TimeSpan.FromMinutes(1)).Select(x => x.Key).ToArray())
                    windows.Remove(expired);

            if (!windows.TryGetValue(key, out var window))
            {
                if (windows.Count >= MaxTrackedAddresses) key = "overflow";
                if (!windows.TryGetValue(key, out window))
                    windows[key] = window = new FailureWindow(now);
            }
            if (Stopwatch.GetElapsedTime(window.Started, now) >= TimeSpan.FromMinutes(1))
                windows[key] = window = new FailureWindow(now);
            return ++window.Count > MaxFailuresPerMinute;
        }
    }

    private sealed class FailureWindow(long started)
    {
        public long Started { get; } = started;
        public int Count { get; set; }
    }
}
