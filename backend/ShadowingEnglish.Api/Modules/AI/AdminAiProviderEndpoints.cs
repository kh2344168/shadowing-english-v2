using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.AIProviders;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Api.Modules.AI;

public static class AdminAiProviderEndpoints
{
    public static IEndpointRouteBuilder MapAdminAiProviderEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/admin/ai-providers")
            .RequireAuthorization(new AuthorizeAttribute { Roles = "Admin" });

        api.MapGet("/catalog", async (HttpContext http, UserManager<ApplicationUser> users) =>
        {
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(AiProviderCatalog.All.Select(x => new
            {
                providerKey = x.ProviderKey,
                displayName = x.DisplayName,
                capability = x.Capability,
                implemented = x.Implemented,
                requiresAccountId = x.RequiresAccountId,
                supportsProjectId = x.SupportsProjectId,
                models = x.Models,
                defaultPriority = x.DefaultPriority,
                unavailableReason = x.UnavailableReason
            }));
        });

        api.MapGet("", async (HttpContext http, UserManager<ApplicationUser> users,
            ApplicationDbContext db, AiProviderCredentialProtector protector, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.List.Start TraceId={TraceId}", http.TraceIdentifier);
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            try
            {
                var rows = await db.AiProviderConfigurations.AsNoTracking()
                    .OrderBy(x => x.Capability).ThenBy(x => x.Priority).ThenBy(x => x.ProviderKey)
                    .ToArrayAsync(http.RequestAborted);
                var actorIds = rows.Select(x => x.UpdatedByAdminId).Distinct().ToArray();
                var emails = await db.Users.AsNoTracking().Where(x => actorIds.Contains(x.Id))
                    .Select(x => new { x.Id, x.Email }).ToDictionaryAsync(x => x.Id, x => x.Email ?? "", http.RequestAborted);
                http.Response.Headers.CacheControl = "no-store";
                logger.LogInformation("Admin.AIProviders.List.Success ActorId={ActorId} Count={Count} EncryptionReady={EncryptionReady} DurationMs={DurationMs}",
                    actor.Id, rows.Length, protector.IsConfigured, Ms(started));
                return Results.Ok(new
                {
                    encryptionReady = protector.IsConfigured,
                    items = rows.Select(x => ToDto(x, emails.GetValueOrDefault(x.UpdatedByAdminId))).ToArray()
                });
            }
            catch (Exception ex)
            {
                return Failed(logger, ex, "List", actor.Id, started);
            }
        });

