import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
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
import { AiMaterial, ConversationHistory, StudentLearningApi } from '../../learning.api';
import { adjacentStage, stageAt, stageReady } from '../stage-flow';

type ConversationVoice = 'Kore' | 'Puck' | 'Aoede';

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
  readonly turnTarget = computed(() => this.material()?.conversationTurnTarget ?? 10);
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
  readonly history = signal<ConversationHistory | null>(null);
  readonly completedReplies = computed(
    () => this.history()?.completedTurns ?? this.history()?.turns.length ?? 0,
  );
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
  readonly voiceNotice = signal('');
  readonly recording = signal(false);
  readonly transcribing = signal(false);
  readonly microphoneSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';
  message = '';
  private pendingId = '';
  private pendingMessage = '';
  private recorder: MediaRecorder | null = null;
  private microphone: MediaStream | null = null;
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;
  private audio: HTMLAudioElement | null = null;
  private destroyed = false;

  ngOnInit(): void {
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
    if (this.recordingTimer) clearTimeout(this.recordingTimer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.audio?.pause();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (!stageReady(data, 'conversation') || (!data.stages && !data.completed.quiz)) {
        this.material.set(null);
        this.error.set('أكمل المراحل السابقة قبل المحادثة.');
      } else {
        this.material.set(data);
        this.history.set(await firstValueFrom(this.api.conversationHistory(this.slotId)));
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
      !text ||
      text.length > 400 ||
      history.remainingToday < 1 ||
      this.completedReplies() >= this.turnTarget()
    )
      return;
    this.busy.set(true);
    this.error.set('');
    if (!this.pendingId || this.pendingMessage !== text) {
      this.pendingId = crypto.randomUUID();
      this.pendingMessage = text;
    }
    try {
      await firstValueFrom(this.auth.csrf());
      await firstValueFrom(this.api.conversationTurn(this.slotId, text, this.pendingId));
      this.pendingId = '';
      this.pendingMessage = '';
      this.message = '';
      const updated = await firstValueFrom(this.api.conversationHistory(this.slotId));
      this.history.set(updated);
      this.scrollToLatest();
      const latest = updated.turns.at(-1);
      if (latest?.id) void this.playReply(latest.id, true);
    } catch (ex) {
      const status = (ex as { status?: number }).status;
      this.error.set(
        status === 429
          ? 'وصلت للحد اليومي للذكاء الاصطناعي. ارجع بكرة.'
          : status === 503
            ? 'خدمات الذكاء الاصطناعي مش متاحة حاليًا. جرّب لاحقًا.'
            : 'لم نتمكن من إرسال الرسالة. اضغط تحديث للتأكد قبل إعادة المحاولة.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  insertSuggestion(phrase: string): void {
    this.message = phrase;
    document.getElementById('student-message')?.focus();
  }

  async toggleRecording(): Promise<void> {
    if (this.recording()) {
      this.recorder?.stop();
      return;
    }
    if (!this.microphoneSupported || this.busy() || this.transcribing()) {
      this.voiceNotice.set('الميكروفون غير مدعوم هنا. جرّب Chrome عبر اتصال آمن، أو اكتب ردك.');
      return;
    }
    try {
      this.voiceNotice.set('');
      this.microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      this.recorder = new MediaRecorder(this.microphone, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      this.recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      this.recorder.onstop = () => {
        if (this.recordingTimer) clearTimeout(this.recordingTimer);
        this.microphone?.getTracks().forEach((track) => track.stop());
        this.microphone = null;
        this.recording.set(false);
        if (!this.destroyed && chunks.length) {
          const audio = new Blob(chunks, { type: this.recorder?.mimeType || 'audio/webm' });
          void this.transcribe(audio);
        }
      };
      this.recorder.start();
      this.recording.set(true);
      this.recordingTimer = setTimeout(() => {
        if (this.recorder?.state === 'recording') this.recorder.stop();
      }, 15000);
    } catch {
      this.microphone?.getTracks().forEach((track) => track.stop());
      this.microphone = null;
      this.voiceNotice.set('تعذر تشغيل الميكروفون. تأكد من السماح له في المتصفح.');
    }
  }

  private async transcribe(audio: Blob): Promise<void> {
    if (audio.size > 2_000_000) {
      this.voiceNotice.set('التسجيل كبير جدًا. حاول تسجيل رد أقصر.');
      return;
    }
    this.transcribing.set(true);
    this.voiceNotice.set('جاري تحويل كلامك إلى نص...');
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(this.api.transcribeConversation(this.slotId, audio));
      this.message = result.text;
      this.voiceNotice.set('راجع النص ثم اضغط إرسال ليجيبك المعلم الذكي.');
    } catch {
      this.voiceNotice.set('تعذر فهم التسجيل. حاول مرة أخرى أو اكتب ردك.');
    } finally {
      this.transcribing.set(false);
    }
  }

  async playReply(turnId?: string, automatic = false): Promise<void> {
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
      if (!automatic && this.audio === audio)
        this.speechNotice.set('اضغط زر الصوت مرة أخرى لتشغيله.');
    }
  }

  selectVoice(voice: ConversationVoice): void {
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
}
