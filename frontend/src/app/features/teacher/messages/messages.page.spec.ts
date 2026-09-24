import { TestBed } from '@angular/core/testing';
import { TeacherMessagesPage } from './messages.page';

describe('TeacherMessagesPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [TeacherMessagesPage] }).compileComponents();
    const fixture = TestBed.createComponent(TeacherMessagesPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
