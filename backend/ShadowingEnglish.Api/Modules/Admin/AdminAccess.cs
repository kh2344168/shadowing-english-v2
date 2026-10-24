using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ShadowingEnglish.Infrastructure.Database;

namespace ShadowingEnglish.Api.Modules.Admin;

internal static class AdminAccess
{
    public static async Task<bool> HasLiveRoleAsync(HttpContext http, ApplicationDbContext db)
    {
        if (!Guid.TryParse(http.User.FindFirstValue(ClaimTypes.NameIdentifier), out var id))
            return false;
        return await (from user in db.Users.AsNoTracking()
            join membership in db.UserRoles.AsNoTracking() on user.Id equals membership.UserId
            join role in db.Roles.AsNoTracking() on membership.RoleId equals role.Id
            where user.Id == id && role.NormalizedName == "ADMIN"
            select user.Id).AnyAsync(http.RequestAborted);
    }
}
