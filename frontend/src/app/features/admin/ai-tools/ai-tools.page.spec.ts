import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  DEFAULT_PROCESSOR_SETTINGS,
  LocalProcessorClient,
  ProcessorLink,
} from '../ai-processing/local-processor.client';
import { AdminAIToolsPage } from './ai-tools.page';

describe('AdminAIToolsPage', () => {
  const client = {
    initialize: vi.fn<LocalProcessorClient['initialize']>(() => null),
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
    const savedLink: ProcessorLink = {
      schemaVersion: 1,
      protocolVersion: 1,
      userId: 'admin-1',
      origin: 'http://localhost:4200',
      token: 'a'.repeat(64),
      settings: { ...DEFAULT_PROCESSOR_SETTINGS },
    };
    client.initialize.mockReturnValue(savedLink);
    const fixture = TestBed.createComponent(AdminAIToolsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(client.health).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fixture.componentInstance.state()).toBe('connected'));
  });
});
