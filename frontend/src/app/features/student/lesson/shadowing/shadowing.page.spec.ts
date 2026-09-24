import { TestBed } from '@angular/core/testing';
import { StudentShadowingPage } from './shadowing.page';

describe('StudentShadowingPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [StudentShadowingPage] }).compileComponents();
    const fixture = TestBed.createComponent(StudentShadowingPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
