import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminCurriculumsPage } from './curriculums.page';

describe('AdminCurriculumsPage', () => {
  it('directs the admin to the available Shadowing publishing flow', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminCurriculumsPage],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminCurriculumsPage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/lesson-builder',
    );
  });
});
