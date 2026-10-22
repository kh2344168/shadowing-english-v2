import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StudentProgressPage } from './progress.page';

describe('StudentProgressPage', () => {
  it('reads saved progress from the server without writing during page open', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentProgressPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentProgressPage);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === '/api/student/learning/curriculum')
      .flush({
        groupName: 'مجموعة',
        curriculumTitle: 'محادثات',
        hasMore: false,
        items: [{ slotId: 'slot-1', isComplete: true, completedSegments: 2 }],
      });
    await Promise.resolve();
    http.expectOne('/api/student/learning/conversation-review').flush([
      {
        slotId: 'slot-1',
        lessonTitle: 'Airport',
        createdAtUtc: '2026-10-20',
        result: {
          goalMet: false,
          replyCount: 5,
          metSteps: [],
          missingSteps: ['Ask for the gate'],
          issues: [],
          endedEarly: true,
          outcome: 'goal-incomplete',
        },
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 من 1');
    expect(fixture.nativeElement.textContent).toContain('Ask for the gate');
    expect(http.match((r) => r.method !== 'GET')).toEqual([]);
    http.verify();
  });
});
