import { TestBed } from '@angular/core/testing';
import { StudentKnowledgeBankPage } from './knowledge-bank.page';

describe('StudentKnowledgeBankPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentKnowledgeBankPage],
    }).compileComponents();
    const fixture = TestBed.createComponent(StudentKnowledgeBankPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'غير متاح',
    );
  });
});
