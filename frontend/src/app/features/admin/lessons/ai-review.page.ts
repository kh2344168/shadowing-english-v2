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
  DictationCard,
  QuizCard,
  StageProcessingStatus,
  StageLatestAttempt,
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
  readonly lessonLevel = signal('B1');
  readonly lessonType = signal<'situation' | 'clip' | 'manual'>('manual');
  readonly dictationModes: {
    key: Exclude<NonNullable<DictationCard['mode']>, 'single-word'>;
    title: string;
    icon: string;
  }[] = [
    { key: 'missing-word', title: 'كلمة ناقصة', icon: 'edit_note' },
    { key: 'word-order', title: 'ترتيب كلمات', icon: 'reorder' },
    { key: 'full-sentence', title: 'جملة كاملة', icon: 'subject' },
  ];
  selectedVoice = 'Kore';
  private previewAudio: HTMLAudioElement | null = null;
  private previewAudioUrl: string | null = null;
  private readonly teacherAudioProbeCache = new Map<number, string | null>();
  readonly playingSegment = signal<number | null>(null);
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
  readonly staleDraft = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly approvalAttempted = signal(false);
  readonly selectedStage = signal<ReviewStage | null>(null);
  readonly stageStatus = signal<StageProcessingStatus>('NotStarted');
  readonly latestAttempt = signal<StageLatestAttempt | null>(null);
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
      this.lessonLevel.set(workflow?.level ?? 'B1');
      this.lessonType.set(workflow?.lessonType ?? 'manual');
      const requested = workflow?.stages.find((stage) => stage.id === this.workflowStageId);
      const reviewStage = requested ? this.toReviewStage(requested.type) : null;
      let latestAttempt: StageLatestAttempt | null = null;
      if (requested && reviewStage) {
        try {
          latestAttempt = await firstValueFrom(
            this.api.latestStageAttempt(this.versionId, requested.type),
          );
        } catch {
          // An older API can still serve the editor; only the failure detail is unavailable.
        }
      }
      this.latestAttempt.set(latestAttempt);
      if (latestAttempt?.status === 'Failed' && this.notice().startsWith('بدأت معالجة'))
        this.notice.set('');
      this.segments.set(
        requested?.type === 'listen-type' ? await this.resolveTeacherAudio(segments) : segments,
      );
      if (this.destroyed) return;
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
        this.activeWorkflowStage.set(requested ?? null);
        const stageStatus = requested ? (statuses[requested.type] ?? 'NotStarted') : 'NotStarted';
        // A lesson has one editable draft shared by all stages. Show it even if
        // the approved source has a newer UpdatedAtUtc timestamp.
        const job = savedDraft ?? latestJob;
        this.setJob(job);
        this.stageStatus.set(stageStatus);
        this.selectedStage.set(
          reviewStage &&
            job?.status === 'Draft' &&
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
        errorCode: latestAttempt?.status === 'Failed' ? latestAttempt.errorCode : null,
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
  private async resolveTeacherAudio(
    segments: LessonSegmentReview[],
  ): Promise<LessonSegmentReview[]> {
    return Promise.all(
      segments.map(async (segment) => {
        if (segment.audioUrl !== undefined) return segment;
        if (this.teacherAudioProbeCache.has(segment.position))
          return {
            ...segment,
            audioUrl: this.teacherAudioProbeCache.get(segment.position) ?? null,
          };
        try {
          await firstValueFrom(this.api.probeTeacherSegmentAudio(this.versionId, segment.position));
          const audioUrl = this.api.teacherSegmentAudioUrl(this.versionId, segment.position);
          this.teacherAudioProbeCache.set(segment.position, audioUrl);
          return { ...segment, audioUrl };
        } catch (error) {
          // Older API versions omitted audioUrl. Only a genuine 404 proves the clip is absent.
          if ((error as HttpErrorResponse).status !== 404) return segment;
          this.teacherAudioProbeCache.set(segment.position, null);
          return { ...segment, audioUrl: null };
        }
      }),
    );
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
    this.staleDraft.set(false);
    this.imageOptions.set({});
    this.imagePages.set({});
    const material = job?.material ? structuredClone(job.material) : null;
    if (material?.vocabularyTargetCount)
      this.vocabularyTargetCount.set(material.vocabularyTargetCount);
    const needsDictation =
      !!material &&
      job?.stageType == null &&
      this.activeWorkflowStage()?.type === 'listen-type' &&
      !material.vocabularyOnly &&
      material.dictation == null &&
      job?.status === 'Draft';
    if (needsDictation && material) {
      material.dictation = this.segments()
        .filter(({ text, audioUrl }) => !!audioUrl && text.trim().length <= 600)
        .map(({ position, text }, index) => this.suggestedDictation(position, text, index === 0));
    }
    let convertedLegacyDictation = false;
    if (material?.dictation && job?.status === 'Draft') {
      material.dictation = material.dictation.map((item) => {
        if (item.mode !== 'single-word') return item;
        const text =
          this.segments().find((segment) => segment.position === item.position)?.text ?? '';
        const words = this.dictationWords(text);
        convertedLegacyDictation = true;
        if (words.length < 2)
          return {
            ...item,
            mode: 'full-sentence',
            targetWordIndex: null,
            acceptedAnswers: [text.trim()],
            audioStartSeconds: null,
            audioEndSeconds: null,
          };
        const targetWordIndex =
          item.targetWordIndex != null &&
          item.targetWordIndex >= 0 &&
          item.targetWordIndex < words.length
            ? item.targetWordIndex
            : Math.floor(words.length / 2);
        return {
          ...item,
          mode: 'missing-word',
          targetWordIndex,
          acceptedAnswers: [words[targetWordIndex]],
          audioStartSeconds: null,
          audioEndSeconds: null,
        };
      });
    }
    const needsReviewInit =
      !!material &&
      job?.stageType == null &&
      job?.status === 'Draft' &&
      material.reviewedStages == null;
    if (needsReviewInit && material) material.reviewedStages = [];
    this.draft.set(material);
    this.dirty.set(needsDictation || needsReviewInit || convertedLegacyDictation);
    if (job?.status !== 'Draft') this.selectedStage.set(null);
  }

  stageIsProcessing(): boolean {
    return this.stageStatus() === 'Pending' || this.stageStatus() === 'Generating';
  }

  dictationAudioState(): 'ready' | 'missing' | 'unverified' {
    const segments = this.segments();
    if (segments.some((segment) => segment.audioUrl === undefined)) return 'unverified';
    return segments.some((segment) => !!segment.audioUrl) ? 'ready' : 'missing';
  }

  canGenerateStage(): boolean {
    return this.activeWorkflowStage()?.type === 'listen-type'
      ? this.dictationAudioState() === 'ready'
      : this.providers().length > 0;
  }

  stageCanEdit(): boolean {
    return (
      !this.globalProcessing() &&
      !!this.draft() &&
      this.job()?.status === 'Draft' &&
      (this.stageStatus() === 'NeedsReview' || this.stageStatus() === 'Approved')
    );
  }

  stagePreview(): string {
    const material = this.draft();
    switch (this.activeWorkflowStage()?.type) {
      case 'vocabulary':
        return (
          material?.vocabulary
            .filter((card) => card.includeForStudent !== false)
            .slice(0, 6)
            .map((card) => card.word)
            .join(' · ') || 'الكلمات محفوظة.'
        );
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
        return 'ردّ النموذج لم يجتز التحقق من محتوى هذه المرحلة. جرّب مزودًا نصيًا آخر إذا تكرر الفشل.';
      case 'invalid_previous_material':
        return 'بيانات المحتوى السابق غير قابلة للقراءة. راجع سجل API قبل إعادة المعالجة.';
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
        if (this.dictationAudioState() === 'unverified')
          return ['تعذر التحقق من تسجيلات المدرّس. راجع اتصال API وتخزين الصوت ثم حدّث الصفحة.'];
        if (this.dictationAudioState() === 'missing')
          return [
            'لا يوجد تسجيل صوتي محفوظ لهذا الدرس. أضف صوت المدرّس أو ألغِ تفعيل مرحلة اسمع واكتب.',
          ];
        if (!material.dictation?.some((item) => item.enabled))
          return ['اختر جملة واحدة على الأقل من المقاطع التي لها تسجيل صوتي.'];
        if (
          material.dictation.some(
            (item) =>
              item.enabled &&
              !this.segments().some(
                (segment) => segment.position === item.position && segment.audioUrl,
              ),
          )
        )
          return ['إحدى الجمل المختارة ليس لها تسجيل من صوت المدرّس. استبعدها.'];
        for (const item of material.dictation.filter((card) => card.enabled)) {
          const segment = this.segments().find((x) => x.position === item.position);
          if (!segment) return ['إحدى الجمل المختارة لم يعد لها نص في الدرس.'];
          const words = this.dictationWords(segment.text);
          const mode = this.dictationMode(item);
          if (mode === 'missing-word' && words.length < 2)
            return [`الجملة ${item.position}: الكلمة الناقصة تحتاج جملة فيها كلمتان على الأقل.`];
          if (mode === 'word-order' && (words.length < 3 || words.length > 12))
            return [`الجملة ${item.position}: ترتيب الكلمات يحتاج جملة من 3 إلى 12 كلمة.`];
          if (mode === 'missing-word') {
            const target = item.targetWordIndex;
            if (target == null || target < 0 || target >= words.length)
              return [`الجملة ${item.position}: اختر الكلمة المستهدفة.`];
          }
        }
        return material.dictation.some(
          (item) =>
            item.enabled &&
            this.dictationMode(item) === 'full-sentence' &&
            !item.acceptedAnswers.length,
        )
          ? ['أضف إجابة مقبولة لكل جملة كاملة مختارة.']
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
        return questions
          .filter((question) => question.enabled !== false)
          .some(
            (question) =>
              !question.question?.trim() ||
              !question.explanationAr?.trim() ||
              question.options.some((option) => !option.trim()),
          )
          ? ['أكمل بيانات الأسئلة أو استبعد السؤال غير المكتمل من المسودة.']
          : [];
      }
      case 'conversation': {
        const issues: string[] = [];
        if (!material.conversationScenario?.trim()) issues.push('اكتب موقف المحادثة.');
        if (!material.conversationContextType)
          issues.push('اختر نوع المهمة: موقف حياتي أو مقطع أو تدريب مهني.');
        if (!material.studentRole?.trim() || !material.aiRole?.trim())
          issues.push('حدد دور الطالب ودور المحاور.');
        if (
          !material.conversationSuccessSteps?.length ||
          material.conversationSuccessSteps.some((step) => !step.trim())
        )
          issues.push('اكتب خطوة نجاح واحدة على الأقل، كل خطوة في سطر.');
        if (
          material.conversationMinTurns == null ||
          material.conversationMaxTurns == null ||
          !Number.isInteger(material.conversationMinTurns) ||
          !Number.isInteger(material.conversationMaxTurns) ||
          material.conversationMinTurns < 1 ||
          material.conversationMaxTurns < material.conversationMinTurns ||
          material.conversationMaxTurns > 20
        )
          issues.push('حدد حدًا أدنى وأقصى لردود الطالب بين 1 و20.');
        if (
          material.conversationContextType === 'professional' &&
          !material.conversationAllowedFacts?.length
        )
          issues.push('في التدريب المهني، اكتب حقائق الموقف المسموح بها.');
        if (!material.conversationSupportMode) issues.push('اختر درجة المساعدة المناسبة للطالب.');
        if (!material.openingMessage?.trim()) issues.push('اكتب أول سؤال سيظهر للطالب.');
        if (!material.conversationLearningOutcome?.trim())
          issues.push('حدد ما الذي سيتمكن الطالب من فعله بعد المحادثة.');
        if (material.conversationSupportMode === 'first-steps') {
          if (!material.conversationHelpAr?.trim() || !material.conversationModelAnswer?.trim())
            issues.push('في «الخطوات الأولى»، أضف تلميحًا بالعربية ومثالًا قصيرًا للرد.');
          if (material.conversationFocusTense)
            issues.push('لا تفرض زمنًا نحويًا على طالب «الخطوات الأولى».');
          if (material.conversationCorrectionMode === 'all')
            issues.push('في «الخطوات الأولى»، صحّح أهداف الدرس فقط.');
          if ((material.conversationTargetWords?.length ?? 0) > 3)
            issues.push('اختر 3 كلمات أو عبارات على الأكثر في «الخطوات الأولى».');
          if (material.conversationTurnTarget != null && material.conversationTurnTarget > 5)
            issues.push('«الخطوات الأولى» تحتاج 5 ردود أو أقل.');
          if (material.conversationMaxTurns != null && material.conversationMaxTurns > 6)
            issues.push('«الخطوات الأولى» تحتاج 6 ردود أو أقل كحد أقصى.');
        }
        if (
          material.conversationTurnTarget != null &&
          (!Number.isInteger(material.conversationTurnTarget) ||
            material.conversationTurnTarget < 1 ||
            material.conversationTurnTarget > 20)
        )
          issues.push('حدد عدد ردود الطالب بين 1 و20.');
        if ((material.conversationTargetWords?.length ?? 0) > 12)
          issues.push('اختر 12 كلمة أو عبارة كحد أقصى.');
        if (
          material.conversationTargetWords?.some(
            (word) =>
              !material.vocabulary.some(
                (card) => card.includeForStudent !== false && card.word === word,
              ),
          )
        )
          issues.push('احذف الكلمات المستبعدة أو التي تغير اسمها من أهداف المحادثة.');
        return issues;
      }
    }
  }
  async reviewStage(): Promise<void> {
    const stage = this.selectedStage(),
      material = this.draft();
    if (stage === 'listen-type') this.syncDictationAnswers();
    if (!stage || !material || this.busy() || this.staleDraft()) return;
    const issues = this.stageIssues(stage);
    if (issues.length) {
      this.approvalAttempted.set(true);
      this.error.set(
        stage === 'conversation'
          ? 'لا يمكن الاعتماد الآن. راجع الرسالة الموجودة تحت كل حقل محدد بالأحمر.'
          : `لا يمكن اعتماد المرحلة بعد: ${issues.join(' ')}`,
      );
      if (stage === 'conversation')
        setTimeout(() => {
          const field = document.querySelector<HTMLElement>(
            '.conversation-workspace .conversation-field--invalid',
          );
          field?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          field?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
        });
      return;
    }
    this.approvalAttempted.set(false);
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
    material.vocabulary = material.vocabulary.map((card) => ({
      ...card,
      includeForStudent: include,
    }));
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
      const result = await firstValueFrom(
        this.api.vocabularyImages(this.versionId, job, index, page),
      );
      this.imageOptions.update((current) => ({ ...current, [index]: result.options }));
      this.imagePages.update((current) => ({ ...current, [index]: result.page }));
      this.notice.set('اختر الصورة المناسبة من الاقتراحات، ثم احفظ التعديل.');
    } catch (ex) {
      const status = (ex as { status?: number }).status;
      this.error.set(
        status === 404
          ? 'لم نجد صورة مناسبة لهذه الكلمة في Pexels. يمكنك وضع رابط يدويًا.'
          : status === 503
            ? 'مفتاح Pexels غير صالح أو غير مفعّل. راجعه من إعدادات مزودي الصور.'
            : status === 429
              ? 'وصل Pexels لحد الطلبات المتاح. حاول لاحقًا.'
              : 'تعذر جلب الصورة الآن. تحقق من اتصال Pexels أو أعد المحاولة.',
      );
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
          const result = await firstValueFrom(
            this.api.vocabularyImages(this.versionId, job, index, 1),
          );
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
      this.notice.set(
        filled
          ? `تم اقتراح ${filled} صورة. راجع كل بطاقة ثم احفظ التعديلات.`
          : 'لم نجد صورًا مناسبة الآن. تحقق من مفتاح Pexels أو اختر الصور يدويًا.',
      );
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
    this.playingSegment.set(null);
  }
  async speak(text: string): Promise<void> {
    const value = text.trim();
    if (!value || this.voiceBusy()) return;
    if (!this.voiceConfigured()) {
      this.error.set(
        'الصوت الطبيعي غير مفعّل. أضف مفتاح Gemini Voice أو Groq Voice من إعدادات الخادم.',
      );
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
      if ((await this.voiceErrorCode(error)) === 'voice_terms_required') {
        this.voiceTermsRequired.set(true);
        this.error.set(
          'مفتاح الصوت محفوظ، لكن Groq يتطلب قبول شروط نموذج Orpheus من مالك الحساب قبل تشغيل النطق.',
        );
      } else if ((error as { status?: number }).status === 429) {
        this.error.set('انتهت حصة معاينة الصوت اليوم. جرّب غدًا أو راجع حد الصوت في إعدادات الخادم.');
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
        const body =
          typeof error.error.text === 'function'
            ? await error.error.text()
            : await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result ?? ''));
                reader.onerror = () => reject(reader.error);
                reader.readAsText(error.error);
              });
        const result = JSON.parse(body);
        return typeof result?.error === 'string' ? result.error : null;
      } catch {
        return null;
      }
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
  selectedDictationCount(): number {
    return this.draft()?.dictation?.filter((item) => item.enabled).length ?? 0;
  }
  dictationMode(item: DictationCard): NonNullable<DictationCard['mode']> {
    return item.mode ?? 'full-sentence';
  }
  dictationWords(text: string): string[] {
    return text.match(/[a-zA-Z0-9]+(?:'[a-zA-Z0-9]+)?/g) ?? [];
  }
  suggestedDictation(position: number, text: string, enabled: boolean): DictationCard {
    const words = this.dictationWords(text);
    if (this.lessonLevel() === 'A1' && words.length >= 2) {
      const targetWordIndex = Math.floor(words.length / 2);
      return {
        position,
        enabled,
        mode: 'missing-word',
        targetWordIndex,
        acceptedAnswers: [words[targetWordIndex]],
        hint: null,
      };
    }
    return { position, enabled, mode: 'full-sentence', acceptedAnswers: [text.trim()], hint: null };
  }
  setDictationMode(
    position: number,
    mode: Exclude<NonNullable<DictationCard['mode']>, 'single-word'>,
    text: string,
  ): void {
    const item = this.dictationItem(position);
    if (!item || this.dictationMode(item) === mode) return;
    const words = this.dictationWords(text);
    if (
      !words.length ||
      (mode === 'missing-word' && words.length < 2) ||
      (mode === 'word-order' && (words.length < 3 || words.length > 12))
    )
      return;
    item.mode = mode;
    item.targetWordIndex = mode === 'missing-word' ? Math.floor(words.length / 2) : null;
    item.acceptedAnswers =
      item.targetWordIndex == null ? [text.trim()] : [words[item.targetWordIndex]];
    item.audioStartSeconds = null;
    item.audioEndSeconds = null;
    this.changed();
  }
  selectDictationWord(position: number, index: number, text: string): void {
    const item = this.dictationItem(position);
    const words = this.dictationWords(text);
    if (!item || !words[index]) return;
    item.targetWordIndex = index;
    item.acceptedAnswers = [words[index]];
    this.changed();
  }
  dictationPrompt(item: DictationCard, text: string): string {
    if (this.dictationMode(item) !== 'missing-word' || item.targetWordIndex == null) return text;
    const matches = [...text.matchAll(/[a-zA-Z0-9]+(?:'[a-zA-Z0-9]+)?/g)];
    const match = matches[item.targetWordIndex];
    return match?.index == null
      ? text
      : `${text.slice(0, match.index)}_____${text.slice(match.index + match[0].length)}`;
  }
  automaticDictationAnswer(item: DictationCard, text: string): string | null {
    const mode = this.dictationMode(item);
    if (mode === 'word-order') return text.trim();
    if (mode === 'missing-word')
      return this.dictationWords(text)[item.targetWordIndex ?? -1] ?? null;
    return null;
  }
  private syncDictationAnswers(): void {
    const material = this.draft();
    if (!material?.dictation) return;
    let updated = false;
    for (const item of material.dictation) {
      const segment = this.segments().find((x) => x.position === item.position);
      const answer = segment ? this.automaticDictationAnswer(item, segment.text) : null;
      if (
        answer != null &&
        (item.acceptedAnswers.length !== 1 || item.acceptedAnswers[0] !== answer)
      ) {
        item.acceptedAnswers = [answer];
        updated = true;
      }
    }
    if (updated) {
      this.draft.set({ ...material });
      this.dirty.set(true);
    }
  }
  dictationModeCount(mode: NonNullable<DictationCard['mode']>): number {
    return (
      this.draft()?.dictation?.filter((item) => item.enabled && this.dictationMode(item) === mode)
        .length ?? 0
    );
  }
  setDictationSelection(enabled: boolean): void {
    const material = this.draft();
    if (!material?.dictation) return;
    const playable = new Set(
      this.segments()
        .filter((segment) => !!segment.audioUrl)
        .map((segment) => segment.position),
    );
    material.dictation = material.dictation.map((item) => ({
      ...item,
      enabled: enabled && playable.has(item.position),
    }));
    this.draft.set({ ...material });
    this.changed();
  }
  selectedQuestionCount(type: NonNullable<QuizCard['type']>): number {
    return this.questionsFor(type).filter(({ question }) => question.enabled !== false).length;
  }
  setQuestionSelection(type: NonNullable<QuizCard['type']>, enabled: boolean): void {
    const material = this.draft();
    if (!material) return;
    material.quiz = material.quiz.map((question) =>
      (question.type ?? 'multiple-choice') === type ? { ...question, enabled } : question,
    );
    this.draft.set({ ...material });
    this.changed();
  }
  async playTeacherSegment(position: number, audioUrl: string | null | undefined): Promise<void> {
    if (!audioUrl) {
      this.error.set('لا يوجد تسجيل للمدرّس لهذه الجملة.');
      return;
    }
    this.stopVoice();
    this.error.set('');
    const audio = new Audio(audioUrl);
    this.previewAudio = audio;
    this.playingSegment.set(position);
    audio.onended = () => this.stopVoice();
    try {
      await audio.play();
    } catch {
      this.stopVoice();
      this.error.set('تعذر تشغيل تسجيل المدرّس. راجع ملف الصوت وحاول مرة أخرى.');
    }
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
  updateConversationLines(
    field: 'conversationSuccessSteps' | 'conversationAllowedFacts',
    value: string,
  ): void {
    const material = this.draft();
    if (!material) return;
    material[field] = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    this.changed();
  }
  conversationSupportMode(): NonNullable<LessonMaterial['conversationSupportMode']> | 'legacy' {
    return this.draft()?.conversationSupportMode ?? 'legacy';
  }
  conversationFieldIssue(field: string): string | null {
    if (!this.approvalAttempted()) return null;
    const material = this.draft();
    if (!material) return null;
    switch (field) {
      case 'support':
        return material.conversationSupportMode ? null : 'اختر مستوى المساعدة المناسب للطالب.';
      case 'context':
        return material.conversationContextType ? null : 'اختر نوع المحادثة.';
      case 'scenario':
        return material.conversationScenario?.trim() ? null : 'اكتب وصفًا مختصرًا للموقف.';
      case 'studentRole':
        return material.studentRole?.trim() ? null : 'اكتب دور الطالب في المحادثة.';
      case 'aiRole':
        return material.aiRole?.trim() ? null : 'اكتب دور المحاور الذكي.';
      case 'facts':
        return material.conversationContextType !== 'professional' ||
          material.conversationAllowedFacts?.length
          ? null
          : 'اكتب حقيقة واحدة على الأقل حتى لا يخترع المحاور معلومات.';
      case 'opening':
        return material.openingMessage?.trim() ? null : 'اكتب السؤال الذي يبدأ به المحاور.';
      case 'steps':
        return material.conversationSuccessSteps?.length &&
          material.conversationSuccessSteps.every((step) => step.trim())
          ? null
          : 'اكتب خطوة نجاح واحدة على الأقل، كل خطوة في سطر.';
      case 'outcome':
        return material.conversationLearningOutcome?.trim()
          ? null
          : 'اكتب ما سيتمكن الطالب من فعله بعد المحادثة.';
      case 'minTurns':
        return Number.isInteger(material.conversationMinTurns) &&
          material.conversationMinTurns! >= 1 &&
          material.conversationMinTurns! <= 20
          ? null
          : 'اكتب رقمًا من 1 إلى 20.';
      case 'maxTurns':
        return Number.isInteger(material.conversationMaxTurns) &&
          material.conversationMaxTurns! >= 1 &&
          material.conversationMaxTurns! <= 20 &&
          material.conversationMaxTurns! >= (material.conversationMinTurns ?? 1) &&
          (material.conversationSupportMode !== 'first-steps' ||
            material.conversationMaxTurns! <= 6)
          ? null
          : material.conversationSupportMode === 'first-steps' &&
              (material.conversationMaxTurns ?? 0) > 6
            ? 'في «خطوات أولى» الحد الأقصى 6 ردود.'
            : 'اكتب رقمًا من 1 إلى 20، ولا يقل عن الحد الأدنى.';
      case 'help':
        return material.conversationSupportMode !== 'first-steps' ||
          material.conversationHelpAr?.trim()
          ? null
          : 'اكتب تلميحًا بالعربية يساعد الطالب إذا تعثر.';
      case 'modelAnswer':
        return material.conversationSupportMode !== 'first-steps' ||
          material.conversationModelAnswer?.trim()
          ? null
          : 'اكتب مثال رد قصير للطالب.';
      default:
        return null;
    }
  }
  setConversationSupportMode(mode: NonNullable<LessonMaterial['conversationSupportMode']>): void {
    const material = this.draft();
    if (!material || material.conversationSupportMode === mode) return;
    const previous = material.conversationSupportMode;
    material.conversationSupportMode = mode;
    material.conversationContextType ??= this.lessonType() === 'clip' ? 'clip' : 'situation';
    material.conversationMinTurns ??= mode === 'first-steps' ? 2 : mode === 'guided' ? 5 : 6;
    material.conversationMaxTurns ??= mode === 'first-steps' ? 4 : mode === 'guided' ? 10 : 12;
    if (
      mode === 'first-steps' &&
      (material.conversationMaxTurns > 6 ||
        material.conversationMinTurns > material.conversationMaxTurns)
    ) {
      material.conversationMinTurns = 2;
      material.conversationMaxTurns = 4;
    }
    if (
      previous == null ||
      material.conversationTurnTarget == null ||
      material.conversationTurnTarget ===
        (previous === 'first-steps' ? 3 : previous === 'guided' ? 5 : 8) ||
      (mode === 'first-steps' && material.conversationTurnTarget > 5)
    )
      material.conversationTurnTarget = mode === 'first-steps' ? 3 : mode === 'guided' ? 5 : 8;
    if (mode === 'first-steps') {
      material.conversationFocusTense = null;
      material.conversationCorrectionMode = 'lesson-only';
      material.conversationTargetWords = material.conversationTargetWords?.slice(0, 3) ?? [];
      if (
        !material.openingMessage?.trim() ||
        material.openingMessage === material.conversationScenario
      )
        material.openingMessage = 'Hi! How are you?';
      material.conversationHelpAr ||= 'يمكنك الرد بكلمة واحدة أو عبارة قصيرة.';
      material.conversationModelAnswer ||= "I'm good.";
    }
    this.draft.set({ ...material });
    this.changed();
  }
  conversationWordSelected(word: string): boolean {
    return this.draft()?.conversationTargetWords?.includes(word) ?? false;
  }
  toggleConversationWord(word: string, selected: boolean): void {
    const material = this.draft();
    if (!material) return;
    const words = material.conversationTargetWords ?? [];
    const limit = material.conversationSupportMode === 'first-steps' ? 3 : 12;
    if (selected && !words.includes(word) && words.length >= limit) return;
    material.conversationTargetWords = selected
      ? [...new Set([...words, word])]
      : words.filter((item) => item !== word);
    this.changed();
  }

  async generate(): Promise<void> {
    const stage = this.activeWorkflowStage();
    if (
      this.busy() ||
      this.globalProcessing() ||
      !this.canGenerateStage() ||
      !this.versionId ||
      !stage ||
      this.stageIsProcessing()
    )
      return;
    if (this.dirty()) {
      this.error.set('احفظ تعديلات هذه المرحلة أولًا قبل إعادة معالجتها.');
      return;
    }
    const started = performance.now();
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    console.info('[Admin.AiReview.Generate.Start]', {
      versionId: this.versionId,
      stageType: stage.type,
    });
    try {
      await firstValueFrom(this.auth.csrf());
      const job = await firstValueFrom(
        this.api.generateStage(
          this.versionId,
          stage.type,
          crypto.randomUUID(),
          stage.type === 'vocabulary' ? this.vocabularyTargetCount() : undefined,
        ),
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
    if (!approved || approved.status !== 'Approved' || this.busy() || this.globalProcessing())
      return;
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
      this.notice.set('نسخة التعديل جاهزة. النسخة المعتمدة التي يذاكرها الطالب لم تتغير.');
      console.info('[Admin.AiReview.Reopen.Success]', {
        sourceJobId: approved.id,
        draftJobId: draft.id,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (ex) {
      const code = await this.voiceErrorCode(ex);
      this.error.set(
        code === 'ai_draft_in_progress'
          ? 'هناك مرحلة قيد المعالجة الآن. انتظر انتهاءها ثم افتح نسخة التعديل.'
          : code === 'approved_content_changed'
            ? 'تغيّرت النسخة المعتمدة. حدّث الصفحة ثم افتح نسخة التعديل.'
            : 'تعذر فتح نسخة التعديل. حدّث الصفحة وحاول مرة أخرى.',
      );
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
    if (
      !job ||
      !draft ||
      job.status !== 'Draft' ||
      !this.dirty() ||
      this.staleDraft() ||
      this.busy() ||
      this.globalProcessing()
    )
      return;
    if (this.activeWorkflowStage()?.type === 'listen-type') {
      this.syncDictationAnswers();
      const issues = this.stageIssues('listen-type');
      if (issues.length) {
        this.error.set(issues.join(' '));
        return;
      }
    }
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
      const code = await this.voiceErrorCode(ex);
      if (code === 'newer_ai_job_exists' || code === 'ai_draft_changed') this.staleDraft.set(true);
      this.error.set(
        code === 'invalid_csrf'
          ? 'انتهت صلاحية جلسة الحفظ. حدّث الصفحة ثم حاول مجددًا.'
          : code === 'invalid_dictation'
            ? 'إعداد سؤال اسمع واكتب غير مكتمل. راجع الكلمة المختارة أو توقيت صوت الكلمة.'
            : code === 'invalid_material'
              ? 'رفض الخادم بيانات مسودة الدرس الكاملة، وليس بالضرورة هذه الجملة. لن تُفقد تعديلاتك؛ راجع المراحل الأخرى أو أرسل تفاصيل Response من طلب PUT لتحديد الحقل.'
              : code === 'newer_ai_job_exists'
                ? 'ظهرت معالجة أحدث لهذا الدرس. هذه النسخة قديمة ولا يمكن حفظها. تعديلاتك ما زالت ظاهرة هنا؛ انسخ ما تحتاجه قبل تحديث الصفحة، ثم افتح أحدث نسخة من رحلة الدرس.'
                : code === 'ai_draft_changed'
                  ? 'تغيّرت هذه المسودة بعد فتحها، ربما من تبويب آخر. تعديلاتك ما زالت ظاهرة هنا؛ انسخها قبل تحديث الصفحة ثم افتح المسودة الحالية.'
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
