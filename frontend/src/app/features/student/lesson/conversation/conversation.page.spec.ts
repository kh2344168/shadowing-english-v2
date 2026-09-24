import { TestBed } from '@angular/core/testing';
import { StudentConversationPage } from './conversation.page';

describe('StudentConversationPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentConversationPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentConversationPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
