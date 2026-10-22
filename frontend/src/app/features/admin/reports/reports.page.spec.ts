import { AdminReportsPage } from './reports.page';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
describe('AdminReportsPage', () => {
  it('exists', () => expect(AdminReportsPage).toBeDefined());
  it('shows per-student goal steps without grading by error count', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminReportsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminReportsPage);
    fixture.detectChanges();
    http.expectOne('/api/admin/reports/conversations?page=1').flush({
      hasMore: false,
      items: [
        {
          studentId: 's1',
          studentEmail: 'student@example.test',
          slotId: 'slot-1',
          lessonVersionId: 'v1',
          lessonTitle: 'At the airport',
          createdAtUtc: '2026-10-20',
          result: {
            goalMet: false,
            replyCount: 5,
            metSteps: ['Ask for the gate'],
            missingSteps: ['State destination'],
            issues: [
              {
                original: 'Gate fifty',
                suggested: 'Gate fifteen',
                reason: 'Different gate',
                kind: 'fact',
              },
            ],
            outcome: 'goal-incomplete',
          },
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('At the airport');
    expect(fixture.nativeElement.textContent).toContain('State destination');
    expect(fixture.nativeElement.textContent).toContain('الهدف غير مكتمل');
    http.verify();
  });
});
