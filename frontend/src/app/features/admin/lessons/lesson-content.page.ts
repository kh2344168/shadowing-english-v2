import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { LessonEditDetails, ShadowingAuthoringApi } from '../shadowing-authoring.api';
import { LessonWorkflowApi } from './lesson-workflow.api';

interface EditableSegment {
  position: number;
  text: string;
  audioUrl: string;
  audio: File | null;
}

@Component({
  selector: 'app-admin-lesson-content',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './lesson-content.page.html',
  styleUrl: './lesson-content.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonContentPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workflowApi = inject(LessonWorkflowApi);
  private readonly authoringApi = inject(ShadowingAuthoringApi);
  private readonly auth = inject(AuthService);
  readonly versionId = this.route.snapshot.paramMap.get('versionId') ?? '';
  readonly stageId = this.route.snapshot.paramMap.get('stageId') ?? '';
  readonly lessonId = signal('');
  readonly title = signal('');
  readonly description = signal('');
  readonly segments = signal<EditableSegment[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly dirty = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.versionId) return;
    const started = performance.now();
    console.info('[Admin.LessonContent.Load.Start]', { versionId: this.versionId });
    this.loading.set(true);
    this.error.set('');
    try {
      const workflow = await firstValueFrom(this.workflowApi.get(this.versionId));
      const details = await firstValueFrom(this.authoringApi.lessonDetails(workflow.lessonId));
      if (details.versionId !== this.versionId) {
        await this.router.navigate(['/admin/lessons', details.versionId, 'workflow']);
        return;
      }
      this.apply(details);
      console.info('[Admin.LessonContent.Load.Success]', {
        versionId: this.versionId,
        segmentCount: details.segments.length,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      this.error.set('تعذر تحميل محتوى الدرس. حاول مرة أخرى.');
      console.warn('[Admin.LessonContent.Load.Failed]', {
        versionId: this.versionId,
        status: (error as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.loading.set(false);
    }
  }

  setTitle(value: string): void {
    this.title.set(value);
    this.changed();
  }
  setDescription(value: string): void {
    this.description.set(value);
    this.changed();
  }
  setText(position: number, text: string): void {
    this.segments.update((items) =>
      items.map((item) => (item.position === position ? { ...item, text } : item)),
    );
    this.changed();
  }
  setAudio(position: number, event: Event): void {
    const file = (event.target as HTMLInputElement).files?.item(0) ?? null;
    this.segments.update((items) =>
      items.map((item) => (item.position === position ? { ...item, audio: file } : item)),
    );
    this.changed();
  }

  async save(): Promise<void> {
    const title = this.title().trim(),
      description = this.description().trim(),
      segments = this.segments();
    if (this.saving() || !this.dirty()) return;
    if (
      title.length < 2 ||
      title.length > 160 ||
      description.length > 1000 ||
      segments.some((item) => !item.text.trim() || item.text.trim().length > 1000)
    ) {
      this.error.set('راجع عنوان الدرس والوصف ونصوص المقاطع قبل الحفظ.');
      return;
    }
    if (
      segments.some(
        (item) =>
          item.audio &&
          (!item.audio.name.toLowerCase().endsWith('.wav') ||
            item.audio.size <= 12 ||
            item.audio.size > 2_000_000),
      )
    ) {
      this.error.set('التسجيل البديل يجب أن يكون WAV وأقل من 2 MB.');
      return;
    }
    const started = performance.now();
    console.info('[Admin.LessonContent.Save.Start]', {
      versionId: this.versionId,
      segmentCount: segments.length,
      replacementAudioCount: segments.filter((item) => item.audio).length,
    });
    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(
        this.authoringApi.editLesson(
          this.lessonId(),
          this.versionId,
          crypto.randomUUID(),
          title,
          description,
          segments,
        ),
      );
      this.notice.set('تم حفظ نسخة جديدة من الدرس. سيتم نقلك إلى رحلتها الآن.');
      console.info('[Admin.LessonContent.Save.Success]', {
        previousVersionId: this.versionId,
        versionId: result.versionId,
        segmentCount: segments.length,
        durationMs: Math.round(performance.now() - started),
      });
      await this.router.navigate(['/admin/lessons', result.versionId, 'workflow']);
    } catch (error) {
      this.error.set(
        (error as { status?: number }).status === 409
          ? 'الدرس تغير من صفحة أخرى. ارجع لرحلة الدرس وافتح أحدث نسخة.'
          : 'تعذر حفظ التعديلات. النسخة السابقة ما زالت سليمة.',
      );
      console.warn('[Admin.LessonContent.Save.Failed]', {
        versionId: this.versionId,
        status: (error as { status?: number }).status ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      this.saving.set(false);
    }
  }

  private apply(details: LessonEditDetails): void {
    this.lessonId.set(details.id);
    this.title.set(details.title);
    this.description.set(details.description);
    this.segments.set(details.segments.map((item) => ({ ...item, audio: null })));
    this.dirty.set(false);
  }
  private changed(): void {
    this.dirty.set(true);
    this.notice.set('');
  }
}
