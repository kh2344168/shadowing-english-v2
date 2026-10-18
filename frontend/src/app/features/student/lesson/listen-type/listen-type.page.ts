import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AiMaterial, DictationFeedback, StudentLearningApi } from '../../learning.api';
import { adjacentStage, stageAt, stageReady } from '../stage-flow';

@Component({
  selector: 'app-student-listen-type-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './listen-type.page.html',
  styleUrl: './listen-type.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentListenTypePage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  @ViewChild('teacher') teacher?: ElementRef<HTMLAudioElement>;
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly material = signal<AiMaterial | null>(null);
  readonly completed = signal(0);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly feedback = signal<DictationFeedback | null>(null);
  readonly playing = signal(false);
  readonly slowPlayback = signal(false);
  readonly selectedWordIndices = signal<number[]>([]);
  readonly masteredCount = signal(0);
  readonly reviewRemaining = signal(0);
  readonly isReviewRound = signal(false);
  readonly attemptNumber = signal(1);
  readonly currentQuestion = computed(() => this.material()?.dictation[this.completed()] ?? null);
  readonly mode = computed(() => this.currentQuestion()?.mode ?? 'full-sentence');
  readonly stage = computed(() => stageAt(this.material()?.stages, 'listen-type'));
  readonly previousStage = computed(() =>
    adjacentStage(this.material()?.stages, 'listen-type', -1),
  );
  readonly nextStage = computed(() => adjacentStage(this.material()?.stages, 'listen-type', 1));
  readonly progressPercent = computed(() => {
    const total = this.material()?.dictation.length ?? 0;
    return total === 0 ? 0 : Math.round((this.masteredCount() / total) * 100);
  });
  answer = '';
  private pendingId = '';
  private pendingAnswer = '';
  private audioStartSeconds: number | null = null;
  private audioEndSeconds: number | null = null;
  private playTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    this.stopAudio();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.stopAudio();
    this.feedback.set(null);
    this.selectedWordIndices.set([]);
    this.answer = '';
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (!stageReady(data, 'listen-type')) {
        this.error.set('أكمل المراحل السابقة قبل تدريب الاستماع والكتابة.');
        this.material.set(null);
      } else if (data.dictation.length > 0 && !data.dictationState) {
        this.material.set(null);
        this.error.set(
          'خادم الدرس يعمل بنسخة قديمة. أعد تشغيل الـAPI ثم حدّث الصفحة لتفعيل ترحيل الإجابات الخاطئة.',
        );
      } else {
        this.material.set(data);
        const state = data.dictationState;
        this.completed.set(
          state
            ? state.nextPosition === null
              ? data.dictation.length
              : state.nextPosition - 1
            : data.progress.listenType,
        );
        this.masteredCount.set(state?.masteredCount ?? data.progress.listenType);
        this.reviewRemaining.set(state?.reviewRemaining ?? 0);
        this.isReviewRound.set(state?.isReviewRound ?? false);
        this.attemptNumber.set((state?.attemptCount ?? 0) + 1);
        if (data.dictation.length > 0 && this.completed() < data.dictation.length) {
          this.schedulePlay();
        }
      }
    } catch (ex) {
      this.error.set(
        (ex as { status?: number }).status === 404
          ? 'هذا النشاط لم يُنشر بعد.'
          : 'تعذر تحميل التدريب.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  async play(reportFailure = true): Promise<void> {
    const data = this.material(),
      audio = this.teacher?.nativeElement;
    if (!data || !audio || this.completed() >= data.dictation.length) return;
    this.error.set('');
    try {
      const clip = data.dictation[this.completed()];
      if (!clip.audioUrl) {
        this.error.set('تسجيل المدرّس غير متاح لهذه الجملة.');
        return;
      }
      audio.src = clip.audioUrl;
      const start = clip.mode === 'single-word' ? clip.audioStartSeconds : null;
      const end = clip.mode === 'single-word' ? clip.audioEndSeconds : null;
      const hasRange =
        typeof start === 'number' &&
        typeof end === 'number' &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start;
      this.audioStartSeconds = hasRange ? start : null;
      this.audioEndSeconds = hasRange ? end : null;
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        audio.currentTime = this.audioStartSeconds ?? 0;
      }
      audio.playbackRate = this.slowPlayback() ? 0.75 : 1;
      await audio.play();
      this.playing.set(true);
    } catch {
      this.playing.set(false);
      if (reportFailure) this.error.set('تعذر تشغيل صوت الدرس. حاول مجددًا.');
    }
  }
  toggleSpeed(): void {
    this.slowPlayback.update((value) => !value);
    const audio = this.teacher?.nativeElement;
    if (audio) audio.playbackRate = this.slowPlayback() ? 0.75 : 1;
  }
  onAudioStopped(): void {
    this.playing.set(false);
  }
  onAudioLoadedMetadata(): void {
    const audio = this.teacher?.nativeElement;
    if (audio && this.audioStartSeconds !== null) audio.currentTime = this.audioStartSeconds;
  }
  onAudioTimeUpdate(): void {
    const audio = this.teacher?.nativeElement;
    if (audio && this.audioEndSeconds !== null && audio.currentTime >= this.audioEndSeconds) {
      audio.pause();
      this.playing.set(false);
    }
  }
  onAudioError(): void {
    if (!this.teacher?.nativeElement.hasAttribute('src')) return;
    this.playing.set(false);
    this.error.set('تعذر تحميل تسجيل المدرّس لهذه الجملة. جرّب مرة أخرى أو أخبر المدرّس.');
  }
  reviewWords(text: string): string[] {
    return text.match(/[a-z0-9]+(?:'[a-z0-9]+)?/gi) ?? [];
  }
  chooseWord(index: number): void {
    const options = this.currentQuestion()?.wordOptions ?? [];
    if (this.busy() || this.feedback() || index < 0 || index >= options.length) return;
    this.selectedWordIndices.update((indices) =>
      indices.includes(index) ? indices : [...indices, index],
    );
  }
  removeWord(position: number): void {
    if (this.busy() || this.feedback()) return;
    this.selectedWordIndices.update((indices) => indices.filter((_, index) => index !== position));
  }
  moveWord(position: number, direction: -1 | 1): void {
    if (this.busy() || this.feedback()) return;
    this.selectedWordIndices.update((indices) => {
      const target = position + direction;
      if (position < 0 || target < 0 || target >= indices.length) return indices;
      const moved = [...indices];
      [moved[position], moved[target]] = [moved[target], moved[position]];
      return moved;
    });
  }
  responseText(): string {
    if (this.mode() !== 'word-order') return this.answer.trim();
    const options = this.currentQuestion()?.wordOptions ?? [];
    return this.selectedWordIndices()
      .map((index) => options[index])
      .join(' ');
  }
  canSubmit(): boolean {
    const text = this.responseText();
    if (this.busy() || this.feedback() || !text || text.length > 600) return false;
    if (this.mode() === 'word-order') {
      const count = this.currentQuestion()?.wordOptions?.length ?? 0;
      return count > 0 && this.selectedWordIndices().length === count;
    }
    if (this.mode() === 'missing-word' || this.mode() === 'single-word') {
      return text.length <= 80 && !/\s/.test(text);
    }
    return true;
  }
  async submit(): Promise<void> {
    const data = this.material(),
      text = this.responseText();
    if (!data || !this.canSubmit() || this.completed() >= data.dictation.length) return;
    this.busy.set(true);
    this.error.set('');
    this.feedback.set(null);
    if (!this.pendingId || this.pendingAnswer !== text) {
      this.pendingId = crypto.randomUUID();
      this.pendingAnswer = text;
    }
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(
        this.api.dictationAnswer(
          this.slotId,
          data.dictation[this.completed()].position,
          text,
          this.pendingId,
        ),
      );
      if (result.nextPosition === undefined || result.attemptCount === undefined) {
        this.pendingId = '';
        this.pendingAnswer = '';
        this.error.set(
          'خادم الدرس يعمل بنسخة قديمة. أعد تشغيل الـAPI ثم حدّث الصفحة؛ لن نعيد السؤال الخطأ الآن.',
        );
        return;
      }
      this.feedback.set(result);
      this.masteredCount.set(
        result.masteredCount ??
          (result.correct
            ? Math.max(this.masteredCount(), this.completed() + 1)
            : this.masteredCount()),
      );
      this.pendingId = '';
      this.pendingAnswer = '';
      this.stopAudio();
    } catch {
      this.error.set('تعذر التحقق من الإجابة. أعد المحاولة أو حدّث التقدم.');
    } finally {
      this.busy.set(false);
    }
  }

  advance(): void {
    const data = this.material();
    const result = this.feedback();
    if (!data || !result || this.completed() >= data.dictation.length) return;
    this.stopAudio();
    this.completed.set(
      result.nextPosition === null ? data.dictation.length : result.nextPosition! - 1,
    );
    this.reviewRemaining.set(result.reviewRemaining ?? this.reviewRemaining());
    this.isReviewRound.set(result.isReviewRound ?? false);
    this.attemptNumber.set(result.attemptCount! + 1);
    this.feedback.set(null);
    this.selectedWordIndices.set([]);
    this.answer = '';
    this.error.set('');
    if (this.completed() < data.dictation.length) this.schedulePlay();
  }

  nextButtonLabel(result: DictationFeedback): string {
    if (result.nextPosition === null) return 'إنهاء المرحلة ←';
    if (result.isReviewRound)
      return result.nextPosition === this.completed() + 1
        ? 'حاول مرة أخرى ←'
        : 'ابدأ المراجعة التالية ←';
    return 'السؤال التالي ←';
  }

  @HostListener('window:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const isInteractive = target?.closest(
      'button, a, input, textarea, select, [contenteditable="true"]',
    );
    if (event.code === 'Space' && !isInteractive) {
      event.preventDefault();
      void this.play();
    }
  }

  private stopAudio(): void {
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    this.audioStartSeconds = null;
    this.audioEndSeconds = null;
    const audio = this.teacher?.nativeElement;
    if (audio?.hasAttribute('src')) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.playing.set(false);
  }

  private schedulePlay(): void {
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = setTimeout(() => {
      this.playTimer = null;
      void this.play(false);
    }, 120);
  }
}
