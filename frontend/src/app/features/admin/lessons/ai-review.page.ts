import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  LessonAiApi,
  LessonAiJob,
  LessonMaterial,
  LessonSegmentReview,
  QuizCard,
} from './lesson-ai.api';
import { LessonStageType, LessonWorkflowApi, LessonWorkflowStage } from './lesson-workflow.api';

type ReviewStage =
  | 'vocabulary'
  | 'listen-type'
  | 'grammar'
  | 'vocabulary-quiz'
  | 'grammar-quiz'
  | 'word-order'
  | 'conversation';

@Component({
  selector: 'app-admin-lesson-stage-editor',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './ai-review.page.html',
  styleUrl: './ai-review.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonStageEditorPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(LessonAiApi);
  private readonly workflowApi = inject(LessonWorkflowApi);
  private readonly auth = inject(AuthService);
  readonly versionId = this.route.snapshot.paramMap.get('versionId') ?? '';
  readonly workflowStageId = this.route.snapshot.paramMap.get('stageId');
  readonly providers = signal<string[]>([]);
  readonly job = signal<LessonAiJob | null>(null);
  readonly draft = signal<LessonMaterial | null>(null);
  readonly segments = signal<LessonSegmentReview[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly dirty = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly selectedStage = signal<ReviewStage | null>(null);
  readonly activeWorkflowStage = signal<LessonWorkflowStage | null>(null);
  readonly requiredReviewStages = signal<ReviewStage[]>([
    'vocabulary',
    'listen-type',
    'grammar',
    'vocabulary-quiz',
    'grammar-quiz',
    'word-order',
    'conversation',
  ]);
  readonly stages: { key: ReviewStage; title: string; description: string; icon: string }[] = [
    {
      key: 'vocabulary',
      title: 'الكلمات والعبارات',
      description: 'راجع المعاني والأمثلة واختر ما يظهر للطالب.',
      icon: 'translate',
    },
    {
      key: 'listen-type',
      title: 'اسمع واكتب',
      description: 'اختر الجمل والإجابات المقبولة.',
      icon: 'headphones',
    },
    {
      key: 'grammar',
      title: 'قواعد الدرس',
      description: 'حرّر القاعدة المستهدفة واربطها بأمثلة الدرس.',
      icon: 'menu_book',
    },
    {
      key: 'vocabulary-quiz',
      title: 'اختبار الكلمات',
      description: 'أسئلة مخصصة لمعاني الكلمات والعبارات.',
      icon: 'quiz',
    },
    {
      key: 'grammar-quiz',
      title: 'اختبار القواعد',
      description: 'أسئلة تطبيقية على قاعدة الدرس.',
      icon: 'fact_check',
    },
    {
      key: 'word-order',
      title: 'ترتيب الجمل',
      description: 'راجع تدريبات ترتيب كلمات الجملة.',
      icon: 'reorder',
    },
    {
      key: 'conversation',
      title: 'محادثة الدرس',
      description: 'راجع الموقف والأدوار والكلمات المستهدفة.',
      icon: 'forum',
    },
  ];
  private pollTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  ngOnInit(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.pollTimer);
  }
  async load(): Promise<void> {
    if (!this.versionId || !this.workflowStageId || this.destroyed) return;
    const started = performance.now();
    console.info('[Admin.AiReview.Load.Start]', { versionId: this.versionId });
    clearTimeout(this.pollTimer);
    this.loading.set(true);
    this.error.set('');
    try {
      const [providers, job, segments, workflow] = await Promise.all([
        firstValueFrom(this.api.providers()),
        firstValueFrom(this.api.get(this.versionId)),
        firstValueFrom(this.api.segments(this.versionId)),
        firstValueFrom(this.workflowApi.get(this.versionId)),
      ]);
      if (this.destroyed) return;
      this.providers.set(providers.configured);
      this.segments.set(segments);
      this.setJob(job);
      if (workflow) {
        this.requiredReviewStages.set([
          ...new Set(
            workflow.stages
              .filter((stage) => stage.enabled)
              .map((stage) => this.toReviewStage(stage.type))
              .filter((stage): stage is ReviewStage => !!stage),
          ),
        ]);
      }
      if (workflow) {
        const requested = workflow.stages.find((stage) => stage.id === this.workflowStageId);
        this.activeWorkflowStage.set(requested ?? null);
        const reviewStage = requested ? this.toReviewStage(requested.type) : null;
        if (reviewStage && job?.status === 'Draft') this.selectedStage.set(reviewStage);
      }
      console.info('[Admin.AiReview.Load.Success]', {
        versionId: this.versionId,
        status: job?.status ?? 'None',
        errorCode: job?.status === 'Failed' ? job.errorCode : null,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (ex) {
      this.error.set('تعذر تحميل حالة معالجة الدرس. حاول مرة أخرى.');
      console.warn('[Admin.AiReview.Load.Failed]', {
        versionId: this.versionId,
        status: (ex as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.loading.set(false);
    }
  }
  private toReviewStage(type: LessonStageType): ReviewStage | null {
    if (type === 'vocabulary') return 'vocabulary';
    if (type === 'listen-type') return 'listen-type';
    if (
      type === 'grammar' ||
      type === 'vocabulary-quiz' ||
      type === 'grammar-quiz' ||
      type === 'word-order'
    )
      return type;
    if (type === 'conversation') return 'conversation';
    return null;
  }
  private setJob(job: LessonAiJob | null): void {
    this.job.set(job);
    const material = job?.material ? structuredClone(job.material) : null;
    const needsDictation = !!material && material.dictation == null && job?.status === 'Draft';
    if (needsDictation && material) {
      material.dictation = this.segments()
        .filter(({ text }) => text.trim().length <= 600)
        .map(({ position, text }) => ({
          position,
          enabled: true,
          acceptedAnswers: [text],
          hint: null,
        }));
    }
    const needsReviewInit =
      !!material && job?.status === 'Draft' && material.reviewedStages == null;
    if (needsReviewInit && material) material.reviewedStages = [];
    this.draft.set(material);
    this.dirty.set(needsDictation || needsReviewInit);
    if (job?.status !== 'Draft') this.selectedStage.set(null);
    clearTimeout(this.pollTimer);
    if (job && (job.status === 'Pending' || job.status === 'Generating')) {
      this.pollTimer = setTimeout(() => {
        if (!this.destroyed) void this.load();
      }, 3000);
    }
  }
  failureReason(code: string | null): string {
    switch (code) {
      case 'provider_auth_rejected':
        return 'المزوّد رفض المفتاح أو صلاحية الحساب (401/403). راجع إعداد المفتاح على جهازك وأعد تشغيل API.';
      case 'provider_rate_limited':
        return 'المزوّد وصل لحد الطلبات الحالي (429). حاول لاحقًا أو أضف مزودًا آخر للانتقال التلقائي.';
      case 'provider_invalid_output':
        return 'ردّ النموذج لم يجتز فحص الكلمات والأسئلة. أعد المعالجة، وإن تكرر جرّب نموذجًا نصيًا آخر.';
      case 'provider_timeout':
        return 'المزوّد لم يردّ في المهلة المحددة. أعد المحاولة أو جرّب مزودًا آخر.';
      case 'provider_request_rejected':
        return 'المزوّد رفض الطلب. راجع اسم النموذج وإعداداته في الباك إند وسطر Ai.Provider.Failed.';
      case 'provider_unavailable':
      case 'provider_request_failed':
        return 'تعذر الوصول إلى المزوّد. راجع اتصال API وسطر Ai.Provider.Failed.';
      case 'providers_unavailable_or_invalid_output':
        return 'لم يرجع مزود الذكاء الاصطناعي محتوى صالحًا. افحص سطر Ai.Provider في نافذة تشغيل API لمعرفة هل رفض الطلب أم كانت الاستجابة غير صالحة.';
      case 'generated_activity_invalid':
        return 'تم توليد المحتوى، لكن تجهيز التمارين من جمل الدرس لم يجتز التحقق. راجع طول الجمل ثم أعد المحاولة.';
      case 'generation_failed':
        return 'حدث خطأ داخل معالجة الدرس. راجع سطر Ai.Job.Failed في نافذة تشغيل API.';
      default:
        return 'تعذرت المعالجة. يمكنك إعادة المحاولة، ثم مراجعة سجل API إن تكرر الفشل.';
    }
  }
  changed(): void {
    const stage = this.selectedStage();
    const material = this.draft();
    if (stage && material?.reviewedStages?.includes(stage)) {
      material.reviewedStages = material.reviewedStages.filter((key) => key !== stage);
      this.draft.set({ ...material });
    }
    this.dirty.set(true);
  }

  stageNumber(): number {
    return this.activeWorkflowStage()?.position ?? 1;
  }
  stageTitle(stage: ReviewStage): string {
    if (this.activeWorkflowStage()) return this.activeWorkflowStage()!.title;
    return this.stages.find(({ key }) => key === stage)?.title ?? '';
  }
  pageTitle(): string {
    const selected = this.selectedStage();
    if (selected) return this.stageTitle(selected);
    return this.activeWorkflowStage()?.title ?? 'استوديو محتوى الدرس';
  }
  stageReviewed(stage: ReviewStage): boolean {
    const reviewed = this.draft()?.reviewedStages ?? [];
    return (
      reviewed.includes(stage) ||
      (['grammar', 'vocabulary-quiz', 'grammar-quiz', 'word-order'].includes(stage) &&
        reviewed.includes('quiz'))
    );
  }
  reviewedCount(): number {
    return this.requiredReviewStages().filter((stage) => this.stageReviewed(stage)).length;
  }
  stageIssues(stage: ReviewStage): string[] {
    const material = this.draft();
    if (!material) return ['لم تجهز المسودة بعد.'];
    switch (stage) {
      case 'vocabulary':
        if (!material.vocabulary.some((card) => card.includeForStudent !== false))
          return ['اختر كلمة أو عبارة واحدة على الأقل للطالب.'];
        return material.vocabulary.some(
          (card) =>
            !card.word?.trim() ||
            !card.meaningAr?.trim() ||
            !card.exampleEn?.trim() ||
            !card.exampleAr?.trim(),
        )
          ? ['أكمل بيانات الكلمات أو استبعد البطاقة غير المكتملة من المسودة.']
          : [];
      case 'listen-type':
        if (!material.dictation?.some((item) => item.enabled))
          return ['اختر جملة واحدة على الأقل.'];
        return material.dictation.some((item) => !item.acceptedAnswers.length)
          ? ['أضف إجابة مقبولة لكل جملة في المسودة.']
          : [];
      case 'grammar':
        return material.grammarFocus?.trim() ? [] : ['اكتب القاعدة المستهدفة قبل الاعتماد.'];
      case 'vocabulary-quiz':
      case 'grammar-quiz':
      case 'word-order': {
        const type =
          stage === 'vocabulary-quiz'
            ? 'vocabulary-card'
            : stage === 'word-order'
              ? 'word-order'
              : 'multiple-choice';
        const questions = this.questionsFor(type).map(({ question }) => question);
        if (!questions.some((question) => question.enabled !== false))
          return ['أضف سؤالًا واحدًا على الأقل أو فعّل سؤالًا موجودًا.'];
        return questions.some(
          (question) =>
            !question.question?.trim() ||
            !question.explanationAr?.trim() ||
            question.options.some((option) => !option.trim()),
        )
          ? ['أكمل بيانات الأسئلة أو استبعد السؤال غير المكتمل من المسودة.']
          : [];
      }
      case 'conversation':
        return material.conversationScenario?.trim() ? [] : ['أكمل موقف المحادثة قبل الاعتماد.'];
    }
  }
  async reviewStage(): Promise<void> {
    const stage = this.selectedStage(),
      material = this.draft();
    if (!stage || !material || this.busy() || this.stageIssues(stage).length) return;
    material.reviewedStages = [...new Set([...(material.reviewedStages ?? []), stage])];
    this.draft.set({ ...material });
    this.dirty.set(true);
    await this.save();
    if (!this.dirty()) {
      await this.router.navigate(['/admin/lessons', this.versionId, 'workflow']);
    }
  }

  addVocabulary(): void {
    const material = this.draft();
    if (!material || material.vocabulary.length >= 20) return;
    material.vocabulary.push({
      word: '',
      kind: 'word',
      meaningAr: '',
      exampleEn: '',
      exampleAr: '',
      includeForStudent: true,
      testLater: false,
      repeatForReview: false,
      imageUrl: null,
    });
    this.draft.set({ ...material });
    this.changed();
  }
  removeVocabulary(index: number): void {
    const material = this.draft();
    if (!material || material.vocabulary.length <= 1) return;
    material.vocabulary.splice(index, 1);
    this.draft.set({ ...material });
    this.changed();
  }
  clearVocabularyImage(index: number): void {
    const material = this.draft();
    if (!material?.vocabulary[index]) return;
    material.vocabulary[index].imageUrl = null;
    this.draft.set({ ...material });
    this.changed();
  }

  async backToStages(): Promise<void> {
    await this.router.navigate(['/admin/lessons', this.versionId, 'workflow']);
  }
  addQuestion(type: 'multiple-choice' | 'vocabulary-card' | 'word-order'): void {
    const material = this.draft();
    if (!material || material.quiz.length >= 12) return;
    material.quiz.push({
      question: '',
      options: type === 'word-order' ? ['', '', ''] : ['', '', '', ''],
      correctIndex: 0,
      explanationAr: '',
      type,
      enabled: true,
      correctAnswer: type === 'word-order' ? '' : null,
    });
    this.draft.set({ ...material });
    this.changed();
  }
  removeQuestion(index: number): void {
    const material = this.draft();
    if (!material || material.quiz.length <= 1) return;
    material.quiz.splice(index, 1);
    this.draft.set({ ...material });
    this.changed();
  }
  changeQuestionType(
    index: number,
    type: 'multiple-choice' | 'vocabulary-card' | 'word-order',
  ): void {
    const material = this.draft();
    if (!material) return;
    material.quiz[index].type = type;
    material.quiz[index].options = type === 'word-order' ? ['', '', ''] : ['', '', '', ''];
    material.quiz[index].correctAnswer = type === 'word-order' ? '' : null;
    material.quiz[index].correctIndex = 0;
    this.draft.set({ ...material });
    this.changed();
  }
  questionsFor(type: NonNullable<QuizCard['type']>): { question: QuizCard; index: number }[] {
    return (this.draft()?.quiz ?? [])
      .map((question, index) => ({ question, index }))
      .filter((item) => (item.question.type ?? 'multiple-choice') === type);
  }
  stageIcon(stage: ReviewStage): string {
    return this.stages.find(({ key }) => key === stage)?.icon ?? 'auto_awesome';
  }
  speak(text: string): void {
    const value = text.trim();
    if (!value || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.lang = 'en-US';
    utterance.rate = 0.82;
    speechSynthesis.speak(utterance);
  }
  updateAnswers(position: number, value: string): void {
    const item = this.draft()?.dictation?.find((x) => x.position === position);
    if (!item) return;
    item.acceptedAnswers = value
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    this.changed();
  }
  dictationItem(position: number) {
    return this.draft()?.dictation?.find((x) => x.position === position) ?? null;
  }
  updateGoals(value: string): void {
    const material = this.draft();
    if (!material) return;
    material.conversationGoals = value
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    this.changed();
  }

  async generate(): Promise<void> {
    if (this.busy() || !this.providers().length || !this.versionId) return;
    const started = performance.now();
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    console.info('[Admin.AiReview.Generate.Start]', { versionId: this.versionId });
    try {
      await firstValueFrom(this.auth.csrf());
      const job = await firstValueFrom(this.api.start(this.versionId, crypto.randomUUID()));
      this.setJob(job);
      this.notice.set('بدأت معالجة الكلمات والتمارين. ستظهر المسودة هنا بعد قليل.');
      console.info('[Admin.AiReview.Generate.Success]', {
        versionId: this.versionId,
        jobId: job.id,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (ex) {
      this.error.set('تعذر بدء المعالجة. حدّث الحالة وحاول مجددًا.');
      console.warn('[Admin.AiReview.Generate.Failed]', {
        versionId: this.versionId,
        status: (ex as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.busy.set(false);
    }
  }
  async reopenApproved(): Promise<void> {
    const approved = this.job();
    if (!approved || approved.status !== 'Approved' || this.busy()) return;
    const started = performance.now();
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await firstValueFrom(this.auth.csrf());
      const draft = await firstValueFrom(
        this.api.reopen(this.versionId, approved, crypto.randomUUID()),
      );
      this.setJob(draft);
      const active = this.activeWorkflowStage();
      const requested = active ? this.toReviewStage(active.type) : null;
      if (requested) this.selectedStage.set(requested);
      this.notice.set('تم فتح نسخة آمنة للتعديل. النسخة المعتمدة الحالية لم تتغير.');
      console.info('[Admin.AiReview.Reopen.Success]', {
        sourceJobId: approved.id,
        draftJobId: draft.id,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (ex) {
      this.error.set('تعذر فتح نسخة التعديل. قد توجد مسودة أخرى مفتوحة لهذا الدرس.');
      console.warn('[Admin.AiReview.Reopen.Failed]', {
        jobId: approved.id,
        status: (ex as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.busy.set(false);
    }
  }
  async save(): Promise<void> {
    const job = this.job(),
      draft = this.draft();
    if (!job || !draft || job.status !== 'Draft' || !this.dirty() || this.busy()) return;
    const started = performance.now();
    this.busy.set(true);
    this.error.set('');
    console.info('[Admin.AiReview.Save.Start]', { versionId: this.versionId, jobId: job.id });
    try {
      await firstValueFrom(this.auth.csrf());
      const updated = await firstValueFrom(this.api.update(this.versionId, job, draft));
      this.setJob(updated);
      this.notice.set('تم حفظ التعديلات. راجع النتيجة ثم اضغط اعتماد.');
      console.info('[Admin.AiReview.Save.Success]', {
        jobId: job.id,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (ex) {
      this.error.set(
        (ex as { status?: number }).status === 400
          ? 'راجع الكلمات والعبارات والجمل المختارة؛ أسئلة الاختيار تحتاج 4 إجابات مختلفة، وسؤال الترتيب يحتاج كلمات الجملة نفسها.'
          : 'تعذر الحفظ أو تغيّرت المسودة. انسخ تعديلاتك ثم حدّث الصفحة.',
      );
      console.warn('[Admin.AiReview.Save.Failed]', {
        jobId: job.id,
        status: (ex as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.busy.set(false);
    }
  }
}
