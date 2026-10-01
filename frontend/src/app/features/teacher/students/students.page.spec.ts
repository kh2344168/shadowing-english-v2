import { TestBed } from '@angular/core/testing';
import { TeacherStudentsPage } from './students.page';

describe('TeacherStudentsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [TeacherStudentsPage] }).compileComponents();
    const fixture = TestBed.createComponent(TeacherStudentsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'غير متاح',
    );
  });
});
