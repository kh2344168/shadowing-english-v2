import { A11yModule } from '@angular/cdk/a11y';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AuthoringGroup,
  AuthoringLesson,
  CurriculumAssignRequest,
  CurriculumDraft,
  CurriculumLesson,
  CurriculumPosition,
  CurriculumPublishRequest,
  CurriculumSaveRequest,
  CurriculumSummary,
  GroupCurriculumState,
  ShadowingAuthoringApi,
} from '../lesson-builder/shadowing-authoring.api';

@Component({
  selector: 'app-admin-curriculums-page',
  standalone: true,
  imports: [FormsModule, DatePipe, A11yModule],
  templateUrl: './curriculums.page.html',
  styleUrl: './curriculums.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCurriculumsPage implements OnInit {
  private readonly api = inject(ShadowingAuthoringApi);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly original = signal('');
  private createAttempt: {
    signature: string;
    request: { requestId: string; name: string; description: string };
  } | null = null;
  private saveAttempt: { signature: string; request: CurriculumSaveRequest } | null = null;
  private assignAttempt: { signature: string; request: CurriculumAssignRequest } | null = null;
  private publishAttempt: CurriculumPublishRequest | null = null;
  private groupLoad = 0;
  private draftLoad = 0;
  readonly curriculums = signal<CurriculumSummary[]>([]);
  readonly lessons = signal<AuthoringLesson[]>([]);
  readonly groups = signal<AuthoringGroup[]>([]);
  readonly draft = signal<CurriculumDraft | null>(null);
  readonly slots = signal<CurriculumLesson[]>([]);
  readonly name = signal('');
  readonly description = signal('');
  readonly groupState = signal<GroupCurriculumState | null>(null);
  readonly selectedGroupId = signal('');
  readonly loading = signal(true);
  readonly loadingDraft = signal(false);
  readonly loadingGroup = signal(false);
  readonly loadingLessons = signal(false);
  readonly loadingCurriculums = signal(false);
  readonly loadingGroupsList = signal(false);
  readonly curriculumsLoaded = signal(false);
  readonly lessonsLoaded = signal(false);
  readonly busy = signal('');
  readonly uncertain = signal(false);
  readonly reviewRequired = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly createOpen = signal(false);
  readonly pickerOpen = signal(false);
  readonly search = signal('');
  readonly sort = signal('newest');
  readonly lessonSearch = signal('');
  readonly closedWeeks = signal<number[]>([]);
  readonly editingLessonVersionId = signal<string | null>(null);
  readonly moreCurriculums = signal(false);
  readonly moreLessons = signal(false);
  readonly moreGroups = signal(false);
  curriculumPage = 0;
  lessonPage = 0;
  groupPage = 0;
  newName = '';
  newDescription = '';
  selectedLessonVersionId = '';
  weekNumber = 1;
  dayNumber = 1;
  sortOrder = 1;
  readonly dirty = computed(() => !!this.draft() && this.signature() !== this.original());
  readonly locked = computed(
    () => !!this.busy() || this.uncertain() || this.reviewRequired() || this.loadingDraft(),
  );
  readonly visibleCurriculums = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    const rows = this.curriculums().filter(
      (x) => !query || `${x.name} ${x.description}`.toLocaleLowerCase().includes(query),
    );
    const time = (value: string | null) => (value ? Date.parse(value) : 0);
    return rows.sort((a, b) =>
      this.sort() === 'name'
        ? a.name.localeCompare(b.name, 'ar')
        : (this.sort() === 'oldest' ? 1 : -1) * (time(a.updatedAtUtc) - time(b.updatedAtUtc)),
    );
  });
  readonly visibleLessons = computed(() => {
    const query = this.lessonSearch().trim().toLocaleLowerCase();
    return this.lessons().filter(
      (x) =>
        (!query || `${x.title} ${x.description}`.toLocaleLowerCase().includes(query)) &&
        !this.slots().some(
          (s) =>
            s.lessonVersionId === x.versionId &&
            s.lessonVersionId !== this.editingLessonVersionId(),
        ),
    );
  });
  readonly weeks = computed(() =>
    [...new Set(this.slots().map((x) => x.weekNumber))]
      .sort((a, b) => a - b)
      .map((number) => ({
        number,
        days: [
          ...new Set(
            this.slots()
              .filter((x) => x.weekNumber === number)
              .map((x) => x.dayNumber),
          ),
        ]
          .sort((a, b) => a - b)
          .map((day) => ({
            number: day,
            lessons: this.slots()
              .filter((x) => x.weekNumber === number && x.dayNumber === day)
              .sort((a, b) => a.sortOrder - b.sortOrder),
          })),
      })),
  );
  readonly canPublish = computed(() => {
    const draft = this.draft(),
      group = this.groupState();
    return (
      !!draft &&
      !!group &&
      group.groupId === this.selectedGroupId() &&
      group.assignedCurriculumTemplateId === draft.id &&
      group.draftRevision === draft.draftRevision &&
      group.hasUnpublishedChanges &&
      this.slots().length > 0 &&
      !this.dirty() &&
      !this.locked() &&
      !this.loadingGroup()
    );
  });
  readonly canRetryPublish = computed(
    () => this.uncertain() && this.failedOperation() === 'Publish' && !this.busy(),
  );
  readonly failedOperation = signal('');

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadCurriculums(), this.loadLessons(), this.loadGroups()]);
    const query = this.route.snapshot.queryParamMap;
    const lessonId = query.get('lessonVersionId');
    if (lessonId && this.validId(lessonId)) {
      this.selectedLessonVersionId = lessonId;
      while (!this.lessons().some((x) => x.versionId === lessonId) && this.moreLessons()) {
        if (!(await this.loadLessons(this.lessonPage + 1))) break;
      }
      if (!this.lessons().some((x) => x.versionId === lessonId))
        this.error.set('الدرس المحدد غير متاح في مكتبة الدروس.');
    }
    const id = query.get('curriculumId');
    if (id && this.validId(id)) await this.loadDraft(id);
    const groupId = query.get('groupId');
    if (groupId && this.validId(groupId)) await this.selectGroup(groupId);
    if (
      query.keys.some(
        (key) =>
          ['curriculumId', 'lessonVersionId', 'groupId'].includes(key) &&
          !this.validId(query.get(key) ?? ''),
      )
    )
      this.error.set('الرابط يحتوي اختيارًا غير صالح. اختر من القائمة.');
    this.loading.set(false);
  }

  async loadCurriculums(page = 1): Promise<boolean> {
    if (this.loadingCurriculums()) return false;
    this.loadingCurriculums.set(true);
    try {
      return await this.read('LoadCurriculums', async () => {
        const response = await firstValueFrom(this.api.curriculums(page));
        this.curriculums.update((rows) =>
          page === 1 ? response.items : this.merge(rows, response.items, (x) => x.id),
        );
        this.moreCurriculums.set(response.hasMore);
        this.curriculumPage = page;
        this.curriculumsLoaded.set(true);
      });
    } finally {
      this.loadingCurriculums.set(false);
    }
  }
  async loadLessons(page = 1): Promise<boolean> {
    if (this.loadingLessons()) return false;
    this.loadingLessons.set(true);
    try {
      return await this.read('LoadLessons', async () => {
        const response = await firstValueFrom(this.api.lessons(page));
        this.lessons.update((rows) =>
          page === 1 ? response.items : this.merge(rows, response.items, (x) => x.versionId),
        );
        this.moreLessons.set(response.hasMore);
        this.lessonPage = page;
        this.lessonsLoaded.set(true);
      });
    } finally {
      this.loadingLessons.set(false);
    }
  }
  async loadGroups(page = 1): Promise<boolean> {
    if (this.loadingGroupsList()) return false;
    this.loadingGroupsList.set(true);
    try {
      return await this.read('LoadGroups', async () => {
        const response = await firstValueFrom(this.api.groups(page));
        this.groups.update((rows) =>
          page === 1 ? response.items : this.merge(rows, response.items, (x) => x.id),
        );
        this.moreGroups.set(response.hasMore);
        this.groupPage = page;
      });
    } finally {
      this.loadingGroupsList.set(false);
    }
  }

  async selectCurriculum(id: string): Promise<void> {
    if (this.locked() || this.dirty() || this.loading()) return;
    this.success.set('');
    this.error.set('');
    if (await this.loadDraft(id)) {
      this.saveAttempt = null;
      this.assignAttempt = null;
      this.publishAttempt = null;
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { curriculumId: id },
        queryParamsHandling: 'merge',
      });
    }
  }
  async loadDraft(id: string): Promise<boolean> {
    const sequence = ++this.draftLoad;
    this.loadingDraft.set(true);
    const result = await this.read('Load', async () => {
      const response = await firstValueFrom(this.api.curriculum(id));
      if (sequence === this.draftLoad) this.applyDraft(response);
    });
    if (sequence === this.draftLoad) this.loadingDraft.set(false);
    return result;
  }
  async selectGroup(id: string): Promise<void> {
    if (this.locked()) return;
    this.selectedGroupId.set(id);
    this.groupState.set(null);
    this.assignAttempt = null;
    this.publishAttempt = null;
    await this.refreshGroup();
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { groupId: id || null },
      queryParamsHandling: 'merge',
    });
  }
  async refreshGroup(): Promise<boolean> {
    const id = this.selectedGroupId();
    if (!id) return false;
    const sequence = ++this.groupLoad;
    this.loadingGroup.set(true);
    const result = await this.read('Load', async () => {
      const state = await firstValueFrom(this.api.groupCurriculum(id));
      if (sequence !== this.groupLoad || id !== this.selectedGroupId()) return;
      this.groupState.set(state);
      if (!this.groups().some((x) => x.id === id))
        this.groups.update((rows) => [
          ...rows,
          { id, name: state.groupName, currentVersionId: state.versionId },
        ]);
    });
    if (sequence === this.groupLoad) this.loadingGroup.set(false);
    return result;
  }
  async reloadSaved(): Promise<void> {
    if (this.busy()) return;
    if (this.uncertain() && this.failedOperation() === 'Create') {
      this.error.set('أعد محاولة الإنشاء بنفس الطلب للتحقق من نتيجته.');
      return;
    }
    const id = this.draft()?.id;
    const loaded = id ? await this.loadDraft(id) : true;
    const groupLoaded = this.selectedGroupId() ? await this.refreshGroup() : true;
    if (loaded && groupLoaded) {
      this.uncertain.set(false);
      this.reviewRequired.set(false);
      this.saveAttempt = null;
      this.assignAttempt = null;
      this.publishAttempt = null;
      this.error.set('');
      this.success.set('تم تحميل الحالة المحفوظة. راجعها قبل أي إسناد أو نشر.');
    }
  }
  async backToLibrary(): Promise<void> {
    if (this.locked() || this.dirty()) {
      this.error.set('احفظ التعديلات أو حمّل النسخة المحفوظة قبل الرجوع.');
      return;
    }
    this.draft.set(null);
    this.success.set('');
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { curriculumId: null },
      queryParamsHandling: 'merge',
    });
    await this.loadCurriculums();
  }
  async createCurriculum(): Promise<void> {
    if (this.busy() || this.dirty()) return;
    const name = this.newName.trim(),
      description = this.newDescription.trim();
    if (name.length < 2 || name.length > 160 || description.length > 1000) {
      this.error.set('راجع اسم المنهج ووصفه.');
      return;
    }
    const signature = JSON.stringify({ name, description });
    if (this.createAttempt?.signature !== signature)
      this.createAttempt = {
        signature,
        request: { requestId: crypto.randomUUID(), name, description },
      };
    const request = this.createAttempt.request;
    await this.write('Create', async () => {
      this.applyDraft(await firstValueFrom(this.api.createCurriculum(request)));
      this.createAttempt = null;
      this.createOpen.set(false);
      this.uncertain.set(false);
      this.newName = '';
      this.newDescription = '';
      this.success.set('تم إنشاء مسودة منهج مستقلة. أضف الدروس ثم احفظ التغييرات.');
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { curriculumId: this.draft()!.id },
        queryParamsHandling: 'merge',
      });
    });
  }
  async saveCurriculum(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.busy() || this.reviewRequired() || !this.dirty()) return;
    const name = this.name().trim(),
      description = this.description().trim();
    const lessons = this.positions();
    if (
      name.length < 2 ||
      name.length > 160 ||
      description.length > 1000 ||
      lessons.some((x) => !this.validPosition(x)) ||
      this.conflict(lessons)
    ) {
      this.error.set('راجع اسم المنهج والمواضع؛ يجب ألا يتكرر الدرس أو موضعه.');
      return;
    }
    const signature = this.signature();
    if (this.saveAttempt?.signature !== signature)
      this.saveAttempt = {
        signature,
        request: {
          requestId: crypto.randomUUID(),
          expectedDraftRevision: draft.draftRevision,
          name,
          description,
          lessons,
        },
      };
    const request = this.saveAttempt.request;
    const result = await this.write('Update', async () => {
      this.applyDraft(await firstValueFrom(this.api.saveCurriculum(draft.id, request)));
      this.saveAttempt = null;
      this.assignAttempt = null;
      this.publishAttempt = null;
      this.uncertain.set(false);
      this.success.set('تم حفظ المنهج وترتيب دروسه. الحفظ لا يسند المنهج ولا ينشره.');
    });
    if (result && this.selectedGroupId()) await this.refreshGroup();
  }
  async assignCurriculum(): Promise<void> {
    const draft = this.draft(),
      group = this.groupState();
    if (
      !draft ||
      !group ||
      this.busy() ||
      this.reviewRequired() ||
      this.dirty() ||
      this.loadingGroup()
    )
      return;
    const signature = `${group.groupId}:${draft.id}:${group.assignmentRevision}`;
    if (this.assignAttempt?.signature !== signature)
      this.assignAttempt = {
        signature,
        request: {
          requestId: crypto.randomUUID(),
          curriculumTemplateId: draft.id,
          expectedAssignmentRevision: group.assignmentRevision,
        },
      };
    const request = this.assignAttempt.request;
    await this.write('Assign', async () => {
      this.groupState.set(await firstValueFrom(this.api.assignCurriculum(group.groupId, request)));
      this.assignAttempt = null;
      this.uncertain.set(false);
      this.publishAttempt = null;
      this.success.set('تم إسناد المنهج للمجموعة. الطالب يرى النسخة المنشورة فقط حتى تضغط نشر.');
    });
  }
  async publishCurriculum(): Promise<void> {
    if (this.busy() || this.reviewRequired() || (!this.canPublish() && !this.canRetryPublish()))
      return;
    const draft = this.draft()!,
      group = this.groupState()!;
    this.publishAttempt ??= {
      requestId: crypto.randomUUID(),
      groupId: group.groupId,
      curriculumTemplateId: draft.id,
      expectedDraftRevision: draft.draftRevision,
      expectedAssignmentRevision: group.assignmentRevision,
      expectedVersionId: group.versionId,
    };
    const request = this.publishAttempt;
    const result = await this.write('Publish', async () => {
      await firstValueFrom(this.api.publishCurriculum(request));
      this.publishAttempt = null;
      this.uncertain.set(false);
      this.groupState.set(null);
      this.success.set(
        'تم نشر المنهج كاملًا للمجموعة. الطلاب المسندون إليها يرون النسخة المنشورة.',
      );
    });
    if (result) await this.refreshGroup();
  }
  async retryFailedOperation(): Promise<void> {
    switch (this.failedOperation()) {
      case 'Create':
        await this.createCurriculum();
        break;
      case 'Update':
        await this.saveCurriculum();
        break;
      case 'Assign':
        await this.assignCurriculum();
        break;
      case 'Publish':
        await this.publishCurriculum();
        break;
    }
  }

  openPicker(slot?: CurriculumLesson, week = 1, day = 1): void {
    if (this.locked()) return;
    this.editingLessonVersionId.set(slot?.lessonVersionId ?? null);
    if (slot) {
      this.selectedLessonVersionId = slot.lessonVersionId;
      this.weekNumber = slot.weekNumber;
      this.dayNumber = slot.dayNumber;
      this.sortOrder = slot.sortOrder;
      if (!this.lessons().some((x) => x.versionId === slot.lessonVersionId))
        this.lessons.update((rows) => [
          ...rows,
          {
            id: slot.lessonId,
            versionId: slot.lessonVersionId,
            title: slot.title,
            description: slot.description,
            segmentCount: slot.segmentCount,
          },
        ]);
    } else {
      if (this.slots().some((x) => x.lessonVersionId === this.selectedLessonVersionId))
        this.selectedLessonVersionId = '';
      this.weekNumber = week;
      this.dayNumber = day;
      this.sortOrder =
        1 +
        Math.max(
          0,
          ...this.slots()
            .filter((x) => x.weekNumber === week && x.dayNumber === day)
            .map((x) => x.sortOrder),
        );
    }
    this.lessonSearch.set('');
    this.pickerOpen.set(true);
  }
  closePicker(): void {
    if (!this.locked()) this.pickerOpen.set(false);
  }
  closeCreate(): void {
    if (!this.busy() && !this.uncertain()) this.createOpen.set(false);
  }
  selectedLesson(): AuthoringLesson | undefined {
    return this.lessons().find((x) => x.versionId === this.selectedLessonVersionId);
  }
  applyPlacement(): void {
    if (this.locked()) return;
    const lesson = this.selectedLesson();
    const position: CurriculumPosition = {
      lessonVersionId: this.selectedLessonVersionId,
      weekNumber: this.weekNumber,
      dayNumber: this.dayNumber,
      sortOrder: this.sortOrder,
    };
    if (!lesson || !this.validPosition(position)) {
      this.error.set('اختر درسًا وموضعًا صحيحًا: أسبوع 1–52، يوم 1–7، ترتيب 1–100.');
      return;
    }
    const next = this.slots().filter((x) => x.lessonVersionId !== this.editingLessonVersionId());
    if (this.conflict([...next, position])) {
      this.error.set('هذا الدرس أو موضعه موجود بالفعل داخل المنهج.');
      return;
    }
    const started = Date.now(),
      operation = this.editingLessonVersionId() ? 'ReorderLesson' : 'AddLesson';
    this.log(operation, 'Start');
    this.slots.set([
      ...next,
      {
        ...position,
        lessonId: lesson.id,
        title: lesson.title,
        description: lesson.description,
        segmentCount: lesson.segmentCount,
      },
    ]);
    this.pickerOpen.set(false);
    this.error.set('');
    this.log(operation, 'Success', started, { result: 'pending_save' });
  }
  removeLesson(slot: CurriculumLesson): void {
    if (this.locked()) return;
    const started = Date.now();
    this.log('RemoveLesson', 'Start');
    this.slots.update((rows) => rows.filter((x) => x.lessonVersionId !== slot.lessonVersionId));
    this.log('RemoveLesson', 'Success', started, { result: 'pending_save' });
  }
  moveLesson(slot: CurriculumLesson, direction: number): void {
    if (this.locked() || (direction !== 1 && direction !== -1)) return;
    const day = this.slots()
      .filter((x) => x.weekNumber === slot.weekNumber && x.dayNumber === slot.dayNumber)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const target =
      day[day.findIndex((x) => x.lessonVersionId === slot.lessonVersionId) + direction];
    if (!target) return;
    const started = Date.now();
    this.log('ReorderLesson', 'Start');
    this.slots.update((rows) =>
      rows.map((x) =>
        x.lessonVersionId === slot.lessonVersionId
          ? { ...x, sortOrder: target.sortOrder }
          : x.lessonVersionId === target.lessonVersionId
            ? { ...x, sortOrder: slot.sortOrder }
            : x,
      ),
    );
    this.log('ReorderLesson', 'Success', started, { result: 'pending_save' });
  }
  toggleWeek(week: number): void {
    this.closedWeeks.update((rows) =>
      rows.includes(week) ? rows.filter((x) => x !== week) : [...rows, week],
    );
  }
  private applyDraft(draft: CurriculumDraft): void {
    this.draft.set(draft);
    this.name.set(draft.name);
    this.description.set(draft.description);
    this.slots.set(draft.lessons.map((x) => ({ ...x })));
    this.original.set(this.signature());
    this.closedWeeks.set([]);
  }
  private positions(): CurriculumPosition[] {
    return this.slots()
      .map((x) => ({
        lessonVersionId: x.lessonVersionId,
        weekNumber: x.weekNumber,
        dayNumber: x.dayNumber,
        sortOrder: x.sortOrder,
      }))
      .sort(
        (a, b) =>
          a.weekNumber - b.weekNumber || a.dayNumber - b.dayNumber || a.sortOrder - b.sortOrder,
      );
  }
  private signature(): string {
    return JSON.stringify({
      name: this.name().trim(),
      description: this.description().trim(),
      lessons: this.positions(),
    });
  }
  private validPosition(x: CurriculumPosition): boolean {
    return (
      Number.isInteger(x.weekNumber) &&
      x.weekNumber >= 1 &&
      x.weekNumber <= 52 &&
      Number.isInteger(x.dayNumber) &&
      x.dayNumber >= 1 &&
      x.dayNumber <= 7 &&
      Number.isInteger(x.sortOrder) &&
      x.sortOrder >= 1 &&
      x.sortOrder <= 100
    );
  }
  private conflict(rows: CurriculumPosition[]): boolean {
    return (
      new Set(rows.map((x) => x.lessonVersionId)).size !== rows.length ||
      new Set(rows.map((x) => `${x.weekNumber}:${x.dayNumber}:${x.sortOrder}`)).size !== rows.length
    );
  }
  private merge<T>(rows: T[], additions: T[], key: (x: T) => string): T[] {
    const mapped = new Map(rows.map((x) => [key(x), x]));
    additions.forEach((x) => mapped.set(key(x), x));
    return [...mapped.values()];
  }
  private async read(operation: string, action: () => Promise<void>): Promise<boolean> {
    const started = Date.now();
    this.log(operation, 'Start');
    try {
      await action();
      this.log(operation, 'Success', started);
      return true;
    } catch (error) {
      this.error.set(this.describe(error));
      this.log(operation, 'Failed', started, this.safeError(error));
      return false;
    }
  }
  private async write(operation: string, action: () => Promise<void>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(operation);
    this.error.set('');
    this.success.set('');
    const started = Date.now();
    this.log(operation, 'Start');
    try {
      await firstValueFrom(this.auth.csrf());
      await action();
      this.failedOperation.set('');
      this.log(operation, 'Success', started);
      return true;
    } catch (error) {
      this.failedOperation.set(operation);
      this.error.set(this.describe(error));
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.uncertain.set(status === 0 || status >= 500);
      if (
        [
          'draft_changed',
          'assignment_changed',
          'publication_changed',
          'publish_request_conflict',
          'curriculum_changed',
          'curriculum_request_conflict',
          'assignment_request_conflict',
        ].includes(this.errorCode(error))
      ) {
        this.reviewRequired.set(true);
        if (this.selectedGroupId()) await this.refreshGroup();
      }
      this.log(operation, 'Failed', started, this.safeError(error));
      return false;
    } finally {
      this.busy.set('');
    }
  }
  private validId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }
  private log(
    operation: string,
    phase: string,
    started = Date.now(),
    extra: Record<string, unknown> = {},
  ): void {
    const curriculumId = this.draft()?.id,
      groupId = this.selectedGroupId();
    const info = {
      operation,
      result: phase.toLowerCase(),
      curriculumId: curriculumId && this.validId(curriculumId) ? curriculumId : null,
      groupId: this.validId(groupId) ? groupId : null,
      count: this.slots().length,
      durationMs: Date.now() - started,
      ...extra,
    };
    if (phase === 'Failed') console.warn(`[Admin.Curriculum.UI.${operation}.${phase}]`, info);
    else console.info(`[Admin.Curriculum.UI.${operation}.${phase}]`, info);
  }
  private safeError(error: unknown): Record<string, unknown> {
    return {
      status: error instanceof HttpErrorResponse ? error.status : null,
      errorCode: this.errorCode(error),
      errorType: error instanceof HttpErrorResponse ? 'HttpErrorResponse' : 'UnexpectedError',
    };
  }
  private errorCode(error: unknown): string {
    const value: unknown = error instanceof HttpErrorResponse ? error.error?.error : null;
    return typeof value === 'string' && Object.hasOwn(this.messages, value)
      ? value
      : 'operation_failed';
  }
  private describe(error: unknown): string {
    if (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
      return 'الجلسة غير صالحة أو لا تملك صلاحية Admin. أعد تسجيل الدخول.';
    return (
      this.messages[this.errorCode(error)] ??
      'تعذر تنفيذ العملية. احتفظ باختياراتك وأعد نفس المحاولة أو حمّل الحالة المحفوظة للمراجعة.'
    );
  }
  private readonly messages: Record<string, string> = {
    active_progress_prevents_republish:
      'يوجد تقدم طلاب بالفعل على النسخة المنشورة. لا يمكن استبدالها بصمت أو إعادة التقدم إلى الصفر.',
    slot_conflict: 'الدرس أو موضع الأسبوع واليوم والترتيب موجود بالفعل.',
    lesson_audio_missing: 'لا يمكن نشر المنهج لأن ملفات صوت بعض الدروس غير متاحة.',
    curriculum_empty: 'أضف درسًا محفوظًا للمنهج واحفظه قبل النشر.',
    lesson_not_found: 'أحد الدروس المحددة غير موجود. راجع مكتبة الدروس.',
    curriculum_not_found: 'المنهج المحدد غير متاح.',
    group_not_found: 'المجموعة المحددة غير متاحة.',
    draft_changed: 'تغيّرت مسودة المنهج. حمّل الحالة المحفوظة وراجعها قبل إعادة المحاولة.',
    assignment_changed: 'تغيّر إسناد المنهج للمجموعة. حمّل الحالة المحفوظة وراجعها.',
    publication_changed: 'تغيّرت النسخة المنشورة للمجموعة. حمّل أحدث حالة وراجعها قبل النشر.',
    publish_request_conflict: 'حدث تعارض في طلب النشر. حمّل أحدث حالة وراجعها.',
    curriculum_changed: 'حدث تعديل متزامن. حمّل الحالة المحفوظة وراجعها قبل إعادة المحاولة.',
    curriculum_request_conflict: 'تعارض طلب الحفظ مع حالة محفوظة. راجع أحدث حالة.',
    assignment_request_conflict: 'تعارض طلب الإسناد مع حالة محفوظة. راجع أحدث حالة.',
    invalid_curriculum: 'راجع اسم المنهج ووصفه ومواضع الدروس.',
    media_storage_not_configured: 'خدمة ملفات الصوت غير مهيأة. راجع مسؤول الموقع.',
    media_storage_unavailable: 'خدمة ملفات الصوت غير متاحة الآن. أعد نفس محاولة النشر لاحقًا.',
  };
}
