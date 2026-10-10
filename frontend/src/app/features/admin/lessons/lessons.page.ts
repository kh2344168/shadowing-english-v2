import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AuthoringLesson, LessonEditDetails, ShadowingAuthoringApi,
} from '../shadowing-authoring.api';

interface EditableSegment {
  position: number;
  text: string;
  audio: File | null;
}

@Component({
  selector: 'app-admin-lessons-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './lessons.page.html',
  styleUrl: './lessons.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonsPage implements OnInit {
  private readonly api = inject(ShadowingAuthoringApi);
  readonly lessons = signal<AuthoringLesson[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly more = signal(false);
  readonly page = signal(0);
  readonly failedPage = signal(0);
  readonly search = signal('');
  readonly sort = signal<'newest' | 'oldest' | 'name'>('newest');
  readonly view = signal<'grid' | 'list'>('grid');
  readonly notice = signal('');
  readonly actionError = signal('');
  readonly editing = signal<AuthoringLesson | null>(null);
  readonly editingLoading = signal(false);
  readonly editSaving = signal(false);
  readonly editTitle = signal('');
  readonly editDescription = signal('');
  readonly editVersionId = signal('');
  readonly editSegments = signal<EditableSegment[]>([]);
  readonly deleting = signal<AuthoringLesson | null>(null);
  readonly deleteSaving = signal(false);
  readonly deleteAccepted = signal(false);
  readonly deleteBlockedByCurriculum = signal(false);

  readonly visibleLessons = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    const items = this.lessons().filter((lesson) =>
      `${lesson.title} ${lesson.description}`.toLocaleLowerCase().includes(query),
    );
    if (this.sort() === 'oldest') return [...items].reverse();
    if (this.sort() === 'name') return [...items].sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    return items;
  });

  ngOnInit(): void { void this.load(1); }

  async load(page: number): Promise<void> {
    if (this.loading() && this.page() !== 0) return;
    const started = Date.now();
    console.info('[Admin.Lessons.UI.List.Start]', { page });
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await firstValueFrom(this.api.lessons(page));
      this.lessons.update((items) => page === 1 ? result.items : [
        ...items,
        ...result.items.filter((next) => !items.some((existing) => existing.id === next.id)),
      ]);
      this.more.set(result.hasMore);
      this.page.set(page);
      this.failedPage.set(0);
      console.info('[Admin.Lessons.UI.List.Success]', { page, count: result.items.length, durationMs: Date.now() - started });
    } catch (error) {
      this.error.set(true);
      this.failedPage.set(page);
      console.warn('[Admin.Lessons.UI.List.Failed]', { page, status: (error as { status?: number }).status ?? null, durationMs: Date.now() - started });
    } finally { this.loading.set(false); }
  }

  async openEdit(lesson: AuthoringLesson): Promise<void> {
    if (this.editing() || this.deleting()) return;
    this.notice.set(''); this.actionError.set('');
    this.editing.set(lesson);
    this.editingLoading.set(true);
    const started = Date.now();
    console.info('[Admin.Lessons.UI.EditOpen.Start]', { lessonId: lesson.id, versionId: lesson.versionId });
    try {
      const details: LessonEditDetails = await firstValueFrom(this.api.lessonDetails(lesson.id));
      this.editVersionId.set(details.versionId);
      this.editTitle.set(details.title);
      this.editDescription.set(details.description);
      this.editSegments.set(details.segments.map((item) => ({ position: item.position, text: item.text, audio: null })));
      console.info('[Admin.Lessons.UI.EditOpen.Success]', { lessonId: lesson.id, segments: details.segments.length, durationMs: Date.now() - started });
    } catch (error) {
      this.actionError.set('تعذر تحميل تفاصيل الدرس. جرّب مرة أخرى.');
      console.warn('[Admin.Lessons.UI.EditOpen.Failed]', { lessonId: lesson.id, status: (error as { status?: number }).status ?? null, durationMs: Date.now() - started });
      this.editing.set(null);
    } finally { this.editingLoading.set(false); }
  }

  cancelEdit(): void {
    if (this.editSaving()) return;
    this.editing.set(null);
    this.editSegments.set([]);
    this.actionError.set('');
  }

  changeSegmentText(position: number, text: string): void {
    this.editSegments.update((items) => items.map((item) => item.position === position ? { ...item, text } : item));
  }

  changeSegmentAudio(position: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const audio = input.files?.item(0) ?? null;
    this.editSegments.update((items) => items.map((item) => item.position === position ? { ...item, audio } : item));
  }

  async saveEdit(event: Event): Promise<void> {
    event.preventDefault();
    const lesson = this.editing();
    if (!lesson || this.editSaving() || this.editingLoading()) return;
    this.actionError.set('');
    const title = this.editTitle().trim();
    const description = this.editDescription().trim();
    const segments = this.editSegments();
    if (title.length < 2 || title.length > 160 || description.length > 1000 ||
        segments.length < 1 || segments.length > 20 || segments.some((s) => !s.text.trim() || s.text.trim().length > 1000)) {
      this.actionError.set('راجع العنوان والوصف ونصوص المقاطع قبل الحفظ.'); return;
    }
    if (segments.some((s) => s.audio && (s.audio.size > 2_000_000 || s.audio.size <= 12 || !s.audio.name.toLowerCase().endsWith('.wav')))) {
      this.actionError.set('التسجيل البديل يجب أن يكون WAV وأقل من 2 MB لكل مقطع.'); return;
    }
    const started = Date.now();
    const requestId = crypto.randomUUID();
    console.info('[Admin.Lessons.UI.Edit.Start]', { lessonId: lesson.id, versionId: this.editVersionId(), segmentCount: segments.length, requestId });
    this.editSaving.set(true);
    try {
      const updated = await firstValueFrom(this.api.editLesson(lesson.id, this.editVersionId(), requestId, title, description, segments));
      this.lessons.update((items) => items.map((item) => item.id === lesson.id ? {
        ...item, title: updated.title, description: updated.description, versionId: updated.versionId, segmentCount: updated.segmentCount,
      } : item));
      this.editing.set(null);
      this.editSegments.set([]);
      this.notice.set(updated.aiNeedsReview ? 'تم حفظ نسخة جديدة. راجع محتوى AI قبل إضافة النسخة الجديدة للمنهج.' : 'تم حفظ نسخة جديدة بنجاح.');
      console.info('[Admin.Lessons.UI.Edit.Success]', { lessonId: lesson.id, versionId: updated.versionId, aiNeedsReview: updated.aiNeedsReview, durationMs: Date.now() - started });
    } catch (error) {
      const status = (error as { status?: number }).status ?? null;
      this.actionError.set(status === 409 ? 'الدرس تغير من صفحة أخرى. اقفل التعديل وافتحه من جديد.' : 'فشل حفظ التعديل. لم نحذف النسخة القديمة.');
      console.warn('[Admin.Lessons.UI.Edit.Failed]', { lessonId: lesson.id, requestId, status, durationMs: Date.now() - started });
    } finally { this.editSaving.set(false); }
  }

  askDelete(lesson: AuthoringLesson): void {
    if (this.editing() || this.deleting()) return;
    this.notice.set(''); this.actionError.set('');
    this.deleteAccepted.set(false);
    this.deleteBlockedByCurriculum.set(false);
    this.deleting.set(lesson);
    console.info('[Admin.Lessons.UI.DeleteConfirm.Open]', { lessonId: lesson.id, versionId: lesson.versionId });
  }

  cancelDelete(): void {
    if (this.deleteSaving()) return;
    this.deleting.set(null);
    this.deleteAccepted.set(false);
    this.deleteBlockedByCurriculum.set(false);
    this.actionError.set('');
  }

  async confirmDelete(): Promise<void> {
    const lesson = this.deleting();
    if (!lesson || this.deleteSaving() || !this.deleteAccepted()) return;
    this.actionError.set('');
    this.deleteBlockedByCurriculum.set(false);
    const started = Date.now();
    console.info('[Admin.Lessons.UI.Purge.Start]', { lessonId: lesson.id, versionId: lesson.versionId });
    this.deleteSaving.set(true);
    try {
      await firstValueFrom(this.api.deleteLessonPermanently(lesson.id, lesson.versionId));
      this.lessons.update((items) => items.filter((item) => item.id !== lesson.id));
      this.deleting.set(null);
      this.deleteAccepted.set(false);
      this.notice.set('تم حذف الدرس نهائيًا من قاعدة البيانات، وجارٍ تنظيف الملفات الصوتية.');
      console.info('[Admin.Lessons.UI.Purge.Success]', { lessonId: lesson.id, durationMs: Date.now() - started });
    } catch (error) {
      const status = (error as { status?: number }).status ?? null;
      const code = (error as { error?: { error?: string } }).error?.error;
      this.deleteBlockedByCurriculum.set(code === 'lesson_in_curriculum_draft' || code === 'lesson_in_published_curriculum');
      this.actionError.set(
        code === 'lesson_in_curriculum_draft'
          ? 'الدرس موجود في مسودة منهج. شيله من كل المناهج المحفوظة الأول، ثم جرّب الحذف.' :
        code === 'lesson_in_published_curriculum'
          ? 'الدرس موجود في منهج منشور حاليًا. شيله من المنهج، وانشر النسخة الجديدة للمجموعة أولًا.' :
        code === 'media_cleanup_migration_required'
          ? 'قاعدة البيانات محتاجة تحديث خاص بتنظيف التسجيلات. لم يتم حذف أي شيء.' :
        code === 'lesson_has_other_dependencies'
          ? 'الدرس مرتبط ببيانات أخرى؛ الحذف توقف لحماية قاعدة البيانات.' :
        code === 'invalid_recording_metadata'
          ? 'بيانات تسجيلات الطلاب غير صالحة؛ لم يتم الحذف.' :
        status === 409 ? 'الدرس تغير من صفحة أخرى؛ حدّث الصفحة ثم حاول مرة أخرى.' :
        'فشل الحذف النهائي. راجع سجل الـBackend قبل إعادة المحاولة.');
      console.warn('[Admin.Lessons.UI.Purge.Failed]', { lessonId: lesson.id, status, errorCode: code ?? null, durationMs: Date.now() - started });
    } finally { this.deleteSaving.set(false); }
  }
}
