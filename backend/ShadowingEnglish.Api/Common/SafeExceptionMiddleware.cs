using System.Diagnostics;

namespace ShadowingEnglish.Api.Common;

public sealed class SafeExceptionMiddleware(RequestDelegate next, ILogger<SafeExceptionMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var started = Stopwatch.GetTimestamp();
        try
        {
            await next(context);
        }
        catch (Exception exception)
        {
            var traceId = context.TraceIdentifier;
            logger.LogError(
                "Api.Request.Failed ErrorCode=internal_error ErrorType={ErrorType} TraceId={TraceId} DurationMs={DurationMs}",
                exception.GetType().Name, traceId, Stopwatch.GetElapsedTime(started).TotalMilliseconds);

            if (context.Response.HasStarted)
            {
                context.Abort();
                return;
            }

            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new { error = "internal_error", traceId });
        }
    }
}