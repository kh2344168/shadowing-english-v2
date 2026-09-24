var builder = WebApplication.CreateBuilder(args);

// Foundation only: no authentication, database writes, or demo seeds are created here.
var app = builder.Build();

app.MapGet("/health", (ILogger<Program> logger) =>
{
    var started = System.Diagnostics.Stopwatch.GetTimestamp();
    logger.LogInformation("Foundation.Health.Start");
    var result = Results.Ok(new { status = "ok", application = "ShadowingEnglish.V2" });
    logger.LogInformation("Foundation.Health.Success DurationMs={DurationMs}",
        System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds);
    return result;
});

app.Run();
