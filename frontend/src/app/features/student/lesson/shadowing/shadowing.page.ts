import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { LessonOverview, Segment, StudentLearningApi } from '../../learning.api';

@Component({
  selector: 'app-student-shadowing-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './shadowing.page.html',
  styleUrl: './shadowing.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentShadowingPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  @ViewChild('teacher') teacher?: ElementRef<HTMLAudioElement>;
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly lesson = signal<LessonOverview | null>(null);
  readonly segment = signal<Segment | null>(null);
  readonly position = signal(1);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly playing = signal(false);
  readonly recording = signal(false);
  readonly microphonePending = signal(false);
  readonly recordingUrl = signal<string | null>(null);
  readonly finished = signal(false);
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private destroyed = false;
  private csrfReady = false;
  private recordingGeneration = 0;

  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    const started = Date.now();
    console.info('[Student.Shadowing.UI.Load.Start]', { slotId: this.slotId });
    this.loading.set(true);
    this.error.set('');
    this.finished.set(false);
    this.teacher?.nativeElement.pause();
    this.teacher?.nativeElement.removeAttribute('src');
    this.playing.set(false);
    this.stopRecording();
    this.clearRecording();
    this.lesson.set(null);
    this.segment.set(null);
    try {
      const overview = await firstValueFrom(this.api.overview(this.slotId));
      this.lesson.set(overview);
      if (overview.segmentCount > 0) {
        const next = Math.min(overview.completedSegments + 1, overview.segmentCount);
        await this.loadSegment(next);
      }
      console.info('[Student.Shadowing.UI.Load.Success]', {
        slotId: this.slotId,
        segmentCount: overview.segmentCount,
        completedSegments: overview.completedSegments,
        durationMs: Date.now() - started,
      });
    } catch (ex) {
      console.warn('[Student.Shadowing.UI.Load.Failed]', {
        slotId: this.slotId,
        status: (ex as { status?: number }).status ?? null,
        durationMs: Date.now() - started,
      });
      this.lesson.set(null);
      this.segment.set(null);
      this.error.set(
        (ex as { status?: number }).status === 404
          ? 'الدرس غير متاح لمجموعتك حاليًا.'
          : 'تعذر تحميل التدريب. حاول مجددًا.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  private async loadSegment(position: number): Promise<void> {
    const started = Date.now();
    console.info('[Student.Shadowing.UI.Segment.Start]', { slotId: this.slotId, position });
    if (this.playing()) this.teacher?.nativeElement.pause();
    this.teacher?.nativeElement.removeAttribute('src');
    this.playing.set(false);
    this.clearRecording();
    this.segment.set(null);
    try {
      this.segment.set(await firstValueFrom(this.api.segment(this.slotId, position)));
      this.position.set(position);
      console.info('[Student.Shadowing.UI.Segment.Success]', {
        slotId: this.slotId,
        position,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      console.warn('[Student.Shadowing.UI.Segment.Failed]', {
        slotId: this.slotId,
        position,
        status: (error as { status?: number }).status ?? null,
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
  async playTeacher(): Promise<void> {
    const audio = this.teacher?.nativeElement;
    const current = this.segment();
    if (!audio || !current) return;
    const started = Date.now();
    console.info('[Student.Shadowing.UI.Audio.Start]', {
      slotId: this.slotId,
      position: this.position(),
    });
    this.error.set('');
    try {
      if (audio.getAttribute('src') !== current.audioUrl) audio.src = current.audioUrl;
      audio.currentTime = 0;
      await audio.play();
      console.info('[Student.Shadowing.UI.Audio.Success]', {
        slotId: this.slotId,
        position: this.position(),
        durationMs: Date.now() - started,
      });
    } catch {
      this.error.set('تعذر تشغيل الصوت. تأكد من اتصالك ثم حاول مجددًا.');
      console.warn('[Student.Shadowing.UI.Audio.Failed]', {
        slotId: this.slotId,
        position: this.position(),
        durationMs: Date.now() - started,
      });
    }
  }
  async startRecording(): Promise<void> {
    if (this.recording() || this.microphonePending() || !this.segment()) return;
    const started = Date.now();
    console.info('[Student.Shadowing.UI.Record.Start]', {
      slotId: this.slotId,
      position: this.position(),
    });
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.error.set('التسجيل غير مدعوم هنا. يمكنك متابعة التدريب بدون تسجيل.');
      console.warn('[Student.Shadowing.UI.Record.Failed]', {
        slotId: this.slotId,
        position: this.position(),
        reason: 'unsupported',
        durationMs: Date.now() - started,
      });
      return;
    }
    this.error.set('');
    this.clearRecording();
    const generation = this.recordingGeneration;
    this.microphonePending.set(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.destroyed || generation !== this.recordingGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const recorder = new MediaRecorder(stream);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (this.stream === stream) this.stream = undefined;
        if (this.recorder === recorder) this.recording.set(false);
        if (!this.destroyed && generation === this.recordingGeneration && chunks.length)
          this.recordingUrl.set(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
      };
      recorder.onerror = () => {
        if (this.destroyed || generation !== this.recordingGeneration) return;
        this.error.set('تعذر تسجيل الصوت. حاول مرة أخرى.');
        console.warn('[Student.Shadowing.UI.Record.Failed]', {
          slotId: this.slotId,
          position: this.position(),
          reason: 'recorder_error',
          durationMs: Date.now() - started,
        });
        this.stopRecording();
      };
      recorder.start();
      this.recording.set(true);
      console.info('[Student.Shadowing.UI.Record.Success]', {
        slotId: this.slotId,
        position: this.position(),
        durationMs: Date.now() - started,
      });
    } catch {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = undefined;
      this.error.set('تعذر فتح الميكروفون. يمكنك متابعة التدريب بدونه.');
      console.warn('[Student.Shadowing.UI.Record.Failed]', {
        slotId: this.slotId,
        position: this.position(),
        reason: 'microphone_error',
        durationMs: Date.now() - started,
      });
    } finally {
      this.microphonePending.set(false);
    }
  }
  stopRecording(): void {
    if (this.recorder?.state === 'recording') {
      console.info('[Student.Shadowing.UI.Record.Stop]', {
        slotId: this.slotId,
        position: this.position(),
      });
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.recording.set(false);
  }
  async next(): Promise<void> {
    const lesson = this.lesson();
    if (!lesson || !this.segment() || this.saving() || this.recording() || this.microphonePending())
      return;
    this.saving.set(true);
    this.error.set('');
    const started = Date.now();
    const position = this.position();
    let saved = false;
    console.info('[Student.Shadowing.UI.Progress.Start]', { slotId: this.slotId, position });
    try {
      // GET obtains the anti-forgery cookie; the PUT is the only business write.
      if (!this.csrfReady) {
        await firstValueFrom(this.auth.csrf());
        this.csrfReady = true;
      }
      const result = await firstValueFrom(this.api.save(this.slotId, position));
      saved = true;
      this.lesson.set({
        ...lesson,
        completedSegments: result.completedSegments,
        isComplete: result.isComplete,
      });
      console.info('[Student.Shadowing.UI.Progress.Success]', {
        slotId: this.slotId,
        position,
        completedSegments: result.completedSegments,
        isComplete: result.isComplete,
        durationMs: Date.now() - started,
      });
      if (position >= lesson.segmentCount) this.finished.set(true);
      else await this.loadSegment(position + 1);
    } catch (ex) {
      if ((ex as { status?: number }).status === 400) this.csrfReady = false;
      if (!saved)
        console.warn('[Student.Shadowing.UI.Progress.Failed]', {
          slotId: this.slotId,
          position,
          status: (ex as { status?: number }).status ?? null,
          durationMs: Date.now() - started,
        });
      this.error.set(
        saved
          ? 'تم حفظ تقدمك، لكن تعذر تحميل الجملة التالية. حدّث الدرس وأكمل.'
          : (ex as { status?: number }).status === 409
            ? 'تغير التقدم على جهاز آخر. حدّث الدرس ثم أكمل.'
            : 'لم يُحفظ تقدمك. حاول مرة أخرى قبل الانتقال للجملة التالية.',
      );
    } finally {
      this.saving.set(false);
    }
  }
  private clearRecording(): void {
    this.recordingGeneration++;
    const url = this.recordingUrl();
    if (url) URL.revokeObjectURL(url);
    this.recordingUrl.set(null);
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.playing()) this.teacher?.nativeElement.pause();
    this.stopRecording();
    this.clearRecording();
  }
}
