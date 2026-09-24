import { TestBed } from '@angular/core/testing';
import { SupervisorMessagesPage } from './messages.page';

describe('SupervisorMessagesPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [SupervisorMessagesPage] }).compileComponents();
    const fixture = TestBed.createComponent(SupervisorMessagesPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
