import { TestBed } from '@angular/core/testing';
import { AdminStudentsPage } from './students.page';

describe('AdminStudentsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminStudentsPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminStudentsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
