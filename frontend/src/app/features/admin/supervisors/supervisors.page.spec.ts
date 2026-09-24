import { TestBed } from '@angular/core/testing';
import { AdminSupervisorsPage } from './supervisors.page';

describe('AdminSupervisorsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminSupervisorsPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminSupervisorsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
