import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminAIProcessingPage } from './ai-processing.page';
import { LocalProcessorClient } from './local-processor.client';
import { ImportedLesson, LocalDraftTransfer } from './local-lesson';

describe('AdminAIProcessingPage', () => {
  const client = { initialize: vi.fn(() => null), health: vi.fn(), start: vi.fn() };
  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [AdminAIProcessingPage],
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
  it('does not discover or process local files when opened without a saved connection', async () => {
    const fixture = TestBed.createComponent(AdminAIProcessingPage);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(client.health).not.toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
    expect(fixture.componentInstance.connected()).toBe(false);
  });
  it('requires review before transferring the current draft', async () => {
    const fixture = TestBed.createComponent(AdminAIProcessingPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const page = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const draft = {
      manifest: { title: 'First lesson', segments: [] },
      files: [],
    } as unknown as ImportedLesson;
    page.result.set(draft);
    const transfer = TestBed.inject(LocalDraftTransfer);
    const setDraft = vi.spyOn(transfer, 'set');
    page.sendToBuilder();
    expect(setDraft).not.toHaveBeenCalled();
    page.reviewed = true;
    page.sendToBuilder();
    expect(setDraft).toHaveBeenCalledOnce();
    expect(setDraft).toHaveBeenCalledWith('admin-1', draft);
    expect(transfer.take('admin-1')).toBe(draft);
    expect(navigate).toHaveBeenCalledWith(['/admin/lesson-builder']);
  });
});
