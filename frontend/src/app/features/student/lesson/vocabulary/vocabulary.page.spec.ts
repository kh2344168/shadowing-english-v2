import { TestBed } from '@angular/core/testing';
import { StudentVocabularyPage } from './vocabulary.page';

describe('StudentVocabularyPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentVocabularyPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentVocabularyPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
