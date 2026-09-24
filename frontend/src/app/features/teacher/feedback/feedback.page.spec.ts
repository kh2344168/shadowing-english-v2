import { TestBed } from '@angular/core/testing';
import { TeacherFeedbackPage } from './feedback.page';

describe('TeacherFeedbackPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [TeacherFeedbackPage] }).compileComponents();
    const fixture = TestBed.createComponent(TeacherFeedbackPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
