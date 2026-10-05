using System.Security.Cryptography;
using System.Text;

namespace ShadowingEnglish.Api.Modules.AI;

public sealed class AiProviderCredentialProtector : IDisposable
{
    private readonly byte[]? key;

    public AiProviderCredentialProtector(IConfiguration configuration)
    {
        var configured = configuration["AI_PROVIDER_MASTER_KEY"] ?? configuration["AiProviders:MasterKey"];
        if (string.IsNullOrWhiteSpace(configured)) return;
        try
        {
            var decoded = Convert.FromBase64String(configured.Trim());
            if (decoded.Length == 32) key = decoded;
            else CryptographicOperations.ZeroMemory(decoded);
        }
        catch (FormatException)
        {
            key = null;
        }
    }

    public bool IsConfigured => key is { Length: 32 };

    public string Protect(string plaintext, string capability, string providerKey)
    {
        if (!IsConfigured) throw new InvalidOperationException("ai_provider_encryption_not_configured");
        var nonce = RandomNumberGenerator.GetBytes(12);
        var tag = new byte[16];
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var aad = Encoding.UTF8.GetBytes($"shadowing-v2:{capability}:{providerKey}");
        try
        {
            using var aes = new AesGcm(key!, tag.Length);
            aes.Encrypt(nonce, plain, cipher, tag, aad);
            return $"v1.{Convert.ToBase64String(nonce)}.{Convert.ToBase64String(tag)}.{Convert.ToBase64String(cipher)}";
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    public bool TryUnprotect(string? protectedValue, string capability, string providerKey, out string plaintext)
    {
        plaintext = "";
        if (!IsConfigured || string.IsNullOrWhiteSpace(protectedValue)) return false;
        var parts = protectedValue.Split('.', StringSplitOptions.None);
        if (parts.Length != 4 || parts[0] != "v1") return false;
        try
        {
            var nonce = Convert.FromBase64String(parts[1]);
            var tag = Convert.FromBase64String(parts[2]);
            var cipher = Convert.FromBase64String(parts[3]);
            if (nonce.Length != 12 || tag.Length != 16 || cipher.Length is < 1 or > 2048) return false;
            var plain = new byte[cipher.Length];
            var aad = Encoding.UTF8.GetBytes($"shadowing-v2:{capability}:{providerKey}");
            try
            {
                using var aes = new AesGcm(key!, tag.Length);
                aes.Decrypt(nonce, cipher, tag, plain, aad);
                plaintext = Encoding.UTF8.GetString(plain);
                return true;
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plain);
            }
        }
        catch (CryptographicException) { return false; }
        catch (FormatException) { return false; }
    }

    public void Dispose()
    {
        if (key is not null) CryptographicOperations.ZeroMemory(key);
    }
}
