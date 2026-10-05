import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { LessonAiApi, LessonAiJob, LessonMaterial, LessonSegmentReview } from './lesson-ai.api';

type ReviewStage = 'vocabulary' | 'listen-type' | 'quiz' | 'conversation';

@Component({
  selector: 'app-admin-ai-review',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './ai-review.page.html',
  styleUrl: './ai-review.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAiReviewPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(LessonAiApi);
  private readonly auth = inject(AuthService);
  readonly versionId = this.route.snapshot.paramMap.get('versionId') ?? '';
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
  readonly stages: { key: ReviewStage; title: string; description: string }[] = [
    {
      key: 'vocabulary',
      title: 'الكلمات والعبارات',
      description: 'راجع المعاني والأمثلة واختر ما يظهر للطالب.',
    },
    { key: 'listen-type', title: 'اسمع واكتب', description: 'اختر الجمل والإجابات المقبولة.' },
    { key: 'quiz', title: 'اختبار الدرس', description: 'راجع أسئلة الكلمات والقواعد والإجابات.' },
    {
      key: 'conversation',
      title: 'محادثة الدرس',
      description: 'راجع الموقف والأدوار والكلمات المستهدفة.',
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
    if (!this.versionId || this.destroyed) return;
    const started = performance.now();
    console.info('[Admin.AiReview.Load.Start]', { versionId: this.versionId });
    clearTimeout(this.pollTimer);
    this.loading.set(true);
    this.error.set('');
    try {
      const [providers, job, segments] = await Promise.all([
        firstValueFrom(this.api.providers()),
        firstValueFrom(this.api.get(this.versionId)),
        firstValueFrom(this.api.segments(this.versionId)),
      ]);
      if (this.destroyed) return;
      this.providers.set(providers.configured);
      this.segments.set(segments);
      this.setJob(job);
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

  openStage(stage: ReviewStage): void {
    this.error.set('');
    this.notice.set('');
    this.selectedStage.set(stage);
  }
  stageNumber(stage: ReviewStage): number {
    return this.stages.findIndex(({ key }) => key === stage) + 1;
  }
  stageTitle(stage: ReviewStage): string {
    return this.stages.find(({ key }) => key === stage)?.title ?? '';
  }
  stageReviewed(stage: ReviewStage): boolean {
    return this.draft()?.reviewedStages?.includes(stage) ?? false;
  }
  allStagesReviewed(): boolean {
    return this.stages.every(({ key }) => this.stageReviewed(key));
  }
  stageSummary(stage: ReviewStage): string {
    const material = this.draft();
    if (!material) return '';
    switch (stage) {
      case 'vocabulary':
        return `${material.vocabulary.filter((card) => card.includeForStudent !== false).length} من ${material.vocabulary.length} للطالب`;
      case 'listen-type':
        return `${material.dictation?.filter((item) => item.enabled).length ?? 0} جمل مختارة`;
      case 'quiz':
        return `${material.quiz.filter((item) => item.enabled !== false).length} أسئلة مختارة`;
      case 'conversation':
        return material.conversationScenario || 'حدد موقف المحادثة';
    }
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
      case 'quiz':
        if (
          !material.quiz.some((question) => question.enabled !== false) ||
          !material.grammarFocus?.trim()
        )
          return ['اختر سؤالًا واحدًا على الأقل واكتب القاعدة المستهدفة.'];
        return material.quiz.some(
          (question) =>
            !question.question?.trim() ||
            !question.explanationAr?.trim() ||
            question.options.some((option) => !option.trim()),
        )
          ? ['أكمل بيانات الأسئلة أو استبعد السؤال غير المكتمل من المسودة.']
          : [];
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
      this.notice.set(
        'حُفظت مراجعة المرحلة. افتح المرحلة التالية أو اعتمد المحتوى بعد مراجعة الكل.',
      );
      this.selectedStage.set(this.stages.find(({ key }) => !this.stageReviewed(key))?.key ?? null);
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
  async approve(): Promise<void> {
    const job = this.job();
    if (!job || job.status !== 'Draft' || this.busy() || this.dirty() || !this.allStagesReviewed())
      return;
    const started = performance.now();
    this.busy.set(true);
    this.error.set('');
    console.info('[Admin.AiReview.Approve.Start]', { jobId: job.id, versionId: this.versionId });
    try {
      await firstValueFrom(this.auth.csrf());
      this.setJob(await firstValueFrom(this.api.approve(this.versionId, job)));
      this.notice.set('تم اعتماد المحتوى. سيظهر للطلاب عند نشر المنهج بهذا المحتوى.');
      console.info('[Admin.AiReview.Approve.Success]', {
        jobId: job.id,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (ex) {
      this.error.set('تعذر اعتماد المسودة. حدّث الحالة وتحقق من التعديلات.');
      console.warn('[Admin.AiReview.Approve.Failed]', {
        jobId: job.id,
        status: (ex as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.busy.set(false);
    }
  }
}
