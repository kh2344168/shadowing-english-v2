import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StudentCurriculumPage } from './curriculum.page';

describe('StudentCurriculumPage', () => {
  async function render(fixture: ComponentFixture<StudentCurriculumPage>) {
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [StudentCurriculumPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentCurriculumPage);
    fixture.detectChanges();
    return { http, fixture };
  }

  it('groups published lessons by week/day, orders them, and links only to slot overview routes', async () => {
    const { http, fixture } = await setup();
    expect(fixture.nativeElement.textContent).toContain('جارٍ تحميل المنهج');
    const first = http.expectOne((r) => r.url === '/api/student/learning/curriculum');
    expect(first.request.params.get('page')).toBe('1');
    expect(first.request.params.get('pageSize')).toBe('20');
    expect(first.request.method).toBe('GET');
    first.flush({
      groupName: 'مجموعة أ',
      publishedVersionId: 'version-a',
      curriculumTitle: 'محادثات',
      items: [
        {
          slotId: 'w2-d1-l1',
          title: 'الأسبوع الثاني',
          weekNumber: 2,
          dayNumber: 1,
          sortOrder: 1,
          isComplete: false,
          completedSegments: 0,
        },
        {
          slotId: 'w1-d2-l1',
          title: 'اليوم الثاني',
          weekNumber: 1,
          dayNumber: 2,
          sortOrder: 1,
          isComplete: false,
          completedSegments: 1,
        },
        {
          slotId: 'w1-d1-l2',
          title: 'الدرس الثاني',
          weekNumber: 1,
          dayNumber: 1,
          sortOrder: 2,
          isComplete: false,
          completedSegments: 0,
        },
        {
          slotId: 'w1-d1-l1',
          title: 'الدرس الأول',
          weekNumber: 1,
          dayNumber: 1,
          sortOrder: 1,
          isComplete: true,
          completedSegments: 2,
        },
      ],
      hasMore: false,
    });
    await render(fixture);

    const weeks = fixture.nativeElement.querySelectorAll('.week-card');
    expect(weeks.length).toBe(2);
    expect(weeks[0].textContent).toContain('الأسبوع');
    expect(weeks[0].textContent).toContain('اليوم 1');
    expect(weeks[0].textContent).toContain('اليوم 2');
    const links = Array.from(fixture.nativeElement.querySelectorAll('.lesson-card')) as HTMLAnchorElement[];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/student/lessons/w1-d1-l1/overview',
      '/student/lessons/w1-d1-l2/overview',
      '/student/lessons/w1-d2-l1/overview',
      '/student/lessons/w2-d1-l1/overview',
    ]);
    expect(http.match((r) => r.method !== 'GET')).toEqual([]);
    http.verify();
  });

  it('shows a distinct no-group state', async () => {
    const { http, fixture } = await setup();
    http.expectOne((r) => r.url === '/api/student/learning/curriculum').flush({
      groupName: null,
      curriculumTitle: null,
      items: [],
      hasMore: false,
    });
    await render(fixture);
    expect(fixture.nativeElement.textContent).toContain('لا توجد مجموعة دراسية');
    expect(fixture.nativeElement.textContent).toContain('بعد إضافتك إلى مجموعة');
    http.verify();
  });

  it('shows a group-without-published-curriculum state without inventing lesson links', async () => {
    const { http, fixture } = await setup();
    http.expectOne((r) => r.url === '/api/student/learning/curriculum').flush({
      groupName: 'مجموعة أ',
      curriculumTitle: null,
      items: [],
      hasMore: false,
    });
    await render(fixture);
    expect(fixture.nativeElement.textContent).toContain('المنهج لم يُنشر بعد');
    expect(fixture.nativeElement.querySelectorAll('.lesson-card').length).toBe(0);
    http.verify();
  });

  it('keeps loaded lessons after a later page failure and retries the same page', async () => {
    const { http, fixture } = await setup();
    http.expectOne((r) => r.url === '/api/student/learning/curriculum').flush({
      groupName: 'مجموعة أ',
      publishedVersionId: 'version-a',
      curriculumTitle: 'محادثات',
      items: [
        {
          slotId: 'slot-1',
          title: 'مرحبا',
          weekNumber: 1,
          dayNumber: 1,
          sortOrder: 1,
          isComplete: false,
          completedSegments: 0,
        },
      ],
      hasMore: true,
    });
    await render(fixture);

    (fixture.nativeElement.querySelector('.load-more button') as HTMLButtonElement).click();
    const second = http.expectOne(
      (r) => r.url === '/api/student/learning/curriculum' && r.params.get('page') === '2',
    );
    expect(second.request.params.get('expectedPublishedVersionId')).toBe('version-a');
    second.flush({}, { status: 503, statusText: 'Unavailable' });
    await render(fixture);
    expect(fixture.nativeElement.querySelectorAll('.lesson-card').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('الدروس التي ظهرت بالفعل ما زالت متاحة');

    (fixture.nativeElement.querySelector('.inline-error button') as HTMLButtonElement).click();
    const retry = http.expectOne(
      (r) => r.url === '/api/student/learning/curriculum' && r.params.get('page') === '2',
    );
    expect(retry.request.params.get('expectedPublishedVersionId')).toBe('version-a');
    retry.flush({ groupName: 'مجموعة أ', publishedVersionId: 'version-a', curriculumTitle: 'محادثات', items: [], hasMore: false });
    await render(fixture);
    expect(fixture.nativeElement.querySelectorAll('.lesson-card').length).toBe(1);
    http.verify();
  });

  it('discards the previous pages on a republish conflict and retries from page one', async () => {
    const { http, fixture } = await setup();
    http.expectOne((r) => r.url === '/api/student/learning/curriculum').flush({
      groupName: 'مجموعة أ',
      publishedVersionId: 'version-a',
      curriculumTitle: 'النسخة الأولى',
      items: [{ slotId: 'old-slot', title: 'درس قديم', weekNumber: 1, dayNumber: 1, sortOrder: 1, isComplete: false, completedSegments: 0 }],
      hasMore: true,
    });
    await render(fixture);

    (fixture.nativeElement.querySelector('.load-more button') as HTMLButtonElement).click();
    const pageTwo = http.expectOne(
      (r) => r.url === '/api/student/learning/curriculum' && r.params.get('page') === '2',
    );
    expect(pageTwo.request.params.get('expectedPublishedVersionId')).toBe('version-a');
    pageTwo.flush({ error: 'curriculum_version_changed' }, { status: 409, statusText: 'Conflict' });
    await render(fixture);

    expect(fixture.nativeElement.querySelectorAll('.lesson-card').length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('تغيّرت النسخة المنشورة أثناء التحميل');
    (fixture.nativeElement.querySelector('.state-card--error button') as HTMLButtonElement).click();
    const reload = http.expectOne(
      (r) => r.url === '/api/student/learning/curriculum' && r.params.get('page') === '1',
    );
    expect(reload.request.params.has('expectedPublishedVersionId')).toBe(false);
    reload.flush({
      groupName: 'مجموعة أ',
      publishedVersionId: 'version-b',
      curriculumTitle: 'النسخة الثانية',
      items: [{ slotId: 'new-slot', title: 'درس جديد', weekNumber: 1, dayNumber: 1, sortOrder: 1, isComplete: false, completedSegments: 0 }],
      hasMore: false,
    });
    await render(fixture);
    expect(fixture.nativeElement.textContent).toContain('درس جديد');
    expect(fixture.nativeElement.textContent).not.toContain('درس قديم');
    http.verify();
  });
});
