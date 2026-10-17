import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  LessonAiApi,
  LessonAiJob,
  LessonMaterial,
  LessonSegmentReview,
  QuizCard,
  StageProcessingStatus,
  VocabularyImageOption,
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
  readonly imagesConfigured = signal(false);
  readonly voiceConfigured = signal(false);
  readonly voiceBusy = signal(false);
  readonly voiceTermsRequired = signal(false);
  readonly vocabularyTargetCount = signal(12);
  selectedVoice = 'Kore';
  private previewAudio: HTMLAudioElement | null = null;
  private previewAudioUrl: string | null = null;
  readonly imageBusy = signal<number | null>(null);
  readonly imageOptions = signal<Record<number, VocabularyImageOption[]>>({});
  readonly imagePages = signal<Record<number, number>>({});
  readonly job = signal<LessonAiJob | null>(null);
  readonly draft = signal<LessonMaterial | null>(null);
  readonly segments = signal<LessonSegmentReview[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly globalProcessing = signal(false);
  readonly dirty = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly selectedStage = signal<ReviewStage | null>(null);
  readonly stageStatus = signal<StageProcessingStatus>('NotStarted');
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
    this.stopVoice();
  }
  @HostListener('window:beforeunload', ['$event'])
  protectUnsavedChanges(event: BeforeUnloadEvent): void {
    if (!this.dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }
  async load(): Promise<void> {
    if (!this.versionId || !this.workflowStageId || this.destroyed) return;
    const started = performance.now();
    console.info('[Admin.AiReview.Load.Start]', { versionId: this.versionId });
    clearTimeout(this.pollTimer);
    this.loading.set(true);
    this.error.set('');
    try {
      const [providers, latestJob, savedDraft, segments, workflow, statuses] = await Promise.all([
        firstValueFrom(this.api.providers()),
        firstValueFrom(this.api.get(this.versionId)),
        firstValueFrom(this.api.latestDraft(this.versionId)),
        firstValueFrom(this.api.segments(this.versionId)),
        firstValueFrom(this.workflowApi.get(this.versionId)),
        firstValueFrom(this.api.stageStatuses(this.versionId)),
      ]);
      if (this.destroyed) return;
      this.providers.set(providers.configured);
      this.imagesConfigured.set(providers.imagesConfigured === true);
      this.voiceConfigured.set(providers.voiceConfigured === true);
      this.segments.set(segments);
      this.globalProcessing.set(
        latestJob?.status === 'Pending' || latestJob?.status === 'Generating',
      );
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
        const stageStatus = requested ? statuses[requested.type] ?? 'NotStarted' : 'NotStarted';
        const useSavedDraft = stageStatus !== 'Pending' && stageStatus !== 'Generating' &&
          stageStatus !== 'Failed' && latestJob?.status !== 'Draft' &&
          latestJob?.status !== 'Approved' && !!savedDraft;
        const job = useSavedDraft ? savedDraft : latestJob;
        this.setJob(job);
        this.stageStatus.set(stageStatus);
        this.selectedStage.set(
          reviewStage && job?.status === 'Draft' &&
          (stageStatus === 'NeedsReview' || stageStatus === 'Approved')
            ? reviewStage
            : null,
        );
        if (stageStatus === 'Pending' || stageStatus === 'Generating') {
          this.pollTimer = setTimeout(() => {
            if (!this.destroyed) void this.load();
          }, 3000);
        }
      }
      console.info('[Admin.AiReview.Load.Success]', {
        versionId: this.versionId,
        status: latestJob?.status ?? 'None',
        errorCode: latestJob?.status === 'Failed' ? latestJob.errorCode : null,
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
    this.imageOptions.set({});
    this.imagePages.set({});
    const material = job?.material ? structuredClone(job.material) : null;
    if (material?.vocabularyTargetCount) this.vocabularyTargetCount.set(material.vocabularyTargetCount);
    const needsDictation = !!material && job?.stageType == null &&
      this.activeWorkflowStage()?.type === 'listen-type' && !material.vocabularyOnly &&
      material.dictation == null && job?.status === 'Draft';
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
      !!material && job?.stageType == null && job?.status === 'Draft' &&
      material.reviewedStages == null;
    if (needsReviewInit && material) material.reviewedStages = [];
    this.draft.set(material);
    this.dirty.set(needsDictation || needsReviewInit);
    if (job?.status !== 'Draft') this.selectedStage.set(null);
  }

  stageIsProcessing(): boolean {
    return this.stageStatus() === 'Pending' || this.stageStatus() === 'Generating';
  }

  canGenerateStage(): boolean {
    return this.activeWorkflowStage()?.type === 'listen-type' || this.providers().length > 0;
  }

  stageCanEdit(): boolean {
    return !this.globalProcessing() && !!this.draft() && this.job()?.status === 'Draft' &&
      (this.stageStatus() === 'NeedsReview' || this.stageStatus() === 'Approved');
  }

  stagePreview(): string {
    const material = this.draft();
    switch (this.activeWorkflowStage()?.type) {
      case 'vocabulary':
        return material?.vocabulary.filter((card) => card.includeForStudent !== false)
          .slice(0, 6).map((card) => card.word).join(' · ') || 'الكلمات محفوظة.';
      case 'conversation':
        return material?.conversationScenario || 'موقف المحادثة محفوظ.';
      case 'grammar':
        return material?.grammarFocus || 'شرح القاعدة محفوظ.';
      default:
        return 'محتوى هذه المرحلة محفوظ؛ سيعود محررها بعد انتهاء المعالجة الحالية.';
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
        if (!material.conversationScenario?.trim()) return ['أكمل موقف المحادثة قبل الاعتماد.'];
        if (
          material.conversationTurnTarget != null &&
          (!Number.isInteger(material.conversationTurnTarget) ||
            material.conversationTurnTarget < 1 ||
            material.conversationTurnTarget > 20)
        )
          return ['حدد عدد ردود الطالب بين 1 و20.'];
        if ((material.conversationTargetWords?.length ?? 0) > 12)
          return ['اختر 12 كلمة أو عبارة كحد أقصى.'];
        if (
          material.conversationTargetWords?.some(
            (word) =>
              !material.vocabulary.some(
                (card) => card.includeForStudent !== false && card.word === word,
              ),
          )
        )
          return ['احذف كلمات مستبعدة أو تغير اسمها من أهداف المحادثة.'];
        return [];
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
  visibleVocabularyCount(): number {
    return this.draft()?.vocabulary.filter((card) => card.includeForStudent !== false).length ?? 0;
  }
  setVocabularySelection(include: boolean): void {
    const material = this.draft();
    if (!material) return;
    material.vocabulary = material.vocabulary.map((card) => ({ ...card, includeForStudent: include }));
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

  async suggestVocabularyImage(index: number): Promise<void> {
    if (this.busy() || this.imageBusy() !== null || !this.imagesConfigured()) return;
    const card = this.draft()?.vocabulary[index];
    if (!card?.word.trim()) return;
    this.error.set('');
    this.notice.set('');
    if (this.dirty() && card.word.trim() !== this.job()?.material?.vocabulary[index]?.word.trim()) {
      await this.save();
      if (this.dirty()) return;
    }
    const job = this.job();
    if (!job || job.status !== 'Draft') return;
    const page = ((this.imagePages()[index] ?? 0) % 10) + 1;
    this.imageBusy.set(index);
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(this.api.vocabularyImages(this.versionId, job, index, page));
      this.imageOptions.update((current) => ({ ...current, [index]: result.options }));
      this.imagePages.update((current) => ({ ...current, [index]: result.page }));
      this.notice.set('اختر الصورة المناسبة من الاقتراحات، ثم احفظ التعديل.');
    } catch (ex) {
      const status = (ex as { status?: number }).status;
      this.error.set(status === 404 ? 'لم نجد صورة مناسبة لهذه الكلمة في Pexels. يمكنك وضع رابط يدويًا.' :
        status === 503 ? 'مفتاح Pexels غير صالح أو غير مفعّل. راجعه من إعدادات مزودي الصور.' :
        status === 429 ? 'وصل Pexels لحد الطلبات المتاح. حاول لاحقًا.' :
        'تعذر جلب الصورة الآن. تحقق من اتصال Pexels أو أعد المحاولة.');
    } finally {
      this.imageBusy.set(null);
    }
  }

  selectVocabularyImage(index: number, imageUrl: string): void {
    const material = this.draft();
    if (!material?.vocabulary[index]) return;
    material.vocabulary[index].imageUrl = imageUrl;
    this.draft.set({ ...material });
    this.changed();
    this.notice.set('تم اختيار الصورة. اضغط حفظ لتثبيتها في مسودة الدرس.');
  }

  async fillMissingVocabularyImages(): Promise<void> {
    if (this.busy() || this.imageBusy() !== null || !this.imagesConfigured()) return;
    if (this.dirty()) {
      await this.save();
      if (this.dirty()) return;
    }
    const job = this.job();
    if (!job || job.status !== 'Draft') return;
    this.busy.set(true);
    this.error.set('');
    let filled = 0;
    try {
      await firstValueFrom(this.auth.csrf());
      for (let index = 0; index < (this.draft()?.vocabulary.length ?? 0); index++) {
        const card = this.draft()?.vocabulary[index];
        if (!card?.word.trim() || card.imageUrl) continue;
        this.imageBusy.set(index);
        try {
          const result = await firstValueFrom(this.api.vocabularyImages(this.versionId, job, index, 1));
          const image = result.options[0];
          if (!image) continue;
          const material = this.draft();
          if (!material?.vocabulary[index]) continue;
          material.vocabulary[index].imageUrl = image.imageUrl;
          this.draft.set({ ...material });
          this.changed();
          filled++;
        } catch {
          // One missing photo must not prevent suggestions for the remaining cards.
        }
      }
      this.notice.set(filled
        ? `تم اقتراح ${filled} صورة. راجع كل بطاقة ثم احفظ التعديلات.`
        : 'لم نجد صورًا مناسبة الآن. تحقق من مفتاح Pexels أو اختر الصور يدويًا.');
    } catch {
      this.error.set('تعذر بدء البحث عن الصور. حدّث الصفحة وحاول مرة أخرى.');
    } finally {
      this.imageBusy.set(null);
      this.busy.set(false);
    }
  }

  async backToStages(): Promise<void> {
    if (this.dirty()) {
      await this.save();
      if (this.dirty()) return;
    }
    await this.router.navigate(['/admin/lessons', this.versionId, 'workflow']);
  }
  async openImageSettings(): Promise<void> {
    if (this.dirty()) {
      await this.save();
      if (this.dirty()) return;
    }
    await this.router.navigate(['/admin/ai-tools']);
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
  private stopVoice(): void {
    this.previewAudio?.pause();
    this.previewAudio = null;
    if (this.previewAudioUrl) URL.revokeObjectURL(this.previewAudioUrl);
    this.previewAudioUrl = null;
  }
  async speak(text: string): Promise<void> {
    const value = text.trim();
    if (!value || this.voiceBusy()) return;
    if (!this.voiceConfigured()) {
      this.error.set('الصوت الطبيعي غير مفعّل. أضف مفتاح Gemini Voice أو Groq Voice من إعدادات الخادم.');
      return;
    }
    this.voiceBusy.set(true);
    this.voiceTermsRequired.set(false);
    this.error.set('');
    this.stopVoice();
    try {
      const sound = await firstValueFrom(this.api.voice(this.versionId, value, this.selectedVoice));
      if (this.destroyed) return;
      const url = URL.createObjectURL(sound);
      const audio = new Audio(url);
      this.previewAudioUrl = url;
      this.previewAudio = audio;
      audio.onended = () => this.stopVoice();
      await audio.play();
    } catch (error) {
      this.stopVoice();
      if (await this.voiceErrorCode(error) === 'voice_terms_required') {
        this.voiceTermsRequired.set(true);
        this.error.set('مفتاح الصوت محفوظ، لكن Groq يتطلب قبول شروط نموذج Orpheus من مالك الحساب قبل تشغيل النطق.');
      } else {
        this.error.set('تعذر تشغيل الصوت الطبيعي الآن. راجع إعدادات مزود الصوت أو حاول مرة أخرى.');
      }
    } finally {
      this.voiceBusy.set(false);
    }
  }
  private async voiceErrorCode(error: unknown): Promise<string | null> {
    if (!(error instanceof HttpErrorResponse)) return null;
    if (error.error instanceof Blob) {
      try {
        const body = typeof error.error.text === 'function' ? await error.error.text() :
          await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(error.error);
          });
        const result = JSON.parse(body);
        return typeof result?.error === 'string' ? result.error : null;
      } catch { return null; }
    }
    return typeof error.error?.error === 'string' ? error.error.error : null;
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
  conversationWordSelected(word: string): boolean {
    return this.draft()?.conversationTargetWords?.includes(word) ?? false;
  }
  toggleConversationWord(word: string, selected: boolean): void {
    const material = this.draft();
    if (!material) return;
    const words = material.conversationTargetWords ?? [];
    if (selected && !words.includes(word) && words.length >= 12) return;
    material.conversationTargetWords = selected
      ? [...new Set([...words, word])]
      : words.filter((item) => item !== word);
    this.changed();
  }

  async generate(): Promise<void> {
    const stage = this.activeWorkflowStage();
    if (this.busy() || this.globalProcessing() || !this.canGenerateStage() || !this.versionId || !stage ||
      this.stageIsProcessing()) return;
    if (this.dirty()) {
      this.error.set('احفظ تعديلات هذه المرحلة أولًا قبل إعادة معالجتها.');
      return;
    }
    const started = performance.now();
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    console.info('[Admin.AiReview.Generate.Start]', { versionId: this.versionId, stageType: stage.type });
    try {
      await firstValueFrom(this.auth.csrf());
      const job = await firstValueFrom(
        this.api.generateStage(this.versionId, stage.type, crypto.randomUUID(),
          stage.type === 'vocabulary' ? this.vocabularyTargetCount() : undefined),
      );
      this.setJob(job);
      this.globalProcessing.set(true);
      this.stageStatus.set('Pending');
      this.selectedStage.set(null);
      this.notice.set(`بدأت معالجة ${stage.title} فقط. انتظر قليلًا؛ ستظهر النتيجة هنا للمراجعة.`);
      clearTimeout(this.pollTimer);
      this.pollTimer = setTimeout(() => {
        if (!this.destroyed) void this.load();
      }, 3000);
      console.info('[Admin.AiReview.Generate.Success]', {
        versionId: this.versionId,
        jobId: job.id,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (ex) {
      this.error.set('تعذر بدء معالجة هذه المرحلة. حدّث الحالة وحاول مجددًا.');
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
    if (!approved || approved.status !== 'Approved' || this.busy() || this.globalProcessing()) return;
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
    if (!job || !draft || job.status !== 'Draft' || !this.dirty() || this.busy() ||
      this.globalProcessing()) return;
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
