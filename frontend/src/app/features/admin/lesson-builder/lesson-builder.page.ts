import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ImportedLesson, LocalDraftTransfer, importLesson } from '../ai-processing/local-lesson';
import { AuthoringGroup, AuthoringLesson, ShadowingAuthoringApi } from './shadowing-authoring.api';

interface DraftSegment {
  id: number;
  text: string;
  audio: File | null;
}

@Component({
  selector: 'app-admin-lesson-builder-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './lesson-builder.page.html',
  styleUrl: './lesson-builder.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonBuilderPage implements OnInit, OnDestroy {
  private readonly api = inject(ShadowingAuthoringApi);
  private readonly auth = inject(AuthService);
  private readonly transfer = inject(LocalDraftTransfer);
  private destroyed = false;
  private urls: Record<number, string> = {};
  private nextSegmentId = 2;
  private createAttempt: string | null = null;
  private publicationAttempt: { signature: string; requestId: string } | null = null;
  lessonsPage = 0;
  groupsPage = 0;

  readonly lessons = signal<AuthoringLesson[]>([]);
  readonly groups = signal<AuthoringGroup[]>([]);
  readonly segments = signal<DraftSegment[]>([{ id: 1, text: '', audio: null }]);
  readonly loading = signal(true);
  readonly moreLessons = signal(false);
  readonly moreGroups = signal(false);
  readonly saving = signal(false);
  readonly importing = signal(false);
  readonly importedDraft = signal(false);
  readonly audioUrls = signal<Record<number, string>>({});
  readonly publishing = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  title = '';
  description = '';
  importedReviewed = false;
  selectedVersionId = '';
  selectedGroupId = '';
  weekNumber = 1;
  dayNumber = 1;
  sortOrder = 1;

  ngOnInit(): void {
    void Promise.all([this.loadLessons(), this.loadGroups()]).finally(() =>
      this.loading.set(false),
    );
    if (this.transfer.hasDraft()) void this.receiveDraft();
  }

  private async receiveDraft(): Promise<void> {
    this.importing.set(true);
    try {
      const session = await firstValueFrom(this.auth.session());
      const lesson = this.transfer.take(
        session.authenticated && session.roles.includes('Admin') ? (session.userId ?? '') : '',
      );
      if (lesson && !this.destroyed) this.applyImported(lesson, true);
    } catch {
      this.transfer.clear();
      this.error.set('تعذر التحقق من الحساب لاستيراد المسودة. أعد تسجيل الدخول.');
    } finally {
      this.importing.set(false);
    }
  }

  async importResult(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file || this.importing() || this.saving()) return;
    // Preserve a draft already being edited. Import into a fresh form.
    if (
      this.title ||
      this.description ||
      this.segments().some((segment) => segment.text || segment.audio)
    ) {
      this.error.set('احتفظ بمسودتك الحالية أولًا. استيراد النتيجة متاح عند فتح منشئ درس فارغ.');
      input.value = '';
      return;
    }
    this.importing.set(true);
    this.error.set('');
    try {
      const session = await firstValueFrom(this.auth.session());
      if (!session.authenticated || !session.roles.includes('Admin') || !session.userId)
        throw new Error('unauthorized');
      const lesson = await importLesson(file);
      if (!this.destroyed) this.applyImported(lesson);
    } catch {
      this.error.set('تعذر استيراد الدرس. تحقق من حساب Admin وملف ZIP الصادر من أداة V2.');
    } finally {
      this.importing.set(false);
      input.value = '';
    }
  }

  private applyImported(lesson: ImportedLesson, reviewed = false): void {
    this.clearAudioUrls();
    this.title = lesson.manifest.title;
    this.description = lesson.manifest.description;
    const segments = lesson.manifest.segments.map((clip, index) => ({
      id: this.nextSegmentId++,
      text: clip.text,
      audio: lesson.files[index],
    }));
    segments.forEach((segment) => {
      this.urls[segment.id] = URL.createObjectURL(segment.audio);
    });
    this.audioUrls.set({ ...this.urls });
    this.segments.set(segments);
    this.importedDraft.set(true);
    this.importedReviewed = reviewed;
    this.createAttempt = null;
    this.success.set(
      'المسودة جاهزة بنصها وصوتها. راجعها ثم اضغط احفظ الدرس؛ لم تُحفظ ولم تُنشر تلقائيًا.',
    );
  }

  private clearAudioUrls(): void {
    Object.values(this.urls).forEach((url) => URL.revokeObjectURL(url));
    this.urls = {};
    this.audioUrls.set({});
  }

  async loadLessons(page = 1): Promise<void> {
    const started = Date.now();
    console.info('[Admin.Shadowing.UI.Lessons.Start]', { page });
    try {
      const result = await firstValueFrom(this.api.lessons(page));
      this.lessons.update((items) => (page === 1 ? result.items : [...items, ...result.items]));
      this.lessonsPage = page;
      this.moreLessons.set(result.hasMore);
      console.info('[Admin.Shadowing.UI.Lessons.Success]', {
        page,
        count: result.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(this.describe(error));
      console.warn('[Admin.Shadowing.UI.Lessons.Failed]', {
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    }
  }

  async loadGroups(page = 1): Promise<void> {
    const started = Date.now();
    console.info('[Admin.Shadowing.UI.Groups.Start]', { page });
    try {
      const result = await firstValueFrom(this.api.groups(page));
      this.groups.update((items) => (page === 1 ? result.items : [...items, ...result.items]));
      this.groupsPage = page;
      this.moreGroups.set(result.hasMore);
      console.info('[Admin.Shadowing.UI.Groups.Success]', {
        page,
        count: result.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(this.describe(error));
      console.warn('[Admin.Shadowing.UI.Groups.Failed]', {
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    }
  }

  addSegment(): void {
    if (this.segments().length >= 20) return;
    this.segments.update((items) => [
      ...items,
      { id: this.nextSegmentId++, text: '', audio: null },
    ]);
    this.changed();
  }
  removeSegment(id: number): void {
    if (this.segments().length <= 1) return;
    this.segments.update((items) => items.filter((item) => item.id !== id));
    if (this.urls[id]) URL.revokeObjectURL(this.urls[id]);
    delete this.urls[id];
    this.audioUrls.set({ ...this.urls });
    this.changed();
  }
  changed(): void {
    this.createAttempt = null;
    if (this.importedDraft()) this.importedReviewed = false;
  }
  chooseAudio(event: Event, id: number): void {
    const file = (event.target as HTMLInputElement).files?.item(0) ?? null;
    this.segments.update((items) =>
      items.map((item) => (item.id === id ? { ...item, audio: file } : item)),
    );
    if (this.urls[id]) URL.revokeObjectURL(this.urls[id]);
    delete this.urls[id];
    if (file) this.urls[id] = URL.createObjectURL(file);
    this.audioUrls.set({ ...this.urls });
    this.changed();
  }

  async create(): Promise<void> {
    if (this.saving() || this.importing()) return;
    if (this.importedDraft() && !this.importedReviewed) {
      this.error.set('راجع النص والصوت للمقاطع المستوردة ثم أكد المراجعة قبل الحفظ.');
      return;
    }
    const title = this.title.trim();
    const description = this.description.trim();
    const segments = this.segments().map((segment) => ({
      text: segment.text.trim(),
      audio: segment.audio,
    }));
    if (
      title.length < 2 ||
      title.length > 160 ||
      description.length > 1000 ||
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
      this.error.set('اكتب عنوانًا وجملة لكل مقطع، وارفع ملف WAV لا يزيد عن 2 MB لكل جملة.');
      return;
    }
    this.createAttempt ??= crypto.randomUUID();
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    const started = Date.now();
    console.info('[Admin.Shadowing.UI.Create.Start]', {
      requestId: this.createAttempt,
      titleLength: title.length,
      segments: segments.length,
      bytes: segments.reduce((sum, segment) => sum + (segment.audio?.size ?? 0), 0),
    });
    try {
      await firstValueFrom(this.auth.csrf());
      const created = await firstValueFrom(
        this.api.create(
          this.createAttempt,
          title,
          description,
          segments.map((segment) => ({ text: segment.text, audio: segment.audio! })),
        ),
      );
      this.selectedVersionId = created.versionId;
      this.lessons.update((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      this.title = '';
      this.description = '';
      this.clearAudioUrls();
      this.importedDraft.set(false);
      this.importedReviewed = false;
      this.segments.set([{ id: this.nextSegmentId++, text: '', audio: null }]);
      this.createAttempt = null;
      this.success.set('اتحفظ الدرس بصوته. اختَر مجموعة واضغط نشر ليظهر للطالب.');
      console.info('[Admin.Shadowing.UI.Create.Success]', {
        lessonId: created.id,
        versionId: created.versionId,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(this.describe(error));
      console.warn('[Admin.Shadowing.UI.Create.Failed]', {
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.saving.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearAudioUrls();
  }

  async publish(): Promise<void> {
    if (this.publishing() || !this.selectedVersionId || !this.selectedGroupId) return;
    const group = this.groups().find((item) => item.id === this.selectedGroupId);
    if (
      !group ||
      !Number.isInteger(this.weekNumber) ||
      !Number.isInteger(this.dayNumber) ||
      !Number.isInteger(this.sortOrder) ||
      this.weekNumber < 1 ||
      this.weekNumber > 52 ||
      this.dayNumber < 1 ||
      this.dayNumber > 7 ||
      this.sortOrder < 1 ||
      this.sortOrder > 100
    ) {
      this.error.set('راجع المجموعة وترتيب الأسبوع واليوم والدرس.');
      return;
    }
    const signature = [
      group.id,
      group.currentVersionId,
      this.selectedVersionId,
      this.weekNumber,
      this.dayNumber,
      this.sortOrder,
    ].join(':');
    if (this.publicationAttempt?.signature !== signature)
      this.publicationAttempt = { signature, requestId: crypto.randomUUID() };
    this.publishing.set(true);
    this.error.set('');
    this.success.set('');
    const started = Date.now();
    console.info('[Admin.Shadowing.UI.Publish.Start]', {
      groupId: group.id,
      lessonVersionId: this.selectedVersionId,
      requestId: this.publicationAttempt.requestId,
    });
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(
        this.api.publish({
          requestId: this.publicationAttempt.requestId,
          groupId: group.id,
          lessonVersionId: this.selectedVersionId,
          expectedVersionId: group.currentVersionId,
          weekNumber: this.weekNumber,
          dayNumber: this.dayNumber,
          sortOrder: this.sortOrder,
        }),
      );
      this.groups.update((items) =>
        items.map((item) =>
          item.id === group.id ? { ...item, currentVersionId: result.versionId } : item,
        ),
      );
      this.publicationAttempt = null;
      this.success.set('تم نشر الدرس للمجموعة. الطالب المسند لها يراه الآن في منهجه.');
      console.info('[Admin.Shadowing.UI.Publish.Success]', {
        groupId: group.id,
        versionId: result.versionId,
        slotId: result.slotId,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(this.describe(error));
      console.warn('[Admin.Shadowing.UI.Publish.Failed]', {
        groupId: group.id,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
      if (this.status(error) === 409) await this.loadGroups(1);
    } finally {
      this.publishing.set(false);
    }
  }

  private status(error: unknown): number | null {
    return error instanceof HttpErrorResponse ? error.status : null;
  }
  private describe(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      switch (error.error?.error) {
        case 'invalid_wav_audio':
          return 'ملف الصوت غير صالح. استخدم WAV حقيقيًا لكل جملة.';
        case 'invalid_lesson':
        case 'invalid_segments':
        case 'invalid_upload':
          return 'راجع العنوان والجمل وملفات WAV؛ الحد 20 جملة و2 MB لكل ملف.';
        case 'media_storage_not_configured':
          return 'خدمة حفظ الصوت غير مهيأة. راجع إعداد التخزين مع مسؤول الموقع.';
        case 'media_storage_unavailable':
          return 'خدمة حفظ الصوت غير متاحة الآن. احتفظ بالمسودة ثم حاول مجددًا.';
        case 'active_progress_prevents_republish':
          return 'لهذه المجموعة تقدم طلاب بالفعل. لن نغيّر نسختهم المنشورة أو نعيد تقدمهم للصفر.';
        case 'slot_conflict':
          return 'هذا الدرس أو موضع الأسبوع/اليوم/الترتيب موجود بالفعل.';
        case 'publication_changed':
        case 'publish_request_conflict':
          return 'تغير منشور المجموعة. حُدثت القائمة؛ راجعها ثم أعد المحاولة.';
        case 'lesson_audio_missing':
          return 'صوت الدرس غير متاح؛ لا يمكن نشره قبل إصلاح الملف.';
      }
      if (error.status === 401 || error.status === 403) return 'لا تملك صلاحية لهذه العملية.';
      if (error.status === 429) return 'طلبات كثيرة الآن. حاول بعد دقيقة.';
    }
    return 'تعذر تنفيذ العملية. تحقق من اتصال API ثم حاول مجددًا.';
  }
}
