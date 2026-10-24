using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.Student;

internal static class StudentAccess
{
    public static async Task<Guid?> LiveStudentIdAsync(HttpContext http, ApplicationDbContext db)
    {
        var raw = http.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(raw, out var id)) return null;
        // The cookie's role claim may be stale after an admin removes a role.
        var activeStudent = await (from user in db.Users.AsNoTracking()
            join membership in db.UserRoles.AsNoTracking() on user.Id equals membership.UserId
            join role in db.Roles.AsNoTracking() on membership.RoleId equals role.Id
            where user.Id == id && role.NormalizedName == "STUDENT"
            select user.Id).AnyAsync(http.RequestAborted);
        return activeStudent ? id : null;
    }
}
