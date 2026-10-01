import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { LocalProcessorClient } from '../ai-processing/local-processor.client';
import { AdminAIToolsPage } from './ai-tools.page';

describe('AdminAIToolsPage', () => {
  const client = {
    initialize: vi.fn(() => null),
    downloadInstaller: vi.fn(async () => new Blob(['installer'])),
    health: vi.fn(async () => ({ linked: true })),
    importLink: vi.fn(async () => ({})),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    client.initialize.mockReturnValue(null);
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

  it('keeps installation separate and does not probe localhost without a saved pairing', async () => {
    const fixture = TestBed.createComponent(AdminAIToolsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('تثبيت أدوات AI');
    expect(client.health).not.toHaveBeenCalled();
    expect(fixture.componentInstance.state()).toBe('idle');
  });

  it('shows a clear package-ready state after preparing the installer', async () => {
    const fixture = TestBed.createComponent(AdminAIToolsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.downloadInstaller();
    expect(client.downloadInstaller).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.state()).toBe('package-ready');
    expect(fixture.componentInstance.message()).toContain('Install.cmd');
  });

  it('marks WhisperX connected only after the local health check succeeds', async () => {
    client.initialize.mockReturnValue({ settings: { profile: 'shadowing-v2-1', leadingMs: 150, trailingMs: 100 } });
    const fixture = TestBed.createComponent(AdminAIToolsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.state()).toBe('connected');
  });
});
