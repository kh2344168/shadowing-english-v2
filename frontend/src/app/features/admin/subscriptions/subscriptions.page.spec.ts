import { TestBed } from '@angular/core/testing';
import { AdminSubscriptionsPage } from './subscriptions.page';

describe('AdminSubscriptionsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminSubscriptionsPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminSubscriptionsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'غير متاح',
    );
  });
});
