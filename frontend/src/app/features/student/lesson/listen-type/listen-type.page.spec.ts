import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { StudentListenTypePage } from './listen-type.page';

describe('StudentListenTypePage', () => {
  it('requires vocabulary, checks the answer, and starts each sentence automatically', async () => {
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
    const playAudio = vi.spyOn(StudentListenTypePage.prototype, 'play').mockResolvedValue();
    const fixture = TestBed.createComponent(StudentListenTypePage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
      completed: { vocabulary: true },
      progress: { listenType: 0 },
      dictation: [
        { position: 1, audioUrl: '/api/student/learning/slots/s1/segments/1/audio' },
        { position: 2, audioUrl: '/api/student/learning/slots/s1/segments/2/audio' },
      ],
    });
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 150));
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('audio') as HTMLAudioElement).getAttribute('src'),
    ).toBeNull();
    expect(playAudio).toHaveBeenCalledWith(false);
    playAudio.mockClear();
    fixture.componentInstance.answer = 'Hello there';
    void fixture.componentInstance.submit();
    await fixture.whenStable();
    const write = http.expectOne('/api/student/learning/slots/s1/listen-type/answers');
    expect(write.request.body).toMatchObject({ position: 1, answer: 'Hello there' });
    write.flush({ correct: false, wrongPositions: [1], expected: 'Hello world' });
    await fixture.whenStable();
    fixture.detectChanges();
    const reviewed = Array.from(
      fixture.nativeElement.querySelectorAll('.word-review span') as NodeListOf<HTMLElement>,
    ).map((word) => word.textContent?.trim());
    expect(reviewed).toEqual(['Hello', 'world']);
    expect(fixture.nativeElement.querySelectorAll('.missed-word')).toHaveLength(1);

    fixture.componentInstance.answer = 'Hello world';
    void fixture.componentInstance.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: true,
      wrongPositions: [],
      expected: 'Hello world',
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(playAudio).toHaveBeenCalledWith(false);
    http.verify();
  });
});
