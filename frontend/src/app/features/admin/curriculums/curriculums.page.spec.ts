import { TestBed } from '@angular/core/testing';
import { AdminCurriculumsPage } from './curriculums.page';

describe('AdminCurriculumsPage', () => {
  it('renders its page shell', async () => {
    await TestBed.configureTestingModule({ imports: [AdminCurriculumsPage] }).compileComponents();
    const fixture = TestBed.createComponent(AdminCurriculumsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('ليست وظيفة مكتملة');
  });
});
