import { TestBed } from '@angular/core/testing';
import { StudentListenTypePage } from './listen-type.page';

describe('StudentListenTypePage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentListenTypePage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentListenTypePage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
