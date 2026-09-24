import { TestBed } from '@angular/core/testing';
import { SupervisorDashboardPage } from './dashboard.page';

describe('SupervisorDashboardPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [SupervisorDashboardPage] }).compileComponents();
    const fixture = TestBed.createComponent(SupervisorDashboardPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
