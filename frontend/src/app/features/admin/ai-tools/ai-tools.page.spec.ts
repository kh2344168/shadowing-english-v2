import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalProcessorClient, ProcessorError } from '../ai-processing/local-processor.client';
import {
  AdminAiProvidersApi,
  AiProviderCatalogItem,
  AiProviderConfig,
} from './ai-providers.api';
import { AdminAIToolsPage } from './ai-tools.page';

describe('AdminAIToolsPage', () => {
  const catalog: AiProviderCatalogItem[] = [
    {
      providerKey: 'groq', displayName: 'Groq', capability: 'text', implemented: true,
      requiresAccountId: false, supportsProjectId: false, models: ['openai/gpt-oss-20b'],
      defaultPriority: 1, unavailableReason: null,
    },
    {
      providerKey: 'cloudflare', displayName: 'Cloudflare Workers AI', capability: 'text', implemented: true,
      requiresAccountId: true, supportsProjectId: false, models: ['@cf/meta/llama-3.1-8b-instruct'],
      defaultPriority: 2, unavailableReason: null,
    },
    {
      providerKey: 'gemini', displayName: 'Google Gemini', capability: 'text', implemented: true,
      requiresAccountId: false, supportsProjectId: true, models: ['gemini-3.8-flash'],
      defaultPriority: 3, unavailableReason: null,
    },
    {
      providerKey: 'gemini-image', displayName: 'Google Gemini / Imagen', capability: 'image-generation', implemented: false,
      requiresAccountId: false, supportsProjectId: true, models: [], defaultPriority: 1,
      unavailableReason: 'not_implemented',
    },
    {
      providerKey: 'pexels', displayName: 'Pexels', capability: 'image-search', implemented: true,
      requiresAccountId: false, supportsProjectId: false, models: [], defaultPriority: 1,
      unavailableReason: null,
    },
    {
      providerKey: 'pixabay', displayName: 'Pixabay', capability: 'image-search', implemented: false,
      requiresAccountId: false, supportsProjectId: false, models: [], defaultPriority: 2,
      unavailableReason: 'secure_adapter_pending',
    },
  ];

  const configuredGroq: AiProviderConfig = {
    id: 'provider-1', capability: 'text', providerKey: 'groq', providerName: 'Groq', implemented: true,
    enabled: true, status: 'connected', priority: 1, hasCredential: true,
    maskedKey: '••••••••9X2K', accountId: null, projectId: null, model: 'openai/gpt-oss-20b',
    lastSuccessfulRequestUtc: '2026-10-05T10:00:00Z', lastFailedRequestUtc: null,
    lastFailureReason: null, updatedBy: 'admin@example.com', updatedAtUtc: '2026-10-05T10:00:00Z',
    revision: '11111111-1111-4111-8111-111111111111',
  };

  const configuredCloudflare: AiProviderConfig = {
    ...configuredGroq, id: 'provider-2', providerKey: 'cloudflare', providerName: 'Cloudflare Workers AI',
    priority: 2, status: 'rate_limited', maskedKey: '••••••••CF22', accountId: 'account-1',
    model: '@cf/meta/llama-3.1-8b-instruct', revision: '22222222-2222-4222-8222-222222222222',
  };

  const configuredGemini: AiProviderConfig = {
    ...configuredGroq, id: 'provider-3', providerKey: 'gemini', providerName: 'Google Gemini',
    priority: 3, enabled: false, status: 'disabled', maskedKey: '••••••••GM33', projectId: 'project-1',
    model: 'gemini-3.8-flash', revision: '33333333-3333-4333-8333-333333333333',
  };

  const client = {
    initialize: vi.fn(() => null as { saved: true } | null),
    downloadInstaller: vi.fn(async () => new Blob(['installer'])),
    health: vi.fn(async () => ({ linked: true, protocolVersion: 1, profile: 'shadowing-v2-1' })),
    importLink: vi.fn(async () => ({ saved: true })),
  };

  const providers = {
    catalog: vi.fn(() => of(catalog)),
    list: vi.fn(() => of({ encryptionReady: true, items: [configuredGroq] })),
    create: vi.fn((request: { providerKey: string }) => of({
      ...configuredGroq,
      id: 'provider-created',
      providerKey: request.providerKey,
      providerName: request.providerKey === 'pexels' ? 'Pexels' : 'Groq',
      capability: request.providerKey === 'pexels' ? 'image-search' as const : 'text' as const,
      maskedKey: '••••••••TEST',
      status: 'untested' as const,
    })),
    update: vi.fn((_id: string, request: { enabled: boolean }) => of({ ...configuredGroq, enabled: request.enabled, revision: '22222222-2222-4222-8222-222222222222' })),
    toggle: vi.fn((_id: string, _revision: string, enabled: boolean) => of({ ...configuredGroq, enabled, status: enabled ? 'untested' as const : 'disabled' as const })),
    test: vi.fn(() => of({ success: true, status: 'connected' as const, failureReason: null, provider: configuredGroq })),
    removeCredentials: vi.fn(() => of({ ...configuredGroq, enabled: false, status: 'not_configured' as const, hasCredential: false, maskedKey: null })),
    reorder: vi.fn(() => of({ result: 'updated' })),
    testFallback: vi.fn(() => of({ success: true, attempts: [{ attempt: 1, providerKey: 'groq', providerName: 'Groq', success: true, status: 'connected' as const, failureReason: null }] })),
  };

  async function createPage() {
    const fixture = TestBed.createComponent(AdminAIToolsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.processorState()).not.toBe('checking');
      expect(fixture.componentInstance.providersLoading()).toBe(false);
    });
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    client.initialize.mockImplementation(() => null);
    client.downloadInstaller.mockResolvedValue(new Blob(['installer']));
    client.health.mockResolvedValue({ linked: true, protocolVersion: 1, profile: 'shadowing-v2-1' });
    client.importLink.mockResolvedValue({ saved: true });
    providers.catalog.mockReturnValue(of(catalog));
    providers.list.mockReturnValue(of({ encryptionReady: true, items: [configuredGroq] }));
    providers.test.mockReturnValue(of({ success: true, status: 'connected', failureReason: null, provider: configuredGroq }));
    providers.reorder.mockReturnValue(of({ result: 'updated' }));
    providers.testFallback.mockReturnValue(of({ success: true, attempts: [{ attempt: 1, providerKey: 'groq', providerName: 'Groq', success: true, status: 'connected', failureReason: null }] }));

    await TestBed.configureTestingModule({
      imports: [AdminAIToolsPage],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            session: () => of({ authenticated: true, userId: 'admin-1', roles: ['Admin'] }),
          },
        },
        { provide: LocalProcessorClient, useValue: client },
        { provide: AdminAiProvidersApi, useValue: providers },
      ],
    }).compileComponents();
  });

  it('shows local processor state and version only after a real linked health response', async () => {
    const fixture = await createPage();
    expect(client.initialize).toHaveBeenCalledWith('admin-1');
    expect(fixture.componentInstance.processorState()).toBe('connected');
    expect(fixture.componentInstance.processorVersion()).toContain('protocol v1');
    expect(fixture.nativeElement.textContent).toContain('لا يحتاج إلى مفتاح API خارجي');
  });

  it('reflects an initial local health failure as offline', async () => {
    client.health.mockRejectedValueOnce(new ProcessorError('local_connection_unavailable'));
    const fixture = await createPage();
    expect(fixture.componentInstance.processorState()).toBe('offline');
    expect(fixture.componentInstance.processorMessage()).toContain('لم تستجب الخدمة المحلية');
  });

  it('loads server-managed providers and renders only the masked saved key', async () => {
    const fixture = await createPage();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Groq');
    expect(text).toContain('••••••••9X2K');
    expect(text).not.toContain('sk-super-secret-key');
    expect(fixture.componentInstance.encryptionReady()).toBe(true);
  });

  it('shows real configured counts instead of counting every catalog provider', async () => {
    providers.list.mockReturnValueOnce(of({
      encryptionReady: true,
      items: [configuredGroq, configuredCloudflare, configuredGemini],
    }));
    const fixture = await createPage();
    expect(fixture.componentInstance.configuredFor('text')).toBe(3);
    expect(fixture.componentInstance.enabledFor('text')).toBe(2);
    expect(fixture.componentInstance.connectedFor('text')).toBe(1);
    expect(fixture.componentInstance.configuredImageProviders()).toBe(0);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('3 مزود API مضاف فعليًا');
    expect(text).toContain('توليد 0 · بحث 0');
  });

  it('keeps the existing manual provider protected and outside API-provider actions and counts', async () => {
    const fixture = await createPage();
    const protectedPanel = fixture.nativeElement.querySelector('.protected-manual-provider') as HTMLElement;
    expect(protectedPanel.textContent).toContain('المزود اليدوي الحالي — محمي');
    expect(protectedPanel.textContent).toContain('لا يدخل في الأعداد أعلاه');
    expect(protectedPanel.querySelector('button')).toBeNull();
    expect(fixture.componentInstance.configuredFor('text')).toBe(1);
  });

  it('separates configured providers from providers that are merely available to add', async () => {
    const fixture = await createPage();
    const configured = fixture.nativeElement.querySelector('[data-provider-state="configured"]') as HTMLElement;
    const available = fixture.nativeElement.querySelector('[data-provider-state="available"]') as HTMLElement;
    expect(configured.textContent).toContain('Groq');
    expect(configured.textContent).not.toContain('Cloudflare Workers AI');
    expect(available.textContent).toContain('Cloudflare Workers AI');
    expect(available.textContent).toContain('متاح للإضافة');
  });

  it('labels image generation adapters that do not exist as unavailable instead of connected', async () => {
    const fixture = await createPage();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('لم تتم إضافة مزود لتوليد الصور بعد');
    expect(text).toContain('غير متاح في الكود حاليًا');
    expect(fixture.componentInstance.implementedFor('image-generation')).toBe(0);
  });

  it('does not expose any arbitrary provider endpoint field in the secure dialog', async () => {
    const fixture = await createPage();
    fixture.componentInstance.openAddProvider('text', 'groq');
    fixture.detectChanges();
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('endpointUrl');
    expect(html).not.toContain('API endpoint');
    expect(fixture.nativeElement.textContent).toContain('عنوان الـAPI غير قابل للتعديل');
  });

  it('requires explicit confirmation before replacing an existing credential', async () => {
    const fixture = await createPage();
    fixture.componentInstance.openEditProvider(configuredGroq);
    fixture.detectChanges();
    const keyInput = fixture.nativeElement.querySelector('input[name="apiKey"]') as HTMLInputElement;
    keyInput.value = 'replacement-key-123456';
    await fixture.componentInstance.saveAndTestProvider(keyInput);
    expect(fixture.componentInstance.replaceConfirmation()).toBe(true);
    expect(providers.update).not.toHaveBeenCalled();
  });

  it('tests fallback in server priority order and shows safe attempt diagnostics', async () => {
    const fixture = await createPage();
    await fixture.componentInstance.testFallback('text');
    fixture.detectChanges();
    expect(providers.testFallback).toHaveBeenCalledWith('text');
    expect(fixture.componentInstance.attemptsFor('text')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('المحاولة 1');
    expect(fixture.nativeElement.textContent).toContain('نجحت');
  });

  it('keeps diagnostic output free of secret processor error text', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const secret = 'secret-token-must-never-be-logged';
    client.health.mockRejectedValueOnce(new ProcessorError(secret));
    await createPage();
    const diagnostics = JSON.stringify(warning.mock.calls);
    expect(diagnostics).toContain('[Admin.AITools.Verify.Failed]');
    expect(diagnostics).toContain('unknown_error');
    expect(diagnostics).not.toContain(secret);
    warning.mockRestore();
  });
});
