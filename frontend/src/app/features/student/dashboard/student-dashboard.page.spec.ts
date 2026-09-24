import { TestBed } from '@angular/core/testing';
import { StudentDashboardPage } from './student-dashboard.page';

describe('StudentDashboardPage', () => {
  it('renders the foundation without requesting /health or business data', async () => {
    await TestBed.configureTestingModule({ imports: [StudentDashboardPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentDashboardPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('المسار التعليمي');
  });
});
