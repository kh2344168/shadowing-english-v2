import { TestBed } from '@angular/core/testing';
import { AdminSettingsPage } from './settings.page';

describe('AdminSettingsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminSettingsPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminSettingsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
