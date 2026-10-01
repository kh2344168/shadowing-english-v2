import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminLessonBuilderPage } from './lesson-builder.page';

describe('AdminLessonBuilderPage', () => {
  it('keeps the draft and save request id when object storage is unavailable', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLessonBuilderPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminLessonBuilderPage);
    const page = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne('/api/admin/shadowing/lessons?page=1').flush({ items: [], hasMore: false });
    http.expectOne('/api/admin/shadowing/groups?page=1').flush({ items: [], hasMore: false });
    await fixture.whenStable();
    const audio = new File([new Uint8Array(64)], 'reviewed.wav', { type: 'audio/wav' });
    page.title = 'Prepared lesson';
    page.segments.set([{ id: 1, text: 'Hello.', audio }]);
    const saving = page.create();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const first = http.expectOne('/api/admin/shadowing/lessons');
    const requestId = first.request.body.get('requestId');
    first.flush(
      { error: 'media_storage_unavailable' },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await saving;
    expect(page.error()).toContain('خدمة حفظ الصوت');
    expect(page.title).toBe('Prepared lesson');
    expect(page.segments()[0].audio).toBe(audio);
    expect(page.selectedVersionId).toBe('');
    const retry = page.create();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const second = http.expectOne('/api/admin/shadowing/lessons');
    expect(second.request.body.get('requestId')).toBe(requestId);
    expect(http.match('/api/admin/shadowing/publish')).toEqual([]);
    second.flush({
      id: requestId,
      versionId: 'version-retry',
      title: page.title,
      description: '',
      segmentCount: 1,
    });
    await retry;
    http.verify();
  });

  it('saves audio and text explicitly, then publishes only after a second action', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLessonBuilderPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminLessonBuilderPage);
    const page = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne('/api/admin/shadowing/lessons?page=1').flush({ items: [], hasMore: false });
    http.expectOne('/api/admin/shadowing/groups?page=1').flush({
      items: [{ id: 'group-1', name: 'أولى', currentVersionId: null }],
      hasMore: false,
    });
    await fixture.whenStable();
    expect(http.match(() => true)).toEqual([]);

    page.title = 'First lesson';
    page.segments.set([
      {
        id: 1,
        text: 'Hello.',
        audio: new File([new Uint8Array(16)], 'first.wav', { type: 'audio/wav' }),
      },
    ]);
    const create = page.create();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const upload = http.expectOne('/api/admin/shadowing/lessons');
    expect(upload.request.method).toBe('POST');
    expect(upload.request.body).toBeInstanceOf(FormData);
    expect(upload.request.body.get('segments')).toBe('["Hello."]');
    expect(upload.request.body.get('audio0')).toBeInstanceOf(File);
    expect(http.match('/api/admin/shadowing/publish')).toEqual([]);
    upload.flush({
      id: 'lesson-1',
      versionId: 'version-1',
      title: 'First lesson',
      description: '',
      segmentCount: 1,
    });
    await create;
    expect(page.selectedVersionId).toBe('version-1');

    page.selectedGroupId = 'group-1';
    const publish = page.publish();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const posted = http.expectOne('/api/admin/shadowing/publish');
    expect(posted.request.body).toMatchObject({
      groupId: 'group-1',
      lessonVersionId: 'version-1',
      expectedVersionId: null,
    });
    posted.flush({ groupId: 'group-1', versionId: 'published-1', slotId: 'slot-1' });
    await publish;
    expect(page.groups()[0].currentVersionId).toBe('published-1');
    http.verify();
  });
});
