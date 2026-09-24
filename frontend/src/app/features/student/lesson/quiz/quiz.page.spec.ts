import { TestBed } from '@angular/core/testing';
import { StudentQuizPage } from './quiz.page';

describe('StudentQuizPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentQuizPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentQuizPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
