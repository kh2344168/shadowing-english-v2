import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AuthoringGroup,
  AuthoringLesson,
  GroupCurriculum,
  PublishRequest,
  ShadowingAuthoringApi,
} from '../lesson-builder/shadowing-authoring.api';

@Component({
  selector: 'app-admin-curriculums-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './curriculums.page.html',
  styleUrl: './curriculums.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCurriculumsPage implements OnInit, OnDestroy {
  private readonly api = inject(ShadowingAuthoringApi);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private destroyed = false;
  private curriculumReadId = 0;
  private publishAttempt: { signature: string; request: PublishRequest } | null = null;
  private readonly publishedSignature = signal('');

  readonly groups = signal<AuthoringGroup[]>([]);
  readonly lessons = signal<AuthoringLesson[]>([]);
  readonly selectedGroupId = signal('');
  readonly selectedLessonVersionId = signal('');
  readonly selectedGroup = computed(() =>
    this.groups().find((group) => group.id === this.selectedGroupId()),
  );
  readonly selectedLesson = computed(() =>
    this.lessons().find((lesson) => lesson.versionId === this.selectedLessonVersionId()),
  );
  readonly weekNumber = signal<number | null>(1);
  readonly dayNumber = signal<number | null>(1);
  readonly sortOrder = signal<number | null>(1);
  readonly loadingGroups = signal(false);
  readonly loadingLessons = signal(false);
  readonly loadingCurriculum = signal(false);
  readonly publishing = signal(false);
  readonly groupsPage = signal(0);
  readonly lessonsPage = signal(0);
  readonly moreGroups = signal(false);
  readonly moreLessons = signal(false);
  readonly groupsError = signal('');
  readonly lessonsError = signal('');
  readonly curriculumError = signal('');
  readonly publishError = signal('');
  readonly success = signal('');
  readonly reviewRequired = signal(false);
  readonly curriculum = signal<GroupCurriculum | null>(null);
  readonly positionValid = computed(
    () =>
      this.inRange(this.weekNumber(), 52) &&
      this.inRange(this.dayNumber(), 7) &&
      this.inRange(this.sortOrder(), 100),
  );
  private readonly selectionSignature = computed(() =>
    JSON.stringify({
      groupId: this.selectedGroupId(),
      lessonVersionId: this.selectedLessonVersionId(),
      weekNumber: this.weekNumber(),
      dayNumber: this.dayNumber(),
      sortOrder: this.sortOrder(),
    }),
  );
  readonly canPublish = computed(
    () =>
      !!this.selectedGroup() &&
      !!this.selectedLesson() &&
      this.positionValid() &&
      !this.loadingGroups() &&
      !this.loadingLessons() &&
      !this.loadingCurriculum() &&
      !this.publishing() &&
      !this.curriculumError() &&
      this.curriculum()?.groupId === this.selectedGroupId() &&
      !this.reviewRequired() &&
      this.publishedSignature() !== this.selectionSignature(),
  );

  ngOnInit(): void {
    const query = this.route.snapshot.queryParamMap;
    this.selectedGroupId.set(this.queryId(query.get('groupId')));
    this.selectedLessonVersionId.set(this.queryId(query.get('lessonVersionId')));
    void Promise.all([this.loadGroups(), this.loadLessons()]).then(() => {
      if (!this.destroyed && this.selectedGroup()) void this.loadCurriculum();
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.curriculumReadId++;
  }

  async loadGroups(page = 1): Promise<void> {
    if (this.loadingGroups() || this.publishing()) return;
    const started = Date.now();
    this.loadingGroups.set(true);
    this.groupsError.set('');
    console.info('[Admin.Curriculum.UI.Load.Start]', { status: 'groups' });
    try {
      // Deep links may target later pages. Ordinary visits load only the first page.
      const target = page === 1 ? this.selectedGroupId() : '';
      let nextPage = page;
      do {
        const response = await firstValueFrom(this.api.groups(nextPage));
        if (this.destroyed) return;
        this.groups.update((items) =>
          nextPage === 1
            ? response.items
            : [
                ...new Map(
                  [...items, ...response.items].map((group) => [group.id, group]),
                ).values(),
              ],
        );
        this.groupsPage.set(nextPage);
        this.moreGroups.set(response.hasMore);
        if (!target || this.selectedGroup() || !response.hasMore) break;
        nextPage++;
      } while (nextPage <= 1000);
      if (target && !this.selectedGroup())
        this.groupsError.set('المجموعة المحددة غير متاحة. اختر مجموعة من القائمة.');
      console.info('[Admin.Curriculum.UI.Load.Success]', {
        status: 'groups',
        count: this.groups().length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (this.destroyed) return;
      this.groupsError.set(this.describe(error, 'تعذر تحميل المجموعات. حاول مجددًا.'));
      this.loadFailed(error, started);
    } finally {
      if (!this.destroyed) this.loadingGroups.set(false);
    }
  }

  async loadLessons(page = 1): Promise<void> {
    if (this.loadingLessons() || this.publishing()) return;
    const started = Date.now();
    this.loadingLessons.set(true);
    this.lessonsError.set('');
    console.info('[Admin.Curriculum.UI.Load.Start]', { status: 'lessons' });
    try {
      const target = page === 1 ? this.selectedLessonVersionId() : '';
      let nextPage = page;
      do {
        const response = await firstValueFrom(this.api.lessons(nextPage));
        if (this.destroyed) return;
        this.lessons.update((items) =>
          nextPage === 1
            ? response.items
            : [
                ...new Map(
                  [...items, ...response.items].map((lesson) => [lesson.versionId, lesson]),
                ).values(),
              ],
        );
        this.lessonsPage.set(nextPage);
        this.moreLessons.set(response.hasMore);
        if (!target || this.selectedLesson() || !response.hasMore) break;
        nextPage++;
      } while (nextPage <= 1000);
      if (target && !this.selectedLesson())
        this.lessonsError.set('الدرس المحدد غير متاح في المكتبة. اختر درسًا محفوظًا من القائمة.');
      console.info('[Admin.Curriculum.UI.Load.Success]', {
        status: 'lessons',
        count: this.lessons().length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (this.destroyed) return;
      this.lessonsError.set(this.describe(error, 'تعذر تحميل الدروس المحفوظة. حاول مجددًا.'));
      this.loadFailed(error, started);
    } finally {
      if (!this.destroyed) this.loadingLessons.set(false);
    }
  }

  selectGroup(groupId: string): void {
    if (this.publishing() || groupId === this.selectedGroupId()) return;
    this.selectedGroupId.set(groupId);
    this.success.set('');
    this.publishError.set('');
    this.reviewRequired.set(false);
    this.syncQuery();
    void this.loadCurriculum();
  }

  selectLesson(versionId: string): void {
    if (this.publishing()) return;
    this.selectedLessonVersionId.set(versionId);
    this.success.set('');
    this.publishError.set('');
    this.syncQuery();
  }

  setPosition(field: 'weekNumber' | 'dayNumber' | 'sortOrder', value: number | null): void {
    if (this.publishing()) return;
    this[field].set(value);
    this.success.set('');
    this.publishError.set('');
  }

  async loadCurriculum(): Promise<void> {
    const groupId = this.selectedGroupId();
    const readId = ++this.curriculumReadId;
    this.curriculumError.set('');
    if (this.curriculum()?.groupId !== groupId) this.curriculum.set(null);
    if (!this.selectedGroup()) {
      this.loadingCurriculum.set(false);
      return;
    }
    const started = Date.now();
    this.loadingCurriculum.set(true);
    console.info('[Admin.Curriculum.UI.Load.Start]', { groupId, status: 'curriculum' });
    try {
      const response = await firstValueFrom(this.api.curriculum(groupId));
      if (this.destroyed || readId !== this.curriculumReadId) return;
      if (response.groupId !== groupId) throw new Error('curriculum_group_mismatch');
      this.curriculum.set(response);
      this.groups.update((items) =>
        items.map((group) =>
          group.id === groupId ? { ...group, currentVersionId: response.versionId } : group,
        ),
      );
      console.info('[Admin.Curriculum.UI.Load.Success]', {
        groupId,
        versionId: response.versionId,
        count: response.lessons.length,
        status: 'curriculum',
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (this.destroyed || readId !== this.curriculumReadId) return;
      this.curriculumError.set(
        this.describe(error, 'تعذر تحديث منهج المجموعة. أعد تحميله قبل النشر.'),
      );
      this.loadFailed(error, started, groupId);
    } finally {
      if (!this.destroyed && readId === this.curriculumReadId) this.loadingCurriculum.set(false);
    }
  }

  confirmReview(): void {
    if (
      this.loadingCurriculum() ||
      this.curriculumError() ||
      this.curriculum()?.groupId !== this.selectedGroupId()
    )
      return;
    this.reviewRequired.set(false);
    this.publishAttempt = null;
    this.publishError.set('');
  }

  async publish(): Promise<void> {
    if (this.publishing()) return;
    if (!this.canPublish()) {
      if (!this.reviewRequired() && this.publishedSignature() !== this.selectionSignature())
        this.publishError.set(
          'اختر المجموعة والدرس، وحمّل منهج المجموعة، وحدد أسبوعًا ويومًا وترتيبًا ضمن الحدود المطلوبة.',
        );
      return;
    }
    const signature = this.selectionSignature();
    if (this.publishAttempt?.signature !== signature) {
      this.publishAttempt = {
        signature,
        request: {
          requestId: crypto.randomUUID(),
          groupId: this.selectedGroupId(),
          lessonVersionId: this.selectedLessonVersionId(),
          expectedVersionId: this.curriculum()!.versionId,
          weekNumber: this.weekNumber()!,
          dayNumber: this.dayNumber()!,
          sortOrder: this.sortOrder()!,
        },
      };
    }
    // Retain the whole request, including expectedVersionId, after an uncertain network result.
    const request = this.publishAttempt.request;
    const started = Date.now();
    this.publishing.set(true);
    this.publishError.set('');
    this.success.set('');
    console.info('[Admin.Curriculum.UI.Publish.Start]', {
      requestId: request.requestId,
      groupId: request.groupId,
      lessonVersionId: request.lessonVersionId,
      expectedVersionId: request.expectedVersionId,
    });
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(this.api.publish(request));
      console.info('[Admin.Curriculum.UI.Publish.Success]', {
        groupId: result.groupId,
        versionId: result.versionId,
        slotId: result.slotId,
        status: 'published',
        durationMs: Date.now() - started,
      });
      if (this.destroyed) return;
      this.publishedSignature.set(signature);
      this.publishAttempt = null;
      this.groups.update((items) =>
        items.map((group) =>
          group.id === result.groupId ? { ...group, currentVersionId: result.versionId } : group,
        ),
      );
      this.success.set('تم إضافة الدرس إلى منهج المجموعة ونشره للطلاب.');
      // A failed refresh does not undo a confirmed publication or send another POST.
      await this.loadCurriculum();
    } catch (error) {
      console.warn('[Admin.Curriculum.UI.Publish.Failed]', {
        requestId: request.requestId,
        groupId: request.groupId,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
      if (this.destroyed) return;
      this.publishError.set(this.describe(error, 'تعذر النشر. احتفظنا باختياراتك؛ حاول مجددًا.'));
      if (
        error instanceof HttpErrorResponse &&
        ['publication_changed', 'publish_request_conflict'].includes(error.error?.error)
      ) {
        this.reviewRequired.set(true);
        await this.loadCurriculum();
      }
    } finally {
      if (!this.destroyed) this.publishing.set(false);
    }
  }

  private inRange(value: number | null, maximum: number): boolean {
    return value !== null && Number.isInteger(value) && value >= 1 && value <= maximum;
  }

  private queryId(value: string | null): string {
    return value && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
      ? value.toLowerCase()
      : '';
  }

  private syncQuery(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      replaceUrl: true,
      queryParams: {
        groupId: this.selectedGroupId() || null,
        lessonVersionId: this.selectedLessonVersionId() || null,
      },
    });
  }

  private status(error: unknown): number | null {
    return error instanceof HttpErrorResponse ? error.status : null;
  }

  private loadFailed(error: unknown, started: number, groupId?: string): void {
    console.warn('[Admin.Curriculum.UI.Load.Failed]', {
      ...(groupId ? { groupId } : {}),
      status: this.status(error),
      durationMs: Date.now() - started,
    });
  }

  private describe(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      switch (error.error?.error) {
        case 'active_progress_prevents_republish':
          return 'هناك تقدم طلاب بالفعل في هذه المجموعة. لا يمكن تغيير النسخة الحالية بصمت أو إعادة تقدم الطلاب إلى الصفر.';
        case 'slot_conflict':
          return 'هذا الموضع أو الدرس موجود بالفعل في منهج المجموعة. راجع الأسبوع واليوم والترتيب.';
        case 'publication_changed':
        case 'publish_request_conflict':
          return 'حدث تغيير في منهج المجموعة. نحمل أحدث نسخة؛ راجعها ثم أكد المراجعة قبل إعادة المحاولة.';
        case 'lesson_audio_missing':
          return 'لا يمكن نشر الدرس لأن ملفات الصوت غير متاحة. راجع ملفات الدرس أولًا.';
        case 'media_storage_not_configured':
        case 'media_storage_unavailable':
          return 'خدمة ملفات الصوت غير متاحة حاليًا. احتفظنا باختياراتك؛ حاول مجددًا لاحقًا.';
        case 'lesson_not_found':
          return 'الدرس المحدد غير متاح. اختر درسًا محفوظًا من المكتبة.';
        case 'group_not_found':
          return 'المجموعة المحددة غير متاحة. اختر مجموعة أخرى.';
      }
      if (error.status === 401 || error.status === 403)
        return 'لا تملك صلاحية هذه العملية. تحقق من تسجيل الدخول بحساب أدمن.';
      if (error.status === 429)
        return 'طلبات كثيرة الآن. احتفظنا باختياراتك؛ انتظر قليلًا ثم حاول مجددًا.';
    }
    return fallback;
  }
}
