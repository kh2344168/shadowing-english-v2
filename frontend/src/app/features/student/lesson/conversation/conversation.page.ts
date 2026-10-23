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
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  AiMaterial,
  ConversationHistory,
  ConversationResult,
  StudentLearningApi,
} from '../../learning.api';
import { adjacentStage, stageAt, stageReady, stageReadyForStudent } from '../stage-flow';

type ConversationVoice = 'Kore' | 'Puck' | 'Aoede';
type ReportIssue = ConversationResult['issues'][number];

@Component({
  selector: 'app-student-conversation-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './conversation.page.html',
  styleUrl: './conversation.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentConversationPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly material = signal<AiMaterial | null>(null);
  readonly turnTarget = computed(
    () => this.history()?.turnTarget ?? this.material()?.conversationTurnTarget ?? 10,
  );
  readonly supportMode = computed(() => this.material()?.conversationSupportMode ?? null);
  readonly structured = computed(() => this.history()?.minTurns != null);
  readonly report = computed(() => this.history()?.report ?? null);
  readonly reportOpen = signal(false);
  readonly reportIssues = computed(() => {
    const log = this.history();
    const report = this.report();
    if (!report) return [];
    const all = [
      ...(log?.turns.flatMap((turn) => {
        const issues = turn.feedback.issues ?? [];
        if (issues.length || !turn.feedback.correction?.trim()) return issues;
        return [
          {
            original: turn.message,
            suggested: turn.feedback.correction,
            reason: turn.feedback.grammarTip || 'راجع الصياغة المرتبطة بالدرس',
            kind: turn.feedback.grammarTip ? 'grammar' : 'expression',
          },
        ];
      }) ?? []),
      ...report.issues,
    ];
    const seen = new Set<string>();
    return all.filter((issue) => {
      const key = `${issue.kind}|${issue.original.trim().toLowerCase()}|${issue.suggested.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  readonly grammarIssues = computed(() =>
    this.reportIssues().filter((issue) => this.issueGroup(issue) === 'grammar'),
  );
  readonly writingIssues = computed(() =>
    this.reportIssues().filter((issue) => this.issueGroup(issue) === 'writing'),
  );
  readonly vocabularyIssues = computed(() =>
    this.reportIssues().filter((issue) => this.issueGroup(issue) === 'vocabulary'),
  );
  readonly otherIssues = computed(() =>
    this.reportIssues().filter((issue) => this.issueGroup(issue) === 'other'),
  );
  readonly focusTenseLabel = computed(() => {
    const tense = this.material()?.conversationFocusTense;
    return tense
      ? tense
          .split('-')
          .map((part) => part[0].toUpperCase() + part.slice(1))
          .join(' ')
      : '';
  });
  readonly currentStage = computed(() => stageAt(this.material()?.stages, 'conversation'));
  readonly previousStage = computed(() =>
    adjacentStage(this.material()?.stages, 'conversation', -1),
  );
  readonly nextStage = computed(() => adjacentStage(this.material()?.stages, 'conversation', 1));
  readonly suggestions = computed(() =>
    (this.material()?.targetPhrases ?? []).filter((phrase) => phrase.trim().length > 0).slice(0, 3),
  );
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly reportDialog = viewChild<ElementRef<HTMLElement>>('reportDialog');
  readonly history = signal<ConversationHistory | null>(null);
  readonly completedReplies = computed(
    () => this.history()?.completedTurns ?? this.material()?.progress?.conversation ?? 0,
  );
  readonly missingSteps = computed(() => this.history()?.missingSteps ?? []);
  readonly showHelp = signal(false);
  readonly showExample = signal(false);
  readonly syncNeeded = signal(false);
  readonly dailyLimitReached = signal(false);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly speechNotice = signal('');
  readonly voices: { id: ConversationVoice; label: string }[] = [
    { id: 'Kore', label: 'كوري' },
    { id: 'Puck', label: 'باك' },
    { id: 'Aoede', label: 'أويدي' },
  ];
  readonly selectedVoice = signal<ConversationVoice>('Kore');
  readonly voicePickerOpen = signal(false);
  readonly viewportHeight = signal<number | null>(null);
  readonly voiceNotice = signal('');
  readonly recording = signal(false);
  readonly requestingMicrophone = signal(false);
  readonly recordingSeconds = signal(0);
  readonly microphoneLevel = signal(0);
  readonly monitoringAudio = signal(false);
  readonly transcribing = signal(false);
  readonly microphoneSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';
  message = '';
  retrySentence = '';
  readonly retryComparisonVisible = signal(false);
  private pendingId = '';
  private pendingMessage = '';
  private recorder: MediaRecorder | null = null;
  private microphone: MediaStream | null = null;
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private audioContext: AudioContext | null = null;
  private recordingRequest = 0;
  private audio: HTMLAudioElement | null = null;
  private destroyed = false;
  private readonly syncViewportHeight = (): void => {
    if (typeof window === 'undefined') return;
    this.viewportHeight.set(window.visualViewport?.height ?? window.innerHeight);
  };

  ngOnInit(): void {
    this.syncViewportHeight();
    window.visualViewport?.addEventListener('resize', this.syncViewportHeight);
    window.addEventListener('resize', this.syncViewportHeight);
    try {
      const saved = localStorage.getItem('student-conversation-voice');
      if (this.voices.some((voice) => voice.id === saved))
        this.selectedVoice.set(saved as ConversationVoice);
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
    void this.load();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    window.visualViewport?.removeEventListener('resize', this.syncViewportHeight);
    window.removeEventListener('resize', this.syncViewportHeight);
    this.cancelRecording();
    this.audio?.pause();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (
        (!stageReady(data, 'conversation') &&
          !(await stageReadyForStudent(this.api, this.slotId, data, 'conversation'))) ||
        (!data.stages && !data.completed.quiz)
      ) {
        this.material.set(null);
        this.error.set('أكمل المراحل السابقة قبل المحادثة.');
      } else {
        this.material.set(data);
        const history = await firstValueFrom(this.api.conversationHistory(this.slotId));
        this.history.set(history);
        if (history.report) this.openReport();
        this.dailyLimitReached.set(history.remainingToday < 1);
        this.showHelp.set(false);
        this.showExample.set(false);
        if (this.syncNeeded()) {
          this.message = '';
          this.pendingId = '';
          this.pendingMessage = '';
          this.syncNeeded.set(false);
        }
        this.scrollToLatest();
      }
    } catch (ex) {
      this.error.set(
        (ex as { status?: number }).status === 404
          ? 'المحادثة لم تُنشر لهذا الدرس بعد.'
          : 'تعذر تحميل المحادثة.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  async send(): Promise<void> {
    const text = this.message.trim(),
      history = this.history();
    if (
      !this.material() ||
      !history ||
      this.busy() ||
      this.syncNeeded() ||
      this.recording() ||
      this.requestingMicrophone() ||
      this.transcribing() ||
      !text ||
      text.length > 400 ||
      history.remainingToday < 1 ||
      this.dailyLimitReached() ||
      !!history.report ||
      this.completedReplies() >= this.turnTarget()
    )
      return;
    this.busy.set(true);
    this.error.set('');
    if (!this.pendingId || this.pendingMessage !== text) {
      this.pendingId = crypto.randomUUID();
      this.pendingMessage = text;
    }
    let sent = false;
    try {
      await firstValueFrom(this.auth.csrf());
      await firstValueFrom(this.api.conversationTurn(this.slotId, text, this.pendingId));
      sent = true;
      const updated = await firstValueFrom(this.api.conversationHistory(this.slotId));
      this.history.set(updated);
      if (updated.report) this.openReport();
      this.dailyLimitReached.set(updated.remainingToday < 1);
      this.pendingId = '';
      this.pendingMessage = '';
      this.message = '';
      this.showHelp.set(false);
      this.showExample.set(false);
      this.scrollToLatest();
      const latest = updated.turns.at(-1);
      if (latest?.id) void this.playReply(latest.id, true);
    } catch (ex) {
      const failure = ex as { status?: number; error?: { error?: string } };
      const status = failure.status;
      if (sent) {
        this.syncNeeded.set(true);
        this.error.set('اترسل ردك، لكن تعذر تحديث السجل. اضغط تحديث قبل إرسال رد جديد.');
      } else if (status === 429) {
        this.dailyLimitReached.set(true);
        this.error.set('وصلت للحد اليومي للذكاء الاصطناعي. تقدر تكمل المحادثة يومًا آخر.');
      } else if (status === 409) {
        this.error.set(
          failure.error?.error === 'conversation_timed_out'
            ? 'نسخة السيرفر الحالية أوقفت المحادثة بسبب الخمول. يلزم إعادة تشغيل الـbackend لتطبيق الإصلاح، ثم اضغط تحديث السجل.'
            : failure.error?.error === 'conversation_complete'
              ? 'المرحلة مكتملة بالفعل. حدّث السجل لعرض تقدمك.'
              : 'قد يكون الرد قيد المعالجة. انتظر قليلًا ثم حدّث السجل قبل المحاولة.',
        );
      } else {
        this.error.set(
          status === 503
            ? 'خدمات الذكاء الاصطناعي مش متاحة حاليًا. اكتب ردك وجرّب لاحقًا.'
            : 'لم نتمكن من إرسال الرسالة. يمكنك المحاولة بنفس الرد أو تحديث السجل.',
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  async finish(): Promise<void> {
    if (
      !this.structured() ||
      this.report() ||
      this.busy() ||
      this.syncNeeded() ||
      this.recording() ||
      this.requestingMicrophone() ||
      this.transcribing()
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.auth.csrf());
      await firstValueFrom(this.api.finishConversation(this.slotId));
      const finished = await firstValueFrom(this.api.conversationHistory(this.slotId));
      this.history.set(finished);
      if (finished.report) this.openReport();
    } catch {
      this.error.set('تعذر إنهاء المحادثة الآن. حدّث السجل وحاول مجددًا.');
    } finally {
      this.busy.set(false);
    }
  }

  insertSuggestion(phrase: string): void {
    this.message = phrase;
    document.getElementById('student-message')?.focus();
  }

  toggleHelp(): void {
    this.showHelp.update((shown) => !shown);
  }

  toggleExample(): void {
    this.showExample.update((shown) => !shown);
  }

  async toggleRecording(): Promise<void> {
    if (this.recording()) {
      if (this.recorder?.state === 'recording') this.recorder.stop();
      return;
    }
    if (
      this.requestingMicrophone() ||
      this.busy() ||
      this.transcribing() ||
      this.syncNeeded() ||
      this.dailyLimitReached() ||
      this.report() ||
      (this.history()?.remainingToday ?? 0) < 1 ||
      this.completedReplies() >= this.turnTarget()
    )
      return;
    if (!this.microphoneSupported) {
      this.voiceNotice.set('الميكروفون غير مدعوم هنا. جرّب Chrome عبر اتصال آمن، أو اكتب ردك.');
      return;
    }
    const request = ++this.recordingRequest;
    this.requestingMicrophone.set(true);
    this.audio?.pause();
    try {
      this.voiceNotice.set('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.destroyed || request !== this.recordingRequest) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.microphone = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (request !== this.recordingRequest) return;
        this.cancelRecording();
        this.voiceNotice.set('توقف التسجيل بسبب مشكلة في الميكروفون. جرّب مرة أخرى أو اكتب ردك.');
      };
      recorder.onstop = () => {
        if (this.destroyed || request !== this.recordingRequest) return;
        this.releaseMicrophone();
        if (chunks.length) {
          const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          void this.transcribe(audio);
        } else {
          this.voiceNotice.set('لم يتم التقاط تسجيل. جرّب مرة أخرى أو اكتب ردك.');
        }
      };
      recorder.start();
      this.recording.set(true);
      this.recordingSeconds.set(0);
      this.startAudioMeter(stream);
      this.recordingTimer = setTimeout(() => {
        if (this.recorder?.state === 'recording') this.recorder.stop();
      }, 15000);
    } catch (ex) {
      if (request !== this.recordingRequest || this.destroyed) return;
      this.releaseMicrophone();
      const name = (ex as { name?: string }).name;
      this.voiceNotice.set(
        name === 'NotAllowedError'
          ? 'السماح بالميكروفون مرفوض. افتح أذونات الموقع واسمح بالميكروفون، أو اكتب ردك.'
          : name === 'NotFoundError'
            ? 'لم يتم العثور على ميكروفون. وصّل ميكروفونًا أو اكتب ردك.'
            : 'تعذر تشغيل الميكروفون. تأكد أنه متصل وغير مستخدم في تطبيق آخر.',
      );
    } finally {
      if (request === this.recordingRequest) this.requestingMicrophone.set(false);
    }
  }

  cancelRecording(): void {
    this.recordingRequest++;
    this.requestingMicrophone.set(false);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.releaseMicrophone();
  }

  private releaseMicrophone(): void {
    if (this.recordingTimer) clearTimeout(this.recordingTimer);
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.recordingTimer = this.meterTimer = null;
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.microphone = null;
    this.recorder = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.recording.set(false);
    this.monitoringAudio.set(false);
    this.microphoneLevel.set(0);
  }

  private startAudioMeter(stream: MediaStream): void {
    let analyser: AnalyserNode | undefined;
    try {
      const context = new AudioContext();
      this.audioContext = context;
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      // Never connect to the speakers: that would feed the student's voice back.
      void context.resume().catch(() => this.monitoringAudio.set(false));
      this.monitoringAudio.set(true);
    } catch {
      // Recording still works in browsers that cannot expose a live audio meter.
      this.monitoringAudio.set(false);
    }
    const samples = new Uint8Array(256);
    const started = Date.now();
    this.meterTimer = setInterval(() => {
      this.recordingSeconds.set(Math.floor((Date.now() - started) / 1000));
      if (!analyser) return;
      analyser.getByteTimeDomainData(samples);
      const energy = samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0);
      this.microphoneLevel.set(Math.min(100, Math.round(Math.sqrt(energy / samples.length) * 400)));
    }, 100);
  }

  private async transcribe(audio: Blob): Promise<void> {
    if (audio.size < 100 || audio.size > 2_000_000) {
      this.voiceNotice.set(
        audio.size < 100
          ? 'التسجيل قصير جدًا. سجّل ردك ثم اضغط إيقاف.'
          : 'التسجيل كبير جدًا. حاول تسجيل رد أقصر.',
      );
      return;
    }
    this.transcribing.set(true);
    this.voiceNotice.set('جاري تحويل كلامك إلى نص...');
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(this.api.transcribeConversation(this.slotId, audio));
      if (this.destroyed) return;
      if (!result.text?.trim()) {
        this.voiceNotice.set('لم نسمع كلامًا واضحًا. قرّب الميكروفون وحاول مرة أخرى أو اكتب ردك.');
        return;
      }
      this.message = result.text.trim();
      this.voiceNotice.set('راجع النص ثم اضغط إرسال ليجيبك المعلم الذكي.');
    } catch (ex) {
      const failure = ex as { status?: number; error?: { error?: string } };
      this.voiceNotice.set(
        failure.error?.error === 'voice_not_configured'
          ? 'خدمة تحويل التسجيل لنص غير مفعّلة. اطلب من المدرّس تفعيل مزوّد الصوت Groq، ويمكنك الكتابة الآن.'
          : failure.error?.error === 'daily_voice_limit'
            ? 'وصلت لحصة تحويل الصوت اليومية. يمكنك كتابة ردك الآن وتجربة الصوت غدًا.'
          : failure.status === 429
            ? 'طلبات الصوت كثيرة في وقت قصير. انتظر قليلًا أو اكتب ردك.'
            : failure.status === 503
              ? 'خدمة تحويل الصوت غير متاحة الآن. حاول لاحقًا أو اكتب ردك.'
              : 'تعذر فهم التسجيل. حاول مرة أخرى أو اكتب ردك.',
      );
    } finally {
      this.transcribing.set(false);
    }
  }

  async playReply(turnId?: string, automatic = false): Promise<void> {
    if (this.recording() || this.requestingMicrophone()) return;
    this.audio?.pause();
    const audio = new Audio(
      this.api.conversationAudioUrl(this.slotId, this.selectedVoice(), turnId),
    );
    this.audio = audio;
    audio.onerror = () => {
      if (this.audio === audio)
        this.speechNotice.set('الصوت غير متاح الآن. الرد المكتوب موجود أمامك.');
    };
    try {
      await audio.play();
      if (this.audio === audio) this.speechNotice.set('');
    } catch {
      if (this.audio === audio)
        this.speechNotice.set(
          automatic
            ? 'التشغيل التلقائي غير متاح هنا. اضغط زر الصوت لسماع سؤال المعلّم.'
            : 'تعذر تشغيل الصوت الآن. يمكنك متابعة المحادثة من النص المكتوب.',
        );
    }
  }

  selectVoice(voice: ConversationVoice): void {
    this.voicePickerOpen.set(false);
    if (this.selectedVoice() === voice) return;
    this.audio?.pause();
    this.audio = null;
    this.selectedVoice.set(voice);
    this.speechNotice.set('تم تغيير الصوت. اضغط زر الاستماع على أي رسالة لتسمعها بالصوت الجديد.');
    try {
      localStorage.setItem('student-conversation-voice', voice);
    } catch {
      /* Optional preference. */
    }
  }

  private scrollToLatest(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    requestAnimationFrame(() => {
      const element = this.thread()?.nativeElement;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }

  openReport(): void {
    this.reportOpen.set(true);
    requestAnimationFrame(() => this.reportDialog()?.nativeElement.focus());
  }

  closeReport(): void {
    this.reportOpen.set(false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.conversation-finish__report')?.focus(),
    );
  }

  @HostListener('window:keydown.escape')
  closeReportOnEscape(): void {
    if (this.reportOpen()) this.closeReport();
  }

  @HostListener('window:keydown', ['$event'])
  keepReportFocus(event: KeyboardEvent): void {
    if (!this.reportOpen() || event.key !== 'Tab') return;
    const buttons = this.reportDialog()?.nativeElement.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled)',
    );
    if (!buttons?.length) return;
    const first = buttons[0],
      last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private issueGroup(issue: ReportIssue): 'grammar' | 'writing' | 'vocabulary' | 'other' {
    const kind = issue.kind.toLowerCase();
    if (/grammar|tense|syntax/.test(kind)) return 'grammar';
    if (/spell|writ|punctuat|typ/.test(kind)) return 'writing';
    if (/vocab|word|lexic/.test(kind)) return 'vocabulary';
    return 'other';
  }
}
