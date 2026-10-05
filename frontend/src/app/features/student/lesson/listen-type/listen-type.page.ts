import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AiMaterial, DictationFeedback, StudentLearningApi } from '../../learning.api';

@Component({
  selector: 'app-student-listen-type-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './listen-type.page.html',
  styleUrl: './listen-type.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentListenTypePage implements OnInit {
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
  answer = '';
  private pendingId = '';
  private pendingAnswer = '';

  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.teacher?.nativeElement.pause();
    this.teacher?.nativeElement.removeAttribute('src');
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (
        !data.completed.vocabulary ||
        (data.shadowingReviewEnabled && !data.completed.shadowingReview)
      ) {
        this.error.set('أكمل الكلمات ومراجعة الشادوينج قبل تدريب الاستماع.');
        this.material.set(null);
      } else {
        this.material.set(data);
        this.completed.set(data.progress.listenType);
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
  async play(): Promise<void> {
    const data = this.material(),
      audio = this.teacher?.nativeElement;
    if (!data || !audio || this.completed() >= data.dictation.length) return;
    this.error.set('');
    try {
      audio.src = data.dictation[this.completed()].audioUrl;
      audio.currentTime = 0;
      await audio.play();
    } catch {
      this.error.set('تعذر تشغيل صوت الدرس. حاول مجددًا.');
    }
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
        this.completed.update((value) => value + 1);
        this.answer = '';
        this.teacher?.nativeElement.pause();
        this.teacher?.nativeElement.removeAttribute('src');
      }
    } catch {
      this.error.set('تعذر التحقق من الإجابة. أعد المحاولة أو حدّث التقدم.');
    } finally {
      this.busy.set(false);
    }
  }
}
