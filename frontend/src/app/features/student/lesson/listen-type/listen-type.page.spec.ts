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
      dictationState: {
        nextPosition: 1,
        masteredCount: 0,
        reviewRemaining: 0,
        isReviewRound: false,
        attemptCount: 0,
      },
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
    write.flush({
      correct: false,
      wrongPositions: [1],
      expected: 'Hello world',
      nextPosition: 2,
      masteredCount: 0,
      reviewRemaining: 1,
      isReviewRound: false,
      attemptCount: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const reviewed = Array.from(
      fixture.nativeElement.querySelectorAll('.word-review span') as NodeListOf<HTMLElement>,
    ).map((word) => word.textContent?.trim());
    expect(reviewed).toEqual(['Hello', 'world']);
    expect(fixture.nativeElement.querySelectorAll('.missed-word')).toHaveLength(1);
    expect(fixture.componentInstance.canSubmit()).toBe(false);
    (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).click();
    expect(fixture.componentInstance.completed()).toBe(1);

    fixture.componentInstance.answer = 'Second sentence';
    void fixture.componentInstance.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: true,
      wrongPositions: [],
      expected: 'Second sentence',
      nextPosition: 1,
      masteredCount: 1,
      reviewRemaining: 1,
      isReviewRound: true,
      attemptCount: 2,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('إجابة صحيحة');
    expect(playAudio).not.toHaveBeenCalled();
    (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).click();
    expect(fixture.componentInstance.completed()).toBe(0);
    expect(fixture.componentInstance.attemptNumber()).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(playAudio).toHaveBeenCalledWith(false);
    http.verify();
    playAudio.mockRestore();
  });

  it('plays the teacher segment URL for the current sentence and reports missing audio', async () => {
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
    const fixture = TestBed.createComponent(StudentListenTypePage);
    const page = fixture.componentInstance;
    const teacherPlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const teacherPause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const teacherLoad = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/student/learning/slots/s1/ai-material')
      .flush({
        completed: { vocabulary: true },
        progress: { listenType: 0 },
        dictationState: {
          nextPosition: 1,
          masteredCount: 0,
          reviewRemaining: 0,
          isReviewRound: false,
          attemptCount: 0,
        },
        dictation: [
          {
            position: 1,
            segmentPosition: 4,
            audioUrl: '/api/student/learning/slots/s1/segments/4/audio',
          },
        ],
      });
    await fixture.whenStable();
    fixture.detectChanges();

    await page.play();
    const audio = fixture.nativeElement.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe('/api/student/learning/slots/s1/segments/4/audio');
    expect(teacherPlay).toHaveBeenCalled();
    expect(page.playing()).toBe(true);

    page.onAudioError();
    expect(page.playing()).toBe(false);
    expect(page.error()).toContain('تسجيل المدرّس');
    fixture.destroy();
    teacherPlay.mockRestore();
    teacherPause.mockRestore();
    teacherLoad.mockRestore();
  });

  it('shows a missing-word prompt without leaking the answer and accepts only one word', async () => {
    const { fixture, http } = await setup({
      position: 1,
      mode: 'missing-word',
      promptText: 'I _____ to school.',
      audioUrl: '/teacher/1.wav',
    });
    const page = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('I _____ to school.');
    expect(fixture.nativeElement.textContent).not.toContain('I go to school.');
    expect(fixture.nativeElement.querySelector('input#heard')).toBeTruthy();
    page.answer = 'go home';
    fixture.detectChanges();
    expect(page.canSubmit()).toBe(false);
    page.answer = 'go';
    void page.submit();
    await Promise.resolve();
    const write = http.expectOne('/api/student/learning/slots/s1/listen-type/answers');
    expect(write.request.body).toMatchObject({ position: 1, answer: 'go' });
    write.flush({
      correct: true,
      wrongPositions: [],
      expected: 'go',
      nextPosition: null,
      masteredCount: 1,
      reviewRemaining: 0,
      isReviewRound: false,
      attemptCount: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('إجابة صحيحة');
    expect(page.completed()).toBe(0);
    (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).click();
    expect(page.completed()).toBe(1);
    http.verify();
    fixture.destroy();
  });

  it('reorders word cards using focusable buttons and submits the selected order', async () => {
    const { fixture, http } = await setup({
      position: 1,
      mode: 'word-order',
      wordOptions: ['bread', 'I', 'want'],
      audioUrl: '/teacher/1.wav',
    });
    const page = fixture.componentInstance;
    const options = fixture.nativeElement.querySelectorAll(
      '.word-order__option',
    ) as NodeListOf<HTMLButtonElement>;
    expect(options).toHaveLength(3);
    options[1].focus();
    expect(document.activeElement).toBe(options[1]);
    const space = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    options[1].dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    options[1].click();
    options[0].click();
    options[2].click();
    fixture.detectChanges();
    expect(page.responseText()).toBe('I bread want');
    page.moveWord(2, -1);
    expect(page.responseText()).toBe('I want bread');
    page.removeWord(2);
    expect(page.canSubmit()).toBe(false);
    page.chooseWord(0);
    expect(page.canSubmit()).toBe(true);
    void page.submit();
    await Promise.resolve();
    const write = http.expectOne('/api/student/learning/slots/s1/listen-type/answers');
    expect(write.request.body.answer).toBe('I want bread');
    write.flush({
      correct: false,
      wrongPositions: [1],
      expected: 'I need bread',
      nextPosition: 1,
      masteredCount: 0,
      reviewRemaining: 1,
      isReviewRound: true,
      attemptCount: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.word-review span') as NodeListOf<HTMLElement>,
      ).map((word) => word.textContent?.trim()),
    ).toEqual(['I', 'need', 'bread']);
    http.verify();
    fixture.destroy();
  });

  it('plays only the single-word range of the teacher recording', async () => {
    const teacherPlay = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const teacherPause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const teacherLoad = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const { fixture, http } = await setup({
      position: 1,
      mode: 'single-word',
      audioUrl: '/teacher/1.wav',
      audioStartSeconds: 1.25,
      audioEndSeconds: 2.4,
    });
    const page = fixture.componentInstance;
    await page.play();
    const audio = fixture.nativeElement.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe('/teacher/1.wav');
    audio.dispatchEvent(new Event('loadedmetadata'));
    expect(audio.currentTime).toBe(1.25);
    audio.currentTime = 2.4;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(teacherPause).toHaveBeenCalled();
    expect(page.playing()).toBe(false);
    page.answer = 'hello there';
    expect(page.canSubmit()).toBe(false);
    page.answer = 'hello';
    expect(page.canSubmit()).toBe(true);
    http.verify();
    fixture.destroy();
    teacherPlay.mockRestore();
    teacherPause.mockRestore();
    teacherLoad.mockRestore();
  });

  it('puts incorrect answers after the basic pass and keeps reviewing until correct', async () => {
    const { fixture, http } = await setup(
      [
        { position: 1, mode: 'single-word', audioUrl: '/teacher/1.wav' },
        { position: 2, mode: 'single-word', audioUrl: '/teacher/2.wav' },
      ],
      {
        nextPosition: 1,
        masteredCount: 0,
        reviewRemaining: 0,
        isReviewRound: false,
        attemptCount: 0,
      },
    );
    const page = fixture.componentInstance;
    page.answer = 'wrong';
    void page.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: false,
      wrongPositions: [0],
      expected: 'first',
      nextPosition: 2,
      masteredCount: 0,
      reviewRemaining: 1,
      isReviewRound: false,
      attemptCount: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('first');
    expect(page.canSubmit()).toBe(false);
    (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).click();
    expect(page.completed()).toBe(1);

    page.answer = 'second';
    void page.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: true,
      wrongPositions: [],
      expected: 'second',
      nextPosition: 1,
      masteredCount: 1,
      reviewRemaining: 1,
      isReviewRound: true,
      attemptCount: 2,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(page.completed()).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('المراجعة: 1 متبقية');

    page.answer = 'still wrong';
    expect(page.canSubmit()).toBe(false);
    page.answer = 'wrong';
    void page.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: false,
      wrongPositions: [0],
      expected: 'first',
      nextPosition: 1,
      masteredCount: 1,
      reviewRemaining: 1,
      isReviewRound: true,
      attemptCount: 3,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).textContent,
    ).toContain('حاول مرة أخرى');
    (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).click();
    expect(page.completed()).toBe(0);

    page.answer = 'first';
    void page.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: true,
      wrongPositions: [],
      expected: 'first',
      nextPosition: null,
      masteredCount: 2,
      reviewRemaining: 0,
      isReviewRound: false,
      attemptCount: 4,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(page.completed()).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('أنهيت الاستماع والكتابة');
    http.verify();
    fixture.destroy();
  });

  it('shows a deferred first sentence as question seven and sends a wrong review to the queue end', async () => {
    const questions = Array.from({ length: 6 }, (_, index) => ({
      position: index + 1,
      mode: 'full-sentence',
      audioUrl: `/teacher/${index + 1}.wav`,
    }));
    const { fixture, http } = await setup(questions, {
      nextPosition: 1,
      masteredCount: 4,
      reviewRemaining: 2,
      isReviewRound: true,
      attemptCount: 6,
    });
    const page = fixture.componentInstance;
    expect(
      fixture.nativeElement.querySelector('.audio-player__content strong').textContent.trim(),
    ).toBe('الجملة 7');
    page.answer = 'wrong sentence';
    void page.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: false,
      wrongPositions: [0],
      expected: 'First sentence',
      nextPosition: 3,
      masteredCount: 4,
      reviewRemaining: 2,
      isReviewRound: true,
      attemptCount: 7,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const next = fixture.nativeElement.querySelector('.feedback__next') as HTMLButtonElement;
    expect(next.textContent).toContain('المراجعة التالية');
    expect(next.textContent).not.toContain('حاول مرة أخرى');
    next.click();
    fixture.detectChanges();
    expect(page.completed()).toBe(2);
    expect(
      fixture.nativeElement.querySelector('.audio-player__content strong').textContent.trim(),
    ).toBe('الجملة 8');
    http.verify();
    fixture.destroy();
  });

  it('does not silently retry the same wrong sentence with an old API response', async () => {
    const { fixture, http } = await setup({ position: 1, audioUrl: '/teacher/1.wav' });
    const page = fixture.componentInstance;
    page.answer = 'wrong';
    void page.submit();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/listen-type/answers').flush({
      correct: false,
      wrongPositions: [0],
      expected: 'right',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.feedback__next')).toBeNull();
    expect(page.error()).toContain('نسخة قديمة');
    http.verify();
    fixture.destroy();
  });
});

async function setup(
  question: Record<string, unknown> | Record<string, unknown>[],
  dictationState?: {
    nextPosition: number | null;
    masteredCount: number;
    reviewRemaining: number;
    isReviewRound: boolean;
    attemptCount: number;
  },
) {
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
  const fixture = TestBed.createComponent(StudentListenTypePage);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
    completed: { vocabulary: true },
    progress: { listenType: 0 },
    dictation: Array.isArray(question) ? question : [question],
    dictationState: dictationState ?? {
      nextPosition: 1,
      masteredCount: 0,
      reviewRemaining: 0,
      isReviewRound: false,
      attemptCount: 0,
    },
  });
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http };
}
