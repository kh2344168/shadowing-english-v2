import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthoringLesson, ShadowingAuthoringApi } from '../lesson-builder/shadowing-authoring.api';
import { AdminAIProcessingPage } from './ai-processing.page';
import { ImportedLesson, LocalDraftTransfer } from './local-lesson';
import { LocalProcessorClient } from './local-processor.client';

describe('AdminAIProcessingPage — approve and save', () => {
  const jobId = '11111111-2222-4333-8444-555555555555';
  const client = {
    initialize: vi.fn(() => null),
    health: vi.fn(),
    start: vi.fn(),
    recut: vi.fn<LocalProcessorClient['recut']>(),
    result: vi.fn<LocalProcessorClient['result']>(),
    remove: vi.fn<LocalProcessorClient['remove']>(),
    forgetJob: vi.fn(),
  };
  let fixture: ComponentFixture<AdminAIProcessingPage>;
  let page: AdminAIProcessingPage;
  let http: HttpTestingController;
  let router: Router;

  function lesson(): ImportedLesson {
    const files = [1, 2].map((index) => new File(
      [new Uint8Array(64)], 'segment-0' + index + '.wav', { type: 'audio/wav' },
    ));
    return {
      manifest: {
        schemaVersion: 1,
        profile: 'shadowing-v2-1',
        jobId,
        title: 'Processed lesson',
        description: 'Processed description',
        duration: 30,
        reviewRequired: true,
        segments: files.map((file, index) => ({
          text: 'Sentence ' + (index + 1) + '.',
          start: index * 3,
          end: index * 3 + 2,
          audioFile: file.name,
          bytes: file.size,
          sha256: '0'.repeat(64),
        })),
      },
      files,
    };
  }

  function prepareReviewedLesson(): ImportedLesson {
    const result = lesson();
    page.result.set(result);
    page.job.set({ jobId, state: 'complete', phase: 'complete', percent: 100 });
    page.title = result.manifest.title;
    page.description = result.manifest.description;
    page.reviewed = true;
    page.previewUrls.set(['blob:first-clip', 'blob:second-clip']);
    fixture.detectChanges();
    return result;
  }

  function savedResponse(): AuthoringLesson {
    return {
      id: jobId,
      versionId: 'saved-version-1',
      title: page.title.trim(),
      description: page.description.trim(),
      segmentCount: page.result()!.manifest.segments.length,
    };
  }

  async function flushCsrf(): Promise<void> {
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
  }

  async function saveSuccessfully(): Promise<void> {
    const saving = page.approveAndSaveLesson();
    await flushCsrf();
    http.expectOne('/api/admin/shadowing/lessons').flush(savedResponse());
    await saving;
    fixture.detectChanges();
  }

  function button(text: string): HTMLButtonElement {
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    );
    const found = buttons.find((item) => item.textContent?.trim() === text);
    expect(found).toBeDefined();
    return found!;
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    client.initialize.mockReturnValue(null);
    client.remove.mockResolvedValue(undefined);
    const browserURL = URL;
    vi.stubGlobal('URL', class extends browserURL {
      static override createObjectURL = vi.fn(() => 'blob:updated-clip');
      static override revokeObjectURL = vi.fn();
    });
    await TestBed.configureTestingModule({
      imports: [AdminAIProcessingPage],
      providers: [
        provideRouter([{ path: 'admin/ai-processing', component: AdminAIProcessingPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LocalProcessorClient, useValue: client },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/admin/ai-processing');
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(AdminAIProcessingPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush({ authenticated: true, userId: 'admin-1', roles: ['Admin'] });
    await fixture.whenStable();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not discover or process local files without a saved connection', () => {
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(client.health).not.toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
    expect(page.connected()).toBe(false);
  });

  it('requires review and waits for an open edit or recut to finish before saving', async () => {
    prepareReviewedLesson();
    page.reviewed = false;
    await page.approveAndSaveLesson();
    page.reviewed = true;
    page.editingIndex.set(0);
    await page.approveAndSaveLesson();
    page.editingIndex.set(null);
    page.segmentSaving.set(true);
    await page.approveAndSaveLesson();
    expect(http.match('/api/auth/csrf')).toEqual([]);
    expect(http.match('/api/admin/shadowing/lessons')).toEqual([]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('saves the latest title, description, edited text and final WAV files after recut', async () => {
    const original = prepareReviewedLesson();
    const refreshed = lesson();
    refreshed.manifest.segments[0] = {
      ...refreshed.manifest.segments[0], text: 'Latest edited sentence.', start: 0.5, end: 1.5,
    };
    refreshed.files[0] = new File([new Uint8Array(96)], 'segment-01.wav', { type: 'audio/wav' });
    refreshed.files[1] = original.files[1];
    client.recut.mockResolvedValue(refreshed.manifest);
    client.result.mockResolvedValue(refreshed);
    page.connected.set(true);
    page.openEditModal(0);
    page.editText = refreshed.manifest.segments[0].text;
    page.editStart = 0.5;
    page.editEnd = 1.5;
    await page.saveSegmentEdit();
    expect(page.reviewed).toBe(false);
    expect(client.recut).toHaveBeenCalledWith(jobId, [
      { text: 'Latest edited sentence.', start: 0.5, end: 1.5 },
      { text: 'Sentence 2.', start: 3, end: 5 },
    ]);
    page.title = '  Latest approved title  ';
    page.description = '  Latest approved description  ';
    page.reviewed = true;
    const saving = page.approveAndSaveLesson();
    await flushCsrf();
    const upload = http.expectOne('/api/admin/shadowing/lessons');
    const body = upload.request.body as FormData;
    expect(upload.request.method).toBe('POST');
    expect(body.get('title')).toBe('Latest approved title');
    expect(body.get('description')).toBe('Latest approved description');
    expect(body.get('segments')).toBe('["Latest edited sentence.","Sentence 2."]');
    expect(body.get('audio0')).toBe(refreshed.files[0]);
    expect(body.get('audio1')).toBe(original.files[1]);
    upload.flush(savedResponse());
    await saving;
    expect(client.start).not.toHaveBeenCalled();
  });

  it('prevents duplicate requests when approve is clicked twice before the view updates', async () => {
    prepareReviewedLesson();
    const approve = button('اعتماد الدرس وحفظه');
    approve.click();
    approve.click();
    expect(page.lessonSaving()).toBe(true);
    await flushCsrf();
    const requests = http.match('/api/admin/shadowing/lessons');
    expect(requests).toHaveLength(1);
    requests[0].flush(savedResponse());
    await fixture.whenStable();
    expect(page.savedLesson()).not.toBeNull();
  });

  it('retries with the same requestId and preserves all work when saving fails', async () => {
    const result = prepareReviewedLesson();
    const previewUrls = page.previewUrls();
    const firstSave = page.approveAndSaveLesson();
    await flushCsrf();
    const first = http.expectOne('/api/admin/shadowing/lessons');
    const firstBody = first.request.body as FormData;
    first.flush({ error: 'media_storage_unavailable' }, { status: 503, statusText: 'Unavailable' });
    await firstSave;
    expect(page.result()).toBe(result);
    expect(page.result()!.files).toBe(result.files);
    expect(page.previewUrls()).toBe(previewUrls);
    expect(page.reviewed).toBe(true);
    expect(page.title).toBe(result.manifest.title);
    expect(page.description).toBe(result.manifest.description);
    expect(page.savedLesson()).toBeNull();
    expect(page.lessonSaving()).toBe(false);
    expect(page.error()).toContain('خدمة حفظ الصوت غير متاحة');
    expect(page.canSaveLesson()).toBe(true);
    const retry = page.approveAndSaveLesson();
    await flushCsrf();
    const second = http.expectOne('/api/admin/shadowing/lessons');
    const secondBody = second.request.body as FormData;
    expect(secondBody.get('requestId')).toBe(firstBody.get('requestId'));
    expect(secondBody.get('requestId')).toBe(jobId);
    expect(secondBody.get('segments')).toBe(firstBody.get('segments'));
    expect(secondBody.get('audio0')).toBe(firstBody.get('audio0'));
    second.flush(savedResponse());
    await retry;
  });

  it('keeps the lesson and allows retry if the CSRF request fails', async () => {
    const result = prepareReviewedLesson();
    const saving = page.approveAndSaveLesson();
    http.expectOne('/api/auth/csrf').flush(null, { status: 503, statusText: 'Unavailable' });
    await saving;
    expect(http.match('/api/admin/shadowing/lessons')).toEqual([]);
    expect(page.result()).toBe(result);
    expect(page.reviewed).toBe(true);
    expect(page.canSaveLesson()).toBe(true);
    await saveSuccessfully();
  });

  it('saves through create without publishing, transferring a draft or rerunning WhisperX', async () => {
    prepareReviewedLesson();
    const publish = vi.spyOn(TestBed.inject(ShadowingAuthoringApi), 'publish');
    const transfer = vi.spyOn(TestBed.inject(LocalDraftTransfer), 'set');
    await saveSuccessfully();
    expect(publish).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();
    expect(http.match('/api/admin/shadowing/publish')).toEqual([]);
    expect(client.start).not.toHaveBeenCalled();
    expect(client.recut).not.toHaveBeenCalled();
  });

  it('shows both success choices without navigating automatically', async () => {
    const result = prepareReviewedLesson();
    await saveSuccessfully();
    expect(page.result()).toBe(result);
    expect(page.savedLesson()!.id).toBe(jobId);
    expect(page.saveChoicePending()).toBe(true);
    expect(button('الانتقال إلى قائمة الدروس')).toBeTruthy();
    expect(button('البقاء في الصفحة')).toBeTruthy();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.url).toBe('/admin/ai-processing');
  });

  it('navigates to the lesson list only when the user clicks the list choice', async () => {
    prepareReviewedLesson();
    await saveSuccessfully();
    button('الانتقال إلى قائمة الدروس').click();
    expect(router.navigate).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/lessons']);
  });

  it('keeps the saved state visible and stays on AI Processing when stay is clicked', async () => {
    const result = prepareReviewedLesson();
    await saveSuccessfully();
    const saved = page.savedLesson();
    button('البقاء في الصفحة').click();
    fixture.detectChanges();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.url).toBe('/admin/ai-processing');
    expect(page.savedLesson()).toBe(saved);
    expect(page.result()).toBe(result);
    expect(page.reviewed).toBe(true);
    expect(page.saveChoicePending()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('الدرس محفوظ بالفعل في قائمة الدروس');
    expect(button('إنشاء درس جديد')).toBeTruthy();
    expect(button('الانتقال إلى قائمة الدروس')).toBeTruthy();
    await page.approveAndSaveLesson();
    expect(http.match('/api/auth/csrf')).toEqual([]);
    expect(http.match('/api/admin/shadowing/lessons')).toEqual([]);
  });

  it('blocks edits, processing and cleanup during save and prevents a second save after success', async () => {
    prepareReviewedLesson();
    const saving = page.approveAndSaveLesson();
    page.openEditModal(0);
    expect(page.editingIndex()).toBeNull();
    await page.createNewLesson();
    await page.process();
    expect(client.remove).not.toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
    await flushCsrf();
    http.expectOne('/api/admin/shadowing/lessons').flush(savedResponse());
    await saving;
    page.openEditModal(0);
    expect(page.editingIndex()).toBeNull();
    await page.approveAndSaveLesson();
    expect(http.match('/api/auth/csrf')).toEqual([]);
    expect(page.canSaveLesson()).toBe(false);
  });

  it('clears the saved state only when the user explicitly starts a new lesson', async () => {
    prepareReviewedLesson();
    await saveSuccessfully();
    page.stayOnAIProcessing();
    await page.createNewLesson();
    expect(client.remove).toHaveBeenCalledWith(jobId);
    expect(page.savedLesson()).toBeNull();
    expect(page.result()).toBeNull();
    expect(page.saveChoicePending()).toBe(false);
    expect(page.title).toBe('');
    expect(page.description).toBe('');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('retains the saved state and result if starting a new lesson cannot clean up the local job', async () => {
    const result = prepareReviewedLesson();
    await saveSuccessfully();
    const saved = page.savedLesson();
    client.remove.mockRejectedValue(new Error('processor_unavailable'));
    await page.createNewLesson();
    expect(page.savedLesson()).toBe(saved);
    expect(page.result()).toBe(result);
    expect(page.newLessonBusy()).toBe(false);
  });

  it('validates the title and available WAV files before posting', async () => {
    const result = prepareReviewedLesson();
    page.title = ' ';
    await page.approveAndSaveLesson();
    expect(page.error()).toContain('راجع عنوان الدرس');
    page.title = result.manifest.title;
    page.result.set({ ...result, files: [] });
    await page.approveAndSaveLesson();
    expect(http.match('/api/auth/csrf')).toEqual([]);
    expect(http.match('/api/admin/shadowing/lessons')).toEqual([]);
    expect(page.reviewed).toBe(true);
  });

  it('logs safe save diagnostics without text, audio or arbitrary server error content', async () => {
    prepareReviewedLesson();
    const info = vi.spyOn(console, 'info');
    const warn = vi.spyOn(console, 'warn');
    const saving = page.approveAndSaveLesson();
    await flushCsrf();
    http.expectOne('/api/admin/shadowing/lessons').flush(
      { error: 'Sensitive content from the server' }, { status: 500, statusText: 'Error' },
    );
    await saving;
    expect(info).toHaveBeenCalledWith('[Admin.AILesson.Save.Start]', {
      requestId: jobId, jobId, segmentCount: 2,
    });
    expect(warn).toHaveBeenCalledWith('[Admin.AILesson.Save.Failed]', {
      requestId: jobId, status: 500, code: 'request_failed', durationMs: expect.any(Number),
    });
    await saveSuccessfully();
    expect(info).toHaveBeenCalledWith('[Admin.AILesson.Save.Success]', {
      lessonId: jobId, versionId: 'saved-version-1', durationMs: expect.any(Number),
    });
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain('Sentence 1.');
    expect(logged).not.toContain('Sensitive content');
    expect(logged).not.toContain('audio0');
  });
});
