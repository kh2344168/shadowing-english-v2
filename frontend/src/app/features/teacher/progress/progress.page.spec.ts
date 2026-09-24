import { TestBed } from '@angular/core/testing';
import { TeacherProgressPage } from './progress.page';

describe('TeacherProgressPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [TeacherProgressPage] }).compileComponents();
    const fixture = TestBed.createComponent(TeacherProgressPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
