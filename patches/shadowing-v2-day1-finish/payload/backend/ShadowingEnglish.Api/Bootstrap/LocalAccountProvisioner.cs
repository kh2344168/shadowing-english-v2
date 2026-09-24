using System.Diagnostics;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

namespace ShadowingEnglish.Api.Bootstrap;

// Explicit local CLI only. Never exposed as an HTTP endpoint or invoked on ordinary startup.
public static class LocalAccountProvisioner
{
    public static async Task RunAsync(WebApplication app)
    {
        if (!app.Environment.IsDevelopment())
            throw new InvalidOperationException("Local account provisioning is restricted to Development.");

        var started = Stopwatch.GetTimestamp();
        var logger = app.Services.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Auth.Provision");
        logger.LogInformation("Auth.Provision.Start Environment=Development");

        Console.WriteLine("LOCAL DEVELOPMENT ONLY - two accounts: Admin and Student.");
        Console.WriteLine("Do NOT enter a password you use anywhere else.");
        Console.WriteLine("Both test accounts will have EmailConfirmed=true ONLY in this local environment.");
        var admin = ReadAccount("Admin");
        var student = ReadAccount("Student");
        if (string.Equals(admin.Email, student.Email, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The Admin and Student emails must be different.");

        await using var scope = app.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<ApplicationDbContext>();
        var roles = services.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var users = services.GetRequiredService<UserManager<ApplicationUser>>();
        if (!await db.Database.CanConnectAsync())
            throw new InvalidOperationException("Cannot connect to the configured development database.");

        // Never replace an existing account or reset a real password during provisioning.
        if (await users.FindByEmailAsync(admin.Email) is not null ||
            await users.FindByEmailAsync(student.Email) is not null)
            throw new InvalidOperationException("An email is already registered. No account was changed.");

        await using var transaction = await db.Database.BeginTransactionAsync();
        try
        {
            foreach (var name in new[] { "Admin", "Student", "Teacher", "Supervisor" })
            {
                if (!await roles.RoleExistsAsync(name))
                    EnsureSuccess(await roles.CreateAsync(new IdentityRole<Guid>(name)), "CreateRole");
            }

            foreach (var account in new[] { admin, student })
            {
                var user = new ApplicationUser
                {
                    Id = Guid.NewGuid(),
                    UserName = account.Email,
                    Email = account.Email,
                    EmailConfirmed = true // Explicit local test accounts only.
                };
                EnsureSuccess(await users.CreateAsync(user, account.Password), "CreateUser");
                EnsureSuccess(await users.AddToRoleAsync(user, account.Role), "AssignRole");
                logger.LogInformation("Auth.Provision.AccountCreated UserId={UserId} Role={Role}",
                    user.Id, account.Role);
            }

            await transaction.CommitAsync();
            logger.LogInformation("Auth.Provision.Success Accounts=2 Roles=4 DurationMs={DurationMs}",
                Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            Console.WriteLine("SUCCESS: two local accounts created. No HTTP service was started.");
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            logger.LogError(ex, "Auth.Provision.Failed DurationMs={DurationMs}",
                Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            throw;
        }
    }

    private static Account ReadAccount(string role)
    {
        Console.Write($"{role} email: ");
        var email = Console.ReadLine()?.Trim() ?? "";
        if (email.Length is < 3 or > 256 || !email.Contains('@'))
            throw new InvalidOperationException($"Invalid {role} email.");

        Console.Write($"{role} password (hidden): ");
        var password = ReadHidden();
        Console.Write($"Confirm {role} password (hidden): ");
        var confirmation = ReadHidden();
        if (!string.Equals(password, confirmation, StringComparison.Ordinal))
            throw new InvalidOperationException($"{role} passwords do not match.");
        if (password.Length < 10)
            throw new InvalidOperationException($"{role} password must be at least 10 characters.");
        return new Account(role, email, password);
    }

    private static string ReadHidden()
    {
        var chars = new List<char>();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); break; }
            if (key.Key == ConsoleKey.Backspace)
            {
                if (chars.Count > 0) chars.RemoveAt(chars.Count - 1);
                continue;
            }
            if (!char.IsControl(key.KeyChar) && chars.Count < 256) chars.Add(key.KeyChar);
        }
        var value = new string(chars.ToArray());
        chars.Clear();
        return value;
    }

    private static void EnsureSuccess(IdentityResult result, string stage)
    {
        if (result.Succeeded) return;
        throw new InvalidOperationException($"{stage} failed: " +
            string.Join(", ", result.Errors.Select(error => error.Code)));
    }

    private sealed record Account(string Role, string Email, string Password);
}
