import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { StudentVocabularyPage } from './vocabulary.page';

describe('StudentVocabularyPage', () => {
  it('does not steal Space or Enter from focused controls', () => {
    const speak = vi.fn();
    const next = vi.fn();
    const page = {
      flipped: () => false,
      busy: () => false,
      speak,
      next,
    } as unknown as StudentVocabularyPage;
    const button = document.createElement('button');
    for (const code of ['Space', 'Enter']) {
      const event = new KeyboardEvent('keydown', { code, cancelable: true });
      Object.defineProperty(event, 'target', { value: button });
      StudentVocabularyPage.prototype.handleShortcut.call(page, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(speak).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    const shortcut = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    Object.defineProperty(shortcut, 'target', { value: document.body });
    StudentVocabularyPage.prototype.handleShortcut.call(page, shortcut);
    expect(shortcut.defaultPrevented).toBe(true);
    expect(speak).toHaveBeenCalledWith('word');
  });

  it('saves words in order and opens the next stage without loading audio', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentVocabularyPage],
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
    const fixture = TestBed.createComponent(StudentVocabularyPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
      vocabulary: [
        {
          word: 'hello',
          meaningAr: 'مرحبًا',
          exampleEn: 'Hello!',
          exampleAr: 'أهلًا',
          imageUrl: 'https://images.pexels.com/photos/1/test.jpeg',
        },
      ],
      progress: { vocabulary: 0 },
      stages: [
        {
          key: 'vocabulary',
          title: 'الكلمات',
          position: 2,
          route: '/student/lessons/s1/vocabulary',
        },
        {
          key: 'listen-type',
          title: 'اسمع واكتب',
          position: 7,
          route: '/student/lessons/s1/listen-type',
        },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('hello');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
    expect(fixture.nativeElement.querySelector('.card-face--back').hasAttribute('inert')).toBe(true);
    fixture.componentInstance.revealMeaning();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.card-face--front').hasAttribute('inert')).toBe(true);
    expect(fixture.nativeElement.querySelector('.action-bar').hasAttribute('inert')).toBe(true);
    fixture.componentInstance.flipped.set(false);
    fixture.detectChanges();
    const image = fixture.nativeElement.querySelector('.word-image img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('https://images.pexels.com/photos/1/test.jpeg');
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('لا توجد صورة متاحة');
    vi.stubGlobal(
      'Audio',
      class {
        pause() {}
        play() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:lesson-word', revokeObjectURL: () => {} });
    const playing = fixture.componentInstance.speak('word');
    const audio = http.expectOne(
      (request) => request.url === '/api/student/learning/slots/s1/vocabulary/audio',
    );
    expect(audio.request.params.get('position')).toBe('1');
    expect(audio.request.params.get('part')).toBe('word');
    audio.flush(new Blob(['wav'], { type: 'audio/wav' }));
    await playing;
    (
      fixture.nativeElement.querySelector('[data-testid="known-button"]') as HTMLButtonElement
    ).click();
    await Promise.resolve();
    const write = http.expectOne('/api/student/learning/slots/s1/vocabulary/progress');
    expect(write.request.method).toBe('PUT');
    expect(write.request.body).toEqual({ position: 1 });
    write.flush({ completed: 1, isComplete: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('a[href="/student/lessons/s1/listen-type"]'),
    ).toBeTruthy();
    http.verify();
    fixture.destroy();
    vi.unstubAllGlobals();
  });
});
