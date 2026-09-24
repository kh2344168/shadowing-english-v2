import { TestBed } from '@angular/core/testing';
import { AdminLessonBuilderPage } from './lesson-builder.page';

describe('AdminLessonBuilderPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminLessonBuilderPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminLessonBuilderPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
