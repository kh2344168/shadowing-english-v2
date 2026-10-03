import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { StudentLessonOverviewPage } from './overview.page';

describe('StudentLessonOverviewPage', () => {
  async function setup(slotId = 'slot-1') {
    await TestBed.configureTestingModule({
      imports: [StudentLessonOverviewPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId }) } },
        },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentLessonOverviewPage);
    fixture.detectChanges();
    return { http, fixture };
  }

  it('loads scoped metadata and restored progress without requesting media', async () => {
    const { http, fixture } = await setup();
    expect(fixture.nativeElement.textContent).toContain('جارٍ تحميل الدرس');
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      versionId: 'version-1',
      title: 'التعارف',
      description: 'جمل قصيرة',
      weekNumber: 2,
      dayNumber: 3,
      sortOrder: 1,
      segmentCount: 4,
      completedSegments: 1,
      isComplete: false,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('الأسبوع 2');
    expect(fixture.nativeElement.textContent).toContain('اليوم 3');
    expect(fixture.nativeElement.textContent).toContain('1 من 4 جملة مكتملة');
    expect(fixture.nativeElement.textContent).toContain('25%');
    expect(fixture.nativeElement.textContent).toContain('باقي 3 جملة');
    expect(
      fixture.nativeElement.querySelector('a[href="/student/lessons/slot-1/shadowing"]'),
    ).toBeTruthy();
    expect(http.match((request) => request.url.includes('/audio'))).toEqual([]);
    expect(http.match((request) => request.url.includes('/segments/'))).toEqual([]);
    http.verify();
  });

  it('does not expose a start action when the lesson has no segments', async () => {
    const { http, fixture } = await setup();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      versionId: 'version-1',
      title: 'التعارف',
      description: '',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 0,
      completedSegments: 0,
      isComplete: false,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('لا توجد جمل متاحة لهذا الدرس بعد');
    expect(fixture.nativeElement.querySelector('.practice-card__action')).toBeNull();
    http.verify();
  });

  it('shows unavailable state on 404 and never renders lesson or shadowing links', async () => {
    const { http, fixture } = await setup('not-published');
    http
      .expectOne('/api/student/learning/slots/not-published')
      .flush({ error: 'slot_not_found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('الدرس غير متاح');
    expect(fixture.nativeElement.textContent).toContain('قد لا يكون هذا الدرس منشورًا لمجموعتك');
    expect(fixture.nativeElement.querySelector('.practice-card__action')).toBeNull();
    http.verify();
  });
  it('shows a retryable error for non-404 failures', async () => {
    const { http, fixture } = await setup();
    http
      .expectOne('/api/student/learning/slots/slot-1')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('تعذر تحميل الدرس');

    (fixture.nativeElement.querySelector('.state-card--error button') as HTMLButtonElement).click();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      versionId: 'version-1',
      title: 'التعارف',
      description: 'جمل قصيرة',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 1,
      completedSegments: 0,
      isComplete: false,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('تدريب Shadowing');
    http.verify();
  });

});
