import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AiMaterial, QuizFeedback, StudentLearningApi } from '../../learning.api';
import { adjacentStage, stageAt, stageReady } from '../stage-flow';

@Component({
  selector: 'app-student-quiz-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './quiz.page.html',
  styleUrl: './quiz.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentQuizPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly stageKey = this.route.snapshot.routeConfig?.path?.split('/').at(-1) ?? 'quiz';
  readonly material = signal<AiMaterial | null>(null);
  readonly stage = computed(() => stageAt(this.material()?.stages, this.stageKey));
  readonly previousStage = computed(() => adjacentStage(this.material()?.stages, this.stageKey, -1));
  readonly nextStage = computed(() => adjacentStage(this.material()?.stages, this.stageKey, 1));
  readonly questions = computed(() => {
    const quiz = this.material()?.quiz ?? [];
    const type = this.stageKey === 'vocabulary-quiz' ? 'vocabulary-card' :
      this.stageKey === 'grammar-quiz' ? 'multiple-choice' :
      this.stageKey === 'word-order' ? 'word-order' : null;
    return type ? quiz.filter((question) => question.type === type) : quiz;
  });
  readonly completed = signal(0);
  readonly selected = signal<number | null>(null);
  readonly ordered = signal<number[]>([]);
  readonly feedback = signal<QuizFeedback | null>(null);
  readonly answeredOptions = signal<string[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  private pendingId = '';
  private pendingAnswer: string | null = null;

  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (!stageReady(data, this.stageKey) || (!data.stages && !data.completed.listenType)) {
        this.material.set(null);
        this.error.set('أكمل المراحل السابقة قبل الاختبار.');
      } else {
        this.material.set(data);
        this.completed.set(this.stageKey === 'vocabulary-quiz' ? data.progress.vocabularyQuiz ?? 0 :
          this.stageKey === 'grammar-quiz' ? data.progress.grammarQuiz ?? 0 :
          this.stageKey === 'word-order' ? data.progress.wordOrder ?? 0 : data.progress.quiz);
      }
    } catch (ex) {
      this.error.set(
        (ex as { status?: number }).status === 404
          ? 'هذا الاختبار لم يُنشر بعد.'
          : 'تعذر تحميل الاختبار.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  choose(index: number): void {
    this.selected.set(index);
    this.feedback.set(null);
  }
  addWord(index: number): void {
    if (this.ordered().includes(index)) return;
    this.ordered.update((current) => [...current, index]);
    this.feedback.set(null);
  }
  removeWord(index: number): void {
    this.ordered.update((current) => current.filter((x) => x !== index));
    this.feedback.set(null);
  }
  async submit(): Promise<void> {
    const data = this.material(),
      option = this.selected();
    if (!data || this.busy() || this.completed() >= this.questions().length) return;
    const question = this.questions()[this.completed()];
    const isOrder = question.type === 'word-order';
    if (isOrder ? this.ordered().length !== question.options.length : option === null) return;
    const answer = isOrder
      ? this.ordered()
          .map((i) => question.options[i])
          .join(' ')
      : option!;
    this.busy.set(true);
    this.error.set('');
    if (!this.pendingId || this.pendingAnswer !== String(answer)) {
      this.pendingId = crypto.randomUUID();
      this.pendingAnswer = String(answer);
    }
    try {
      await firstValueFrom(this.auth.csrf());
      this.answeredOptions.set(question.options);
      const result = await firstValueFrom(
        this.api.quizAnswer(this.slotId, this.completed() + 1, answer, this.pendingId, this.stageKey),
      );
      this.feedback.set(result);
      this.pendingId = '';
      this.pendingAnswer = null;
      if (result.correct) {
        this.completed.update((value) => value + 1);
        this.selected.set(null);
        this.ordered.set([]);
      }
    } catch {
      this.error.set('تعذر حفظ الإجابة. حاول مجددًا أو حدّث التقدم.');
    } finally {
      this.busy.set(false);
    }
  }
}
