import { TestBed } from '@angular/core/testing';
import { AdminTeachersPage } from './teachers.page';

describe('AdminTeachersPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminTeachersPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminTeachersPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
