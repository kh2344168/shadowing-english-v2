import { TestBed } from '@angular/core/testing';
import { SupervisorReportsPage } from './reports.page';

describe('SupervisorReportsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [SupervisorReportsPage] }).compileComponents();
    const fixture = TestBed.createComponent(SupervisorReportsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'غير متاح',
    );
  });
});
