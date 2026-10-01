import { TestBed } from '@angular/core/testing';
import { StudentMessagesPage } from './messages.page';

describe('StudentMessagesPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentMessagesPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentMessagesPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'غير متاح',
    );
  });
});
