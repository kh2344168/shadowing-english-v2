import { TestBed } from '@angular/core/testing';
import { TeacherDashboardPage } from './dashboard.page';

describe('TeacherDashboardPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [TeacherDashboardPage] }).compileComponents();
    const fixture = TestBed.createComponent(TeacherDashboardPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'غير متاح',
    );
  });
});