        api.MapPost("", async (ConfigureProviderRequest request, HttpContext http, IAntiforgery antiforgery,
            UserManager<ApplicationUser> users, ApplicationDbContext db, AiProviderCredentialProtector protector,
            ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.Create.Start Provider={Provider} Capability={Capability} TraceId={TraceId}",
                SafeToken(request.ProviderKey), SafeToken(request.Capability), http.TraceIdentifier);
            if (!await HasValidCsrfAsync(http, antiforgery)) return Reject(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            if (!protector.IsConfigured) return Reject(logger, started, 503, "credential_encryption_not_configured");

            var validation = ValidateConfiguration(request.Capability, request.ProviderKey, request.ApiKey,
                request.AccountId, request.ProjectId, request.Model, request.Priority, requireKey: true);
            if (validation.Error is not null) return Reject(logger, started, validation.Status, validation.Error);
            var definition = validation.Definition!;
            if (!definition.Implemented) return Reject(logger, started, 409, "provider_not_implemented");
            if (request.RequestId == Guid.Empty) return Reject(logger, started, 400, "invalid_request_id");

            var existing = await db.AiProviderConfigurations.SingleOrDefaultAsync(x =>
                x.Capability == definition.Capability && x.ProviderKey == definition.ProviderKey, http.RequestAborted);
            var hash = MutationHash(definition.Capability, definition.ProviderKey, request.AccountId,
                request.ProjectId, request.Model, request.Priority, request.Enabled, !string.IsNullOrWhiteSpace(request.ApiKey));
            if (existing is not null)
            {
                if (existing.LastMutationRequestId == request.RequestId && existing.LastMutationRequestHash == hash)
                    return Results.Ok(ToDto(existing, actor.Email ?? ""));
                return Reject(logger, started, 409, "provider_already_configured");
            }

            var now = DateTimeOffset.UtcNow;
            var key = request.ApiKey!.Trim();
            var row = new AiProviderConfiguration
            {
                Id = Guid.NewGuid(),
                Capability = definition.Capability,
                ProviderKey = definition.ProviderKey,
                EncryptedApiKey = protector.Protect(key, definition.Capability, definition.ProviderKey),
                KeyLast4 = Last4(key),
                AccountId = Clean(request.AccountId),
                ProjectId = Clean(request.ProjectId),
                Model = Clean(request.Model),
                Priority = request.Priority,
                Enabled = request.Enabled,
                Status = request.Enabled ? "untested" : "disabled",
                UpdatedByAdminId = actor.Id,
                UpdatedAtUtc = now,
                Revision = Guid.NewGuid(),
                LastMutationRequestId = request.RequestId,
                LastMutationRequestHash = hash
            };
            db.AiProviderConfigurations.Add(row);
            db.AiProviderAuditEntries.Add(Audit(row, actor.Id, "created", "success", now));
            try
            {
                await db.SaveChangesAsync(http.RequestAborted);
                logger.LogInformation("Admin.AIProviders.Create.Success ActorId={ActorId} ProviderId={ProviderId} Provider={Provider} Capability={Capability} DurationMs={DurationMs}",
                    actor.Id, row.Id, row.ProviderKey, row.Capability, Ms(started));
                http.Response.Headers.CacheControl = "no-store";
                return Results.Json(ToDto(row, actor.Email ?? ""), statusCode: 201);
            }
            catch (DbUpdateException ex)
            {
                logger.LogWarning("Admin.AIProviders.Create.Conflict ErrorCode=provider_already_configured ErrorType={ErrorType} ActorId={ActorId} DurationMs={DurationMs}",
                    ex.GetType().Name, actor.Id, Ms(started));
                return Results.Conflict(new { error = "provider_already_configured" });
            }
        }).RequireRateLimiting("admin-ai-provider-write");

