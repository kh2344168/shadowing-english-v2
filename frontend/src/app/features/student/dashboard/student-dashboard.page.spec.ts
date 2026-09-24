import { TestBed } from '@angular/core/testing';
import { StudentDashboardPage } from './student-dashboard.page';

describe('StudentDashboardPage', () => {
  it('creates', async () => {
    await TestBed.configureTestingModule({ imports: [StudentDashboardPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentDashboardPage);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
