import { TestBed } from '@angular/core/testing';
import { AdminGroupsPage } from './groups.page';

describe('AdminGroupsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminGroupsPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminGroupsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