        api.MapPut("/{id:guid}", async (Guid id, UpdateProviderRequest request, HttpContext http,
            IAntiforgery antiforgery, UserManager<ApplicationUser> users, ApplicationDbContext db,
            AiProviderCredentialProtector protector, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.Update.Start ProviderId={ProviderId} TraceId={TraceId}", id, http.TraceIdentifier);
            if (!await HasValidCsrfAsync(http, antiforgery)) return Reject(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            if (!protector.IsConfigured) return Reject(logger, started, 503, "credential_encryption_not_configured");
            if (request.RequestId == Guid.Empty || request.ExpectedRevision == Guid.Empty)
                return Reject(logger, started, 400, "invalid_request_id");

            var row = await db.AiProviderConfigurations.SingleOrDefaultAsync(x => x.Id == id, http.RequestAborted);
            if (row is null) return Results.NotFound(new { error = "provider_not_found" });
            var validation = ValidateConfiguration(row.Capability, row.ProviderKey, request.ApiKey,
                request.AccountId, request.ProjectId, request.Model, request.Priority, requireKey: row.EncryptedApiKey is null);
            if (validation.Error is not null) return Reject(logger, started, validation.Status, validation.Error);
            if (!validation.Definition!.Implemented) return Reject(logger, started, 409, "provider_not_implemented");
            if (row.Revision != request.ExpectedRevision) return Reject(logger, started, 409, "provider_changed");

            var hasNewKey = !string.IsNullOrWhiteSpace(request.ApiKey);
            if (hasNewKey && row.EncryptedApiKey is not null && !request.ConfirmReplaceCredential)
                return Reject(logger, started, 409, "credential_replace_confirmation_required");
            var hash = MutationHash(row.Capability, row.ProviderKey, request.AccountId, request.ProjectId,
                request.Model, request.Priority, request.Enabled, !string.IsNullOrWhiteSpace(request.ApiKey));
            if (row.LastMutationRequestId == request.RequestId)
            {
                if (row.LastMutationRequestHash == hash) return Results.Ok(ToDto(row, actor.Email ?? ""));
                return Reject(logger, started, 409, "request_conflict");
            }

            if (hasNewKey)
            {
                var key = request.ApiKey!.Trim();
                row.EncryptedApiKey = protector.Protect(key, row.Capability, row.ProviderKey);
                row.KeyLast4 = Last4(key);
            }
            row.AccountId = Clean(request.AccountId);
            row.ProjectId = Clean(request.ProjectId);
            row.Model = Clean(request.Model);
            row.Priority = request.Priority;
            row.Enabled = request.Enabled && row.EncryptedApiKey is not null;
            row.Status = row.Enabled ? "untested" : row.EncryptedApiKey is null ? "not_configured" : "disabled";
            row.LastFailureReason = null;
            row.UpdatedByAdminId = actor.Id;
            row.UpdatedAtUtc = DateTimeOffset.UtcNow;
            row.Revision = Guid.NewGuid();
            row.LastMutationRequestId = request.RequestId;
            row.LastMutationRequestHash = hash;
            db.AiProviderAuditEntries.Add(Audit(row, actor.Id, hasNewKey ? "credential_replaced" : "updated", "success", row.UpdatedAtUtc));
            try
            {
                await db.SaveChangesAsync(http.RequestAborted);
                logger.LogInformation("Admin.AIProviders.Update.Success ActorId={ActorId} ProviderId={ProviderId} Provider={Provider} Capability={Capability} CredentialChanged={CredentialChanged} DurationMs={DurationMs}",
                    actor.Id, row.Id, row.ProviderKey, row.Capability, hasNewKey, Ms(started));
                return Results.Ok(ToDto(row, actor.Email ?? ""));
            }
            catch (DbUpdateConcurrencyException ex)
            {
                logger.LogWarning("Admin.AIProviders.Update.Conflict ErrorCode=provider_changed ErrorType={ErrorType} ActorId={ActorId} ProviderId={ProviderId} DurationMs={DurationMs}",
                    ex.GetType().Name, actor.Id, id, Ms(started));
                return Results.Conflict(new { error = "provider_changed" });
            }
        }).RequireRateLimiting("admin-ai-provider-write");

        api.MapPut("/{id:guid}/enabled", async (Guid id, ToggleProviderRequest request, HttpContext http,
            IAntiforgery antiforgery, UserManager<ApplicationUser> users, ApplicationDbContext db,
            ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.Toggle.Start ProviderId={ProviderId} Enabled={Enabled} TraceId={TraceId}", id, request.Enabled, http.TraceIdentifier);
            if (!await HasValidCsrfAsync(http, antiforgery)) return Reject(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            if (request.RequestId == Guid.Empty || request.ExpectedRevision == Guid.Empty)
                return Reject(logger, started, 400, "invalid_request_id");
            var row = await db.AiProviderConfigurations.SingleOrDefaultAsync(x => x.Id == id, http.RequestAborted);
            if (row is null) return Results.NotFound(new { error = "provider_not_found" });
            if (row.Revision != request.ExpectedRevision) return Reject(logger, started, 409, "provider_changed");
            if (request.Enabled && row.EncryptedApiKey is null) return Reject(logger, started, 409, "provider_not_configured");
            var hash = Sha256($"toggle|{id}|{request.Enabled}");
            if (row.LastMutationRequestId == request.RequestId)
            {
                if (row.LastMutationRequestHash == hash) return Results.Ok(ToDto(row, actor.Email ?? ""));
                return Reject(logger, started, 409, "request_conflict");
            }
            row.Enabled = request.Enabled;
            row.Status = request.Enabled ? "untested" : "disabled";
            row.UpdatedByAdminId = actor.Id;
            row.UpdatedAtUtc = DateTimeOffset.UtcNow;
            row.Revision = Guid.NewGuid();
            row.LastMutationRequestId = request.RequestId;
            row.LastMutationRequestHash = hash;
            db.AiProviderAuditEntries.Add(Audit(row, actor.Id, request.Enabled ? "enabled" : "disabled", "success", row.UpdatedAtUtc));
            await db.SaveChangesAsync(http.RequestAborted);
            logger.LogInformation("Admin.AIProviders.Toggle.Success ActorId={ActorId} ProviderId={ProviderId} Enabled={Enabled} DurationMs={DurationMs}", actor.Id, id, row.Enabled, Ms(started));
            return Results.Ok(ToDto(row, actor.Email ?? ""));
        }).RequireRateLimiting("admin-ai-provider-write");

        api.MapPost("/{id:guid}/remove-credentials", async (Guid id, RemoveCredentialRequest request,
            HttpContext http, IAntiforgery antiforgery, UserManager<ApplicationUser> users,
            ApplicationDbContext db, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.CredentialRemove.Start ProviderId={ProviderId} TraceId={TraceId}", id, http.TraceIdentifier);
            if (!await HasValidCsrfAsync(http, antiforgery)) return Reject(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            if (!request.Confirm || request.RequestId == Guid.Empty || request.ExpectedRevision == Guid.Empty)
                return Reject(logger, started, 400, "removal_confirmation_required");
            var row = await db.AiProviderConfigurations.SingleOrDefaultAsync(x => x.Id == id, http.RequestAborted);
            if (row is null) return Results.NotFound(new { error = "provider_not_found" });
            if (row.Revision != request.ExpectedRevision) return Reject(logger, started, 409, "provider_changed");
            var hash = Sha256($"remove|{id}|true");
            if (row.LastMutationRequestId == request.RequestId)
            {
                if (row.LastMutationRequestHash == hash) return Results.Ok(ToDto(row, actor.Email ?? ""));
                return Reject(logger, started, 409, "request_conflict");
            }
            row.EncryptedApiKey = null;
            row.KeyLast4 = null;
            row.Enabled = false;
            row.Status = "not_configured";
            row.LastFailureReason = null;
            row.UpdatedByAdminId = actor.Id;
            row.UpdatedAtUtc = DateTimeOffset.UtcNow;
            row.Revision = Guid.NewGuid();
            row.LastMutationRequestId = request.RequestId;
            row.LastMutationRequestHash = hash;
            db.AiProviderAuditEntries.Add(Audit(row, actor.Id, "credential_removed", "success", row.UpdatedAtUtc));
            await db.SaveChangesAsync(http.RequestAborted);
            logger.LogInformation("Admin.AIProviders.CredentialRemove.Success ActorId={ActorId} ProviderId={ProviderId} DurationMs={DurationMs}", actor.Id, id, Ms(started));
            return Results.Ok(ToDto(row, actor.Email ?? ""));
        }).RequireRateLimiting("admin-ai-provider-write");

        api.MapPost("/{id:guid}/test", async (Guid id, HttpContext http, IAntiforgery antiforgery,
            UserManager<ApplicationUser> users, ApplicationDbContext db, AiProviderCredentialProtector protector,
            AiProviderConnectionTester tester, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.Test.Start ProviderId={ProviderId} TraceId={TraceId}", id, http.TraceIdentifier);
            if (!await HasValidCsrfAsync(http, antiforgery)) return Reject(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            var row = await db.AiProviderConfigurations.SingleOrDefaultAsync(x => x.Id == id, http.RequestAborted);
            if (row is null) return Results.NotFound(new { error = "provider_not_found" });
            var result = await TestStoredAsync(row, protector, tester, http.RequestAborted);
            ApplyTestResult(row, result);
            await db.SaveChangesAsync(http.RequestAborted);
            logger.LogInformation("Admin.AIProviders.Test.{Outcome} ActorId={ActorId} ProviderId={ProviderId} Provider={Provider} Capability={Capability} Status={Status} DurationMs={DurationMs}",
                result.Success ? "Success" : "Failed", actor.Id, row.Id, row.ProviderKey, row.Capability, result.Status, Ms(started));
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { success = result.Success, status = DisplayStatus(row), failureReason = result.FailureReason, provider = ToDto(row, actor.Email ?? "") });
        }).RequireRateLimiting("admin-ai-provider-write");

        api.MapPut("/order", async (ReorderProvidersRequest request, HttpContext http, IAntiforgery antiforgery,
            UserManager<ApplicationUser> users, ApplicationDbContext db, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.Order.Start Capability={Capability} Count={Count} TraceId={TraceId}",
                SafeToken(request.Capability), request.OrderedIds?.Length ?? 0, http.TraceIdentifier);
            if (!await HasValidCsrfAsync(http, antiforgery)) return Reject(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            if (!AiProviderCatalog.IsCapability(request.Capability) || request.RequestId == Guid.Empty || request.OrderedIds is null ||
                request.OrderedIds.Length > 30 || request.OrderedIds.Distinct().Count() != request.OrderedIds.Length)
                return Reject(logger, started, 400, "invalid_order");
            var rows = await db.AiProviderConfigurations.Where(x => x.Capability == request.Capability && x.Enabled && x.EncryptedApiKey != null)
                .OrderBy(x => x.Priority).ToArrayAsync(http.RequestAborted);
            if (rows.Length != request.OrderedIds.Length || !rows.Select(x => x.Id).ToHashSet().SetEquals(request.OrderedIds))
                return Reject(logger, started, 409, "provider_order_changed");
            var hash = Sha256("order|" + request.Capability + "|" + string.Join(',', request.OrderedIds));
            if (rows.Length > 0 && rows.All(x => x.LastMutationRequestId == request.RequestId && x.LastMutationRequestHash == hash))
                return Results.Ok(new { result = "no_change" });
            var byId = rows.ToDictionary(x => x.Id);
            var now = DateTimeOffset.UtcNow;
            for (var index = 0; index < request.OrderedIds.Length; index++)
            {
                var row = byId[request.OrderedIds[index]];
                row.Priority = index + 1;
                row.UpdatedByAdminId = actor.Id;
                row.UpdatedAtUtc = now;
                row.Revision = Guid.NewGuid();
                row.LastMutationRequestId = request.RequestId;
                row.LastMutationRequestHash = hash;
                db.AiProviderAuditEntries.Add(Audit(row, actor.Id, "priority_changed", "success", now));
            }
            await db.SaveChangesAsync(http.RequestAborted);
            logger.LogInformation("Admin.AIProviders.Order.Success ActorId={ActorId} Capability={Capability} Count={Count} DurationMs={DurationMs}", actor.Id, request.Capability, rows.Length, Ms(started));
            return Results.Ok(new { result = "updated" });
        }).RequireRateLimiting("admin-ai-provider-write");

        api.MapPost("/fallback-test", async (FallbackTestRequest request, HttpContext http,
            IAntiforgery antiforgery, UserManager<ApplicationUser> users, ApplicationDbContext db,
            AiProviderCredentialProtector protector, AiProviderConnectionTester tester, ILoggerFactory logs) =>
        {
            var started = Stopwatch.GetTimestamp();
            var logger = logs.CreateLogger("Admin.AIProviders");
            logger.LogInformation("Admin.AIProviders.FallbackTest.Start Capability={Capability} TraceId={TraceId}", SafeToken(request.Capability), http.TraceIdentifier);
            if (!await HasValidCsrfAsync(http, antiforgery)) return Reject(logger, started, 400, "invalid_csrf");
            var actor = await CurrentAdminAsync(http, users);
            if (actor is null) return Results.Forbid();
            if (!AiProviderCatalog.IsCapability(request.Capability)) return Reject(logger, started, 400, "invalid_capability");
            var rows = await db.AiProviderConfigurations.Where(x => x.Capability == request.Capability && x.Enabled && x.EncryptedApiKey != null)
                .OrderBy(x => x.Priority).ThenBy(x => x.ProviderKey).ToArrayAsync(http.RequestAborted);
            var attempts = new List<object>();
            var success = false;
            for (var index = 0; index < rows.Length; index++)
            {
                var row = rows[index];
                var result = await TestStoredAsync(row, protector, tester, http.RequestAborted);
                ApplyTestResult(row, result);
                var display = AiProviderCatalog.Find(row.Capability, row.ProviderKey)?.DisplayName ?? row.ProviderKey;
                attempts.Add(new { attempt = index + 1, providerKey = row.ProviderKey, providerName = display, success = result.Success, status = result.Status, failureReason = result.FailureReason });
                logger.LogInformation("Admin.AIProviders.FallbackTest.Attempt ActorId={ActorId} Attempt={Attempt} Provider={Provider} Status={Status} DurationMs={DurationMs}",
                    actor.Id, index + 1, row.ProviderKey, result.Status, Ms(started));
                if (result.Success) { success = true; break; }
            }
            await db.SaveChangesAsync(http.RequestAborted);
            logger.LogInformation("Admin.AIProviders.FallbackTest.{Outcome} ActorId={ActorId} Capability={Capability} Attempts={Attempts} DurationMs={DurationMs}",
                success ? "Success" : "Failed", actor.Id, request.Capability, attempts.Count, Ms(started));
            return Results.Ok(new { success, attempts });
        }).RequireRateLimiting("admin-ai-provider-write");

        return app;
    }

    private static async Task<AiProviderConnectionTester.Result> TestStoredAsync(
        AiProviderConfiguration row, AiProviderCredentialProtector protector,
        AiProviderConnectionTester tester, CancellationToken cancellationToken)
    {
        if (row.EncryptedApiKey is null) return new(false, "not_configured", "provider_not_configured");
        if (!protector.IsConfigured) return new(false, "connection_failed", "credential_encryption_not_configured");
        if (!protector.TryUnprotect(row.EncryptedApiKey, row.Capability, row.ProviderKey, out var apiKey))
            return new(false, "connection_failed", "credential_decryption_failed");
        return await tester.TestAsync(row, apiKey, cancellationToken);
    }

    private static void ApplyTestResult(AiProviderConfiguration row, AiProviderConnectionTester.Result result)
    {
        var now = DateTimeOffset.UtcNow;
        row.Status = result.Status;
        if (result.Success)
        {
            row.LastSuccessfulRequestUtc = now;
            row.LastFailureReason = null;
        }
        else
        {
            row.LastFailedRequestUtc = now;
            row.LastFailureReason = result.FailureReason;
        }
    }

    private static object ToDto(AiProviderConfiguration row, string updatedBy) => new
    {
        id = row.Id,
        capability = row.Capability,
        providerKey = row.ProviderKey,
        providerName = AiProviderCatalog.Find(row.Capability, row.ProviderKey)?.DisplayName ?? row.ProviderKey,
        implemented = AiProviderCatalog.Find(row.Capability, row.ProviderKey)?.Implemented ?? false,
        enabled = row.Enabled,
        status = DisplayStatus(row),
        priority = row.Priority,
        hasCredential = row.EncryptedApiKey is not null,
        maskedKey = row.KeyLast4 is null ? null : "••••••••" + row.KeyLast4,
        accountId = row.AccountId,
        projectId = row.ProjectId,
        model = row.Model,
        lastSuccessfulRequestUtc = row.LastSuccessfulRequestUtc,
        lastFailedRequestUtc = row.LastFailedRequestUtc,
        lastFailureReason = row.LastFailureReason,
        updatedBy,
        updatedAtUtc = row.UpdatedAtUtc,
        revision = row.Revision
    };

    private static string DisplayStatus(AiProviderConfiguration row) =>
        row.EncryptedApiKey is null ? "not_configured" : !row.Enabled ? "disabled" : row.Status;

    private static (AiProviderCatalog.Definition? Definition, string? Error, int Status) ValidateConfiguration(
        string capability, string providerKey, string? apiKey, string? accountId,
        string? projectId, string? model, int priority, bool requireKey)
    {
        if (!AiProviderCatalog.IsCapability(capability) || priority is < 1 or > 100)
            return (null, "invalid_provider_configuration", 400);
        var definition = AiProviderCatalog.Find(capability, providerKey);
        if (definition is null) return (null, "provider_not_allowed", 400);
        if (requireKey && !ValidKey(apiKey)) return (definition, "invalid_api_key", 400);
        if (!string.IsNullOrWhiteSpace(apiKey) && !ValidKey(apiKey)) return (definition, "invalid_api_key", 400);
        if (definition.RequiresAccountId && !SafeExternalId(accountId)) return (definition, "account_id_required", 400);
        if (!string.IsNullOrWhiteSpace(accountId) && !SafeExternalId(accountId)) return (definition, "invalid_account_id", 400);
        if (!string.IsNullOrWhiteSpace(projectId) && !SafeProjectId(projectId)) return (definition, "invalid_project_id", 400);
        if (definition.Capability == AiProviderCatalog.Text && !SafeModel(model)) return (definition, "model_required", 400);
        if (definition.Capability != AiProviderCatalog.Text && !string.IsNullOrWhiteSpace(model) && !SafeModel(model))
            return (definition, "invalid_model", 400);
        return (definition, null, 200);
    }

    private static bool ValidKey(string? value) => value is { Length: >= 8 and <= 2048 } &&
        value.All(ch => !char.IsControl(ch) && !char.IsWhiteSpace(ch));
    private static bool SafeExternalId(string? value) => value is { Length: >= 4 and <= 160 } &&
        value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_');
    private static bool SafeProjectId(string? value) => value is { Length: >= 4 and <= 160 } &&
        value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.');
    private static bool SafeModel(string? value) => value is { Length: >= 2 and <= 200 } &&
        value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_' or '.' or '/' or ':' or '@');
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string Last4(string value) => value.Substring(Math.Max(0, value.Length - 4));
    private static string SafeToken(string? value) => value is null ? "null" : new string(value.Where(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_').Take(48).ToArray());

    private static string MutationHash(string capability, string providerKey, string? accountId,
        string? projectId, string? model, int priority, bool enabled, bool credentialProvided)
    {
        // Idempotency metadata must never contain the API key or a secret-derived digest.
        // The request id already identifies the submission; only persist whether credentials were supplied.
        return Sha256($"{capability}|{providerKey}|{Clean(accountId)}|{Clean(projectId)}|{Clean(model)}|{priority}|{enabled}|credential:{credentialProvided}");
    }

    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static AiProviderAuditEntry Audit(AiProviderConfiguration row, Guid actorId, string action,
        string resultCode, DateTimeOffset when) => new()
    {
        Id = Guid.NewGuid(), ProviderConfigurationId = row.Id, Capability = row.Capability,
        ProviderKey = row.ProviderKey, Action = action, ResultCode = resultCode,
        ActorAdminId = actorId, OccurredAtUtc = when
    };

    private static async Task<ApplicationUser?> CurrentAdminAsync(HttpContext context, UserManager<ApplicationUser> users)
    {
        var actor = await users.GetUserAsync(context.User);
        return actor is not null && await users.IsInRoleAsync(actor, "Admin") ? actor : null;
    }

    private static async Task<bool> HasValidCsrfAsync(HttpContext context, IAntiforgery antiforgery)
    {
        try { await antiforgery.ValidateRequestAsync(context); return true; }
        catch (AntiforgeryValidationException) { return false; }
    }

    private static IResult Reject(ILogger logger, long started, int status, string error)
    {
        logger.LogWarning("Admin.AIProviders.Rejected ErrorCode={ErrorCode} DurationMs={DurationMs}", error, Ms(started));
        return Results.Json(new { error }, statusCode: status);
    }

    private static IResult Failed(ILogger logger, Exception ex, string operation, Guid actorId, long started)
    {
        logger.LogError("Admin.AIProviders.Failed ErrorCode=ai_provider_operation_failed ErrorType={ErrorType} Operation={Operation} ActorId={ActorId} DurationMs={DurationMs}",
            ex.GetType().Name, operation, actorId, Ms(started));
        return Results.Problem(statusCode: 500, title: "ai_provider_operation_failed");
    }

    private static double Ms(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    public sealed record ConfigureProviderRequest(Guid RequestId, string Capability, string ProviderKey,
        string? ApiKey, string? AccountId, string? ProjectId, string? Model, int Priority, bool Enabled);
    public sealed record UpdateProviderRequest(Guid RequestId, Guid ExpectedRevision, string? ApiKey,
        string? AccountId, string? ProjectId, string? Model, int Priority, bool Enabled, bool ConfirmReplaceCredential);
    public sealed record ToggleProviderRequest(Guid RequestId, Guid ExpectedRevision, bool Enabled);
    public sealed record RemoveCredentialRequest(Guid RequestId, Guid ExpectedRevision, bool Confirm);
    public sealed record ReorderProvidersRequest(Guid RequestId, string Capability, Guid[] OrderedIds);
    public sealed record FallbackTestRequest(string Capability);
}
