using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Core.Groups;
using ShadowingEnglish.Infrastructure.Database;
using ShadowingEnglish.Infrastructure.Identity;

internal static class SwitchAccounts
{
    internal static async Task Run()
    {
        var connection = Environment.GetEnvironmentVariable("DEMO_DB_CONNECTION")
            ?? throw new InvalidOperationException("Missing demo connection");
        var baseUrl = Environment.GetEnvironmentVariable("DEMO_URL")
            ?? throw new InvalidOperationException("Missing demo URL");
        if (!baseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
            !baseUrl.EndsWith(".trycloudflare.com", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Only the local demo tunnel is allowed");
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlServer(connection).Options;
        var students = new List<(Guid Id, string Email, string Password)>();
        try
        {
            await using (var db = new ApplicationDbContext(options))
            {
                var source = await (from membership in db.StudentGroupMemberships.AsNoTracking()
                    join assignment in db.GroupCurriculumAssignments.AsNoTracking()
                        on membership.GroupId equals assignment.GroupId
                    where membership.EndedAtUtc == null
                    select new { membership.GroupId, membership.AssignedByAdminId }).FirstAsync();
                var role = await db.Roles.AsNoTracking().SingleAsync(x => x.Name == "Student");
                for (var i = 0; i < 2; i++)
                {
                    var id = Guid.NewGuid();
                    var email = $"account-switch-{id:N}@v2-test.invalid";
                    var password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(36));
                    var user = new ApplicationUser
                    {
                        Id = id, Email = email, NormalizedEmail = email.ToUpperInvariant(),
                        UserName = email, NormalizedUserName = email.ToUpperInvariant(), EmailConfirmed = true,
                        SecurityStamp = Guid.NewGuid().ToString("N"), ConcurrencyStamp = Guid.NewGuid().ToString("N"),
                        LockoutEnabled = true
                    };
                    user.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(user, password);
                    db.Users.Add(user);
                    db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = id, RoleId = role.Id });
                    db.StudentGroupMemberships.Add(new StudentGroupMembership
                    {
                        Id = Guid.NewGuid(), StudentId = id, GroupId = source.GroupId,
                        StartedAtUtc = DateTimeOffset.UtcNow, AssignedByAdminId = source.AssignedByAdminId
                    });
                    students.Add((id, email, password));
                }
                await db.SaveChangesAsync();
            }

            using var browser = new Process();
            browser.StartInfo.FileName = "node";
            browser.StartInfo.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "browser-account-switch.cjs"));
            browser.StartInfo.Environment["DEMO_URL"] = baseUrl;
            browser.StartInfo.Environment["DEMO_A_EMAIL"] = students[0].Email;
            browser.StartInfo.Environment["DEMO_A_PASSWORD"] = students[0].Password;
            browser.StartInfo.Environment["DEMO_A_ID"] = students[0].Id.ToString();
            browser.StartInfo.Environment["DEMO_B_EMAIL"] = students[1].Email;
            browser.StartInfo.Environment["DEMO_B_PASSWORD"] = students[1].Password;
            browser.StartInfo.Environment["DEMO_B_ID"] = students[1].Id.ToString();
            browser.StartInfo.RedirectStandardOutput = true;
            browser.StartInfo.RedirectStandardError = true;
            browser.Start();
            var output = await browser.StandardOutput.ReadToEndAsync();
            var error = await browser.StandardError.ReadToEndAsync();
            await browser.WaitForExitAsync();
            Console.Write(output);
            if (browser.ExitCode != 0) throw new InvalidOperationException(error);
        }
        finally
        {
            await using var db = new ApplicationDbContext(options);
            foreach (var student in students)
            {
                var user = await db.Users.FindAsync(student.Id);
                if (user is null) continue;
                user.LockoutEnd = DateTimeOffset.MaxValue;
                user.SecurityStamp = Guid.NewGuid().ToString("N");
            }
            await db.SaveChangesAsync();
            Console.WriteLine("Temporary students locked; all rows retained.");
        }
    }
}
