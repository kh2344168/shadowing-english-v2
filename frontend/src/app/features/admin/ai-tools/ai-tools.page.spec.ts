import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalProcessorClient, ProcessorError } from '../ai-processing/local-processor.client';
import { AdminAIToolsPage } from './ai-tools.page';

describe('AdminAIToolsPage', () => {
  const client = {
    initialize: vi.fn(() => null as { saved: true } | null),
    downloadInstaller: vi.fn(async () => new Blob(['installer'])),
    health: vi.fn(async () => ({ linked: true })),
    importLink: vi.fn(async () => ({ saved: true })),
  };

  async function createPage() {
    const fixture = TestBed.createComponent(AdminAIToolsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.processorState()).not.toBe('checking');
    });
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    client.initialize.mockImplementation(() => null);
    client.downloadInstaller.mockResolvedValue(new Blob(['installer']));
    client.health.mockResolvedValue({ linked: true });
    client.importLink.mockResolvedValue({ saved: true });
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
      ],
    }).compileComponents();
  });

  it('initializes as disconnected when the real health response reports unlinked', async () => {
    client.health.mockResolvedValueOnce({ linked: false });
    const fixture = await createPage();

    expect(client.initialize).toHaveBeenCalledWith('admin-1');
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.hasSavedLink()).toBe(false);
    expect(fixture.componentInstance.processorState()).toBe('unlinked');
    expect(fixture.nativeElement.textContent).toContain('الخدمة تعمل والربط غير مكتمل');
  });

  it('shows connected on initial load only after a linked health response', async () => {
    const fixture = await createPage();

    expect(client.health).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.processorState()).toBe('connected');
    expect(fixture.nativeElement.textContent).toContain('الأداة متصلة');
  });

  it('reflects an initial health failure as offline', async () => {
    client.health.mockRejectedValueOnce(new ProcessorError('local_connection_unavailable'));
    const fixture = await createPage();

    expect(fixture.componentInstance.processorState()).toBe('offline');
    expect(fixture.componentInstance.processorMessage()).toContain('لم تستجب الخدمة المحلية');
  });

  it('downloads the installer once and does not claim that the tool is installed', async () => {
    client.health.mockResolvedValueOnce({ linked: false });
    const fixture = await createPage();

    await fixture.componentInstance.downloadInstaller();

    expect(client.downloadInstaller).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.downloadState()).toBe('downloaded');
    expect(fixture.componentInstance.downloadMessage()).toBe(
      'تم تنزيل ملف التثبيت. افتحه مرة واحدة لإكمال التثبيت.',
    );
    expect(fixture.componentInstance.processorState()).toBe('unlinked');
  });

  it('reports a real installer download failure', async () => {
    client.downloadInstaller.mockRejectedValueOnce(new ProcessorError('package_unavailable'));
    const fixture = await createPage();

    await fixture.componentInstance.downloadInstaller();

    expect(fixture.componentInstance.downloadState()).toBe('failed');
    expect(fixture.componentInstance.downloadMessage()).toContain('تعذر تنزيل ملف التثبيت');
  });

  it('blocks a second download while the first one is still running', async () => {
    let resolveDownload!: (blob: Blob) => void;
    client.downloadInstaller.mockImplementation(
      () => new Promise((resolve) => (resolveDownload = resolve)),
    );
    const fixture = await createPage();

    const first = fixture.componentInstance.downloadInstaller();
    const second = fixture.componentInstance.downloadInstaller();
    expect(client.downloadInstaller).toHaveBeenCalledTimes(1);

    resolveDownload(new Blob(['installer']));
    await Promise.all([first, second]);
    expect(fixture.componentInstance.downloadState()).toBe('downloaded');
  });

  it('connects only from the real health result', async () => {
    client.health.mockResolvedValueOnce({ linked: false }).mockResolvedValueOnce({ linked: true });
    const fixture = await createPage();

    await fixture.componentInstance.connectToProcessor();

    expect(client.health).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.processorState()).toBe('connected');
  });

  it('marks verification complete after a real linked health response', async () => {
    const fixture = await createPage();

    await fixture.componentInstance.verifyProcessor();

    expect(client.health).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.verificationCompleted()).toBe(true);
  });

  it('does not mark verification complete when health fails', async () => {
    client.health
      .mockResolvedValueOnce({ linked: true })
      .mockRejectedValueOnce(new ProcessorError('local_connection_unavailable'));
    const fixture = await createPage();

    await fixture.componentInstance.verifyProcessor();

    expect(fixture.componentInstance.processorState()).toBe('offline');
    expect(fixture.componentInstance.verificationCompleted()).toBe(false);
  });

  it('keeps diagnostic output free of secret error text', async () => {
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
