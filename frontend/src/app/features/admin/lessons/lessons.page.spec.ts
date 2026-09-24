import { TestBed } from '@angular/core/testing';
import { AdminLessonsPage } from './lessons.page';

describe('AdminLessonsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminLessonsPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminLessonsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
