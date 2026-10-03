import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StudentDashboardPage } from './student-dashboard.page';

describe('StudentDashboardPage', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [StudentDashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentDashboardPage);
    fixture.detectChanges();
    return { http, fixture };
  }

  it('shows the no-group state and never writes on open', async () => {
    const { http, fixture } = await setup();
    expect(fixture.nativeElement.textContent).toContain('جارٍ تحميل المسار التعليمي');
    const request = http.expectOne((r) => r.url === '/api/student/learning/curriculum');
    expect(request.request.params.get('pageSize')).toBe('5');
    expect(request.request.method).toBe('GET');
    request.flush({ groupName: null, curriculumTitle: null, items: [], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('لم تُضف إلى مجموعة دراسية');
    expect(http.match((r) => r.method !== 'GET')).toEqual([]);
    http.verify();
  });

  it('distinguishes a group with no published curriculum from a student with no group', async () => {
    const { http, fixture } = await setup();
    http.expectOne((r) => r.url === '/api/student/learning/curriculum').flush({
      groupName: 'مجموعة أ',
      curriculumTitle: null,
      items: [],
      hasMore: false,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('أنت ضمن مجموعة دراسية');
    expect(fixture.nativeElement.textContent).toContain('لم يُنشر لها منهج متاح بعد');
    http.verify();
  });

  it('orders published lessons and makes the first incomplete lesson the current CTA', async () => {
    const { http, fixture } = await setup();
    http.expectOne((r) => r.url === '/api/student/learning/curriculum').flush({
      groupName: 'مجموعة أ',
      curriculumTitle: 'محادثات',
      items: [
        {
          slotId: 'slot-2',
          title: 'الدرس الثاني',
          weekNumber: 1,
          dayNumber: 1,
          sortOrder: 2,
          isComplete: false,
          completedSegments: 1,
        },
        {
          slotId: 'slot-1',
          title: 'الدرس الأول',
          weekNumber: 1,
          dayNumber: 1,
          sortOrder: 1,
          isComplete: true,
          completedSegments: 2,
        },
      ],
      hasMore: true,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const nodes = Array.from(
      fixture.nativeElement.querySelectorAll('.path-lesson__node'),
    ) as HTMLAnchorElement[];
    expect(nodes.map((node) => node.getAttribute('href'))).toEqual([
      '/student/lessons/slot-1/overview',
      '/student/lessons/slot-2/overview',
    ]);
    const current = fixture.nativeElement.querySelector('.path-lesson.is-current');
    expect(current?.textContent).toContain('الدرس الثاني');
    expect(current?.textContent).toContain('كمّل من مكانك');
    expect(fixture.nativeElement.textContent).toContain('عرض باقي الدروس');
    http.verify();
  });
  it('shows an error state and retries the same read without writes', async () => {
    const { http, fixture } = await setup();
    http
      .expectOne((r) => r.url === '/api/student/learning/curriculum')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('تعذر تحميل مسارك');

    (fixture.nativeElement.querySelector('.state-card--error button') as HTMLButtonElement).click();
    const retry = http.expectOne((r) => r.url === '/api/student/learning/curriculum');
    expect(retry.request.method).toBe('GET');
    retry.flush({ groupName: null, curriculumTitle: null, items: [], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(http.match((r) => r.method !== 'GET')).toEqual([]);
    http.verify();
  });

});
