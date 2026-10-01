import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StudentCurriculumPage } from './curriculum.page';

describe('StudentCurriculumPage', () => {
  it('paginates published lesson cards on demand and links to the published slot', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentCurriculumPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentCurriculumPage);
    fixture.detectChanges();
    const first = http.expectOne((r) => r.url === '/api/student/learning/curriculum');
    expect(first.request.params.get('page')).toBe('1');
    first.flush({
      groupName: 'مجموعة أ',
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
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('a[href="/student/lessons/slot-1/overview"]'),
    ).toBeTruthy();
    (fixture.nativeElement.querySelector('button.learning-button') as HTMLButtonElement).click();
    const next = http.expectOne(
      (r) => r.url === '/api/student/learning/curriculum' && r.params.get('page') === '2',
    );
    next.flush({ groupName: 'مجموعة أ', curriculumTitle: 'محادثات', items: [], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.lesson-row').length).toBe(1);
    expect(http.match((r) => r.method !== 'GET')).toEqual([]);
    http.verify();
  });
});
