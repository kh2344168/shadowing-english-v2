import { TestBed } from '@angular/core/testing';
import { SupervisorStudentsPage } from './students.page';

describe('SupervisorStudentsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [SupervisorStudentsPage] }).compileComponents();
    const fixture = TestBed.createComponent(SupervisorStudentsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
