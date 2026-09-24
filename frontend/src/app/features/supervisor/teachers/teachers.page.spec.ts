import { TestBed } from '@angular/core/testing';
import { SupervisorTeachersPage } from './teachers.page';

describe('SupervisorTeachersPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [SupervisorTeachersPage] }).compileComponents();
    const fixture = TestBed.createComponent(SupervisorTeachersPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
