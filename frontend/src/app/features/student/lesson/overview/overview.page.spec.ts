import { TestBed } from '@angular/core/testing';
import { StudentLessonOverviewPage } from './overview.page';

describe('StudentLessonOverviewPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentLessonOverviewPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentLessonOverviewPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
