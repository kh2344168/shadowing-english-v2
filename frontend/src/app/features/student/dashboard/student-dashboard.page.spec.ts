import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StudentDashboardPage } from './student-dashboard.page';

describe('StudentDashboardPage', () => {
  it('loads only its first visible cards, shows group empty state, and never writes on open', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentDashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentDashboardPage);
    fixture.detectChanges();
    const request = http.expectOne((r) => r.url === '/api/student/learning/curriculum');
    expect(request.request.params.get('pageSize')).toBe('5');
    expect(request.request.method).toBe('GET');
    request.flush({ groupName: null, curriculumTitle: null, items: [], hasMore: false });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('لم تُضف إلى مجموعة');
    expect(http.match((r) => r.method !== 'GET')).toEqual([]);
    http.verify();
  });
});
