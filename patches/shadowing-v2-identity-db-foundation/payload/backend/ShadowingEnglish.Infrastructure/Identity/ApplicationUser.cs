using Microsoft.AspNetCore.Identity;

namespace ShadowingEnglish.Infrastructure.Identity;

// Identity stores the password hash and security metadata. Never add a plaintext password field.
public sealed class ApplicationUser : IdentityUser<Guid>
{
}
