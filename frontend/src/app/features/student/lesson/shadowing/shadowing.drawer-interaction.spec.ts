import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { StudentShadowingPage } from './shadowing.page';

describe('Shadowing drawer interaction before playback', () => {
  it('opens both mobile drawers immediately without pressing play', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentShadowingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ slotId: 'slot-1' }),
              routeConfig: { path: 'student/lessons/:slotId/shadowing' },
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(StudentShadowingPage);
    const page = fixture.componentInstance;
    const http = TestBed.inject(HttpTestingController);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    expect(page.sessionStarted).toBe(false);

    const settingsButton = fixture.nativeElement.querySelector(
      'button[aria-label="إعدادات التدريب"]',
    ) as HTMLButtonElement;
    expect(settingsButton).toBeTruthy();
    settingsButton.click();
    // Intentionally NO fixture.detectChanges(): the click must update the drawer itself.
    expect(page.settingsDrawerOpen).toBe(true);
    expect(fixture.nativeElement.querySelector('#drawer-settings').classList.contains('translate-x-0')).toBe(true);
    expect(fixture.nativeElement.querySelector('.settings-drawer__footer button')?.textContent)
      .toContain('حفظ الإعدادات والعودة للتمرين');

    const sentenceButton = fixture.nativeElement.querySelector(
      'button[aria-label="قائمة الجمل"]',
    ) as HTMLButtonElement;
    expect(sentenceButton).toBeTruthy();
    sentenceButton.click();
    expect(page.sentenceDrawerOpen).toBe(true);
    expect(page.settingsDrawerOpen).toBe(false);
    expect(fixture.nativeElement.querySelector('#drawer-sentences').classList.contains('translate-x-0')).toBe(true);
    expect(fixture.nativeElement.querySelector('#drawer-settings')).toBeNull();

    page.lesson = {
      id: 'slot-1', title: 'Test', description: '', segmentCount: 2, hasAiContent: false,
      segments: [1, 2].map((position) => ({
        position, text: `Sentence ${position}`, audioUrl: `/audio/${position}`,
        start: 0, end: 0, loaded: true,
      })),
    };
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    const entries = Array.from(
      fixture.nativeElement.querySelectorAll('#drawer-sentences .flex-1.overflow-y-auto > button'),
    ) as HTMLButtonElement[];
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining('Sentence 1'),
      expect.stringContaining('Sentence 2'),
    ]);
    expect(entries[0].getAttribute('aria-current')).toBe('step');
    expect(entries.every((entry) => entry.type === 'button')).toBe(true);
    page.segmentNavigationInProgress = true;
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    expect(entries.every((entry) => entry.disabled)).toBe(true);

    sentenceButton.click();
    expect(page.sentenceDrawerOpen).toBe(false);
    expect(fixture.nativeElement.querySelector('#drawer-sentences')).toBeNull();
    expect(page.sessionStarted).toBe(false);
    http.verify();
    fixture.destroy();
  });
});
