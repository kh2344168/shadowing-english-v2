import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { AdminLessonWorkflowPage } from '../lessons/lesson-workflow.page';
import { LessonWorkflowApi } from '../lessons/lesson-workflow.api';
import { LessonEditDetails, ShadowingAuthoringApi } from '../shadowing-authoring.api';
import { ImportedLesson } from './local-lesson';
import {
  DEFAULT_PROCESSOR_SETTINGS,
  LocalProcessorClient,
  ProcessorError,
  ProcessorJob,
} from './local-processor.client';

@Component({
  selector: 'app-admin-ai-processing-page',
  standalone: true,
  imports: [FormsModule, RouterLink, AdminLessonWorkflowPage],
  templateUrl: './ai-processing.page.html',
  styleUrl: './ai-processing.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAIProcessingPage implements OnInit, OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly auth = inject(AuthService);
  private readonly client = inject(LocalProcessorClient);
  private readonly authoringApi = inject(ShadowingAuthoringApi);
  private readonly workflowApi = inject(LessonWorkflowApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private routedVersionId = this.route.snapshot.paramMap.get('versionId') ?? '';

  private controller: AbortController | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private sourceMedia: File | null = null;
  private sourceMediaJobId: string | null = null;
  private editPreviewAudio: HTMLAudioElement | null = null;
  private editPreviewTimer: number | null = null;
  private editPreviewAttempt = 0;
  private editPreviewStartedAt = 0;
  private editPreviewRange: { start: number; end: number } | null = null;
  private editPreviewPositionSelected = false;
  private editWaveformAttempt = 0;
  private editWaveformBuffer: AudioBuffer | null = null;
  private editWaveformSourceFile: File | null = null;
  private editWaveformWindowStart = 0;
  private editWaveformWindowEnd = 0;
  private activeEditRangeHandle: { handle: 'start' | 'end'; pointerId: number } | null = null;
  private suppressWaveformTrackClick = false;
  private attempt: string | null = null;
  private urls: string[] = [];
  private destroyed = false;

  @ViewChild('mediaInput') private mediaFileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('transcriptInput') private transcriptFileInput?: ElementRef<HTMLInputElement>;

  userId = '';

  title = '';
  description = '';
  lessonType: 'situation' | 'clip' | 'manual' = 'manual';
  level = 'A1';
  goal = '';
  sourceText = '';
  readonly creatingTextLesson = signal(false);
  readonly creationMode = signal<'audio' | 'text'>('audio');

  selectCreationMode(mode: 'audio' | 'text'): void {
    if (this.activeVersionId() || this.busy() || this.lessonSaving() || this.creatingTextLesson()) return;
    this.creationMode.set(mode);
    this.error.set('');
    this.notice.set('');
  }

  media: File | null = null;
  transcriptFile: File | null = null;
  script = '';

  settings = { ...DEFAULT_PROCESSOR_SETTINGS };

  reviewed = false;

  editText = '';
  editStart = 0;
  editEnd = 0;

  readonly connected = signal(false);
  readonly checking = signal(false);
  readonly busy = signal(false);

  readonly job = signal<ProcessorJob | null>(null);
  readonly result = signal<ImportedLesson | null>(null);
  readonly savedLesson = signal<LessonEditDetails | null>(null);
  readonly savedLessonLoading = signal(false);
  readonly savedLessonDirty = signal(false);
  readonly savedLessonAudio = signal<Record<number, File>>({});
  readonly savedClipDurations = signal<Record<number, number>>({});
  private pendingSavedAudio: File | null = null;
  private savedWaveformRequest = 0;
  // IDs are stable by segment slot/order across WhisperX recut.
  readonly selectedSegmentIndices = signal<ReadonlySet<number>>(new Set<number>());
  readonly previewUrls = signal<string[]>([]);

  readonly editingIndex = signal<number | null>(null);
  readonly segmentSaving = signal(false);
  readonly newLessonBusy = signal(false);
  readonly lessonSaving = signal(false);
  readonly playingIndex = signal<number | null>(null);
  readonly editPreviewSourceUrl = signal('');
  readonly editMediaDuration = signal<number | null>(null);
  readonly editPreviewPlaying = signal(false);
  readonly editPreviewBusy = signal(false);
  readonly editPreviewError = signal('');
  readonly editPreviewPosition = signal(0);
  readonly editWaveformPeaks = signal<number[]>([]);
  readonly editWaveformLoading = signal(false);
  readonly editWaveformError = signal('');

  readonly error = signal('');
  readonly notice = signal('');
  readonly activeVersionId = signal(this.routedVersionId);
  readonly activeCreationTab = signal<'shadowing' | 'activities'>('shadowing');
  readonly hasShadowingStage = signal(true);

  async createTextLesson(): Promise<void> {
    if (this.creatingTextLesson() || this.activeVersionId()) return;
    if (!this.title.trim() || !this.goal.trim() || !this.sourceText.trim()) {
      this.error.set('اكتب عنوان الدرس وهدفه والنص أو الكلمات المصدرية.');
      return;
    }
    this.creatingTextLesson.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.auth.csrf());
      const created = await firstValueFrom(this.workflowApi.create({
        title: this.title.trim(), lessonType: this.lessonType, level: this.level,
        goal: this.goal.trim(), sourceText: this.sourceText.trim(),
      }));
      await this.router.navigate(['/admin/lessons', created.versionId, 'workflow']);
    } catch (error) {
      this.error.set(`تعذر إنشاء الدرس (${(error as { status?: number }).status ?? 'اتصال'}).`);
    } finally {
      this.creatingTextLesson.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    try {
      const session = await firstValueFrom(this.auth.session());

      if (this.destroyed) {
        return;
      }

      if (!session.authenticated || !session.roles.includes('Admin') || !session.userId) {
        this.error.set('إنشاء الدروس متاح لحساب Admin فقط.');
        return;
      }

      this.userId = session.userId;

      // A saved lesson comes from the database; do not restore a local processor draft.
      if (this.routedVersionId) {
        await this.loadSavedLesson();
        return;
      }

      const link = this.client.initialize(session.userId);

      if (!link) {
        this.connected.set(false);
        this.notice.set(
          'أداة الذكاء الاصطناعي غير مربوطة بهذا الحساب. افتح صفحة تثبيت أدوات AI أولًا.',
        );
        return;
      }

      this.settings = { ...link.settings };

      await this.connect();
    } catch {
      this.error.set('تعذر التحقق من حساب الأدمن. أعد تسجيل الدخول.');
    }
  }

  private async loadSavedLesson(): Promise<void> {
    this.savedLessonLoading.set(true);
    this.error.set('');
    try {
      const workflow = await firstValueFrom(this.workflowApi.get(this.routedVersionId));
      this.hasShadowingStage.set(workflow.stages.some((stage) =>
        stage.type === 'shadowing' && stage.enabled));
      if (!this.hasShadowingStage()) this.activeCreationTab.set('activities');
      const details = await firstValueFrom(this.authoringApi.lessonDetails(workflow.lessonId));
      if (details.versionId !== this.routedVersionId) {
        await this.router.navigate(['/admin/lessons', details.versionId, 'workflow'], {
          replaceUrl: true,
        });
        return;
      }
      this.urls.forEach((url) => URL.revokeObjectURL(url));
      this.urls = [];
      this.savedClipDurations.set({});
      this.savedLesson.set(details);
      this.title = details.title;
      this.description = details.description;
      this.result.set({
        manifest: {
          schemaVersion: 1,
          profile: 'shadowing-v2-1',
          jobId: details.versionId,
          title: details.title,
          description: details.description,
          duration: details.segments.length + 1,
          reviewRequired: true,
          segments: details.segments.map((segment, index) => ({
            text: segment.text,
            start: index,
            end: index + 1,
            audioFile: `segment-${String(index + 1).padStart(2, '0')}.wav`,
            bytes: 0,
            sha256: '',
          })),
        },
        files: [],
      });
      this.previewUrls.set(details.segments.map((segment) => segment.audioUrl));
      this.selectedSegmentIndices.set(new Set(details.segments.map((_, index) => index)));
      this.reviewed = true;
    } catch (error) {
      this.error.set('تعذر تحميل نصوص الدرس المحفوظة. حاول تحديث الصفحة.');
      console.warn('[Admin.AILesson.SavedLoad.Failed]', {
        versionId: this.routedVersionId,
        status: (error as { status?: number }).status ?? null,
      });
    } finally {
      this.savedLessonLoading.set(false);
      this.changeDetector.markForCheck();
    }
  }

  setSavedAudio(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.item(0);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.wav') || file.size <= 12 || file.size > 2_000_000) {
      this.error.set('التسجيل البديل يجب أن يكون WAV وأقل من 2 MB.');
      return;
    }
    this.pendingSavedAudio = file;
    this.error.set('');
    this.savedWaveformRequest += 1;
    const index = this.editingIndex();
    if (index !== null) this.showSavedWaveform(file, index);
  }

  rememberSavedDuration(index: number, event: Event): void {
    const duration = (event.target as HTMLAudioElement).duration;
    if (Number.isFinite(duration) && duration > 0) {
      this.savedClipDurations.update((items) => ({ ...items, [index]: duration }));
    }
  }

  private async loadSavedWaveform(index: number): Promise<void> {
    const request = ++this.savedWaveformRequest;
    const details = this.savedLesson();
    const segment = details?.segments[index];
    if (!details || !segment) return;
    this.editWaveformLoading.set(true);
    try {
      const blob = await firstValueFrom(
        this.authoringApi.lessonSegmentAudio(details.versionId, segment.position),
      );
      if (
        request !== this.savedWaveformRequest ||
        this.editingIndex() !== index ||
        this.savedLesson()?.versionId !== details.versionId
      )
        return;
      this.showSavedWaveform(
        new File([blob], `segment-${segment.position}.wav`, { type: 'audio/wav' }),
        index,
      );
    } catch {
      if (request === this.savedWaveformRequest && this.editingIndex() === index) {
        this.editWaveformLoading.set(false);
        this.editWaveformError.set('تعذر تحميل صوت المقطع المحفوظ. يمكنك تعديل النص فقط.');
      }
    }
  }

  private showSavedWaveform(file: File, index: number): void {
    this.releaseEditPreview();
    this.editWaveformBuffer = null;
    this.editWaveformSourceFile = null;
    this.editStart = 0;
    this.editEnd = 0;
    this.editPreviewSourceUrl.set(URL.createObjectURL(file));
    this.editWaveformLoading.set(true);
    void this.loadEditWaveform(file, index);
  }

  async saveSavedLesson(): Promise<void> {
    const details = this.savedLesson();
    if (!details || !this.savedLessonDirty() || this.lessonSaving()) return;
    const selected = details.segments.filter((_, index) => this.isSegmentSelected(index));
    const title = this.title.trim();
    const description = this.description.trim();
    if (
      title.length < 2 ||
      title.length > 160 ||
      description.length > 1000 ||
      selected.length === 0 ||
      selected.some((segment) => !segment.text.trim() || segment.text.trim().length > 1000)
    ) {
      this.error.set('راجع عنوان الدرس والوصف ونصوص المقاطع قبل الحفظ.');
      return;
    }
    this.lessonSaving.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.auth.csrf());
      const updated = await firstValueFrom(
        this.authoringApi.editLesson(
          details.id,
          details.versionId,
          crypto.randomUUID(),
          title,
          description,
          details.segments.flatMap((segment, index) =>
            this.isSegmentSelected(index)
              ? [
                  {
                    position: segment.position,
                    text: segment.text,
                    audio: this.savedLessonAudio()[index] ?? null,
                  },
                ]
              : [],
          ),
        ),
      );
      const navigated = await this.router.navigate([
        '/admin/lessons',
        updated.versionId,
        'workflow',
      ]);
      if (navigated) {
        this.routedVersionId = updated.versionId;
        this.activeVersionId.set(updated.versionId);
        this.savedLessonDirty.set(false);
        this.savedLessonAudio.set({});
        await this.loadSavedLesson();
      }
    } catch (error) {
      this.error.set(
        (error as { status?: number }).status === 409
          ? 'الدرس اتغير من صفحة أخرى. حدّث الصفحة وافتح أحدث نسخة.'
          : 'تعذر حفظ التعديلات. النسخة السابقة ما زالت محفوظة.',
      );
    } finally {
      this.lessonSaving.set(false);
      this.changeDetector.markForCheck();
    }
  }

  async connect(): Promise<void> {
    if (this.checking() || !this.userId) {
      return;
    }

    this.checking.set(true);
    this.error.set('');

    try {
      const status = await this.client.health();

      this.connected.set(status.linked);

      if (!status.linked) {
        this.notice.set('الأداة تعمل، لكن الربط بهذا الحساب غير مكتمل. افتح صفحة تثبيت أدوات AI.');
        return;
      }

      this.notice.set('أداة المعالجة جاهزة.');

      const savedJobId = status.activeJobId ?? this.client.savedJob();

      if (savedJobId && !this.routedVersionId && !this.busy() && !this.lessonSaving()) {
        await this.resume(savedJobId);
      }
    } catch (error) {
      this.connected.set(false);
      this.error.set(this.describe(error));
    } finally {
      this.checking.set(false);
    }
  }

  chooseMedia(event: Event): void {
    if (this.lessonSaving() || this.newLessonBusy()) return;
    const started = performance.now();
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;

    this.error.set('');

    console.info('[Admin.AILesson.Media.Select.Start]');

    if (!file) {
      this.media = null;
      return;
    }

    const validExtension = /\.(wav|mp3|m4a|mp4|ogg|webm)$/i.test(file.name);

    if (!validExtension || file.size <= 0 || file.size > 100_000_000) {
      this.media = null;
      input.value = '';

      this.error.set('اختر ملف صوت أو فيديو صالحًا بحجم لا يتجاوز 100 MB.');

      console.warn('[Admin.AILesson.Media.Select.Failed]', {
        bytes: file.size,
        durationMs: Math.round(performance.now() - started),
      });

      return;
    }

    this.media = file;
    this.attempt = null;

    console.info('[Admin.AILesson.Media.Select.Success]', {
      bytes: file.size,
      durationMs: Math.round(performance.now() - started),
    });
  }

  async chooseTranscript(event: Event): Promise<void> {
    if (this.lessonSaving() || this.newLessonBusy()) return;
    const started = performance.now();
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;

    this.error.set('');
    this.transcriptFile = null;
    this.script = '';
    this.attempt = null;
    this.changeDetector.markForCheck();

    console.info('[Admin.AILesson.Transcript.Select.Start]');

    if (!file) {
      return;
    }

    try {
      if (file.size <= 0 || file.size > 150_000 || !file.name.toLowerCase().endsWith('.txt')) {
        throw new Error('invalid_transcript');
      }

      const text = await file.text();

      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 1 || lines.length > 20 || lines.some((line) => line.length > 1000)) {
        throw new Error('invalid_transcript');
      }

      this.transcriptFile = file;
      this.script = lines.join('\n');
      this.attempt = null;
      this.changeDetector.markForCheck();

      console.info('[Admin.AILesson.Transcript.Select.Success]', {
        bytes: file.size,
        lines: lines.length,
        durationMs: Math.round(performance.now() - started),
      });
    } catch {
      this.transcriptFile = null;
      this.script = '';
      input.value = '';

      this.error.set(
        'ملف النص غير صالح. استخدم TXT، وكل سطر يمثل مقطعًا واحدًا، بحد أقصى 20 مقطعًا.',
      );
      this.changeDetector.markForCheck();

      console.warn('[Admin.AILesson.Transcript.Select.Failed]', {
        bytes: file.size,
        durationMs: Math.round(performance.now() - started),
      });
    }
  }

  clearMedia(input: HTMLInputElement): void {
    if (this.lessonSaving() || this.newLessonBusy()) return;
    this.media = null;
    input.value = '';
    this.attempt = null;
  }

  clearTranscript(input: HTMLInputElement): void {
    if (this.lessonSaving() || this.newLessonBusy()) return;
    this.transcriptFile = null;
    this.script = '';
    input.value = '';
    this.attempt = null;
  }

  canProcess(): boolean {
    return (
      !this.busy() &&
      !this.lessonSaving() &&
      !this.newLessonBusy() &&
      this.connected() &&
      !!this.media &&
      !!this.transcriptFile &&
      this.title.trim().length >= 2
    );
  }

  async process(): Promise<void> {
    if (!this.canProcess()) {
      return;
    }

    const currentJob = this.job();

    if (currentJob?.state === 'awaiting_upload' || currentJob?.state === 'running') {
      this.error.set('هناك معالجة جارية بالفعل. أكملها أو ألغها قبل بدء درس جديد.');
      return;
    }

    const lines = this.script
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (
      !this.media ||
      this.title.trim().length < 2 ||
      this.title.length > 160 ||
      this.description.length > 1000 ||
      lines.length < 1 ||
      lines.length > 20
    ) {
      this.error.set('راجع بيانات الدرس والملفات ثم حاول مرة أخرى.');
      return;
    }

    this.attempt ??= crypto.randomUUID();

    const started = performance.now();

    this.controller = new AbortController();

    this.busy.set(true);
    this.error.set('');
    this.notice.set('');

    this.clearResult();

    this.job.set(null);
    this.client.forgetJob();

    this.sourceMedia = this.media;
    this.sourceMediaJobId = null;

    console.info('[Admin.AILesson.Process.Start]', {
      requestId: this.attempt,
      mediaBytes: this.media.size,
      transcriptLines: lines.length,
    });

    try {
      const createdJob = await this.client.start(
        {
          requestId: this.attempt,
          title: this.title.trim(),
          description: this.description.trim(),
          lines,
          settings: this.settings,
        },
        this.media,
        this.controller.signal,
        (created) => {
          this.job.set(created);
          this.sourceMediaJobId = created.jobId;
        },
      );

      this.job.set(createdJob);
      this.sourceMediaJobId = createdJob.jobId;

      await this.waitForResult(createdJob.jobId, this.controller.signal);

      console.info('[Admin.AILesson.Process.Success]', {
        jobId: createdJob.jobId,
        segments: this.result()?.manifest.segments.length ?? 0,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      this.error.set(this.describe(error));

      console.warn('[Admin.AILesson.Process.Failed]', {
        code: error instanceof ProcessorError ? error.code : 'unknown',
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.busy.set(false);
    }
  }

  async resume(jobId: string): Promise<void> {
    if (this.lessonSaving() || this.newLessonBusy()) return;
    this.controller = new AbortController();
    this.busy.set(true);

    try {
      await this.waitForResult(jobId, this.controller.signal);
    } catch (error) {
      if (error instanceof ProcessorError && error.code === 'not_found') {
        this.client.forgetJob();
      } else {
        this.error.set(this.describe(error));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async waitForResult(jobId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.destroyed) {
      const status = await this.client.job(jobId, signal);

      this.job.set(status);

      if (status.state === 'complete') {
        const lesson = await this.client.result(jobId, signal);

        this.setResult(lesson);

        this.notice.set('اكتملت معالجة الشادوينج. راجع المقاطع قبل اعتماد الدرس.');

        return;
      }

      if (status.state === 'failed' || status.state === 'cancelled') {
        this.attempt = null;
        this.client.forgetJob();

        throw new ProcessorError(
          status.state === 'failed' ? (status.error ?? 'engine_failed') : 'cancelled',
        );
      }

      if (status.state === 'awaiting_upload') {
        this.notice.set('الأداة تنتظر وصول ملف الصوت أو الفيديو.');
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  }

  async cancel(): Promise<void> {
    const jobId = this.job()?.jobId ?? this.client.savedJob();

    this.controller?.abort();

    if (!jobId) {
      return;
    }

    try {
      const status = await this.client.cancel(jobId);

      this.job.set(status);
      this.client.forgetJob();
      this.attempt = null;

      this.notice.set('تم إلغاء المعالجة.');
    } catch (error) {
      this.error.set(this.describe(error));
    }
  }

  openEditModal(index: number): void {
    const lesson = this.result();
    const clip = lesson?.manifest.segments[index];
    if (!lesson || !clip || this.lessonSaving() || this.newLessonBusy() || this.segmentSaving())
      return;

    this.releaseEditPreview();
    this.stopAudio();
    this.editingIndex.set(index);
    this.editText = clip.text;
    this.editStart = clip.start;
    this.editEnd = clip.end;
    this.activeEditRangeHandle = null;
    this.configureEditWaveformWindow(lesson.manifest.duration, false);
    this.editPreviewPositionSelected = false;
    this.editPreviewPosition.set(clip.start);
    this.editWaveformPeaks.set([]);
    this.editWaveformError.set('');
    this.error.set('');

    if (this.savedLesson()) {
      this.pendingSavedAudio = null;
      this.editWaveformBuffer = null;
      this.editWaveformSourceFile = null;
      this.editStart = 0;
      this.editEnd = 0;
      void this.loadSavedWaveform(index);
      return;
    }

    const originalMedia = this.sourceMediaJobId === lesson.manifest.jobId ? this.sourceMedia : null;
    if (originalMedia) {
      this.editPreviewSourceUrl.set(URL.createObjectURL(originalMedia));
      void this.loadEditWaveform(originalMedia, index);
    } else {
      this.editPreviewError.set(
        'اختر ملف المصدر نفسه لإظهار الموجة ومعاينة الكلمات قبل المقطع وبعده.',
      );
    }

    console.info('[Admin.AILesson.SegmentEdit.Open]', {
      jobId: lesson.manifest.jobId,
      segmentIndex: index,
      start: clip.start,
      end: clip.end,
    });
  }

  closeEditModal(): void {
    if (this.segmentSaving()) return;
    this.savedWaveformRequest += 1;
    this.pendingSavedAudio = null;
    this.releaseEditPreview();
    if (this.savedLesson()) {
      this.editWaveformBuffer = null;
      this.editWaveformSourceFile = null;
    }
    this.stopAudio();
    this.editingIndex.set(null);
  }

  onEditPreviewMetadata(event: Event): void {
    const duration = (event.target as HTMLAudioElement).duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      this.failEditPreview('invalid_media_duration');
      return;
    }
    this.editMediaDuration.set(duration);
    if (this.savedLesson() && (this.editEnd === 0 || this.editEnd > duration)) {
      this.editEnd = duration;
    }
    this.configureEditWaveformWindow(duration, false);
    this.editPreviewError.set(
      this.editEnd > duration
        ? 'مدة الملف المحدد أقصر من نهاية المقطع؛ تأكد من اختيار ملف المصدر الصحيح.'
        : '',
    );
    this.refreshEditWaveform();
  }

  onEditPreviewError(): void {
    if (this.editingIndex() === null || !this.editPreviewSourceUrl()) return;
    this.failEditPreview('media_decode_failed');
  }

  chooseEditSourceMedia(event: Event): void {
    if (this.savedLesson()) {
      this.setSavedAudio(event);
      (event.target as HTMLInputElement).value = '';
      return;
    }
    const started = performance.now();
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;
    const lesson = this.result();
    const index = this.editingIndex();
    if (!file || !lesson || index === null) return;

    const context = {
      jobId: lesson.manifest.jobId,
      segmentIndex: index,
      bytes: file.size,
    };
    console.info('[Admin.AILesson.SegmentEdit.SourceMedia.Start]', context);
    input.value = '';

    const validExtension = /\.(wav|mp3|m4a|mp4|ogg|webm)$/i.test(file.name);
    if (!validExtension || file.size <= 0 || file.size > 100_000_000) {
      this.editPreviewError.set(
        'اختر ملف المصدر نفسه بصيغة صوت أو فيديو صالح وبحجم لا يتجاوز 100 MB.',
      );
      console.warn('[Admin.AILesson.SegmentEdit.SourceMedia.Failed]', {
        ...context,
        code: 'invalid_source_media',
        durationMs: Math.round(performance.now() - started),
      });
      return;
    }

    this.releaseEditPreview();
    this.editWaveformBuffer = null;
    this.editWaveformSourceFile = null;
    this.sourceMedia = file;
    this.sourceMediaJobId = lesson.manifest.jobId;
    this.editPreviewSourceUrl.set(URL.createObjectURL(file));
    this.editPreviewError.set('');
    this.editWaveformError.set('');
    void this.loadEditWaveform(file, index);
    console.info('[Admin.AILesson.SegmentEdit.SourceMedia.Success]', {
      ...context,
      durationMs: Math.round(performance.now() - started),
    });
  }

  onEditRangeChanged(): void {
    this.stopEditPreview('range_changed');
    this.editPreviewPositionSelected = false;
    this.editPreviewPosition.set(Number.isFinite(this.editStart) ? this.editStart : 0);
    if (this.editPreviewSourceUrl()) this.editPreviewError.set('');
    const duration = this.editMediaDuration() ?? this.result()?.manifest.duration;
    if (duration) this.configureEditWaveformWindow(duration, true);
    this.refreshEditWaveform();
  }

  beginEditRangeHandleDrag(handle: 'start' | 'end', event: PointerEvent): void {
    if (
      this.segmentSaving() ||
      !this.editMediaDuration() ||
      !this.isEditRangeValid() ||
      this.editWaveformLoading() ||
      this.editWaveformPeaks().length === 0
    )
      return;

    const target = event.currentTarget as HTMLElement;
    this.activeEditRangeHandle = { handle, pointerId: event.pointerId };
    this.suppressWaveformTrackClick = true;
    this.stopEditPreview('range_changed');
    this.editPreviewPositionSelected = false;
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  moveEditRangeHandle(event: PointerEvent, track: HTMLElement): void {
    const active = this.activeEditRangeHandle;
    const duration = this.editMediaDuration();
    if (!active || active.pointerId !== event.pointerId || !duration) return;

    const bounds = track.getBoundingClientRect();
    const left = bounds.left + 8;
    const right = bounds.right - 8;
    if (right <= left) return;

    const progress = Math.max(0, Math.min(1, (event.clientX - left) / (right - left)));
    const windowWidth = this.editWaveformWindowEnd - this.editWaveformWindowStart;
    if (windowWidth <= 0) return;
    this.updateEditRangeHandle(
      active.handle,
      this.editWaveformWindowStart + progress * windowWidth,
    );
    event.preventDefault();
    event.stopPropagation();
  }

  finishEditRangeHandleDrag(event: PointerEvent): void {
    if (this.activeEditRangeHandle?.pointerId !== event.pointerId) return;
    this.activeEditRangeHandle = null;
    const duration = this.editMediaDuration() ?? this.result()?.manifest.duration;
    if (duration) this.configureEditWaveformWindow(duration, true);
    this.refreshEditWaveform();
    window.setTimeout(() => {
      this.suppressWaveformTrackClick = false;
    }, 0);
    event.preventDefault();
    event.stopPropagation();
  }

  adjustEditRangeHandle(handle: 'start' | 'end', event: KeyboardEvent): void {
    const duration = this.editMediaDuration();
    if (!duration || this.segmentSaving()) return;

    const current = handle === 'start' ? this.editStart : this.editEnd;
    const step = event.shiftKey ? 1 : 0.1;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + step;
        break;
      case 'Home':
        next = handle === 'start' ? this.editStartHandleMinimum() : this.editStart + 0.01;
        break;
      case 'End':
        next = handle === 'start' ? this.editStartHandleMaximum() : this.editEndHandleMaximum();
        break;
      default:
        return;
    }

    event.preventDefault();
    this.stopEditPreview('range_changed');
    this.updateEditRangeHandle(handle, next);
    this.configureEditWaveformWindow(duration, true);
    this.refreshEditWaveform();
  }

  private updateEditRangeHandle(handle: 'start' | 'end', requestedTime: number): void {
    const duration = this.editMediaDuration();
    if (!duration) return;

    const precision = 100;
    const round = (value: number) => Math.round(value * precision) / precision;
    if (handle === 'start') {
      const minimum = this.editStartHandleMinimum();
      const maximum = this.editStartHandleMaximum();
      if (maximum < minimum) return;
      const rounded = round(Math.max(minimum, Math.min(maximum, requestedTime)));
      this.editStart = Math.max(minimum, Math.min(maximum, rounded));
    } else {
      const minimum = this.editStart + 0.01;
      const maximum = this.editEndHandleMaximum();
      if (maximum < minimum) return;
      const rounded = round(Math.max(minimum, Math.min(maximum, requestedTime)));
      this.editEnd = Math.max(minimum, Math.min(maximum, rounded));
    }

    this.editPreviewPositionSelected = false;
    this.editPreviewPosition.set(this.editStart);
    this.editPreviewError.set('');
    this.changeDetector.markForCheck();
  }

  editStartMinimum(): number {
    if (this.savedLesson()) return 0;
    const lesson = this.result();
    const index = this.editingIndex();
    return lesson && index !== null && index > 0 ? lesson.manifest.segments[index - 1].start : 0;
  }

  editStartMaximum(): number {
    if (this.savedLesson()) return this.editMediaDuration() ?? 0;
    const lesson = this.result();
    const index = this.editingIndex();
    const duration = this.editMediaDuration() ?? lesson?.manifest.duration ?? 0;
    return lesson && index !== null && index < lesson.manifest.segments.length - 1
      ? Math.min(duration, lesson.manifest.segments[index + 1].start)
      : duration;
  }

  editStartHandleMaximum(): number {
    return Math.min(this.editEnd - 0.01, this.editStartMaximum(), this.editWaveformWindowEnd);
  }

  editStartHandleMinimum(): number {
    return Math.max(this.editStartMinimum(), this.editWaveformWindowStart);
  }

  editEndHandleMaximum(): number {
    return Math.min(
      this.editMediaDuration() ?? this.editWaveformWindowEnd,
      this.editWaveformWindowEnd,
    );
  }

  editWaveformViewStart(): number {
    return this.editWaveformWindowStart;
  }

  editWaveformViewMidpoint(): number {
    return (this.editWaveformWindowStart + this.editWaveformWindowEnd) / 2;
  }

  editWaveformViewEnd(): number {
    return this.editWaveformWindowEnd;
  }

  editRangeStartProgress(): number {
    return this.editTimelineProgress(this.editStart);
  }

  editRangeEndProgress(): number {
    return this.editTimelineProgress(this.editEnd);
  }

  private editTimelineProgress(time: number): number {
    const width = this.editWaveformWindowEnd - this.editWaveformWindowStart;
    return width > 0 && Number.isFinite(time)
      ? Math.max(0, Math.min(1, (time - this.editWaveformWindowStart) / width))
      : 0;
  }

  private configureEditWaveformWindow(duration: number, expand: boolean): void {
    if (this.savedLesson()) {
      this.editWaveformWindowStart = 0;
      this.editWaveformWindowEnd = duration;
      return;
    }
    const lesson = this.result();
    const index = this.editingIndex();
    const clip = lesson && index !== null ? lesson.manifest.segments[index] : null;
    if (!clip || !Number.isFinite(duration) || duration <= 0) return;

    const padding = Math.max(5, Math.min(10, (clip.end - clip.start) / 2));
    const selectedStart = Number.isFinite(this.editStart) ? this.editStart : clip.start;
    const selectedEnd = Number.isFinite(this.editEnd) ? this.editEnd : clip.end;
    const start = Math.max(0, Math.min(clip.start, selectedStart) - padding);
    const end = Math.min(duration, Math.max(clip.end, selectedEnd) + padding);
    this.editWaveformWindowStart = expand ? Math.min(this.editWaveformWindowStart, start) : start;
    this.editWaveformWindowEnd = expand ? Math.max(this.editWaveformWindowEnd, end) : end;
  }

  isEditRangeValid(): boolean {
    return this.currentEditRange() !== null;
  }

  private currentEditRange(): { start: number; end: number } | null {
    const lesson = this.result();
    const index = this.editingIndex();
    const start = this.editStart;
    const end = this.editEnd;
    if (
      !lesson ||
      index === null ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > (this.savedLesson() ? (this.editMediaDuration() ?? 0) : lesson.manifest.duration) ||
      (!this.savedLesson() && index > 0 && start < lesson.manifest.segments[index - 1].start) ||
      (!this.savedLesson() &&
        index < lesson.manifest.segments.length - 1 &&
        start > lesson.manifest.segments[index + 1].start)
    )
      return null;

    if (this.editPreviewSourceUrl()) {
      const mediaDuration = this.editMediaDuration();
      if (mediaDuration === null || end > mediaDuration) return null;
    }
    return { start, end };
  }

  async toggleEditPreview(audio: HTMLAudioElement): Promise<void> {
    if (this.editPreviewPlaying() || this.editPreviewBusy()) {
      this.stopEditPreview('manual');
      return;
    }
    const index = this.editingIndex();
    const range = this.currentEditRange();
    if (index === null || !this.editPreviewSourceUrl() || !range) {
      this.failEditPreview('invalid_range_or_source');
      return;
    }

    const attempt = ++this.editPreviewAttempt;
    this.editPreviewAudio = audio;
    this.editPreviewRange = range;
    this.editPreviewStartedAt = performance.now();
    this.editPreviewBusy.set(true);
    this.editPreviewError.set('');
    console.info('[Admin.AILesson.SegmentPreview.Start]', {
      segmentIndex: index,
      start: range.start,
      end: range.end,
    });

    try {
      audio.pause();
      const currentPosition = audio.currentTime;
      const startAt =
        this.editPreviewPositionSelected &&
        currentPosition >= range.start &&
        currentPosition < range.end
          ? currentPosition
          : range.start;
      audio.currentTime = startAt;
      this.editPreviewPositionSelected = false;
      this.editPreviewPosition.set(startAt);
      if (audio.seeking) await this.waitForEditSeek(audio);
      if (attempt !== this.editPreviewAttempt || this.editingIndex() !== index) return;
      await audio.play();
      if (attempt !== this.editPreviewAttempt || this.editingIndex() !== index) {
        audio.pause();
        return;
      }
      this.editPreviewBusy.set(false);
      this.editPreviewPlaying.set(true);
      this.editPreviewTimer = window.setInterval(() => this.checkEditPreviewEnd(), 25);
      this.checkEditPreviewEnd();
    } catch (error) {
      if (attempt !== this.editPreviewAttempt) return;
      this.failEditPreview(
        error instanceof Error && error.message === 'seek_timeout'
          ? 'seek_timeout'
          : 'playback_failed',
      );
    }
  }

  private waitForEditSeek(audio: HTMLAudioElement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('seek_timeout'));
      }, 5000);
      function cleanup(): void {
        window.clearTimeout(timeout);
        audio.removeEventListener('seeked', onSeeked);
        audio.removeEventListener('error', onError);
      }
      function onSeeked(): void {
        cleanup();
        resolve();
      }
      function onError(): void {
        cleanup();
        reject(new Error('seek_failed'));
      }
      audio.addEventListener('seeked', onSeeked, { once: true });
      audio.addEventListener('error', onError, { once: true });
    });
  }

  onEditPreviewTimeUpdate(event: Event): void {
    if (event.target === this.editPreviewAudio) {
      this.editPreviewPosition.set(this.editPreviewAudio?.currentTime ?? 0);
      this.checkEditPreviewEnd();
    }
  }

  seekEditPreview(audio: HTMLAudioElement, event: MouseEvent): void {
    if (this.suppressWaveformTrackClick) return;
    if ((event.target as HTMLElement).closest('.waveform-range-handle')) return;
    if (
      this.editWaveformLoading() ||
      this.editWaveformPeaks().length === 0 ||
      !this.editMediaDuration()
    )
      return;
    const range = this.currentEditRange();
    const track = event.currentTarget as HTMLElement;
    const bounds = track.getBoundingClientRect();
    const duration = this.editMediaDuration();
    if (!range || !duration || !bounds.width || this.editWaveformLoading()) return;

    const left = bounds.left + 8;
    const right = bounds.right - 8;
    const windowWidth = this.editWaveformWindowEnd - this.editWaveformWindowStart;
    if (right <= left || windowWidth <= 0) return;
    const progress = Math.max(0, Math.min(1, (event.clientX - left) / (right - left)));
    const requestedPosition = this.editWaveformWindowStart + windowWidth * progress;
    const position = Math.max(range.start, Math.min(range.end, requestedPosition));
    this.editPreviewRange = range;
    this.editPreviewAudio = audio;
    this.editPreviewPositionSelected = true;
    audio.currentTime = position;
    this.editPreviewPosition.set(position);
  }

  seekEditPreviewWithKeyboard(audio: HTMLAudioElement, event: KeyboardEvent): void {
    if ((event.target as HTMLElement).closest('.waveform-range-handle')) return;
    const range = this.currentEditRange();
    if (!range || this.editWaveformLoading() || this.editWaveformPeaks().length === 0) return;

    const current =
      Number.isFinite(audio.currentTime) &&
      audio.currentTime >= range.start &&
      audio.currentTime <= range.end
        ? audio.currentTime
        : range.start;
    const step = event.shiftKey ? 1 : 0.1;
    let position = current;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        position = current - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        position = current + step;
        break;
      case 'Home':
        position = range.start;
        break;
      case 'End':
        position = range.end;
        break;
      default:
        return;
    }

    event.preventDefault();
    position = Math.max(range.start, Math.min(range.end, position));
    this.editPreviewRange = range;
    this.editPreviewAudio = audio;
    this.editPreviewPositionSelected = true;
    audio.currentTime = position;
    this.editPreviewPosition.set(position);
  }

  skipEditPreview(audio: HTMLAudioElement, offsetSeconds: number): void {
    const range = this.currentEditRange();
    if (!range) return;

    const currentPosition =
      Number.isFinite(audio.currentTime) &&
      audio.currentTime >= range.start &&
      audio.currentTime <= range.end
        ? audio.currentTime
        : range.start;
    const position = Math.max(range.start, Math.min(range.end, currentPosition + offsetSeconds));
    this.editPreviewRange = range;
    this.editPreviewAudio = audio;
    this.editPreviewPositionSelected = true;
    audio.currentTime = position;
    this.editPreviewPosition.set(position);
  }

  editWaveformProgress(): number {
    return this.editTimelineProgress(this.editPreviewPosition());
  }

  editWaveformElapsed(): number {
    const range = this.currentEditRange();
    if (!range) return 0;
    return Math.max(0, Math.min(range.end - range.start, this.editPreviewPosition() - range.start));
  }

  editRangeDuration(): number {
    return Number.isFinite(this.editStart) && Number.isFinite(this.editEnd)
      ? Math.max(0, this.editEnd - this.editStart)
      : 0;
  }

  waveformBarPlayed(index: number): boolean {
    const peaks = this.editWaveformPeaks();
    return peaks.length > 0 && index / peaks.length <= this.editWaveformProgress();
  }

  private async loadEditWaveform(file: File, segmentIndex: number): Promise<void> {
    const attempt = ++this.editWaveformAttempt;
    const started = performance.now();
    const lesson = this.result();
    const clip = lesson?.manifest.segments[segmentIndex];
    if (!clip) return;

    this.editWaveformLoading.set(true);
    this.editWaveformError.set('');
    console.info('[Admin.AILesson.SegmentWaveform.Start]', {
      jobId: lesson.manifest.jobId,
      segmentIndex,
      start: clip.start,
      end: clip.end,
    });

    let context: AudioContext | null = null;
    try {
      let buffer = this.editWaveformSourceFile === file ? this.editWaveformBuffer : null;
      if (!buffer) {
        if (typeof window.AudioContext !== 'function') {
          throw new Error('audio_context_unavailable');
        }
        context = new window.AudioContext();
        buffer = await context.decodeAudioData(await file.arrayBuffer());
      }

      if (attempt !== this.editWaveformAttempt || this.editingIndex() !== segmentIndex) return;

      this.editWaveformSourceFile = file;
      this.editWaveformBuffer = buffer;
      if (this.savedLesson()) {
        this.editMediaDuration.set(buffer.duration);
        if (this.editEnd === 0) this.editEnd = buffer.duration;
        this.savedClipDurations.update((items) => ({ ...items, [segmentIndex]: buffer.duration }));
      }
      this.configureEditWaveformWindow(buffer.duration, false);
      this.refreshEditWaveform();
      console.info('[Admin.AILesson.SegmentWaveform.Success]', {
        jobId: lesson.manifest.jobId,
        segmentIndex,
        bars: this.editWaveformPeaks().length,
        durationMs: Math.round(performance.now() - started),
      });
    } catch {
      if (attempt !== this.editWaveformAttempt) return;
      this.editWaveformError.set('تعذر تحليل التموجات الصوتية لهذا الملف.');
      console.warn('[Admin.AILesson.SegmentWaveform.Failed]', {
        jobId: lesson.manifest.jobId,
        segmentIndex,
        start: clip.start,
        end: clip.end,
        code: 'waveform_decode_failed',
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      if (context && context.state !== 'closed') {
        await context.close().catch(() => undefined);
      }
      if (attempt === this.editWaveformAttempt) {
        this.editWaveformLoading.set(false);
        this.changeDetector.markForCheck();
      }
    }
  }

  private refreshEditWaveform(): void {
    const buffer = this.editWaveformBuffer;
    if (!buffer) {
      this.editWaveformPeaks.set([]);
      return;
    }

    const firstSample = Math.max(0, Math.floor(this.editWaveformWindowStart * buffer.sampleRate));
    const lastSample = Math.min(
      buffer.length,
      Math.ceil(this.editWaveformWindowEnd * buffer.sampleRate),
    );
    const sampleCount = lastSample - firstSample;
    if (sampleCount <= 0) {
      this.editWaveformPeaks.set([]);
      return;
    }

    const barCount = 96;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel),
    );
    const peaks = Array.from({ length: barCount }, (_, barIndex) => {
      const start = firstSample + Math.floor((sampleCount * barIndex) / barCount);
      const end = Math.min(
        lastSample,
        firstSample + Math.ceil((sampleCount * (barIndex + 1)) / barCount),
      );
      let peak = 0;
      for (const channel of channels) {
        for (let sample = start; sample < end; sample += 1) {
          peak = Math.max(peak, Math.abs(channel[sample]));
        }
      }
      return peak;
    });
    const maximum = Math.max(...peaks, 0.001);
    this.editWaveformPeaks.set(peaks.map((peak) => Math.max(0.06, peak / maximum)));
  }

  private checkEditPreviewEnd(): void {
    const audio = this.editPreviewAudio;
    const range = this.editPreviewRange;
    if (
      this.editPreviewPlaying() &&
      audio &&
      range &&
      (audio.currentTime >= range.end || audio.ended)
    )
      this.stopEditPreview('range_end');
  }

  stopEditPreview(reason: string = 'manual'): void {
    const active = this.editPreviewBusy() || this.editPreviewPlaying();
    const range = this.editPreviewRange;
    const index = this.editingIndex();
    this.editPreviewAttempt += 1;
    if (this.editPreviewTimer !== null) {
      window.clearInterval(this.editPreviewTimer);
      this.editPreviewTimer = null;
    }
    this.editPreviewAudio?.pause();
    this.editPreviewAudio = null;
    this.editPreviewBusy.set(false);
    this.editPreviewPlaying.set(false);
    this.editPreviewRange = null;
    if (active && range && index !== null) {
      console.info('[Admin.AILesson.SegmentPreview.Stop]', {
        segmentIndex: index,
        start: range.start,
        end: range.end,
        reason,
        durationMs: Math.round(performance.now() - this.editPreviewStartedAt),
      });
    }
    this.editPreviewStartedAt = 0;
  }

  private failEditPreview(code: string): void {
    const index = this.editingIndex();
    const durationMs = this.editPreviewStartedAt
      ? Math.round(performance.now() - this.editPreviewStartedAt)
      : 0;
    this.stopEditPreview('failed');
    this.editPreviewError.set('تعذر تشغيل التوقيت المحدد. راجع الملف والبداية والنهاية.');
    console.warn('[Admin.AILesson.SegmentPreview.Failed]', {
      segmentIndex: index,
      start: Number.isFinite(this.editStart) ? this.editStart : null,
      end: Number.isFinite(this.editEnd) ? this.editEnd : null,
      code,
      durationMs,
    });
  }

  private releaseEditPreview(): void {
    this.editWaveformAttempt += 1;
    this.stopEditPreview('close');
    const url = this.editPreviewSourceUrl();
    this.editPreviewSourceUrl.set('');
    this.editMediaDuration.set(null);
    this.editPreviewError.set('');
    this.editPreviewPosition.set(0);
    this.editWaveformPeaks.set([]);
    this.editWaveformLoading.set(false);
    this.editWaveformError.set('');
    if (url) URL.revokeObjectURL(url);
  }

  async saveSegmentEdit(): Promise<void> {
    const lesson = this.result();
    const index = this.editingIndex();
    if (this.savedLesson()) {
      if (index === null || this.lessonSaving() || this.segmentSaving()) return;
      const text = this.editText.trim();
      if (!text || text.length > 1000) {
        this.error.set('اكتب نصًا صالحًا للمقطع قبل الحفظ.');
        return;
      }
      const buffer = this.editWaveformBuffer;
      const range = this.currentEditRange();
      let audio = this.pendingSavedAudio;
      if (buffer && range) {
        const trimmed = range.start > 0.01 || range.end < buffer.duration - 0.01;
        if (trimmed) {
          try {
            audio = this.wavClip(buffer, range.start, range.end, index);
          } catch {
            this.error.set('التوقيت المحدد غير صالح أو حجم الصوت بعد القص يتجاوز 2 MB.');
            return;
          }
        }
      } else if (buffer && !range) {
        this.error.set('راجع بداية المقطع ونهايته قبل تأكيد التعديل.');
        return;
      }
      this.savedLesson.update((details) =>
        details
          ? {
              ...details,
              segments: details.segments.map((segment, position) =>
                position === index ? { ...segment, text } : segment,
              ),
            }
          : null,
      );
      if (audio) {
        this.savedLessonAudio.update((files) => ({ ...files, [index]: audio }));
        const url = URL.createObjectURL(audio);
        this.urls.push(url);
        this.previewUrls.update((items) =>
          items.map((item, position) => (position === index ? url : item)),
        );
        if (buffer && range) {
          this.savedClipDurations.update((items) => ({
            ...items,
            [index]: range.end - range.start,
          }));
        }
      }
      this.pendingSavedAudio = null;
      this.result.update((current) =>
        current
          ? {
              ...current,
              manifest: {
                ...current.manifest,
                segments: current.manifest.segments.map((clip, position) =>
                  position === index ? { ...clip, text } : clip,
                ),
              },
            }
          : null,
      );
      this.savedLessonDirty.set(true);
      this.closeEditModal();
      this.notice.set('تم تعديل النص. اضغط حفظ التعديلات أسفل المقاطع لحفظ نسخة الدرس.');
      return;
    }
    if (
      !lesson ||
      index === null ||
      this.segmentSaving() ||
      this.lessonSaving() ||
      this.newLessonBusy()
    )
      return;

    const started = performance.now();
    const text = this.editText.trim();
    const range = this.currentEditRange();
    const context = {
      jobId: lesson.manifest.jobId,
      segmentIndex: index,
      start: Number.isFinite(this.editStart) ? this.editStart : null,
      end: Number.isFinite(this.editEnd) ? this.editEnd : null,
    };
    if (!range || text.length < 1 || text.length > 1000) {
      this.error.set('راجع نص المقطع ووقت البداية والنهاية قبل الحفظ.');
      console.warn('[Admin.AILesson.SegmentEdit.Save.Failed]', {
        ...context,
        code: 'invalid_edit',
        durationMs: Math.round(performance.now() - started),
      });
      return;
    }
    if (!this.connected()) {
      this.error.set('أداة المعالجة غير متصلة. لا يمكن إعادة قص المقطع الآن.');
      console.warn('[Admin.AILesson.SegmentEdit.Save.Failed]', {
        ...context,
        code: 'processor_disconnected',
        durationMs: Math.round(performance.now() - started),
      });
      return;
    }

    this.stopEditPreview('save');
    const segments = lesson.manifest.segments.map((clip, clipIndex) =>
      clipIndex === index
        ? { text, start: range.start, end: range.end }
        : { text: clip.text, start: clip.start, end: clip.end },
    );
    this.segmentSaving.set(true);
    this.error.set('');
    console.info('[Admin.AILesson.SegmentEdit.Save.Start]', {
      ...context,
      start: range.start,
      end: range.end,
    });

    try {
      await this.client.recut(lesson.manifest.jobId, segments);
      const refreshed = await this.client.result(lesson.manifest.jobId);
      this.releaseEditPreview();
      this.setResult(refreshed, true);
      this.reviewed = false;
      this.notice.set(`تم حفظ تعديل المقطع ${index + 1} وإعادة تجهيز صوته.`);
      console.info('[Admin.AILesson.SegmentEdit.Save.Success]', {
        ...context,
        start: range.start,
        end: range.end,
        durationMs: Math.round(performance.now() - started),
      });
      this.editingIndex.set(null);
    } catch (error) {
      this.error.set(this.describe(error));
      console.warn('[Admin.AILesson.SegmentEdit.Save.Failed]', {
        ...context,
        code: error instanceof ProcessorError ? error.code : 'unknown',
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.segmentSaving.set(false);
    }
  }

  private wavClip(buffer: AudioBuffer, start: number, end: number, index: number): File {
    const first = Math.floor(start * buffer.sampleRate);
    const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
    const frames = last - first;
    const bytes = 44 + frames * 2;
    if (frames <= 0 || bytes > 2_000_000) throw new Error('invalid_wav_clip');
    const wav = new ArrayBuffer(bytes);
    const view = new DataView(wav);
    const label = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    label(0, 'RIFF');
    view.setUint32(4, bytes - 8, true);
    label(8, 'WAVE');
    label(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    label(36, 'data');
    view.setUint32(40, frames * 2, true);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel),
    );
    for (let frame = 0; frame < frames; frame++) {
      let sample = 0;
      for (const channel of channels) sample += channel[first + frame] / channels.length;
      view.setInt16(44 + frame * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
    }
    return new File([wav], `segment-${index + 1}.wav`, { type: 'audio/wav' });
  }

  playSegment(index: number): void {
    const source = this.previewUrls()[index];

    if (!source) {
      return;
    }

    if (this.playingIndex() === index) {
      this.stopAudio();
      return;
    }

    this.stopAudio();

    const started = performance.now();

    const audio = new Audio(source);

    this.activeAudio = audio;
    this.playingIndex.set(index);

    console.info('[Admin.AILesson.SegmentPlay.Start]', {
      segment: index + 1,
    });

    audio.onended = () => {
      this.activeAudio = null;
      this.playingIndex.set(null);

      console.info('[Admin.AILesson.SegmentPlay.Success]', {
        segment: index + 1,
        durationMs: Math.round(performance.now() - started),
      });
    };

    audio.onerror = () => {
      this.activeAudio = null;
      this.playingIndex.set(null);

      this.error.set('تعذر تشغيل هذا المقطع الصوتي.');

      console.warn('[Admin.AILesson.SegmentPlay.Failed]', {
        segment: index + 1,
        durationMs: Math.round(performance.now() - started),
      });
    };

    void audio.play().catch(() => {
      this.activeAudio = null;
      this.playingIndex.set(null);

      this.error.set('المتصفح منع تشغيل المقطع. اضغط تشغيل مرة أخرى.');
    });
  }

  stopAudio(): void {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.currentTime = 0;
      this.activeAudio = null;
    }

    this.playingIndex.set(null);
  }

  selectedSegmentCount(): number {
    return (
      this.result()?.manifest.segments.filter((_, index) =>
        this.selectedSegmentIndices().has(index),
      ).length ?? 0
    );
  }

  allSegmentsSelected(): boolean {
    const count = this.result()?.manifest.segments.length ?? 0;
    return count > 0 && this.selectedSegmentCount() === count;
  }

  someSegmentsSelected(): boolean {
    const selected = this.selectedSegmentCount();
    return selected > 0 && !this.allSegmentsSelected();
  }

  isSegmentSelected(index: number): boolean {
    return this.selectedSegmentIndices().has(index);
  }

  selectAllSegments(checked: boolean): void {
    if (!this.canChangeSelection()) return;
    const count = this.result()?.manifest.segments.length ?? 0;
    this.selectedSegmentIndices.set(
      new Set(checked ? Array.from({ length: count }, (_, i) => i) : []),
    );
    this.reviewed = false;
    if (this.savedLesson()) this.savedLessonDirty.set(true);
    console.info('[Admin.AILesson.Selection.All]', {
      selectedCount: this.selectedSegmentCount(),
      totalCount: count,
    });
  }

  toggleSegmentSelection(index: number, checked: boolean): void {
    if (
      !this.canChangeSelection() ||
      index < 0 ||
      index >= (this.result()?.manifest.segments.length ?? 0)
    )
      return;
    const selected = new Set(this.selectedSegmentIndices());
    if (checked) selected.add(index);
    else selected.delete(index);
    this.selectedSegmentIndices.set(selected);
    this.reviewed = false;
    if (this.savedLesson()) this.savedLessonDirty.set(true);
    console.info('[Admin.AILesson.Selection.Change]', {
      segmentIndex: index,
      included: checked,
      selectedCount: selected.size,
    });
  }

  canChangeSelection(): boolean {
    return (
      !this.busy() &&
      !this.segmentSaving() &&
      !this.lessonSaving() &&
      !this.newLessonBusy() &&
      this.editingIndex() === null
    );
  }

  canSaveLesson(): boolean {
    return (
      !!this.result() &&
      this.reviewed &&
      this.selectedSegmentCount() > 0 &&
      !!this.userId &&
      !this.busy() &&
      !this.segmentSaving() &&
      !this.newLessonBusy() &&
      !this.lessonSaving() &&
      this.editingIndex() === null
    );
  }

  async approveAndSaveLesson(): Promise<void> {
    const lesson = this.result();
    if (!lesson || !this.canSaveLesson()) return;

    // The processor job UUID identifies this lesson across retries and page visits.
    // The existing create endpoint returns the same lesson for an identical requestId.
    const requestId = lesson.manifest.jobId;
    const title = this.title.trim();
    const description = this.description.trim();
    const segments = lesson.manifest.segments.flatMap((clip, index) =>
      this.selectedSegmentIndices().has(index)
        ? [{ text: clip.text.trim(), audio: lesson.files[index] }]
        : [],
    );
    const started = performance.now();
    this.lessonSaving.set(true);
    this.error.set('');
    console.info('[Admin.AILesson.Save.Start]', {
      requestId,
      jobId: lesson.manifest.jobId,
      segmentCount: segments.length,
      totalCount: lesson.manifest.segments.length,
    });

    try {
      if (
        title.length < 2 ||
        title.length > 160 ||
        description.length > 1000 ||
        segments.length < 1 ||
        segments.length > 20 ||
        lesson.files.length !== lesson.manifest.segments.length ||
        segments.some(
          (segment) =>
            !segment.text ||
            segment.text.length > 1000 ||
            !segment.audio ||
            segment.audio.size <= 12 ||
            segment.audio.size > 2_000_000 ||
            !segment.audio.name.toLowerCase().endsWith('.wav'),
        )
      ) {
        throw new Error('invalid_lesson');
      }

      await firstValueFrom(this.auth.csrf());
      const created = await firstValueFrom(
        this.authoringApi.create(requestId, title, description, segments, this.level, this.goal),
      );
      this.activeVersionId.set(created.versionId);
      console.info('[Admin.AILesson.Save.Success]', {
        lessonId: created.id,
        versionId: created.versionId,
        durationMs: Math.round(performance.now() - started),
      });
      await this.clearSavedShadowingDraft(requestId);
      const navigated = await this.router.navigate(
        ['/admin/lessons', created.versionId, 'workflow'],
        { replaceUrl: true },
      );
      if (!navigated) {
        this.activeCreationTab.set('activities');
      }
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : null;
      const code = this.lessonSaveErrorCode(error);
      this.error.set(this.describeLessonSaveError(code, status));
      console.warn('[Admin.AILesson.Save.Failed]', {
        requestId,
        status,
        code,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.lessonSaving.set(false);
      this.changeDetector.markForCheck();
    }
  }

  shadowingComplete(): boolean {
    return !!this.activeVersionId();
  }

  selectCreationTab(tab: 'shadowing' | 'activities'): void {
    if (tab === 'activities' && !this.shadowingComplete()) return;
    if (tab === 'shadowing' && !this.hasShadowingStage()) return;
    this.activeCreationTab.set(tab);
    this.error.set('');
  }

  private lessonSaveErrorCode(error: unknown): string {
    const code =
      error instanceof HttpErrorResponse
        ? error.error?.error
        : error instanceof Error
          ? error.message
          : null;
    const knownCodes = [
      'invalid_lesson',
      'invalid_segments',
      'invalid_upload',
      'invalid_wav_audio',
      'invalid_csrf',
      'media_storage_not_configured',
      'media_storage_unavailable',
      'lesson_request_conflict',
    ];
    return typeof code === 'string' && knownCodes.includes(code) ? code : 'request_failed';
  }

  private describeLessonSaveError(code: string, status: number | null): string {
    switch (code) {
      case 'invalid_lesson':
      case 'invalid_segments':
      case 'invalid_upload':
      case 'invalid_wav_audio':
        return 'راجع عنوان الدرس ونصوص المقاطع وملفات WAV قبل إعادة الحفظ.';
      case 'media_storage_not_configured':
        return 'خدمة حفظ الصوت غير مهيأة. بيانات الدرس محفوظة هنا؛ راجع إعداد التخزين مع مسؤول الموقع.';
      case 'media_storage_unavailable':
        return 'خدمة حفظ الصوت غير متاحة الآن. بيانات الدرس والتعديلات ما زالت هنا؛ حاول الحفظ مجددًا.';
      case 'lesson_request_conflict':
        return 'توجد محاولة حفظ سابقة لهذا الدرس ببيانات مختلفة. راجع قائمة الدروس قبل إعادة المحاولة.';
      case 'invalid_csrf':
        return 'تعذر التحقق من جلسة الحفظ. بيانات الدرس ما زالت هنا؛ حاول الحفظ مجددًا.';
    }
    if (status === 401 || status === 403)
      return 'تعذر حفظ الدرس بسبب صلاحيات الحساب أو انتهاء الجلسة. بيانات الدرس ما زالت هنا.';
    if (status === 429)
      return 'طلبات الحفظ كثيرة الآن. انتظر قليلًا ثم حاول مجددًا؛ بيانات الدرس ما زالت هنا.';
    return 'تعذر حفظ الدرس. تحقق من اتصال API ثم حاول مجددًا؛ لم يتم مسح بيانات الدرس أو تعديلاته.';
  }

  async createNewLesson(): Promise<void> {
    const currentJob = this.job();
    const lesson = this.result();

    if (
      !lesson ||
      !currentJob ||
      currentJob.state !== 'complete' ||
      this.busy() ||
      this.segmentSaving() ||
      this.lessonSaving() ||
      this.newLessonBusy()
    ) {
      return;
    }

    const started = performance.now();
    const context = {
      jobId: currentJob.jobId,
      segments: lesson.manifest.segments.length,
    };
    this.newLessonBusy.set(true);
    this.error.set('');

    console.info('[Admin.AILesson.NewLesson.Start]', context);

    try {
      let cleanupResult = 'deleted';
      try {
        await this.client.remove(currentJob.jobId);
      } catch (error) {
        if (!(error instanceof ProcessorError) || error.code !== 'not_found') {
          throw error;
        }
        this.client.forgetJob();
        cleanupResult = 'already_absent';
      }

      this.resetLessonDraft();

      this.notice.set('تم تنظيف ملفات الدرس السابق. أضف بيانات الدرس الجديد.');

      console.info('[Admin.AILesson.NewLesson.Success]', {
        ...context,
        result: cleanupResult,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      this.error.set(
        'تعذر حذف ملفات الدرس السابق. لم يتم بدء درس جديد حتى لا تبقى الملفات القديمة.',
      );

      console.warn('[Admin.AILesson.NewLesson.Failed]', {
        ...context,
        code: error instanceof ProcessorError ? error.code : 'unknown',
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.newLessonBusy.set(false);
    }
  }

  transcriptLineCount(): number {
    return this.script
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length;
  }

  phaseLabel(): string {
    const phase = this.job()?.phase;

    switch (phase) {
      case 'decoding':
        return 'جاري تجهيز ملف الصوت...';

      case 'aligning':
        return 'جاري مطابقة النص مع الصوت...';

      case 'cutting':
        return 'جاري إنشاء المقاطع الصوتية...';

      case 'complete':
        return 'اكتملت المعالجة.';

      default:
        return this.busy() ? 'جاري تجهيز الدرس...' : 'جاهز للمعالجة';
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1_000_000) {
      return `${Math.max(1, Math.round(bytes / 1000))} KB`;
    }

    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }

  formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) {
      return '00:00.0';
    }

    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remainder = safe - minutes * 60;

    return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
  }

  segmentDuration(start: number, end: number): string {
    return Math.max(0, end - start).toFixed(1);
  }

  editingPreviewUrl(): string {
    return this.editPreviewSourceUrl();
  }

  private setResult(result: ImportedLesson, preserveSelection = false): void {
    if (this.destroyed) {
      return;
    }

    const isNewLesson = this.result()?.manifest.jobId !== result.manifest.jobId;
    const preserved =
      preserveSelection && !isNewLesson ? new Set(this.selectedSegmentIndices()) : null;
    this.clearResult();

    if (isNewLesson) {
      this.title = result.manifest.title;
      this.description = result.manifest.description;
    }

    this.result.set(result);
    const indexes = result.manifest.segments.map((_, index) => index);
    this.selectedSegmentIndices.set(
      new Set(preserved ? indexes.filter((index) => preserved.has(index)) : indexes),
    );

    this.urls = result.files.map((file) => URL.createObjectURL(file));

    this.previewUrls.set(this.urls);

    this.reviewed = false;
  }

  private async clearSavedShadowingDraft(jobId: string): Promise<void> {
    try {
      await this.client.remove(jobId);
    } catch (error) {
      console.warn('[Admin.AILesson.LocalCleanup.Failed]', {
        jobId,
        code: error instanceof ProcessorError ? error.code : 'unknown',
      });
    } finally {
      this.client.forgetJob();
      this.resetLessonDraft(true);
    }
  }

  private resetLessonDraft(preserveWorkflow = false): void {
    this.clearResult(preserveWorkflow);
    this.job.set(null);
    this.editingIndex.set(null);
    this.sourceMedia = null;
    this.sourceMediaJobId = null;
    this.editWaveformBuffer = null;
    this.editWaveformSourceFile = null;
    this.media = null;
    this.transcriptFile = null;
    this.script = '';
    this.title = '';
    this.description = '';
    this.editText = '';
    this.editStart = 0;
    this.editEnd = 0;
    this.editPreviewPositionSelected = false;
    this.attempt = null;

    if (this.mediaFileInput) {
      this.mediaFileInput.nativeElement.value = '';
    }
    if (this.transcriptFileInput) {
      this.transcriptFileInput.nativeElement.value = '';
    }
  }

  private clearResult(preserveWorkflow = false): void {
    this.releaseEditPreview();
    this.stopAudio();

    this.urls.forEach((url) => URL.revokeObjectURL(url));

    this.urls = [];

    this.previewUrls.set([]);
    this.result.set(null);
    this.selectedSegmentIndices.set(new Set<number>());
    if (!preserveWorkflow) {
      this.activeVersionId.set('');
      this.activeCreationTab.set('shadowing');
    }

    this.reviewed = false;
  }

  private describe(error: unknown): string {
    const code = error instanceof ProcessorError ? error.code : 'invalid_result';

    switch (code) {
      case 'local_connection_unavailable':
        return 'أداة AI غير متصلة. افتح صفحة تثبيت أدوات AI وتحقق من حالة الأداة.';

      case 'link_required':
      case 'invalid_link':
        return 'ربط أداة AI غير مكتمل. افتح صفحة تثبيت أدوات AI لإصلاح الربط.';

      case 'version_mismatch':
        return 'إصدار أداة AI غير متوافق مع الموقع. حدّث الأداة من صفحة تثبيت أدوات AI.';

      case 'processor_busy':
        return 'هناك درس آخر تتم معالجته الآن. انتظر انتهاء العملية الحالية أو ألغها.';

      case 'local_storage_full':
        return 'مساحة عمليات الأداة المحلية ممتلئة. احذف نتائج قديمة ثم حاول مرة أخرى.';

      case 'media_too_long':
        return 'الملف أطول من الحد الحالي وهو 10 دقائق.';

      case 'segment_too_long':
      case 'invalid_bounds':
        return 'توقيت المقطع غير صالح. تأكد أن البداية تسبق النهاية.';

      case 'script_alignment_mismatch':
      case 'line_has_no_timing':
        return 'تعذر مطابقة النص مع الصوت. تأكد أن النص مطابق للكلام المنطوق فعلًا.';

      case 'engine_failed':
      case 'processing_timeout':
      case 'media_decode_failed':
        return 'فشلت معالجة الملف محليًا. راجع الملف ثم حاول مرة أخرى.';

      case 'processing_interrupted':
        return 'توقفت الأداة أثناء المعالجة. شغّلها ثم أعد المحاولة.';

      case 'cancelled':
        return 'تم إلغاء المعالجة.';

      default:
        return 'تعذر تنفيذ العملية. راجع الملفات وحالة أداة AI ثم حاول مرة أخرى.';
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;

    this.controller?.abort();

    this.releaseEditPreview();
    this.stopAudio();

    this.urls.forEach((url) => URL.revokeObjectURL(url));

    this.urls = [];
    this.editWaveformBuffer = null;
    this.editWaveformSourceFile = null;
    this.editWaveformAttempt += 1;
  }
}
