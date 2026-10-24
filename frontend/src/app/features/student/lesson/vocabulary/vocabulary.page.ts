import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AiMaterial, StudentLearningApi } from '../../learning.api';
import { adjacentStage, stageAt, stageReady, stageReadyForStudent } from '../stage-flow';

@Component({
  selector: 'app-student-vocabulary-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './vocabulary.page.html',
  styleUrl: './vocabulary.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentVocabularyPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly material = signal<AiMaterial | null>(null);
  readonly completed = signal(0);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly flipped = signal(false);
  readonly leaving = signal(false);
  readonly speaking = signal<'word' | 'example' | null>(null);
  readonly imageFailed = signal(false);
  readonly current = computed(() => {
    const data = this.material();
    return data && this.completed() < data.vocabulary.length
      ? data.vocabulary[this.completed()]
      : null;
  });
  readonly stage = computed(() => stageAt(this.material()?.stages, 'vocabulary'));
  readonly nextStage = computed(() => adjacentStage(this.material()?.stages, 'vocabulary', 1));
  readonly progressPercent = computed(() => {
    const total = this.material()?.vocabulary.length ?? 0;
    return total === 0 ? 0 : Math.round((this.completed() / total) * 100);
  });

  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;
  private speechRequest = 0;

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.stopSpeech();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (!stageReady(data, 'vocabulary') && !(await stageReadyForStudent(this.api, this.slotId, data, 'vocabulary'))) {
        this.material.set(null);
        this.error.set('أكمل المراحل السابقة قبل الكلمات.');
      } else {
        this.material.set(data);
        this.completed.set(data.progress.vocabulary);
        this.imageFailed.set(false);
      }
    } catch (ex) {
      this.error.set(
        (ex as { status?: number }).status === 404
          ? 'الكلمات لم تُعتمد وتُنشر لهذا الدرس بعد.'
          : 'تعذر تحميل الكلمات أو أن مرحلة Shadowing لم تكتمل.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  async next(): Promise<void> {
    const material = this.material();
    if (!material || this.busy() || this.completed() >= material.vocabulary.length) return;
    this.busy.set(true);
    this.error.set('');
    const position = this.completed() + 1;
    try {
      await firstValueFrom(this.auth.csrf());
      const progress = await firstValueFrom(this.api.vocabularyProgress(this.slotId, position));
      this.stopSpeech();
      this.leaving.set(true);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
      this.completed.set(progress.completed);
      this.flipped.set(false);
      this.imageFailed.set(false);
    } catch {
      this.error.set('تعذر حفظ التقدم. اضغط تحديث ثم حاول مجددًا.');
    } finally {
      this.leaving.set(false);
      this.busy.set(false);
    }
  }

  revealMeaning(): void {
    if (this.busy() || this.leaving()) return;
    this.stopSpeech();
    this.flipped.set(true);
  }

  async speak(target: 'word' | 'example'): Promise<void> {
    const item = this.current();
    if (!item) return;
    this.stopSpeech();
    const request = this.speechRequest;
    this.speaking.set(target);
    try {
      await firstValueFrom(this.auth.csrf());
      if (request !== this.speechRequest) return;
      const sound = await firstValueFrom(
        this.api.vocabularyAudio(this.slotId, this.completed() + 1, target),
      );
      if (request !== this.speechRequest) return;
      const url = URL.createObjectURL(sound);
      const audio = new Audio(url);
      this.activeAudio = audio;
      this.activeAudioUrl = url;
      audio.onended = () => this.stopSpeech();
      await audio.play();
      } catch (error) {
      if (request !== this.speechRequest) return;
      this.stopSpeech();
        this.error.set((error as { status?: number }).status === 429
          ? 'انتهت حصة الصوت اليومية. يمكنك متابعة الكلمات بالنص وتجربة الصوت غدًا.'
          : 'الصوت الطبيعي غير متاح الآن. أبلغ المدرّس لتفعيل مزود الصوت أو حاول لاحقًا.');
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleShortcut(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      this.speak(this.flipped() ? 'example' : 'word');
    } else if (event.code === 'Enter' && !this.busy()) {
      event.preventDefault();
      void this.next();
    }
  }

  private stopSpeech(): void {
    this.speechRequest++;
    this.activeAudio?.pause();
    this.activeAudio = null;
    if (this.activeAudioUrl) URL.revokeObjectURL(this.activeAudioUrl);
    this.activeAudioUrl = null;
    this.speaking.set(null);
  }
}
