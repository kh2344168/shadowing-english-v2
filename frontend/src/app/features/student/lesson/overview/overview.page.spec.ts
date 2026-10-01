import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { StudentLessonOverviewPage } from './overview.page';

describe('StudentLessonOverviewPage', () => {
  it('loads scoped metadata and restored progress without requesting media', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentLessonOverviewPage],
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
    const fixture = TestBed.createComponent(StudentLessonOverviewPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      title: 'التعارف',
      description: 'جمل قصيرة',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 2,
      completedSegments: 1,
      isComplete: false,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('أكملت 1 من 2');
    expect(
      fixture.nativeElement.querySelector('a[href="/student/lessons/slot-1/shadowing"]'),
    ).toBeTruthy();
    http.verify();
  });
});
