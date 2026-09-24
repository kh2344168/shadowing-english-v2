import { TestBed } from '@angular/core/testing';
import { StudentProgressPage } from './progress.page';

describe('StudentProgressPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentProgressPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentProgressPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
