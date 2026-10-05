import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const endpoints = read('backend/ShadowingEnglish.Api/Modules/AI/AdminAiProviderEndpoints.cs');
const catalog = read('backend/ShadowingEnglish.Api/Modules/AI/AiProviderCatalog.cs');
const tester = read('backend/ShadowingEnglish.Api/Modules/AI/AiProviderConnectionTester.cs');
const protector = read('backend/ShadowingEnglish.Api/Modules/AI/AiProviderCredentialProtector.cs');
const context = read('backend/ShadowingEnglish.Infrastructure/Database/ApplicationDbContext.cs');
const migration = read('backend/ShadowingEnglish.Infrastructure/Database/Migrations/20261005134000_AddAiProviderManagement.cs');
const snapshot = read('backend/ShadowingEnglish.Infrastructure/Database/Migrations/ApplicationDbContextModelSnapshot.cs');
const program = read('backend/ShadowingEnglish.Api/Program.cs');
const api = read('frontend/src/app/features/admin/ai-tools/ai-providers.api.ts');
const page = read('frontend/src/app/features/admin/ai-tools/ai-tools.page.ts');
const html = read('frontend/src/app/features/admin/ai-tools/ai-tools.page.html');

test('provider credentials stay server-side and responses expose only masked keys', () => {
  assert.match(protector, /AesGcm/);
  assert.match(protector, /AI_PROVIDER_MASTER_KEY/);
  assert.match(endpoints, /EncryptedApiKey\s*=\s*protector\.Protect/);
  const dto = endpoints.slice(endpoints.indexOf('private static object ToDto'), endpoints.indexOf('private static string DisplayStatus'));
  assert.doesNotMatch(dto, /encryptedApiKey\s*=/i);
  assert.doesNotMatch(dto, /apiKey\s*=/i);
  assert.match(dto, /maskedKey\s*=\s*row\.KeyLast4/);
  assert.doesNotMatch(api + page, /localStorage|sessionStorage/);
  assert.doesNotMatch(endpoints, /Sha256\(apiKey|keyHash\s*=.*apiKey/);
  assert.doesNotMatch(page, /apiKey:\s*string/);
  assert.doesNotMatch(html, /value\s*=\s*["'][^"']*(?:sk-|api[_-]?key)/i);
});

test('admin provider writes are CSRF protected and rate limited', () => {
  assert.match(endpoints, /RequireAuthorization\(new AuthorizeAttribute \{ Roles = "Admin" \}\)/);
  for (const route of ['MapPost(""', 'MapPut("/{id:guid}"', 'MapPut("/{id:guid}/enabled"', 'MapPost("/{id:guid}/remove-credentials"', 'MapPost("/{id:guid}/test"', 'MapPut("/order"', 'MapPost("/fallback-test"']) {
    assert.ok(endpoints.includes(route), `missing endpoint: ${route}`);
  }
  const csrfCount = (endpoints.match(/HasValidCsrfAsync/g) || []).length;
  const rateCount = (endpoints.match(/RequireRateLimiting\("admin-ai-provider-write"\)/g) || []).length;
  assert.ok(csrfCount >= 8, `expected CSRF checks, got ${csrfCount}`);
  assert.equal(rateCount, 7);
  assert.match(program, /AddPolicy\("admin-ai-provider-write"/);
  assert.match(program, /MapAdminAiProviderEndpoints\(\)/);
});

test('provider requests use backend-controlled allowlisted URLs only', () => {
  assert.doesNotMatch(endpoints + api, /endpointUrl|baseUrl|customEndpoint/i);
  assert.match(tester, /https:\/\/api\.groq\.com\/openai\/v1\/models/);
  assert.match(tester, /https:\/\/api\.cloudflare\.com\/client\/v4\/accounts/);
  assert.match(tester, /https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(tester, /https:\/\/api\.mistral\.ai\/v1\/models/);
  assert.match(tester, /https:\/\/openrouter\.ai\/api\/v1\/models/);
  assert.match(tester, /https:\/\/api\.pexels\.com\/v1\/curated/);
  assert.match(tester, /https:\/\/api\.unsplash\.com\/photos/);
  assert.doesNotMatch(tester, /pixabay\.com\/api\/\?key=/);
  assert.match(program, /AllowAutoRedirect = false/);
});

test('catalog is honest about unavailable image adapters', () => {
  for (const provider of ['groq', 'cloudflare', 'gemini', 'mistral', 'openrouter']) {
    assert.match(catalog, new RegExp(`new\\("${provider}"[^\\n]*Text, true`));
  }
  assert.match(catalog, /gemini-image[^\n]*ImageGeneration, false/);
  assert.match(catalog, /cloudflare-image[^\n]*ImageGeneration, false/);
  assert.match(catalog, /openrouter-image[^\n]*ImageGeneration, false/);
  assert.match(catalog, /pixabay[^\n]*ImageSearch, false/);
  assert.match(html, /لم تتم إضافة مزود لتوليد الصور بعد/);
  assert.match(html, /غير متاح في الكود حاليًا/);
});

test('fallback is per-capability and stops after first success', () => {
  assert.match(endpoints, /x\.Capability == request\.Capability && x\.Enabled && x\.EncryptedApiKey != null/);
  assert.match(endpoints, /OrderBy\(x => x\.Priority\)/);
  assert.match(endpoints, /if \(result\.Success\) \{ success = true; break; \}/);
  assert.match(html, /cdkDropList/);
  assert.match(page, /dropProvider/);
  assert.match(page, /testFallback/);
});

test('database schema stores encrypted configuration and non-secret audit metadata', () => {
  assert.match(context, /DbSet<AiProviderConfiguration>/);
  assert.match(context, /DbSet<AiProviderAuditEntry>/);
  assert.match(context, /HasIndex\(x => new \{ x\.Capability, x\.ProviderKey \}\)\.IsUnique\(\)/);
  assert.match(migration, /CreateTable\(\s*name: "AiProviderConfigurations"/);
  assert.match(migration, /CreateTable\(\s*name: "AiProviderAuditEntries"/);
  assert.doesNotMatch(migration, /(^|[^A-Za-z])ApiKey\s*=\s*table\.Column/m);
  assert.match(migration, /EncryptedApiKey/);
  assert.match(snapshot, /ShadowingEnglish.Infrastructure.AIProviders.AiProviderConfiguration/);
  assert.match(snapshot, /ShadowingEnglish.Infrastructure.AIProviders.AiProviderAuditEntry/);
  assert.match(snapshot, /EncryptedApiKey/);
});

test('AI Tools UI contains requested secure states and no arbitrary endpoint field', () => {
  for (const text of [
    'جارٍ اختبار الاتصال', 'المفتاح غير صالح', 'تم تجاوز الحد', 'غير متاح مؤقتًا',
    'النموذج المحدد غير متاح', 'تعذر الاتصال', 'حفظ واختبار الاتصال', 'حذف بيانات الاعتماد',
    'لا يحتاج إلى مفتاح API خارجي',
  ]) assert.ok((page + html).includes(text), `missing UI text: ${text}`);
  assert.doesNotMatch(html, /name="endpoint|name="url/i);
  assert.match(html, /providerForm\.showKey \? 'text' : 'password'/);
  assert.match(html, /maskedKey/);
});
