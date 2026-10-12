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
  readonly stage = computed(() => stageAt(this.material()?.stages, 'listen-type'));
  readonly previousStage = computed(() => adjacentStage(this.material()?.stages, 'listen-type', -1));
  readonly nextStage = computed(() => adjacentStage(this.material()?.stages, 'listen-type', 1));
  readonly progressPercent = computed(() => {
    const total = this.material()?.dictation.length ?? 0;
    return total === 0 ? 0 : Math.round(((this.completed() + 1) / total) * 100);
  });
  answer = '';
  private pendingId = '';
  private pendingAnswer = '';

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
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (!stageReady(data, 'listen-type')) {
        this.error.set('أكمل المراحل السابقة قبل تدريب الاستماع والكتابة.');
        this.material.set(null);
      } else {
        this.material.set(data);
        this.completed.set(data.progress.listenType);
        if (data.progress.listenType < data.dictation.length) {
          window.setTimeout(() => void this.play(false), 120);
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
      audio.src = data.dictation[this.completed()].audioUrl;
      audio.currentTime = 0;
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
  reviewWords(text: string): string[] {
    return text.match(/[a-z0-9]+(?:'[a-z0-9]+)?/gi) ?? [];
  }
  async submit(): Promise<void> {
    const data = this.material(),
      text = this.answer.trim();
    if (
      !data ||
      this.busy() ||
      !text ||
      text.length > 600 ||
      this.completed() >= data.dictation.length
    )
      return;
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
      this.feedback.set(result);
      this.pendingId = '';
      this.pendingAnswer = '';
      if (result.correct) {
        const nextPosition = this.completed() + 1;
        this.completed.set(nextPosition);
        this.answer = '';
        this.stopAudio();
        if (nextPosition < data.dictation.length) {
          window.setTimeout(() => void this.play(false), 120);
        }
      }
    } catch {
      this.error.set('تعذر التحقق من الإجابة. أعد المحاولة أو حدّث التقدم.');
    } finally {
      this.busy.set(false);
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const isWriting = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
    if (event.code === 'Space' && !isWriting) {
      event.preventDefault();
      void this.play();
    }
  }

  private stopAudio(): void {
    const audio = this.teacher?.nativeElement;
    if (audio?.hasAttribute('src')) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.playing.set(false);
  }
}
