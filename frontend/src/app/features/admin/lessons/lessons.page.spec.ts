import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminLessonsPage } from './lessons.page';

describe('AdminLessonsPage', () => {
  it('loads the saved lesson list without publishing anything', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLessonsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminLessonsPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/admin/shadowing/lessons?page=1').flush({
      items: [
        {
          id: 'lesson-1',
          versionId: 'version-1',
          title: 'Hello',
          description: 'Example',
          segmentCount: 1,
        },
      ],
      hasMore: false,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Hello');
    expect(http.match(() => true)).toEqual([]);
  });
});
