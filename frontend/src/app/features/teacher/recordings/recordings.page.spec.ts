import { TestBed } from '@angular/core/testing';
import { TeacherRecordingsPage } from './recordings.page';

describe('TeacherRecordingsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [TeacherRecordingsPage] }).compileComponents();
    const fixture = TestBed.createComponent(TeacherRecordingsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
