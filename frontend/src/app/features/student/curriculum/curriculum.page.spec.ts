import { TestBed } from '@angular/core/testing';
import { StudentCurriculumPage } from './curriculum.page';

describe('StudentCurriculumPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentCurriculumPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentCurriculumPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
