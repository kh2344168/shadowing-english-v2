import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  AiMaterial,
  LessonOverview,
  Segment,
  StageOverview,
  StudentLearningApi,
} from '../../learning.api';
import { ShadowingReportingApi } from './shadowing-reporting.api';
import { ShadowingRecordingStore } from './shadowing-recording.store';

type PlayerState =
  | 'loading'
  | 'ready'
  | 'teacher'
  | 'student'
  | 'paused'
  | 'saving'
  | 'between'
  | 'finished'
  | 'stopped'
  | 'error';

type PausablePhase = 'teacher' | 'student';
type StudentKaraokeWordState = 'pending' | 'matched' | 'wrong';

interface ShadowingSegment extends Segment {
  translation?: string | null;
  ipa?: string | null;
  pronunciationHint?: string | null;
  start: number;
  end: number;
  loaded: boolean;
}

interface ShadowingLessonView {
  id: string;
  title: string;
  description: string;
  segmentCount: number;
  hasAiContent: boolean;
  segments: ShadowingSegment[];
}

interface LocalRecordingMeta {
  id: string;
  repetitionFrom: number;
  countsTowardProgress: boolean;
  durationLabel: string;
  createdAt: string;
  includesTeacher: boolean;
}

interface LocalRecordingView {
  meta: LocalRecordingMeta;
  url: string | null;
  blob: Blob;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}

