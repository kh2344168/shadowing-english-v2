import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { ImportedLesson, LocalDraftTransfer } from './local-lesson';
import {
  DEFAULT_PROCESSOR_SETTINGS,
  LocalProcessorClient,
  ProcessorError,
  ProcessorJob,
} from './local-processor.client';

@Component({
  selector: 'app-admin-ai-processing-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './ai-processing.page.html',
  styleUrl: './ai-processing.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAIProcessingPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly client = inject(LocalProcessorClient);
  private readonly transfer = inject(LocalDraftTransfer);
  private readonly router = inject(Router);

  private controller: AbortController | null = null;
  private activeAudio: HTMLAudioElement | null = null;
  private attempt: string | null = null;
  private urls: string[] = [];
  private destroyed = false;

  userId = '';

  title = '';
  description = '';

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
  readonly previewUrls = signal<string[]>([]);

  readonly editingIndex = signal<number | null>(null);
  readonly segmentSaving = signal(false);
  readonly playingIndex = signal<number | null>(null);

  readonly error = signal('');
  readonly notice = signal('');

  async ngOnInit(): Promise<void> {
    try {
      const session = await firstValueFrom(this.auth.session());

      if (this.destroyed) {
        return;
      }

      if (
        !session.authenticated ||
        !session.roles.includes('Admin') ||
        !session.userId
      ) {
        this.error.set('إنشاء الدروس متاح لحساب Admin فقط.');
        return;
      }

      this.userId = session.userId;

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
        this.notice.set(
          'الأداة تعمل، لكن الربط بهذا الحساب غير مكتمل. افتح صفحة تثبيت أدوات AI.',
        );
        return;
      }

      this.notice.set('أداة المعالجة جاهزة.');

      const savedJobId = status.activeJobId ?? this.client.savedJob();

      if (savedJobId && !this.busy()) {
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

      this.error.set(
        'اختر ملف صوت أو فيديو صالحًا بحجم لا يتجاوز 100 MB.',
      );

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
    const started = performance.now();
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;

    this.error.set('');

    console.info('[Admin.AILesson.Transcript.Select.Start]');

    if (!file) {
      this.transcriptFile = null;
      this.script = '';
      return;
    }

    try {
      if (
        file.size <= 0 ||
        file.size > 150_000 ||
        !file.name.toLowerCase().endsWith('.txt')
      ) {
        throw new Error('invalid_transcript');
      }

      const text = await file.text();

      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (
        lines.length < 1 ||
        lines.length > 20 ||
        lines.some((line) => line.length > 1000)
      ) {
        throw new Error('invalid_transcript');
      }

      this.transcriptFile = file;
      this.script = lines.join('\n');
      this.attempt = null;

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

      console.warn('[Admin.AILesson.Transcript.Select.Failed]', {
        bytes: file.size,
        durationMs: Math.round(performance.now() - started),
      });
    }
  }

  clearMedia(input: HTMLInputElement): void {
    this.media = null;
    input.value = '';
    this.attempt = null;
  }

  clearTranscript(input: HTMLInputElement): void {
    this.transcriptFile = null;
    this.script = '';
    input.value = '';
    this.attempt = null;
  }

  canProcess(): boolean {
    return (
      !this.busy() &&
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

    if (
      currentJob?.state === 'awaiting_upload' ||
      currentJob?.state === 'running'
    ) {
      this.error.set(
        'هناك معالجة جارية بالفعل. أكملها أو ألغها قبل بدء درس جديد.',
      );
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
        (created) => this.job.set(created),
      );

      this.job.set(createdJob);

      await this.waitForResult(
        createdJob.jobId,
        this.controller.signal,
      );

      console.info('[Admin.AILesson.Process.Success]', {
        jobId: createdJob.jobId,
        segments: this.result()?.manifest.segments.length ?? 0,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      this.error.set(this.describe(error));

      console.warn('[Admin.AILesson.Process.Failed]', {
        code:
          error instanceof ProcessorError
            ? error.code
            : 'unknown',
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.busy.set(false);
    }
  }

  async resume(jobId: string): Promise<void> {
    this.controller = new AbortController();
    this.busy.set(true);

    try {
      await this.waitForResult(
        jobId,
        this.controller.signal,
      );
    } catch (error) {
      if (
        error instanceof ProcessorError &&
        error.code === 'not_found'
      ) {
        this.client.forgetJob();
      } else {
        this.error.set(this.describe(error));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async waitForResult(
    jobId: string,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted && !this.destroyed) {
      const status = await this.client.job(jobId, signal);

      this.job.set(status);

      if (status.state === 'complete') {
        const lesson = await this.client.result(
          jobId,
          signal,
        );

        this.setResult(lesson);

        this.notice.set(
          'اكتملت معالجة الشادوينج. راجع المقاطع قبل اعتماد الدرس.',
        );

        return;
      }

      if (
        status.state === 'failed' ||
        status.state === 'cancelled'
      ) {
        this.attempt = null;
        this.client.forgetJob();

        throw new ProcessorError(
          status.state === 'failed'
            ? status.error ?? 'engine_failed'
            : 'cancelled',
        );
      }

      if (status.state === 'awaiting_upload') {
        this.notice.set(
          'الأداة تنتظر وصول ملف الصوت أو الفيديو.',
        );
      }

      await new Promise<void>((resolve) =>
        setTimeout(resolve, 1000),
      );
    }
  }

  async cancel(): Promise<void> {
    const jobId =
      this.job()?.jobId ??
      this.client.savedJob();

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

    if (!lesson) {
      return;
    }

    const clip = lesson.manifest.segments[index];

    if (!clip) {
      return;
    }

    this.stopAudio();

    this.editingIndex.set(index);

    this.editText = clip.text;
    this.editStart = clip.start;
    this.editEnd = clip.end;

    this.error.set('');

    console.info('[Admin.AILesson.SegmentEdit.Open]', {
      jobId: lesson.manifest.jobId,
      segment: index + 1,
    });
  }

  closeEditModal(): void {
    if (this.segmentSaving()) {
      return;
    }

    this.stopAudio();
    this.editingIndex.set(null);
  }

  async saveSegmentEdit(): Promise<void> {
    const lesson = this.result();
    const index = this.editingIndex();

    if (
      !lesson ||
      index === null ||
      this.segmentSaving()
    ) {
      return;
    }

    const text = this.editText.trim();
    const start = Number(this.editStart);
    const end = Number(this.editEnd);

    if (
      text.length < 1 ||
      text.length > 1000 ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > lesson.manifest.duration
    ) {
      this.error.set(
        'راجع نص المقطع ووقت البداية والنهاية.',
      );
      return;
    }

    if (!this.connected()) {
      this.error.set(
        'أداة المعالجة غير متصلة. لا يمكن إعادة قص المقطع الآن.',
      );
      return;
    }

    const started = performance.now();

    const segments = lesson.manifest.segments.map(
      (clip, clipIndex) =>
        clipIndex === index
          ? {
              ...clip,
              text,
              start,
              end,
            }
          : { ...clip },
    );

    this.segmentSaving.set(true);
    this.error.set('');

    console.info(
      '[Admin.AILesson.SegmentEdit.Start]',
      {
        jobId: lesson.manifest.jobId,
        segment: index + 1,
        start,
        end,
        textLength: text.length,
      },
    );

    try {
      await this.client.recut(
        lesson.manifest.jobId,
        segments.map(
          ({ text: clipText, start: clipStart, end: clipEnd }) => ({
            text: clipText,
            start: clipStart,
            end: clipEnd,
          }),
        ),
      );

      const refreshed = await this.client.result(
        lesson.manifest.jobId,
      );

      this.setResult(refreshed);

      this.reviewed = false;

      this.notice.set(
        `تم حفظ تعديل المقطع ${index + 1} وإعادة تجهيز صوته.`,
      );

      console.info(
        '[Admin.AILesson.SegmentEdit.Success]',
        {
          jobId: lesson.manifest.jobId,
          segment: index + 1,
          durationMs: Math.round(
            performance.now() - started,
          ),
        },
      );

      this.editingIndex.set(null);
    } catch (error) {
      this.error.set(this.describe(error));

      console.warn(
        '[Admin.AILesson.SegmentEdit.Failed]',
        {
          jobId: lesson.manifest.jobId,
          segment: index + 1,
          code:
            error instanceof ProcessorError
              ? error.code
              : 'unknown',
          durationMs: Math.round(
            performance.now() - started,
          ),
        },
      );
    } finally {
      this.segmentSaving.set(false);
    }
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

    console.info(
      '[Admin.AILesson.SegmentPlay.Start]',
      {
        segment: index + 1,
      },
    );

    audio.onended = () => {
      this.activeAudio = null;
      this.playingIndex.set(null);

      console.info(
        '[Admin.AILesson.SegmentPlay.Success]',
        {
          segment: index + 1,
          durationMs: Math.round(
            performance.now() - started,
          ),
        },
      );
    };

    audio.onerror = () => {
      this.activeAudio = null;
      this.playingIndex.set(null);

      this.error.set(
        'تعذر تشغيل هذا المقطع الصوتي.',
      );

      console.warn(
        '[Admin.AILesson.SegmentPlay.Failed]',
        {
          segment: index + 1,
          durationMs: Math.round(
            performance.now() - started,
          ),
        },
      );
    };

    void audio.play().catch(() => {
      this.activeAudio = null;
      this.playingIndex.set(null);

      this.error.set(
        'المتصفح منع تشغيل المقطع. اضغط تشغيل مرة أخرى.',
      );
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

  sendToBuilder(): void {
    const lesson = this.result();

    if (
      !lesson ||
      !this.reviewed ||
      this.busy() ||
      !this.userId
    ) {
      return;
    }

    const started = performance.now();

    console.info(
      '[Admin.AILesson.Transfer.Start]',
      {
        jobId: lesson.manifest.jobId,
        segments: lesson.manifest.segments.length,
      },
    );

    this.transfer.set(
      this.userId,
      lesson,
    );

    console.info(
      '[Admin.AILesson.Transfer.Success]',
      {
        jobId: lesson.manifest.jobId,
        durationMs: Math.round(
          performance.now() - started,
        ),
      },
    );

    void this.router.navigate([
      '/admin/lesson-builder',
    ]);
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
        return this.busy()
          ? 'جاري تجهيز الدرس...'
          : 'جاهز للمعالجة';
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1_000_000) {
      return `${Math.max(
        1,
        Math.round(bytes / 1000),
      )} KB`;
    }

    return `${(
      bytes / 1_000_000
    ).toFixed(1)} MB`;
  }

  formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) {
      return '00:00.0';
    }

    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remainder = safe - minutes * 60;

    return `${String(minutes).padStart(
      2,
      '0',
    )}:${remainder.toFixed(1).padStart(4, '0')}`;
  }

  segmentDuration(
    start: number,
    end: number,
  ): string {
    return Math.max(
      0,
      end - start,
    ).toFixed(1);
  }

  editingPreviewUrl(): string {
    const index = this.editingIndex();

    if (index === null) {
      return '';
    }

    return this.previewUrls()[index] ?? '';
  }

  private setResult(
    result: ImportedLesson,
  ): void {
    if (this.destroyed) {
      return;
    }

    this.clearResult();

    this.result.set(result);

    this.urls = result.files.map((file) =>
      URL.createObjectURL(file),
    );

    this.previewUrls.set(this.urls);

    this.reviewed = false;
  }

  private clearResult(): void {
    this.stopAudio();

    this.urls.forEach((url) =>
      URL.revokeObjectURL(url),
    );

    this.urls = [];

    this.previewUrls.set([]);
    this.result.set(null);

    this.reviewed = false;
  }

  private describe(error: unknown): string {
    const code =
      error instanceof ProcessorError
        ? error.code
        : 'invalid_result';

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

    this.stopAudio();

    this.urls.forEach((url) =>
      URL.revokeObjectURL(url),
    );

    this.urls = [];
  }
}