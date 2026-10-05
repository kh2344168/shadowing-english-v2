import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { StudentListenTypePage } from './listen-type.page';

describe('StudentListenTypePage', () => {
  it('requires vocabulary and sends the written answer without preloading sound', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentListenTypePage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId: 's1' }) } },
        },
        { provide: AuthService, useValue: { csrf: () => of({}) } },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentListenTypePage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
      completed: { vocabulary: true },
      progress: { listenType: 0 },
      dictation: [{ position: 1, audioUrl: '/api/student/learning/slots/s1/segments/1/audio' }],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('audio') as HTMLAudioElement).getAttribute('src'),
    ).toBeNull();
    fixture.componentInstance.answer = 'Hello there';
    void fixture.componentInstance.submit();
    await fixture.whenStable();
    const write = http.expectOne('/api/student/learning/slots/s1/listen-type/answers');
    expect(write.request.body).toMatchObject({ position: 1, answer: 'Hello there' });
    write.flush({ correct: false, wrongPositions: [1], expected: 'Hello world' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Hello world');
    http.verify();
  });
});
