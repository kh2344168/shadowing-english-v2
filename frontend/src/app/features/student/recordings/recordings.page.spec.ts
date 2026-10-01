import { TestBed } from '@angular/core/testing';
import { StudentRecordingsPage } from './recordings.page';

describe('StudentRecordingsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentRecordingsPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentRecordingsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'غير متاح',
    );
  });
});
