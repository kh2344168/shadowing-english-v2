import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { StudentShadowingPage } from './shadowing.page';

describe('StudentShadowingPage', () => {
  it('restores the next segment, requests audio only after play, and saves on explicit Next', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentShadowingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId: 'slot-1' }) } },
        },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentShadowingPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      title: 'التعارف',
      description: '',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 2,
      completedSegments: 1,
      isComplete: false,
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/slot-1/segments/2').flush({
      position: 2,
      text: 'Hello.',
      audioUrl: '/api/student/learning/slots/slot-1/segments/2/audio',
    });
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.practice-phrase')?.textContent).toContain(
      'Hello.',
    );
    expect(fixture.nativeElement.querySelector('audio[src]')).toBeNull();
    expect(http.match(() => true)).toEqual([]);
    const next = fixture.nativeElement.querySelector('.next-action') as HTMLButtonElement;
    next.click();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const save = http.expectOne('/api/student/learning/slots/slot-1/progress');
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({ completedSegments: 2 });
    save.flush({ completedSegments: 2, isComplete: true });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('اكتمل تدريب Shadowing');
    http.verify();
    fixture.destroy();
  });

  it('moves between segments manually with one CSRF request per page session', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentShadowingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId: 'slot-2' }) } },
        },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentShadowingPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/slot-2').flush({
      slotId: 'slot-2',
      title: 'التعارف',
      description: '',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 2,
      completedSegments: 0,
      isComplete: false,
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/slot-2/segments/1').flush({
      position: 1,
      text: 'Hello.',
      audioUrl: '/api/student/learning/slots/slot-2/segments/1/audio',
    });
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.next-action') as HTMLButtonElement).click();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    const first = http.expectOne('/api/student/learning/slots/slot-2/progress');
    expect(first.request.body).toEqual({ completedSegments: 1 });
    first.flush({ completedSegments: 1, isComplete: false });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/slot-2/segments/2').flush({
      position: 2,
      text: 'Good day.',
      audioUrl: '/api/student/learning/slots/slot-2/segments/2/audio',
    });
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.next-action') as HTMLButtonElement).click();
    const second = http.expectOne('/api/student/learning/slots/slot-2/progress');
    expect(second.request.body).toEqual({ completedSegments: 2 });
    second.flush({ completedSegments: 2, isComplete: true });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('اكتمل تدريب Shadowing');
    http.verify();
    fixture.destroy();
  });

  it('does not say progress was lost when saving succeeded but the next segment failed to load', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentShadowingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId: 'slot-3' }) } },
        },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentShadowingPage);
    fixture.detectChanges();
    const overview = {
      slotId: 'slot-3',
      title: 'التعارف',
      description: '',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 2,
      completedSegments: 0,
      isComplete: false,
    };
    http.expectOne('/api/student/learning/slots/slot-3').flush(overview);
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/slot-3/segments/1').flush({
      position: 1,
      text: 'Hello.',
      audioUrl: '/audio',
    });
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.next-action') as HTMLButtonElement).click();
    http.expectOne('/api/auth/csrf').flush(null);
    await Promise.resolve();
    http
      .expectOne('/api/student/learning/slots/slot-3/progress')
      .flush({ completedSegments: 1, isComplete: false });
    await Promise.resolve();
    http
      .expectOne('/api/student/learning/slots/slot-3/segments/2')
      .flush({ error: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.learning-status.error')?.textContent).toContain(
      'تم حفظ تقدمك',
    );
    (
      fixture.nativeElement.querySelector('.learning-status.error button') as HTMLButtonElement
    ).click();
    http
      .expectOne('/api/student/learning/slots/slot-3')
      .flush({ ...overview, completedSegments: 1 });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/slot-3/segments/2').flush({
      position: 2,
      text: 'Good day.',
      audioUrl: '/audio',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.practice-phrase')?.textContent).toContain(
      'Good day.',
    );
    http.verify();
    fixture.destroy();
  });

  it('discards an old recording when the lesson is refreshed before the recorder stops', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentShadowingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId: 'slot-4' }) } },
        },
      ],
    }).compileComponents();
    const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(stream) },
    });
    class DelayedRecorder {
      static latest: DelayedRecorder;
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        DelayedRecorder.latest = this;
      }
      start(): void {
        this.state = 'recording';
      }
      stop(): void {
        this.state = 'inactive';
      }
    }
    vi.stubGlobal('MediaRecorder', DelayedRecorder);
    try {
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(StudentShadowingPage);
      const page = fixture.componentInstance;
      page.segment.set({ position: 1, text: 'Hello.', audioUrl: '/audio' });
      await page.startRecording();
      page.stopRecording();
      const refresh = page.load();
      DelayedRecorder.latest.ondataavailable?.({ data: new Blob(['old audio']) } as BlobEvent);
      DelayedRecorder.latest.onstop?.();
      expect(page.recordingUrl()).toBeNull();
      http.expectOne('/api/student/learning/slots/slot-4').flush({
        slotId: 'slot-4',
        title: 'التعارف',
        description: '',
        weekNumber: 1,
        dayNumber: 1,
        sortOrder: 1,
        segmentCount: 0,
        completedSegments: 0,
        isComplete: false,
      });
      await refresh;
      http.verify();
      fixture.destroy();
      expect(track.stop).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
      else Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });
});