interface BrowserSpeechRecognitionEvent {
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognitionErrorEvent {
  error?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

@Component({
  selector: 'app-student-shadowing-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './shadowing.page.html',
  styleUrl: './shadowing.page.scss',
})
export class StudentShadowingPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  private readonly reportingApi = inject(ShadowingReportingApi);
  private readonly recordingStore = inject(ShadowingRecordingStore);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('mediaPlayer') mediaPlayer?: ElementRef<HTMLVideoElement>;

  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly reviewMode = (this.route.snapshot.routeConfig?.path ?? '').includes('shadowing-review');
  private studentId = '';

  lesson: ShadowingLessonView | null = null;
  overview: LessonOverview | null = null;
  aiMaterial: AiMaterial | null = null;
  mediaUrl = '';
  state: PlayerState = 'loading';
  error = '';

  currentSegmentIndex = 0;
  currentSegment: ShadowingSegment | null = null;
  segmentNavigationInProgress = false;
  currentKaraokeIndex = -1;
  studentKaraokeWordStates: StudentKaraokeWordState[] = [];
  studentSpeechRecognitionSupported = true;

  currentRepetitionNumber = 0;
  sessionTargetRepetitions = 1;
  private sessionTargetForThisRun = 1;
  sessionStarted = false;
  sessionCompletedInThisRun = 0;
  private stopAfterCurrentRepetition = false;

  teacherPlaybackRate = 1;
  teacherMuted = false;
  studentDurationRatio = 1;
  studentTurnTimeLimitEnabled = false;
  countdownPauseSeconds = 0;
  sentenceTranslationVisible = true;
  autoAdvanceEnabled = true;

  // Signals keep both drawers reactive before the audio/session starts.
  private readonly sentenceDrawerVisible = signal(false);
  private readonly settingsDrawerVisible = signal(false);

  get sentenceDrawerOpen(): boolean { return this.sentenceDrawerVisible(); }
  set sentenceDrawerOpen(value: boolean) { this.sentenceDrawerVisible.set(value); }

  get settingsDrawerOpen(): boolean { return this.settingsDrawerVisible(); }
  set settingsDrawerOpen(value: boolean) { this.settingsDrawerVisible.set(value); }
  isCompletionModalOpen = false;
  showMicPermissionBanner = false;
  manualPreviewActive = false;

  mediaReady = false;
  teacherSegmentProgress = 0;
  studentTurnElapsedSeconds = 0;
  private studentTurnDurationMs = 0;
  private studentTurnStartedAt = 0;
  private studentTurnElapsedBeforePauseMs = 0;

  teacherWaveBars: number[] = Array.from({ length: 42 }, (_, index) => this.createSilentBar(index, 42));
  voiceBars: number[] = Array.from({ length: 42 }, (_, index) => this.createSilentBar(index, 42));
  voiceLevel = 0;
  hasMicSignal = false;
  microphoneTestActive = false;
  microphoneTestStarting = false;
  microphoneSettingsLabel = 'سيتم فحص إعدادات الميكروفون عند بدء التدريب.';

  recordings: LocalRecordingView[] = [];
  private micStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private activeRecordingChunks: BlobPart[] = [];
  private recordingStartedAt = 0;
  private recordingAccumulatedMs = 0;
  private recordingSliceStartedAt = 0;
  private recordingMimeType = 'audio/webm';

  private analyser: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private visualizerFrameId: number | null = null;
  private teacherAudioContext: AudioContext | null = null;
  private teacherAnalyser: AnalyserNode | null = null;
  private teacherMediaSource: MediaElementAudioSourceNode | null = null;
  private teacherGainNode: GainNode | null = null;
  private teacherVisualizerFrameId: number | null = null;
  private microphoneTestTimerId: number | null = null;

  private studentVoiceDetected = false;
  private studentFirstVoiceAt = 0;
  private studentLastVoiceAt = 0;
  private studentAdvanceInFlight = false;
  private readonly studentSilenceAutoAdvanceMs = 1500;
  private readonly studentMinimumVoiceSpanMs = 180;
  private readonly studentMinimumTurnMs = 650;
  private lastStudentWaveUiAt = 0;

  private activeTimerId: number | null = null;
  private activeTimerCallback: (() => void) | null = null;
  private activeTimerRemainingMs = 0;
  private activeTimerStartedAt = 0;
  private pausedPhase: PausablePhase | null = null;

  private studentSpeechRecognition: BrowserSpeechRecognition | null = null;
  private studentSpeechRecognitionShouldRun = false;
  private studentSpeechRecognitionRestartId: number | null = null;
  private studentSpeechCompletionTimerId: number | null = null;
  private studentRecognitionCommittedTokens: string[] = [];
  private studentRecognitionSessionTranscript = '';
  private studentLatestRecognizedTokens: string[] = [];
  private studentRecognitionGeneration = 0;

  private currentRepetitionSegmentScores: number[] = [];
  private shadowingRepetitionScores: number[] = [];
  private sessionTrainingStartedAtMs = 0;
  private sessionTrainingFinishedAtMs = 0;
  private completedSegments = 0;
  private stageComplete = false;
  private mediaLoadGeneration = 0;
  private csrfReady = false;
  private csrfRequest: Promise<void> | null = null;
  private micStreamRequest: Promise<boolean> | null = null;
  private destroyed = false;
  private readonly prefetchedSegments = new Map<number, ShadowingSegment>();
  private nextAudioPreloader: HTMLAudioElement | null = null;
  completionReportSaved = false;
  completionReportSaving = false;
  completionReportError = '';
  private completionRequestId = '';

  private readonly teacherPlaybackRateStorageKey = 'shadowing-v2-teacher-playback-rate';
  private readonly studentDurationRatioStorageKey = 'shadowing-v2-student-duration-ratio';
  private readonly studentTurnTimeLimitStorageKey = 'shadowing-v2-student-turn-time-limit-v2';
  private readonly sessionTargetStorageKey = 'shadowing-v2-session-target';
  private readonly autoAdvanceStorageKey = 'shadowing-v2-auto-advance';
  private readonly translationStorageKey = 'shadowing-v2-translation-visible';

  async ngOnInit(): Promise<void> {
    this.restoreSettings();
    await this.load();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearTimer();
    this.clearStudentSpeechCompletionTimer();
    this.stopStudentSpeechRecognition(true);
    this.stopMicrophoneTest(false);
    this.stopVisualizer();
    this.stopTeacherVisualizer();
    this.disposeTeacherAudioGraph();
    this.stopTracks();
    this.mediaPlayer?.nativeElement.pause();
    for (const recording of this.recordings) {
      if (recording.url) URL.revokeObjectURL(recording.url);
    }
    this.releaseNextAudioPreloader();
    this.prefetchedSegments.clear();
  }

  async load(): Promise<void> {
    const started = performance.now();
    this.log('Load.Start', { slotId: this.slotId, reviewMode: this.reviewMode });
    this.state = 'loading';
    this.error = '';

    try {
      const overview = await firstValueFrom(this.api.overview(this.slotId));
      if (!this.reviewMode && overview.stages?.some((stage) => stage.key === 'shadowing' && !stage.isUnlocked)) {
        throw new Error('shadowing_stage_locked');
      }
      this.overview = overview;
      this.studentId = overview.studentId ?? '';
      this.completedSegments = overview.completedSegments;
      this.stageComplete = overview.isComplete;

      if (this.reviewMode) {
        if (!overview.hasAiContent) {
          throw new Error('review_ai_content_missing');
        }
        const material = await firstValueFrom(this.api.aiMaterial(this.slotId));
        this.aiMaterial = material;
        if (material.shadowingReviewEnabled === false) {
          throw new Error('review_disabled');
        }
        if (!material.completed.vocabulary) {
          throw new Error('review_vocabulary_locked');
        }
        this.completedSegments = Math.min(
          material.progress.shadowingReview ?? 0,
          overview.segmentCount,
        );
        this.stageComplete = material.completed.shadowingReview ?? false;
      }

      this.lesson = {
        id: this.slotId,
        title: overview.title,
        description: overview.description,
        segmentCount: overview.segmentCount,
        hasAiContent: overview.hasAiContent,
        segments: Array.from({ length: overview.segmentCount }, (_, index) => ({
          position: index + 1,
          text: '',
          audioUrl: '',
          translation: null,
          ipa: null,
          pronunciationHint: null,
          start: 0,
          end: 0,
          loaded: false,
        })),
      };

      if (overview.segmentCount === 0) {
        this.state = 'ready';
        this.log('Load.Success', {
          slotId: this.slotId,
          segmentCount: 0,
          durationMs: this.elapsed(started),
        });
        return;
      }

      const initialPosition = this.stageComplete
        ? 1
        : Math.min(this.completedSegments + 1, overview.segmentCount);
      await this.loadSegment(initialPosition - 1);
      await this.restoreLocalRecordings();
      this.state = 'ready';
      await this.checkMicrophonePermission();
      void this.ensureCsrf().catch((error) => {
        this.logError('Session.Csrf.Prewarm.Failed', error, { slotId: this.slotId });
      });

      this.log('Load.Success', {
        slotId: this.slotId,
        reviewMode: this.reviewMode,
        segmentCount: overview.segmentCount,
        completedSegments: this.completedSegments,
        stageComplete: this.stageComplete,
        durationMs: this.elapsed(started),
      });
    } catch (error) {
      this.state = 'error';
      const message = error instanceof Error ? error.message : '';
      this.error =
        message === 'review_disabled'
          ? 'مرحلة الشادوينج بعد الفهم غير مفعّلة لهذا الدرس.'
          : message === 'review_ai_content_missing'
            ? 'محتوى المراجعة غير متاح لهذا الدرس.'
            : message === 'shadowing_stage_locked'
              ? 'أكمل المراحل السابقة قبل الشادوينج.'
              : message === 'review_vocabulary_locked'
                ? 'أكمل مرحلة الكلمات قبل مراجعة الشادوينج.'
                : 'تعذر تحميل تدريب الشادوينج. حاول مرة أخرى.';
      this.logError('Load.Failed', error, {
        slotId: this.slotId,
        reviewMode: this.reviewMode,
        durationMs: this.elapsed(started),
      });
    }
  }

  get lessonTitle(): string {
    return this.lesson?.title || 'Shadowing';
  }

  get activeStageTitle(): string {
    return this.reviewMode ? 'الشادوينج بعد فهم الكلمات' : 'الشادوينج الأساسي';
  }

  get karaokeWords(): string[] {
    const text = this.currentSegment?.text || '';
    return text.split(/\s+/).filter(Boolean);
  }

  get hasSentenceTranslation(): boolean {
    return Boolean(this.currentSegment?.translation?.trim());
  }

  get currentSegmentPhoneticHint(): { ipa: string; tip: string } | null {
    const ipa = this.currentSegment?.ipa?.trim();
    const tip = this.currentSegment?.pronunciationHint?.trim();
    if (!ipa && !tip) return null;
    return { ipa: ipa || '', tip: tip || '' };
  }

  get segmentProgressPercent(): number {
    if (!this.lesson?.segments.length) return 0;
    return Math.round(((this.currentSegmentIndex + 1) / this.lesson.segments.length) * 100);
  }

  get hasPreviousSegment(): boolean {
    return this.currentSegmentIndex > 0;
  }

  get hasNextSegment(): boolean {
    return Boolean(this.lesson && this.currentSegmentIndex < this.lesson.segments.length - 1);
  }

  get currentRepetitionLabel(): string {
    const current = this.currentRepetitionNumber || Math.min(this.sessionCompletedInThisRun + 1, this.sessionTargetRepetitions);
    return `${Math.max(1, current)} / ${Math.max(1, this.sessionTargetRepetitions)}`;
  }

  get primaryActionLabel(): string {
    if (!this.mediaReady) return 'جاري تجهيز الصوت...';
    if (this.state === 'paused') return 'كمّل نفس التدريب';
    if (this.state === 'teacher' || this.state === 'student') return 'إيقاف مؤقت';
    if (this.state === 'saving') return 'جارٍ حفظ التقدم...';
    if (this.state === 'between') return 'نجهّز الخطوة التالية...';
    return this.stageComplete ? 'ابدأ مراجعة الشادوينج' : 'ابدأ التدريب';
  }

  get primaryActionDisabled(): boolean {
    if (this.state === 'paused') return false;
    if (this.state === 'teacher' || this.state === 'student') return false;
    if (this.state === 'saving' || this.state === 'between') return true;
    return !this.lesson || !this.currentSegment || !this.mediaReady || this.lesson.segmentCount === 0;
  }

  get teacherPlaybackRateLabel(): string {
    return `${this.teacherPlaybackRate.toFixed(2)}×`;
  }

  get studentDurationRatioPercent(): number {
    return Math.round(this.studentDurationRatio * 100);
  }

  get studentDurationRatioLabel(): string {
    const diff = Math.round((this.studentDurationRatio - 1) * 100);
    if (diff === 0) return '100% (مطابق)';
    return diff > 0
      ? `${this.studentDurationRatioPercent}% (+${diff}%)`
      : `${this.studentDurationRatioPercent}% (${diff}%)`;
  }

  get studentTargetDurationLabel(): string {
    if (!this.studentTurnTimeLimitEnabled) return 'بدون حد زمني';
    return this.formatDurationSeconds(this.studentTurnDurationMs / 1000);
  }

  get microphoneLevelLabel(): string {
    if (!this.microphoneTestActive) return 'الاختبار متوقف';
    if (this.voiceLevel >= 75) return 'صوتك مرتفع جدًا';
    if (this.voiceLevel >= 25) return 'صوتك واضح ومناسب';
    if (this.voiceLevel >= 8) return 'صوتك منخفض';
    return 'لا يصل صوت واضح';
  }

  get teacherWaveBarsSlice(): number[] {
    if (this.state === 'teacher' || this.manualPreviewActive) return this.teacherWaveBars.slice(0, 11);
    return Array.from({ length: 11 }, (_, index) => this.createSilentBar(index, 11));
  }

  get studentWaveBarsSlice(): number[] {
    if (this.state === 'student' || this.microphoneTestActive) return this.voiceBars.slice(0, 11);
    return Array.from({ length: 11 }, (_, index) => this.createSilentBar(index, 11));
  }

  get audioCurrentTimeLabel(): string {
    const media = this.mediaPlayer?.nativeElement;
    if (this.state === 'teacher' || this.manualPreviewActive) {
      return this.formatDurationSeconds(media?.currentTime ?? 0);
    }
    if (this.state === 'student') {
      return this.formatDurationSeconds(this.studentTurnElapsedSeconds);
    }
    return '00:00';
  }

  get audioTotalTimeLabel(): string {
    if (this.state === 'student') {
      return this.studentTurnTimeLimitEnabled ? this.studentTargetDurationLabel : '∞';
    }
    const duration = this.currentSegment?.end ?? 0;
    return this.formatDurationSeconds(duration);
  }

  get scrubCursorLeft(): string {
    if (this.state === 'teacher' || this.manualPreviewActive) {
      return `${Math.round((Math.min(100, this.teacherSegmentProgress) / 100) * 48)}%`;
    }
    if (this.state === 'student') {
      if (!this.studentTurnTimeLimitEnabled) {
        const total = Math.max(1, this.studentKaraokeWordStates.length);
        const matched = this.studentKaraokeWordStates.filter((state) => state === 'matched').length;
        return `${48 + Math.round((matched / total) * 48)}%`;
      }
      const fraction = this.studentTurnDurationMs > 0
        ? Math.min(1, (this.studentTurnElapsedSeconds * 1000) / this.studentTurnDurationMs)
        : 0;
      return `${48 + Math.round(fraction * 48)}%`;
    }
    return '48%';
  }

  get liveWaveLabel(): string {
    if (this.manualPreviewActive) return 'إعادة سماع الجملة';
    if (this.state === 'teacher') return 'استمع للمدرس';
    if (this.state === 'student') return 'تكلم الآن';
    if (this.state === 'paused') return 'التدريب متوقف مؤقتًا';
    if (this.state === 'saving') return 'جارٍ الحفظ';
    if (this.state === 'between') return 'استعد';
    if (this.state === 'finished') return 'تم التدريب';
    return 'جاهز للتدريب';
  }

  get liveSignalLabel(): string {
    if (this.manualPreviewActive) return `صوت المدرس · ${this.teacherPlaybackRateLabel}`;
    if (this.state === 'teacher') return 'صوت المدرس يعمل';
    if (this.state === 'student') return this.hasMicSignal ? 'صوتك واضح' : 'لا يوجد صوت واضح';
    if (this.state === 'paused') return 'يمكنك إكمال نفس التدريب من موضعه';
    if (this.state === 'saving') return 'جارٍ حفظ تقدم المرحلة';
    if (this.state === 'finished') return 'تم حفظ التقدم';
    return 'اضغط ابدأ التدريب';
  }

  get currentSpeechMatchScore(): number | null {
    if (!this.studentSpeechRecognitionSupported) return null;
    const capturedCount = this.studentRecognitionCommittedTokens.length +
      this.normalizeSpeechTokens(this.studentRecognitionSessionTranscript).length;
    if (capturedCount === 0 || !this.studentKaraokeWordStates.length) return null;
    const matched = this.studentKaraokeWordStates.filter((state) => state === 'matched').length;
    return Math.round((matched / this.studentKaraokeWordStates.length) * 100);
  }

  get currentRecognizedSpeechText(): string {
    return [
      ...this.studentRecognitionCommittedTokens,
      ...this.normalizeSpeechTokens(this.studentRecognitionSessionTranscript),
    ].join(' ');
  }

  get currentSpeechReviewLabel(): string {
    const score = this.currentSpeechMatchScore;
    if (score === null) return 'غير متاح';
    if (score >= 90) return 'ممتاز';
    if (score >= 80) return 'جيد جدًا';
    if (score >= 65) return 'جيد';
    return 'يحتاج مراجعة';
  }

  speechReviewVisible = false;

  get speechReviewRequiredByTeacher(): boolean {
    return false;
  }

  get shouldShowSpeechReview(): boolean {
    return this.speechReviewRequiredByTeacher || this.speechReviewVisible;
  }

  get completionMatchScore(): number | null {
    if (!this.shadowingRepetitionScores.length) return null;
    return Math.round(
      this.shadowingRepetitionScores.reduce((sum, score) => sum + score, 0) /
        this.shadowingRepetitionScores.length,
    );
  }

  get completionBestRepetitionScore(): number | null {
    return this.shadowingRepetitionScores.length ? Math.max(...this.shadowingRepetitionScores) : null;
  }

  get completionQualityLabel(): string {
    const score = this.completionMatchScore;
    if (score === null) return 'غير متاح';
    if (score >= 90) return 'ممتاز';
    if (score >= 80) return 'جيد جدًا';
    if (score >= 65) return 'جيد';
    return 'يحتاج مراجعة';
  }

  get completionTrainingTimeLabel(): string {
    if (!this.sessionTrainingStartedAtMs) return '00:00';
    const endedAt = this.sessionTrainingFinishedAtMs || Date.now();
    return this.formatDurationSeconds(Math.max(0, endedAt - this.sessionTrainingStartedAtMs) / 1000);
  }

  get nextStageLabel(): string {
    const next = this.nextPublishedStage(this.reviewMode ? 'vocabulary' : 'shadowing');
    if (next) return next.title;
    if (this.overview?.stages?.length) return 'مراحل الدرس';
    if (this.reviewMode) return 'استمع واكتب';
    return this.lesson?.hasAiContent ? 'الكلمات والعبارات' : 'مراحل الدرس';
  }

  private nextPublishedStage(afterKey: string): StageOverview | null {
    const stages = this.overview?.stages ?? [];
    const index = stages.findIndex((stage) => stage.key === afterKey);
    return index >= 0 ? stages[index + 1] ?? null : null;
  }


  studentKaraokeState(index: number): StudentKaraokeWordState {
    return this.studentKaraokeWordStates[index] ?? 'pending';
  }

  async handlePrimaryAction(): Promise<void> {
    if (this.state === 'paused') {
      await this.resumeTraining();
      return;
    }
    if (this.state === 'teacher' || this.state === 'student') {
      await this.pauseTraining();
      return;
    }
    await this.startSession();
  }

  async startSession(): Promise<void> {
    if (!this.lesson || !this.currentSegment || !this.mediaReady || this.state === 'saving') return;

    const started = performance.now();
    this.log('Session.Start', {
      slotId: this.slotId,
      reviewMode: this.reviewMode,
      targetRepetitions: this.sessionTargetRepetitions,
    });

    // Teacher audio should start immediately. Microphone and CSRF preparation continue
    // in parallel and are awaited only when the student/save phases actually need them.
    void this.ensureMicStream();
    void this.ensureCsrf().catch((error) => {
      this.logError('Session.Csrf.Prewarm.Failed', error, { slotId: this.slotId });
    });

    this.sessionTargetForThisRun = Math.max(1, this.sessionTargetRepetitions);
    this.sessionCompletedInThisRun = 0;
    this.currentRepetitionNumber = 0;
    this.stopAfterCurrentRepetition = false;
    this.sessionStarted = true;
    this.shadowingRepetitionScores = [];
    this.currentRepetitionSegmentScores = [];
    this.sessionTrainingStartedAtMs = Date.now();
    this.sessionTrainingFinishedAtMs = 0;
    this.speechReviewVisible = false;
    this.completionReportSaved = false;
    this.completionReportError = '';
    this.completionRequestId = '';

    await this.startNextRepetitionInSession();

    this.log('Session.Success', {
      slotId: this.slotId,
      targetRepetitions: this.sessionTargetForThisRun,
      durationMs: this.elapsed(started),
    });
  }

  async stopTraining(): Promise<void> {
    this.log('Session.Stop', { slotId: this.slotId, state: this.state });
    this.stopAfterCurrentRepetition = true;
    this.sessionStarted = false;
    this.clearTimer();
    this.stopStudentSpeechRecognition(true);
    this.mediaPlayer?.nativeElement.pause();
    const stoppedRecording = await this.stopLocalRecording(true);
    if (stoppedRecording) {
      await this.addLocalRecording(stoppedRecording);
    }
    this.stopVisualizer();
    this.stopTeacherVisualizer();
    this.stopTracks();
    this.state = 'stopped';
    this.manualPreviewActive = false;
    this.currentKaraokeIndex = -1;
  }

  async pauseTraining(): Promise<void> {
    if (this.state !== 'teacher' && this.state !== 'student') return;
    this.pausedPhase = this.state;
    this.pauseActiveTimer();
    if (this.state === 'teacher') {
      this.mediaPlayer?.nativeElement.pause();
      this.stopTeacherVisualizer();
    } else {
      this.stopStudentSpeechRecognition(false);
      if (this.studentTurnStartedAt > 0) {
        this.studentTurnElapsedBeforePauseMs += Math.max(0, Date.now() - this.studentTurnStartedAt);
      }
      this.studentTurnStartedAt = 0;
      this.stopVisualizer(false);
    }
    if (this.pausedPhase === 'student') this.pauseStudentRecordingCapture();
    this.state = 'paused';
  }

  async resumeTraining(): Promise<void> {
    if (this.state !== 'paused' || !this.pausedPhase) return;
    const phase = this.pausedPhase;
    if (phase === 'student') this.resumeStudentRecordingCapture();
    this.state = phase;
    if (phase === 'teacher') {
      const media = this.mediaPlayer?.nativeElement;
      if (media) {
        this.applyTeacherPlaybackRate(media);
        await this.startTeacherVisualizer();
        await media.play();
      }
    } else if (this.micStream) {
      this.studentTurnStartedAt = Date.now();
      await this.startMicVisualizer(this.micStream, false);
      this.startStudentSpeechRecognition(false);
    }
    this.pausedPhase = null;
    this.resumeActiveTimer();
  }

  async previousSegment(): Promise<void> {
    if (this.navigationBusy || !this.hasPreviousSegment) return;
    await this.selectSegment(this.currentSegmentIndex - 1);
  }

  async nextSegment(): Promise<void> {
    if (this.navigationBusy || !this.lesson) return;
    if (this.state === 'student') {
      await this.goToNextSegmentOrFinish();
      return;
    }
    if (!this.hasNextSegment) return;
    await this.selectSegment(this.currentSegmentIndex + 1);
  }

  async replayCurrentSegment(): Promise<void> {
    if (!this.currentSegment || this.navigationBusy) return;
    if (this.state === 'teacher' || this.state === 'student') {
      await this.selectSegment(this.currentSegmentIndex, true);
      return;
    }
    if (this.state === 'paused') return;
    await this.previewSelectedSegment();
  }

  toggleSentenceTranslation(): void {
    if (!this.hasSentenceTranslation) return;
    this.sentenceTranslationVisible = !this.sentenceTranslationVisible;
    localStorage.setItem(this.translationStorageKey, this.sentenceTranslationVisible ? 'true' : 'false');
  }

  toggleSlowAudio(): void {
    this.setTeacherPlaybackRate(this.teacherPlaybackRate === 0.75 ? 1 : 0.75);
  }

  setTeacherPlaybackRate(value: number): void {
    this.teacherPlaybackRate = Math.round(Math.min(2, Math.max(0.5, value)) * 100) / 100;
    localStorage.setItem(this.teacherPlaybackRateStorageKey, String(this.teacherPlaybackRate));
    const media = this.mediaPlayer?.nativeElement;
    if (media) this.applyTeacherPlaybackRate(media);
  }

  toggleTeacherMute(): void {
    this.teacherMuted = !this.teacherMuted;
    const media = this.mediaPlayer?.nativeElement;
    if (this.teacherGainNode) {
      this.teacherGainNode.gain.value = this.teacherMuted ? 0 : 1;
      if (media) media.muted = false;
    } else if (media) {
      media.muted = this.teacherMuted;
    }
  }

  copyCurrentSentence(): void {
    const text = this.currentSegment?.text;
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
      return;
    }
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
      document.execCommand('copy');
    } catch {
      // Clipboard fallback is best effort only.
    }
    input.remove();
  }

  toggleSentenceDrawer(): void {
    const started = performance.now();
    this.log('SentenceDrawer.Toggle.Start', {
      slotId: this.slotId,
      wasOpen: this.sentenceDrawerOpen,
      sessionStarted: this.sessionStarted,
    });
    this.sentenceDrawerOpen = !this.sentenceDrawerOpen;
    if (this.sentenceDrawerOpen) this.settingsDrawerOpen = false;
    this.refreshView();
    this.log('SentenceDrawer.Toggle.Success', {
      slotId: this.slotId,
      isOpen: this.sentenceDrawerOpen,
      durationMs: this.elapsed(started),
    });
  }

  toggleSettingsDrawer(): void {
    const started = performance.now();
    this.log('SettingsDrawer.Toggle.Start', {
      slotId: this.slotId,
      wasOpen: this.settingsDrawerOpen,
      sessionStarted: this.sessionStarted,
    });
    this.settingsDrawerOpen = !this.settingsDrawerOpen;
    if (this.settingsDrawerOpen) this.sentenceDrawerOpen = false;
    this.refreshView();
    this.log('SettingsDrawer.Toggle.Success', {
      slotId: this.slotId,
      isOpen: this.settingsDrawerOpen,
      durationMs: this.elapsed(started),
    });
  }

  async selectSegmentFromDrawer(index: number): Promise<void> {
    if (!this.lesson || this.segmentNavigationInProgress) return;
    if (!this.stageComplete && index > this.completedSegments) {
      this.log('Segment.Select.Blocked', {
        slotId: this.slotId,
        requestedPosition: index + 1,
        highestUnlockedPosition: this.completedSegments + 1,
      });
      return;
    }
    await this.selectSegment(index);
    this.sentenceDrawerOpen = false;
  }

  requestSpeechReview(): void {
    this.speechReviewVisible = !this.speechReviewVisible;
  }

  setSessionTarget(value: number): void {
    if (this.state === 'teacher' || this.state === 'student' || this.state === 'saving') return;
    this.sessionTargetRepetitions = Math.max(1, Math.min(7, value));
    localStorage.setItem(this.sessionTargetStorageKey, String(this.sessionTargetRepetitions));
  }

  setStudentDurationRatio(value: number): void {
    this.studentDurationRatio = Math.round(Math.min(1.5, Math.max(0.6, value)) * 100) / 100;
    localStorage.setItem(this.studentDurationRatioStorageKey, String(this.studentDurationRatio));
  }

  setStudentTurnTimeLimitEnabled(enabled: boolean): void {
    this.studentTurnTimeLimitEnabled = enabled;
    localStorage.setItem(this.studentTurnTimeLimitStorageKey, enabled ? 'true' : 'false');

    if (this.state === 'student' && this.currentSegment) {
      this.clearTimer();
      if (enabled) {
        const total = this.getStudentTurnDurationMs();
        const elapsed = this.studentTurnElapsedBeforePauseMs +
          (this.studentTurnStartedAt > 0 ? Date.now() - this.studentTurnStartedAt : 0);
        this.studentTurnDurationMs = total;
        this.scheduleActiveTimer(Math.max(200, total - elapsed), () => {
          void this.goToNextSegmentOrFinish();
        });
      } else {
        this.studentTurnDurationMs = 0;
      }
    }
  }

  setCountdownPause(seconds: number): void {
    this.countdownPauseSeconds = Math.max(0, Math.min(5, seconds));
  }

  async requestMicPermission(): Promise<void> {
    this.showMicPermissionBanner = false;
    const ready = await this.ensureMicStream(false);
    if (!ready) this.showMicPermissionBanner = true;
  }

  async toggleMicrophoneTest(): Promise<void> {
    if (this.microphoneTestActive) {
      this.stopMicrophoneTest(true);
      return;
    }
    if (this.state === 'teacher' || this.state === 'student' || this.microphoneTestStarting) return;

    this.microphoneTestStarting = true;
    this.microphoneTestActive = true;
    const ready = await this.ensureMicStream(false);
    this.microphoneTestStarting = false;
    if (!ready || !this.micStream) {
      this.microphoneTestActive = false;
      return;
    }

    await this.startMicVisualizer(this.micStream);
    this.microphoneTestTimerId = window.setTimeout(() => this.stopMicrophoneTest(true), 30_000);
  }

  async deleteRecording(recording: LocalRecordingView): Promise<void> {
    const confirmed = window.confirm('هل تريد حذف هذا التسجيل من هذا الجهاز؟ لن يحذف ذلك نسخة التقرير التي رُفعت للأدمن بعد إكمال المرحلة.');
    if (!confirmed) return;
    if (recording.url) URL.revokeObjectURL(recording.url);
    this.recordings = this.recordings.filter((item) => item.meta.id !== recording.meta.id);
    this.refreshView();
    try {
      await this.recordingStore.delete(recording.meta.id, this.studentId);
    } catch (error) {
      this.logError('Recording.LocalDelete.Failed', error, { slotId: this.slotId, recordingId: recording.meta.id });
    }
    this.log('Recording.Delete.Success', {
      slotId: this.slotId,
      recordingId: recording.meta.id,
      remainingCount: this.recordings.length,
    });
  }

  async restartCurrentStage(): Promise<void> {
    this.isCompletionModalOpen = false;
    await this.selectSegment(0);
    await this.startSession();
  }

  async continueToNextStage(): Promise<void> {
    this.isCompletionModalOpen = false;
    if (this.reviewMode) {
      const next = this.nextPublishedStage('vocabulary');
      if (this.overview?.stages?.length) {
        await this.router.navigateByUrl(next?.route ?? `/student/lessons/${this.slotId}/overview`);
      } else {
        await this.router.navigate(['/student/lessons', this.slotId, 'listen-type']);
      }
      return;
    }
    if (!this.stageComplete) {
      await this.router.navigate(['/student/lessons', this.slotId, 'overview']);
      return;
    }
    const next = this.nextPublishedStage('shadowing');
    await this.router.navigateByUrl(next?.route ?? `/student/lessons/${this.slotId}/overview`);
  }

  onMediaMetadataLoaded(): void {
    const media = this.mediaPlayer?.nativeElement;
    if (!media || !this.currentSegment) return;
    const duration = Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0;
    this.currentSegment.end = duration;
    this.mediaReady = duration > 0;
    this.applyTeacherPlaybackRate(media);
    this.log('Media.Metadata.Success', {
      slotId: this.slotId,
      position: this.currentSegment.position,
      durationSeconds: Math.round(duration * 100) / 100,
    });
  }

  onMediaTimeUpdate(): void {
    const media = this.mediaPlayer?.nativeElement;
    const duration = this.currentSegment?.end ?? 0;
    if (!media || duration <= 0) return;
    this.teacherSegmentProgress = Math.min(100, Math.max(0, (media.currentTime / duration) * 100));
    if (this.state === 'teacher' || this.manualPreviewActive) {
      const words = this.karaokeWords;
      this.currentKaraokeIndex = words.length
        ? Math.min(words.length - 1, Math.floor((this.teacherSegmentProgress / 100) * words.length))
        : -1;
    }
  }

  onTeacherMediaEnded(): void {
    this.stopTeacherVisualizer();
    this.teacherSegmentProgress = 100;
    this.currentKaraokeIndex = this.karaokeWords.length ? this.karaokeWords.length - 1 : -1;

    if (this.manualPreviewActive) {
      this.manualPreviewActive = false;
      this.currentKaraokeIndex = -1;
      return;
    }

    if (this.state !== 'teacher') return;
    if (this.countdownPauseSeconds > 0) {
      this.state = 'between';
      this.scheduleActiveTimer(this.countdownPauseSeconds * 1000, () => {
        void this.startStudentTurn();
      });
      return;
    }
    void this.startStudentTurn();
  }

  onMediaLoadError(): void {
    const mediaError = this.mediaPlayer?.nativeElement.error;
    if (this.segmentNavigationInProgress || mediaError?.code === MediaError.MEDIA_ERR_ABORTED) {
      this.log('Media.Load.Interrupted', {
        slotId: this.slotId,
        position: this.currentSegment?.position ?? null,
        code: mediaError?.code ?? null,
      });
      return;
    }
    this.state = 'error';
    this.error = 'ملف صوت الجملة غير موجود أو تعذر تحميله من السيرفر.';
    this.logError('Media.Load.Failed', mediaError, {
      slotId: this.slotId,
      position: this.currentSegment?.position ?? null,
    });
  }

  private async loadSegment(index: number): Promise<void> {
    if (!this.lesson || index < 0 || index >= this.lesson.segments.length) return;
    const started = performance.now();
    const position = index + 1;
    this.log('Segment.Load.Start', { slotId: this.slotId, position });

    let view = this.prefetchedSegments.get(position) ?? null;
    if (view) {
      this.prefetchedSegments.delete(position);
      this.log('Segment.Load.PrefetchHit', { slotId: this.slotId, position });
    } else {
      const segment = await firstValueFrom(this.api.segment(this.slotId, position));
      const extended = segment as Segment & {
        translation?: string | null;
        ipa?: string | null;
        pronunciationHint?: string | null;
      };
      view = {
        ...segment,
        translation: extended.translation ?? null,
        ipa: extended.ipa ?? null,
        pronunciationHint: extended.pronunciationHint ?? null,
        start: 0,
        end: 0,
        loaded: true,
      };
    }

    this.lesson.segments[index] = view;
    this.currentSegmentIndex = index;
    this.currentSegment = view;
    this.currentKaraokeIndex = -1;
    this.studentKaraokeWordStates = this.karaokeWords.map(() => 'pending');
    this.sentenceTranslationVisible = this.readStoredBoolean(this.translationStorageKey, true);
    this.mediaReady = false;
    this.teacherSegmentProgress = 0;
    this.prepareMediaSource(view.audioUrl);

    this.log('Segment.Load.Success', {
      slotId: this.slotId,
      position,
      hasTranslation: Boolean(view.translation),
      durationMs: this.elapsed(started),
    });
  }

  private async selectSegment(index: number, forceReplay = false): Promise<void> {
    if (!this.lesson || index < 0 || index >= this.lesson.segments.length) return;
    if (this.segmentNavigationInProgress || this.state === 'saving' || this.state === 'between' || this.state === 'paused') return;

    const trainingActive = this.state === 'teacher' || this.state === 'student';
    if (!forceReplay && index === this.currentSegmentIndex) return;
    this.segmentNavigationInProgress = true;

    try {
      this.clearTimer();
      this.stopStudentSpeechRecognition(true);
      this.stopVisualizer(false);
      this.stopTeacherVisualizer();
      this.pauseStudentRecordingCapture();
      this.mediaPlayer?.nativeElement.pause();

      if (!this.lesson.segments[index].loaded) {
        await this.loadSegment(index);
      } else {
        this.currentSegmentIndex = index;
        this.currentSegment = this.lesson.segments[index];
        this.mediaReady = false;
        this.teacherSegmentProgress = 0;
        this.currentKaraokeIndex = -1;
        this.studentKaraokeWordStates = this.karaokeWords.map(() => 'pending');
        this.prepareMediaSource(this.currentSegment.audioUrl);
      }

      if (trainingActive) {
        await this.waitForMediaReady();
        await this.playCurrentTeacherSegment();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const name = error instanceof Error ? error.name : '';
      if (message === 'media_source_changed' || name === 'AbortError') {
        this.log('Segment.Navigation.Interrupted', {
          slotId: this.slotId,
          requestedPosition: index + 1,
        });
      } else {
        this.state = 'ready';
        this.error = 'تعذر تشغيل الجملة الآن. حاول مرة أخرى.';
        this.logError('Segment.Navigation.Failed', error, {
          slotId: this.slotId,
          requestedPosition: index + 1,
        });
      }
    } finally {
      this.segmentNavigationInProgress = false;
      this.refreshView();
    }
  }

  private async previewSelectedSegment(): Promise<void> {
    const media = this.mediaPlayer?.nativeElement;
    if (!media || !this.currentSegment) return;
    await this.waitForMediaReady();
    this.manualPreviewActive = true;
    this.teacherSegmentProgress = 0;
    this.currentKaraokeIndex = -1;
    media.currentTime = 0;
    this.applyTeacherPlaybackRate(media);
    try {
      await this.startTeacherVisualizer();
      await media.play();
    } catch (error) {
      this.manualPreviewActive = false;
      this.error = 'المتصفح منع تشغيل الجملة. حاول مرة أخرى.';
      this.logError('Preview.Play.Failed', error, {
        slotId: this.slotId,
        position: this.currentSegment.position,
      });
    }
  }

  private async startNextRepetitionInSession(): Promise<void> {
    if (!this.lesson || this.stopAfterCurrentRepetition) return;
    if (this.sessionCompletedInThisRun >= this.sessionTargetForThisRun) {
      await this.finishSession();
      return;
    }

    this.currentRepetitionNumber = this.sessionCompletedInThisRun + 1;
    this.currentRepetitionSegmentScores = [];
    await this.selectSegment(0);
    await this.waitForMediaReady();
    await this.playCurrentTeacherSegment();
  }

  private async playCurrentTeacherSegment(): Promise<void> {
    const media = this.mediaPlayer?.nativeElement;
    if (!media || !this.currentSegment) return;

    const generation = this.mediaLoadGeneration;

    try {
      await this.waitForMediaReady(generation);
    } catch (error) {
      if (error instanceof Error && error.message === 'media_source_changed') {
        this.log('Teacher.Play.SkippedStaleSource', {
          slotId: this.slotId,
          position: this.currentSegment.position,
          generation,
          currentGeneration: this.mediaLoadGeneration,
        });
        return;
      }
      throw error;
    }

    if (generation !== this.mediaLoadGeneration || !this.currentSegment) return;

    this.clearTimer();
    this.stopStudentSpeechRecognition(true);
    this.stopVisualizer(false);
    this.stopTeacherVisualizer();
    this.pauseStudentRecordingCapture();
    this.state = 'teacher';
    this.teacherSegmentProgress = 0;
    this.currentKaraokeIndex = -1;
    media.currentTime = 0;
    this.applyTeacherPlaybackRate(media);

    this.log('Teacher.Play.Start', {
      slotId: this.slotId,
      position: this.currentSegment.position,
      playbackRate: this.teacherPlaybackRate,
      generation,
    });

    try {
      await this.startTeacherVisualizer();
      await media.play();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';

      if (errorName === 'AbortError') {
        this.state = 'ready';
        this.error = '';
        this.log('Teacher.Play.Interrupted', {
          slotId: this.slotId,
          position: this.currentSegment.position,
          generation,
          currentGeneration: this.mediaLoadGeneration,
        });
        return;
      }

      this.state = 'error';
      this.error =
        errorName === 'NotAllowedError'
          ? 'المتصفح منع تشغيل صوت الجملة. اضغط تشغيل مرة أخرى.'
          : 'تعذر تشغيل صوت الجملة. حاول مرة أخرى.';
      this.logError('Teacher.Play.Failed', error, {
        slotId: this.slotId,
        position: this.currentSegment.position,
        generation,
      });
    }
  }

  private async startStudentTurn(): Promise<void> {
    if (!this.currentSegment) return;
    const ready = await this.ensureMicStream();
    if (!ready || !this.micStream) return;

    this.clearTimer();
    const recordingReady = await this.ensureStudentRecordingActive();
    if (!recordingReady) return;
    this.state = 'student';
    this.studentTurnElapsedSeconds = 0;
    this.studentTurnElapsedBeforePauseMs = 0;
    this.studentTurnStartedAt = Date.now();
    this.studentVoiceDetected = false;
    this.studentFirstVoiceAt = 0;
    this.studentLastVoiceAt = 0;
    this.studentAdvanceInFlight = false;
    this.studentTurnDurationMs = this.studentTurnTimeLimitEnabled ? this.getStudentTurnDurationMs() : 0;
    this.resetStudentKaraokeState();
    await this.startMicVisualizer(this.micStream);
    this.startStudentSpeechRecognition(true);
    void this.prefetchNextSegment();

    this.log('Student.Turn.Start', {
      slotId: this.slotId,
      position: this.currentSegment.position,
      timeLimitEnabled: this.studentTurnTimeLimitEnabled,
      durationMs: this.studentTurnDurationMs,
    });

    if (this.studentTurnTimeLimitEnabled) {
      this.scheduleActiveTimer(this.studentTurnDurationMs, () => {
        void this.goToNextSegmentOrFinish();
      });
    }
  }

  private async goToNextSegmentOrFinish(): Promise<void> {
    if (!this.lesson || !this.currentSegment || this.state === 'saving' || this.studentAdvanceInFlight) return;
    this.studentAdvanceInFlight = true;

    try {
      this.clearTimer();
      this.captureCurrentSegmentQuality();
      this.stopStudentSpeechRecognition(true);
      this.stopVisualizer();
      this.pauseStudentRecordingCapture();
      const completedPosition = this.currentSegmentIndex + 1;

      const saved = await this.saveStageProgressIfNeeded(completedPosition);
      if (!saved) return;

      const nextIndex = this.currentSegmentIndex + 1;
      if (nextIndex < this.lesson.segments.length) {
        await this.loadSegment(nextIndex);
        await this.waitForMediaReady();
        await this.playCurrentTeacherSegment();
        return;
      }

      await this.finishRepetition();
    } finally {
      this.studentAdvanceInFlight = false;
    }
  }

  private async saveStageProgressIfNeeded(position: number): Promise<boolean> {
    if (position <= this.completedSegments) return true;
    if (position !== this.completedSegments + 1) {
      this.error = 'لا يمكن حفظ التقدم خارج ترتيب الجمل. ارجع للجملة التالية غير المكتملة.';
      return false;
    }

    const previousState = this.state;
    this.state = 'saving';
    const started = performance.now();
    this.log('Progress.Save.Start', {
      slotId: this.slotId,
      reviewMode: this.reviewMode,
      position,
    });

    try {
      await this.ensureCsrf();
      if (this.reviewMode) {
        const result = await firstValueFrom(this.api.shadowingReviewProgress(this.slotId, position));
        this.completedSegments = result.completed;
        this.stageComplete = result.isComplete;
      } else {
        const result = await firstValueFrom(this.api.save(this.slotId, position));
        this.completedSegments = result.completedSegments;
        this.stageComplete = result.isComplete;
      }

      this.log('Progress.Save.Success', {
        slotId: this.slotId,
        reviewMode: this.reviewMode,
        position,
        completedSegments: this.completedSegments,
        stageComplete: this.stageComplete,
        durationMs: this.elapsed(started),
      });
      this.state = previousState === 'student' ? 'student' : previousState;
      return true;
    } catch (error) {
      const status = (error as { status?: number }).status ?? null;
      if (status === 400) this.csrfReady = false;
      this.state = 'student';
      this.error = status === 409
        ? 'تغير تقدم الدرس. حدّث الصفحة ثم أكمل من آخر جملة محفوظة.'
        : 'تعذر حفظ التقدم. حاول مرة أخرى قبل الانتقال.';
      this.logError('Progress.Save.Failed', error, {
        slotId: this.slotId,
        reviewMode: this.reviewMode,
        position,
        status,
        durationMs: this.elapsed(started),
      });
      return false;
    }
  }

  private async finishRepetition(): Promise<void> {
    this.state = 'saving';
    const recording = await this.stopLocalRecording(true);
    if (recording) {
      await this.addLocalRecording(recording);
    }

    const repetitionScore = this.currentRepetitionSegmentScores.length
      ? Math.round(
          this.currentRepetitionSegmentScores.reduce((sum, score) => sum + score, 0) /
            this.currentRepetitionSegmentScores.length,
        )
      : null;
    if (repetitionScore !== null) this.shadowingRepetitionScores.push(repetitionScore);
    this.sessionCompletedInThisRun += 1;

    this.log('Repetition.Success', {
      slotId: this.slotId,
      repetition: this.sessionCompletedInThisRun,
      target: this.sessionTargetForThisRun,
      speechMatchScore: repetitionScore,
      recordingCreated: Boolean(recording),
    });

    if (this.stopAfterCurrentRepetition) {
      await this.finishSession();
      return;
    }

    if (this.sessionCompletedInThisRun < this.sessionTargetForThisRun) {
      this.state = 'between';
      this.scheduleActiveTimer(900, () => {
        void this.startNextRepetitionInSession();
      });
      return;
    }

    await this.finishSession();
  }

  private async finishSession(): Promise<void> {
    this.sessionStarted = false;
    this.sessionTrainingFinishedAtMs = Date.now();
    this.state = 'finished';
    this.isCompletionModalOpen = true;
    this.currentKaraokeIndex = -1;
    this.stopVisualizer();
    this.stopTeacherVisualizer();
    this.stopTracks();
    this.completionReportSaved = false;
    this.completionReportError = '';

    // Completion is a student UI state, not a network state. Render it immediately
    // even when the report endpoint is slow, unavailable, or not registered yet.
    this.refreshView();
    if (this.stageComplete) void this.saveCompletionReport();
    this.log('Session.Completed', {
      slotId: this.slotId,
      reviewMode: this.reviewMode,
      repetitions: this.sessionCompletedInThisRun,
      averageSpeechMatchScore: this.completionMatchScore,
      bestSpeechMatchScore: this.completionBestRepetitionScore,
      completedSegments: this.completedSegments,
      stageComplete: this.stageComplete,
    });
  }

  async retryCompletionReport(): Promise<void> {
    if (!this.stageComplete || this.completionReportSaving) return;
    await this.saveCompletionReport();
  }

  private async prefetchNextSegment(): Promise<void> {
    const nextIndex = this.currentSegmentIndex + 1;
    if (!this.lesson || nextIndex >= this.lesson.segments.length) return;
    const position = nextIndex + 1;
    if (this.lesson.segments[nextIndex].loaded || this.prefetchedSegments.has(position)) return;

    const started = performance.now();
    try {
      const segment = await firstValueFrom(this.api.segment(this.slotId, position));
      const extended = segment as Segment & {
        translation?: string | null;
        ipa?: string | null;
        pronunciationHint?: string | null;
      };
      const view: ShadowingSegment = {
        ...segment,
        translation: extended.translation ?? null,
        ipa: extended.ipa ?? null,
        pronunciationHint: extended.pronunciationHint ?? null,
        start: 0,
        end: 0,
        loaded: true,
      };
      this.prefetchedSegments.set(position, view);
      this.releaseNextAudioPreloader();
      const preloader = new Audio();
      preloader.preload = 'auto';
      preloader.src = segment.audioUrl;
      preloader.load();
      this.nextAudioPreloader = preloader;
      this.log('Segment.Prefetch.Success', {
        slotId: this.slotId,
        position,
        mode: 'audio-buffer',
        durationMs: this.elapsed(started),
      });
    } catch (error) {
      this.prefetchedSegments.delete(position);
      this.logError('Segment.Prefetch.Failed', error, {
        slotId: this.slotId,
        position,
        durationMs: this.elapsed(started),
      });
    }
  }

  private async saveCompletionReport(): Promise<void> {
    if (!this.stageComplete || !this.lesson || this.completionReportSaving) return;
    const started = performance.now();
    if (!this.completionRequestId) {
      this.completionRequestId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : '00000000-0000-4000-8000-' + Date.now().toString().slice(-12).padStart(12, '0');
    }
    const requestId = this.completionRequestId;
    const latestRecording = this.recordings[0]?.blob ?? null;
    this.completionReportSaving = true;
    this.completionReportError = '';
    this.refreshView();
    try {
      await this.ensureCsrf();
      const result = await firstValueFrom(this.reportingApi.saveCompletion(this.slotId, {
        requestId,
        reviewMode: this.reviewMode,
        repetitions: Math.max(1, this.sessionCompletedInThisRun),
        trainingSeconds: Math.max(0, Math.round((Date.now() - this.sessionTrainingStartedAtMs) / 1000)),
        averageSpeechMatchScore: this.completionMatchScore,
        bestSpeechMatchScore: this.completionBestRepetitionScore,
        speechRecognitionSupported: this.studentSpeechRecognitionSupported,
      }, latestRecording));
      this.completionReportSaved = result.saved;
      this.log('CompletionReport.Save.Success', {
        slotId: this.slotId,
        reviewMode: this.reviewMode,
        recordingSaved: result.recordingSaved,
        durationMs: this.elapsed(started),
      });
    } catch (error) {
      const response = error as { status?: number; error?: { error?: string } };
      const status = response.status ?? null;
      if (status === 400) this.csrfReady = false;
      this.completionReportSaved = false;
      this.completionReportError = status === 409 && response.error?.error === 'completion_report_limit'
        ? 'completion_report_limit'
        : 'completion_sync_failed';
      this.logError('CompletionReport.Save.Failed', error, {
        slotId: this.slotId,
        reviewMode: this.reviewMode,
        status,
        durationMs: this.elapsed(started),
      });
    } finally {
      this.completionReportSaving = false;
      this.refreshView();
    }
  }

  private async ensureCsrf(): Promise<void> {
    if (this.csrfReady) return;
    if (!this.csrfRequest) {
      this.csrfRequest = firstValueFrom(this.auth.csrf())
        .then(() => { this.csrfReady = true; })
        .finally(() => { this.csrfRequest = null; });
    }
    await this.csrfRequest;
  }

  private async ensureMicStream(reportError = true): Promise<boolean> {
    if (this.micStream?.active) return true;
    if (!this.micStreamRequest) {
      this.micStreamRequest = this.openMicStream(reportError)
        .finally(() => { this.micStreamRequest = null; });
    }
    return this.micStreamRequest;
  }

  private async openMicStream(reportError: boolean): Promise<boolean> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('media_devices_unavailable');
      }
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const track = this.micStream.getAudioTracks()[0];
      this.microphoneSettingsLabel = track?.label?.trim()
        ? `${track.label} · جاهز للتدريب`
        : 'الميكروفون جاهز للتدريب.';
      this.showMicPermissionBanner = false;
      this.log('Microphone.Ready', {
        slotId: this.slotId,
        tracks: this.micStream.getAudioTracks().length,
      });
      return true;
    } catch (error) {
      this.showMicPermissionBanner = true;
      if (reportError) {
        this.error = 'تعذر فتح الميكروفون. اسمح باستخدامه من إعدادات المتصفح ثم حاول مرة أخرى.';
      }
      this.logError('Microphone.Failed', error, { slotId: this.slotId });
      return false;
    }
  }

  private async checkMicrophonePermission(): Promise<void> {
    try {
      const permissions = navigator.permissions as Permissions & {
        query(permissionDesc: PermissionDescriptor | { name: 'microphone' }): Promise<PermissionStatus>;
      };
      const status = await permissions.query({ name: 'microphone' });
      this.showMicPermissionBanner = status.state === 'denied';
    } catch {
      this.showMicPermissionBanner = false;
    }
  }

  private async ensureStudentRecordingActive(): Promise<boolean> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return this.startLocalRecording();
    }
    if (this.mediaRecorder.state === 'paused') this.resumeStudentRecordingCapture();
    return this.mediaRecorder.state === 'recording';
  }

  private async startLocalRecording(): Promise<boolean> {
    const ready = await this.ensureMicStream();
    if (!ready || !this.micStream || typeof MediaRecorder === 'undefined') return false;

    try {
      this.activeRecordingChunks = [];
      this.recordingAccumulatedMs = 0;
      this.recordingMimeType = this.pickRecordingMimeType();
      const options = this.recordingMimeType ? { mimeType: this.recordingMimeType } : undefined;
      this.mediaRecorder = new MediaRecorder(this.micStream, options);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.activeRecordingChunks.push(event.data);
      };
      this.mediaRecorder.onerror = (event) => {
        this.logError('Recording.Runtime.Failed', event, {
          slotId: this.slotId,
          repetition: this.currentRepetitionNumber,
        });
      };
      // Start only when the student's first turn begins. This avoids start->pause races.
      this.mediaRecorder.start(250);
      this.recordingStartedAt = Date.now();
      this.recordingSliceStartedAt = this.recordingStartedAt;
      this.log('Recording.Start.Success', {
        slotId: this.slotId,
        repetition: this.currentRepetitionNumber,
        mimeType: this.mediaRecorder.mimeType || this.recordingMimeType || 'browser-default',
        mode: 'student-microphone-only',
        microphoneTracks: this.micStream.getAudioTracks().length,
      });
      return true;
    } catch (error) {
      this.error = 'تعذر بدء تسجيل صوتك. تحقق من إذن الميكروفون ثم حاول مرة أخرى.';
      this.logError('Recording.Start.Failed', error, {
        slotId: this.slotId,
        repetition: this.currentRepetitionNumber,
      });
      return false;
    }
  }

  private pauseStudentRecordingCapture(): void {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state !== 'recording') return;
    this.accumulateRecordingSlice();
    try {
      recorder.requestData();
      recorder.pause();
      this.log('Recording.Pause', { slotId: this.slotId, position: this.currentSegment?.position ?? null });
    } catch (error) {
      this.logError('Recording.Pause.Failed', error, { slotId: this.slotId });
    }
  }

  private resumeStudentRecordingCapture(): void {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state !== 'paused') return;
    try {
      recorder.resume();
      this.recordingSliceStartedAt = Date.now();
      this.log('Recording.Resume', { slotId: this.slotId, position: this.currentSegment?.position ?? null });
    } catch (error) {
      this.logError('Recording.Resume.Failed', error, { slotId: this.slotId });
    }
  }

  private stopLocalRecording(keep: boolean): Promise<LocalRecordingView | null> {
    return new Promise((resolve) => {
      const recorder = this.mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const durationMs = Math.max(0, this.recordingAccumulatedMs);
        let result: LocalRecordingView | null = null;
        if (keep && this.activeRecordingChunks.length) {
          const blob = new Blob(this.activeRecordingChunks, {
            type: this.recordingMimeType || recorder.mimeType || 'audio/webm',
          });
          result = {
            meta: {
              id: `shadowing-local-${Date.now()}-${this.currentRepetitionNumber}`,
              repetitionFrom: this.currentRepetitionNumber,
              countsTowardProgress: !this.reviewMode && !(this.overview?.isComplete ?? false) && this.currentRepetitionNumber === 1,
              durationLabel: this.formatDurationSeconds(durationMs / 1000),
              createdAt: new Date().toISOString(),
              includesTeacher: false,
            },
            url: URL.createObjectURL(blob),
            blob,
          };
        }
        this.activeRecordingChunks = [];
        this.mediaRecorder = null;
        this.recordingAccumulatedMs = 0;
        this.recordingSliceStartedAt = 0;
        resolve(result);
      };

      if (recorder.state === 'recording') {
        this.accumulateRecordingSlice();
        try { recorder.requestData(); } catch { /* best effort */ }
      }
      recorder.stop();
    });
  }

  private accumulateRecordingSlice(): void {
    if (this.recordingSliceStartedAt <= 0) return;
    this.recordingAccumulatedMs += Math.max(0, Date.now() - this.recordingSliceStartedAt);
    this.recordingSliceStartedAt = 0;
  }


  private pickRecordingMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
  }

  private async startMicVisualizer(stream: MediaStream, resetElapsed = true): Promise<void> {
    this.stopVisualizer(resetElapsed);
    const AudioContextConstructor = window.AudioContext;
    this.audioContext = new AudioContextConstructor();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.68;
    await this.audioContext.resume();
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);
    const timeData = new Uint8Array(this.analyser.frequencyBinCount);
    const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.lastStudentWaveUiAt = 0;

    const animate = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(timeData);
      let sum = 0;
      for (const value of timeData) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / timeData.length);
      const rawLevel = Math.round(Math.min(100, Math.max(0, (rms - 0.012) * 620)));
      this.voiceLevel = rawLevel < 8 ? 0 : rawLevel;
      this.hasMicSignal = this.voiceLevel >= 8;

      const now = Date.now();
      // Updating 42 bars at 60fps is unnecessary. 20fps is visually smooth and
      // keeps Angular change detection light while silence detection stays 60fps.
      if (now - this.lastStudentWaveUiAt >= 50) {
        this.lastStudentWaveUiAt = now;
        this.analyser.getByteFrequencyData(frequencyData);
        const visualEnergy = Math.max(0, Math.min(1, rms * 7));
        this.voiceBars = this.voiceBars.map((_, index) => {
          const bin = Math.min(
            frequencyData.length - 1,
            Math.floor((index / Math.max(1, this.voiceBars.length - 1)) * (frequencyData.length - 1)),
          );
          const spectral = frequencyData[bin] / 255;
          const energy = Math.max(spectral, visualEnergy);
          if (energy < 0.015) return this.createSilentBar(index, this.voiceBars.length);
          const height = 8 + Math.pow(energy, 0.72) * 70;
          return Math.max(8, Math.min(78, Math.round(height)));
        });
        this.refreshView();
      }

      if (this.state === 'student' && this.studentTurnStartedAt > 0) {
        this.studentTurnElapsedSeconds = Math.max(
          0,
          Math.floor(
            (this.studentTurnElapsedBeforePauseMs + now - this.studentTurnStartedAt) / 1000,
          ),
        );

        if (!this.studentTurnTimeLimitEnabled && this.autoAdvanceEnabled) {
          if (this.hasMicSignal) {
            if (!this.studentVoiceDetected) {
              this.studentVoiceDetected = true;
              this.studentFirstVoiceAt = now;
            }
            this.studentLastVoiceAt = now;
          } else if (
            this.shouldAutoAdvanceAfterStudentSilence(now) &&
            !this.studentAdvanceInFlight
          ) {
            this.log('Student.Turn.SilenceDetected', {
              slotId: this.slotId,
              position: this.currentSegment?.position ?? null,
              silenceMs: now - this.studentLastVoiceAt,
            });
            void this.goToNextSegmentOrFinish();
          }
        }
      }
      this.visualizerFrameId = window.requestAnimationFrame(animate);
    };
    animate();
  }

  private shouldAutoAdvanceAfterStudentSilence(now: number): boolean {
    if (
      !this.studentVoiceDetected ||
      this.studentFirstVoiceAt <= 0 ||
      this.studentLastVoiceAt <= 0 ||
      this.studentTurnStartedAt <= 0
    ) {
      return false;
    }

    const voiceSpanMs = this.studentLastVoiceAt - this.studentFirstVoiceAt;
    const turnMs = now - this.studentTurnStartedAt;
    const silenceMs = now - this.studentLastVoiceAt;
    return (
      voiceSpanMs >= this.studentMinimumVoiceSpanMs &&
      turnMs >= this.studentMinimumTurnMs &&
      silenceMs >= this.studentSilenceAutoAdvanceMs
    );
  }

  private async startTeacherVisualizer(): Promise<void> {
    const media = this.mediaPlayer?.nativeElement;
    if (!media || typeof AudioContext === 'undefined') return;

    try {
      if (!this.teacherAudioContext) {
        this.teacherAudioContext = new AudioContext();
        this.teacherAnalyser = this.teacherAudioContext.createAnalyser();
        this.teacherAnalyser.fftSize = 128;
        this.teacherAnalyser.smoothingTimeConstant = 0.72;
        this.teacherGainNode = this.teacherAudioContext.createGain();
        this.teacherMediaSource = this.teacherAudioContext.createMediaElementSource(media);
        this.teacherMediaSource.connect(this.teacherAnalyser);
        this.teacherAnalyser.connect(this.teacherGainNode);
        this.teacherGainNode.connect(this.teacherAudioContext.destination);
      }

      this.teacherGainNode!.gain.value = this.teacherMuted ? 0 : 1;
      media.muted = false;
      await this.teacherAudioContext.resume();

      if (this.teacherVisualizerFrameId !== null) {
        window.cancelAnimationFrame(this.teacherVisualizerFrameId);
      }

      const analyser = this.teacherAnalyser!;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const animate = () => {
        if (!this.teacherAnalyser || !(this.state === 'teacher' || this.manualPreviewActive)) return;
        this.teacherAnalyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        this.teacherWaveBars = this.teacherWaveBars.map((_, index) => {
          const value = Math.abs((data[index % data.length] - 128) / 128);
          const height = Math.round((value * 3 + rms * 2.2) * 78);
          return Math.max(8, Math.min(78, height));
        });
        this.teacherVisualizerFrameId = window.requestAnimationFrame(animate);
      };
      animate();
    } catch (error) {
      // Playback itself must keep working even if Web Audio analysis is unavailable.
      this.teacherWaveBars = Array.from({ length: 42 }, (_, index) => this.createSilentBar(index, 42));
      this.logError('Teacher.Waveform.Failed', error, {
        slotId: this.slotId,
        position: this.currentSegment?.position ?? null,
      });
    }
  }

  private stopTeacherVisualizer(resetBars = true): void {
    if (this.teacherVisualizerFrameId !== null) {
      window.cancelAnimationFrame(this.teacherVisualizerFrameId);
      this.teacherVisualizerFrameId = null;
    }
    if (resetBars) {
      this.teacherWaveBars = Array.from({ length: 42 }, (_, index) => this.createSilentBar(index, 42));
    }
  }

  private disposeTeacherAudioGraph(): void {
    this.stopTeacherVisualizer();
    this.teacherMediaSource?.disconnect();
    this.teacherAnalyser?.disconnect();
    this.teacherGainNode?.disconnect();
    this.teacherMediaSource = null;
    this.teacherAnalyser = null;
    this.teacherGainNode = null;
    if (this.teacherAudioContext) {
      void this.teacherAudioContext.close();
      this.teacherAudioContext = null;
    }
  }

  private stopVisualizer(resetElapsed = true): void {
    if (this.visualizerFrameId !== null) {
      window.cancelAnimationFrame(this.visualizerFrameId);
      this.visualizerFrameId = null;
    }
    this.analyser = null;
    this.hasMicSignal = false;
    this.voiceLevel = 0;
    if (resetElapsed) this.studentTurnElapsedSeconds = 0;
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.voiceBars = Array.from({ length: 42 }, (_, index) => this.createSilentBar(index, 42));
  }

  private stopMicrophoneTest(releaseMicrophone: boolean): void {
    if (this.microphoneTestTimerId !== null) {
      window.clearTimeout(this.microphoneTestTimerId);
      this.microphoneTestTimerId = null;
    }
    this.microphoneTestActive = false;
    this.microphoneTestStarting = false;
    this.stopVisualizer();
    if (releaseMicrophone) this.stopTracks();
  }

  private stopTracks(): void {
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
  }

  private startStudentSpeechRecognition(resetProgress: boolean): void {
    if (!this.currentSegment || this.state !== 'student') return;
    if (resetProgress) {
      this.studentRecognitionCommittedTokens = [];
      this.studentRecognitionSessionTranscript = '';
      this.studentLatestRecognizedTokens = [];
      this.resetStudentKaraokeState();
      this.clearStudentSpeechCompletionTimer();
    }

    this.clearStudentSpeechRecognitionRestart();
    const recognitionConstructor =
      (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).webkitSpeechRecognition;

    if (!recognitionConstructor) {
      this.studentSpeechRecognitionSupported = false;
      this.studentSpeechRecognitionShouldRun = false;
      return;
    }

    this.studentSpeechRecognitionSupported = true;
    this.studentSpeechRecognitionShouldRun = true;
    const generation = ++this.studentRecognitionGeneration;
    const recognition = new recognitionConstructor();
    this.studentSpeechRecognition = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      if (
        generation !== this.studentRecognitionGeneration ||
        !this.studentSpeechRecognitionShouldRun ||
        this.state !== 'student'
      ) {
        return;
      }
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.[0]?.transcript) transcript += ` ${result[0].transcript}`;
      }
      this.studentRecognitionSessionTranscript = transcript.trim();
      const liveTokens = [
        ...this.studentRecognitionCommittedTokens,
        ...this.normalizeSpeechTokens(this.studentRecognitionSessionTranscript),
      ];
      this.studentLatestRecognizedTokens = liveTokens;
      this.updateStudentKaraokeFromRecognizedTokens(liveTokens);
      const latest = event.results[event.results.length - 1];
      if (latest?.isFinal) this.maybeScheduleStudentSpeechCompletion(liveTokens, true);
    };

    recognition.onerror = (event) => {
      const reason = event.error ?? 'unknown';
      this.log('SpeechRecognition.Error', {
        slotId: this.slotId,
        position: this.currentSegment?.position ?? null,
        reason,
      });
      if (reason === 'not-allowed' || reason === 'service-not-allowed' || reason === 'audio-capture') {
        this.studentSpeechRecognitionShouldRun = false;
      }
    };

    recognition.onend = () => {
      if (generation !== this.studentRecognitionGeneration) return;
      this.commitStudentRecognitionSession();
      if (this.studentSpeechRecognition === recognition) this.studentSpeechRecognition = null;
      if (!this.studentSpeechRecognitionShouldRun || this.state !== 'student') return;
      this.studentSpeechRecognitionRestartId = window.setTimeout(() => {
        this.studentSpeechRecognitionRestartId = null;
        if (this.studentSpeechRecognitionShouldRun && this.state === 'student') {
          this.startStudentSpeechRecognition(false);
        }
      }, 200);
    };

    try {
      recognition.start();
    } catch (error) {
      this.logError('SpeechRecognition.Start.Failed', error, {
        slotId: this.slotId,
        position: this.currentSegment.position,
      });
    }
  }

  private stopStudentSpeechRecognition(resetProgress: boolean): void {
    this.studentSpeechRecognitionShouldRun = false;
    this.clearStudentSpeechRecognitionRestart();
    this.clearStudentSpeechCompletionTimer();
    this.commitStudentRecognitionSession();
    this.studentRecognitionGeneration += 1;
    const recognition = this.studentSpeechRecognition;
    this.studentSpeechRecognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // Browser may already have stopped recognition.
      }
    }
    if (resetProgress) {
      this.studentRecognitionCommittedTokens = [];
      this.studentRecognitionSessionTranscript = '';
      this.studentLatestRecognizedTokens = [];
      this.resetStudentKaraokeState();
    }
  }

  private clearStudentSpeechRecognitionRestart(): void {
    if (this.studentSpeechRecognitionRestartId !== null) {
      window.clearTimeout(this.studentSpeechRecognitionRestartId);
      this.studentSpeechRecognitionRestartId = null;
    }
  }

  private commitStudentRecognitionSession(): void {
    const transcript = this.studentRecognitionSessionTranscript.trim();
    if (!transcript) return;
    this.studentRecognitionCommittedTokens.push(...this.normalizeSpeechTokens(transcript));
    this.studentRecognitionSessionTranscript = '';
  }

  private resetStudentKaraokeState(): void {
    this.studentKaraokeWordStates = this.karaokeWords.map(() => 'pending');
    this.currentKaraokeIndex = -1;
  }

  private updateStudentKaraokeFromRecognizedTokens(spokenTokens: string[]): void {
    const expectedTokens = this.karaokeWords.map((word) => this.normalizeSpeechTokens(word)[0] ?? '');
    const states: StudentKaraokeWordState[] = expectedTokens.map(() => 'pending');
    let cursor = 0;

    for (let expectedIndex = 0; expectedIndex < expectedTokens.length; expectedIndex += 1) {
      const expected = expectedTokens[expectedIndex];
      if (!expected) continue;
      const spoken = spokenTokens[cursor];
      if (!spoken) break;
      if (spoken === expected) {
        states[expectedIndex] = 'matched';
        cursor += 1;
      } else {
        const foundAhead = spokenTokens.slice(cursor, cursor + 3).indexOf(expected);
        if (foundAhead >= 0) {
          states[expectedIndex] = 'matched';
          cursor += foundAhead + 1;
        } else {
          states[expectedIndex] = 'wrong';
          cursor += 1;
        }
      }
      this.currentKaraokeIndex = expectedIndex;
    }

    this.studentKaraokeWordStates = states;
  }

  private maybeScheduleStudentSpeechCompletion(spokenTokens: string[], finalResult: boolean): void {
    const expectedCount = this.karaokeWords.length;
    const minimumCaptured = Math.max(1, Math.ceil(expectedCount * 0.7));
    if (
      this.studentTurnTimeLimitEnabled ||
      !this.autoAdvanceEnabled ||
      this.state !== 'student' ||
      !finalResult ||
      spokenTokens.length < minimumCaptured
    ) {
      this.clearStudentSpeechCompletionTimer();
      return;
    }
    if (this.studentSpeechCompletionTimerId !== null) return;
    this.studentSpeechCompletionTimerId = window.setTimeout(() => {
      this.studentSpeechCompletionTimerId = null;
      if (this.state === 'student' && !this.studentTurnTimeLimitEnabled && this.autoAdvanceEnabled) {
        void this.goToNextSegmentOrFinish();
      }
    }, 900);
  }

  private clearStudentSpeechCompletionTimer(): void {
    if (this.studentSpeechCompletionTimerId !== null) {
      window.clearTimeout(this.studentSpeechCompletionTimerId);
      this.studentSpeechCompletionTimerId = null;
    }
  }

  private captureCurrentSegmentQuality(): void {
    if (this.state !== 'student') return;
    const score = this.currentSpeechMatchScore;
    if (score !== null) this.currentRepetitionSegmentScores.push(score);
  }

  private normalizeSpeechTokens(text: string): string[] {
    const rawTokens = text
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
    const expansions: Record<string, string[]> = {
      "i'm": ['i', 'am'],
      "you're": ['you', 'are'],
      "we're": ['we', 'are'],
      "they're": ['they', 'are'],
      "he's": ['he', 'is'],
      "she's": ['she', 'is'],
      "it's": ['it', 'is'],
      "don't": ['do', 'not'],
      "doesn't": ['does', 'not'],
      "can't": ['can', 'not'],
      "won't": ['will', 'not'],
    };
    return rawTokens.flatMap((token) => expansions[token] ?? [token]);
  }

  private getStudentTurnDurationMs(): number {
    const teacherMs = Math.max((this.currentSegment?.end ?? 0) * 1000, 1500);
    return Math.max(1500, teacherMs * this.studentDurationRatio);
  }

  private applyTeacherPlaybackRate(media: HTMLMediaElement): void {
    media.defaultPlaybackRate = this.teacherPlaybackRate;
    media.playbackRate = this.teacherPlaybackRate;
    if (this.teacherGainNode) {
      this.teacherGainNode.gain.value = this.teacherMuted ? 0 : 1;
      media.muted = false;
    } else {
      media.muted = this.teacherMuted;
    }
  }

  private prepareMediaSource(url: string): void {
    this.mediaLoadGeneration += 1;
    this.mediaUrl = url;
    this.mediaReady = false;

    const media = this.mediaPlayer?.nativeElement;
    if (media) {
      this.applyMediaSourceToElement(media, this.mediaLoadGeneration);
    } else {
      this.log('Media.Source.Pending', {
        slotId: this.slotId,
        position: this.currentSegment?.position ?? null,
        generation: this.mediaLoadGeneration,
      });
    }
  }

  private applyMediaSourceToElement(media: HTMLMediaElement, generation: number): void {
    if (generation !== this.mediaLoadGeneration) return;
    const generationKey = String(generation);
    if (media.dataset['shadowingLoadGeneration'] === generationKey) return;

    media.pause();
    media.dataset['shadowingLoadGeneration'] = generationKey;
    media.src = this.mediaUrl;
    media.currentTime = 0;
    media.load();

    this.log('Media.Source.Set', {
      slotId: this.slotId,
      position: this.currentSegment?.position ?? null,
      generation,
    });
  }

  private async waitForMediaReady(expectedGeneration = this.mediaLoadGeneration): Promise<void> {
    if (expectedGeneration !== this.mediaLoadGeneration) {
      throw new Error('media_source_changed');
    }
    if (this.mediaReady) return;

    const media = this.mediaPlayer?.nativeElement;
    if (!media) return;

    this.applyMediaSourceToElement(media, expectedGeneration);

    if (media.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(media.duration)) {
      this.onMediaMetadataLoaded();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('media_metadata_timeout'));
      }, 5000);

      const ready = () => {
        if (expectedGeneration !== this.mediaLoadGeneration) {
          cleanup();
          reject(new Error('media_source_changed'));
          return;
        }
        cleanup();
        if (!this.mediaReady) this.onMediaMetadataLoaded();
        resolve();
      };

      const failed = () => {
        cleanup();
        reject(new Error('media_metadata_failed'));
      };

      const cleanup = () => {
        window.clearTimeout(timer);
        media.removeEventListener('loadedmetadata', ready);
        media.removeEventListener('error', failed);
      };

      media.addEventListener('loadedmetadata', ready, { once: true });
      media.addEventListener('error', failed, { once: true });
    });
  }

  private scheduleActiveTimer(durationMs: number, callback: () => void): void {
    this.clearTimer();
    this.activeTimerCallback = callback;
    this.activeTimerRemainingMs = Math.max(0, durationMs);
    this.activeTimerStartedAt = Date.now();
    this.activeTimerId = window.setTimeout(() => {
      const next = this.activeTimerCallback;
      this.clearTimer();
      next?.();
    }, this.activeTimerRemainingMs);
  }

  private clearTimer(): void {
    if (this.activeTimerId !== null) window.clearTimeout(this.activeTimerId);
    this.activeTimerId = null;
    this.activeTimerCallback = null;
    this.activeTimerRemainingMs = 0;
    this.activeTimerStartedAt = 0;
  }

  private pauseActiveTimer(): void {
    if (!this.activeTimerCallback) return;
    if (this.activeTimerId !== null) {
      window.clearTimeout(this.activeTimerId);
      this.activeTimerId = null;
    }
    if (this.activeTimerStartedAt > 0) {
      this.activeTimerRemainingMs = Math.max(
        0,
        this.activeTimerRemainingMs - (Date.now() - this.activeTimerStartedAt),
      );
    }
    this.activeTimerStartedAt = 0;
  }

  private resumeActiveTimer(): void {
    if (!this.activeTimerCallback || this.activeTimerId !== null) return;
    const callback = this.activeTimerCallback;
    this.activeTimerStartedAt = Date.now();
    this.activeTimerId = window.setTimeout(() => {
      this.clearTimer();
      callback();
    }, this.activeTimerRemainingMs);
  }

  private restoreSettings(): void {
    this.teacherPlaybackRate = this.readStoredNumber(this.teacherPlaybackRateStorageKey, 0.5, 2, 1);
    this.studentDurationRatio = this.readStoredNumber(this.studentDurationRatioStorageKey, 0.6, 1.5, 1);
    this.sessionTargetRepetitions = Math.round(
      this.readStoredNumber(this.sessionTargetStorageKey, 1, 7, 1),
    );
    this.studentTurnTimeLimitEnabled = this.readStoredBoolean(this.studentTurnTimeLimitStorageKey, false);
    this.autoAdvanceEnabled = this.readStoredBoolean(this.autoAdvanceStorageKey, true);
    this.sentenceTranslationVisible = this.readStoredBoolean(this.translationStorageKey, true);
  }

  private readStoredNumber(key: string, minimum: number, maximum: number, fallback: number): number {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
  }

  private readStoredBoolean(key: string, fallback: boolean): boolean {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  }


  private createSilentBar(index: number, total: number): number {
    const center = (total - 1) / 2;
    const distance = Math.abs(index - center) / Math.max(1, center);
    return Math.max(6, Math.min(9, Math.round(6 + (1 - distance) * 3)));
  }

  private async addLocalRecording(recording: LocalRecordingView): Promise<void> {
    this.recordings.unshift(recording);
    while (this.recordings.length > 6) {
      const removed = this.recordings.pop();
      if (removed?.url) URL.revokeObjectURL(removed.url);
    }
    this.refreshView();
    await this.persistLocalRecording(recording);
  }

  private async persistLocalRecording(recording: LocalRecordingView): Promise<void> {
    try {
      await this.recordingStore.save({
        id: recording.meta.id,
        studentId: this.studentId,
        slotId: this.slotId,
        reviewMode: this.reviewMode,
        repetition: recording.meta.repetitionFrom,
        durationLabel: recording.meta.durationLabel,
        createdAt: recording.meta.createdAt,
        mimeType: recording.blob.type || 'audio/webm',
        blob: recording.blob,
      });
      this.log('Recording.LocalSave.Success', {
        slotId: this.slotId,
        recordingId: recording.meta.id,
        bytes: recording.blob.size,
      });
    } catch (error) {
      // Recording remains playable for the current page even when IndexedDB is unavailable.
      this.logError('Recording.LocalSave.Failed', error, {
        slotId: this.slotId,
        recordingId: recording.meta.id,
      });
    }
  }

  private async restoreLocalRecordings(): Promise<void> {
    try {
      const rows = await this.recordingStore.list(this.studentId, this.slotId, this.reviewMode);
      for (const recording of this.recordings) {
        if (recording.url) URL.revokeObjectURL(recording.url);
      }
      this.recordings = rows.map((row) => ({
        meta: {
          id: row.id,
          repetitionFrom: row.repetition,
          countsTowardProgress: false,
          durationLabel: row.durationLabel,
          createdAt: row.createdAt,
          includesTeacher: false,
        },
        url: URL.createObjectURL(row.blob),
        blob: row.blob,
      }));
      this.refreshView();
      this.log('Recording.LocalRestore.Success', { slotId: this.slotId, count: this.recordings.length });
    } catch (error) {
      this.logError('Recording.LocalRestore.Failed', error, { slotId: this.slotId });
    }
  }

  private releaseNextAudioPreloader(): void {
    if (!this.nextAudioPreloader) return;
    this.nextAudioPreloader.pause();
    this.nextAudioPreloader.removeAttribute('src');
    this.nextAudioPreloader.load();
    this.nextAudioPreloader = null;
  }

  get navigationBusy(): boolean {
    return this.segmentNavigationInProgress || this.studentAdvanceInFlight ||
      this.state === 'saving' || this.state === 'between';
  }

  formatDurationSeconds(totalSeconds: number): string {
    const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
    const minutes = String(Math.floor(safe / 60)).padStart(2, '0');
    const seconds = String(Math.floor(safe % 60)).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  private elapsed(started: number): number {
    return Math.round(performance.now() - started);
  }

  private refreshView(): void {
    if (this.destroyed) return;
    try {
      this.cdr.detectChanges();
    } catch {
      // The component may be between destroy phases; UI refresh is best-effort only.
    }
  }

  private log(event: string, data: Record<string, unknown> = {}): void {
    console.info(`[Student.Shadowing.${event}]`, data);
  }

  private logError(event: string, error: unknown, data: Record<string, unknown> = {}): void {
    console.warn(`[Student.Shadowing.${event}]`, {
      ...data,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : null,
    });
  }
}
