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
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminGroupsApi, GroupHistoryItem, GroupStudent, StudyGroup } from './groups.api';

@Component({
  selector: 'app-admin-groups-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './groups.page.html',
  styleUrl: './groups.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminGroupsPage implements OnInit {
  private readonly api = inject(AdminGroupsApi);
  private readonly auth = inject(AuthService);
  private readonly dateFormatter = new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  private studentRequestId = 0;
  private historyRequestId = 0;
  private createAttempt: { name: string; requestId: string } | null = null;

  readonly groups = signal<StudyGroup[]>([]);
  readonly groupSearchTerm = signal('');
  readonly visibleGroups = computed(() => {
    const query = this.groupSearchTerm().trim().toLocaleLowerCase();
    return query
      ? this.groups().filter((group) => group.name.toLocaleLowerCase().includes(query))
      : this.groups();
  });
  readonly students = signal<GroupStudent[]>([]);
  readonly history = signal<GroupHistoryItem[]>([]);
  readonly loadingGroups = signal(true);
  readonly loadingStudents = signal(true);
  readonly loadingHistory = signal(false);
  readonly savingGroup = signal(false);
  readonly movingStudentId = signal<string | null>(null);
  readonly confirmMoveId = signal<string | null>(null);
  readonly historyStudentId = signal<string | null>(null);
  readonly groupsPage = signal(1);
  readonly studentsPage = signal(1);
  readonly historyPage = signal(1);
  readonly moreGroups = signal(false);
  readonly moreStudents = signal(false);
  readonly moreHistory = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly createOpen = signal(false);

  groupName = '';
  searchQuery = '';
  targetGroupIds: Record<string, string> = {};

  ngOnInit(): void {
    void Promise.all([this.loadGroups(), this.loadStudents()]);
  }

  filterLoadedGroups(query: string): void {
    const started = Date.now();
    console.debug('[Admin.Groups.UI.Filter.Start]', { queryLength: query.trim().length });
    this.groupSearchTerm.set(query);
    console.debug('[Admin.Groups.UI.Filter.Success]', {
      loadedCount: this.groups().length,
      visibleCount: this.visibleGroups().length,
      durationMs: Date.now() - started,
    });
  }

  async loadGroups(page = 1): Promise<void> {
    const started = Date.now();
    this.loadingGroups.set(true);
    console.info('[Admin.Groups.UI.List.Start]', { page });
    try {
      const response = await firstValueFrom(this.api.listGroups(page));
      this.groups.update((current) =>
        page === 1 ? response.items : [...current, ...response.items],
      );
      this.groupsPage.set(page);
      this.moreGroups.set(response.hasMore);
      console.info('[Admin.Groups.UI.List.Success]', {
        page,
        count: response.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(this.describeError(error));
      console.warn('[Admin.Groups.UI.List.Failed]', {
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.loadingGroups.set(false);
    }
  }

  async createGroup(): Promise<void> {
    const name = this.groupName.trim();
    if (this.savingGroup() || name.length < 2 || name.length > 120) return;
    if (this.createAttempt?.name !== name)
      this.createAttempt = { name, requestId: crypto.randomUUID() };
    this.savingGroup.set(true);
    this.error.set('');
    this.success.set('');
    const started = Date.now();
    console.info('[Admin.Groups.UI.Create.Start]', {
      nameLength: name.length,
      requestId: this.createAttempt.requestId,
    });
    try {
      await firstValueFrom(this.auth.csrf());
      const created = await firstValueFrom(
        this.api.createGroup(name, this.createAttempt.requestId),
      );
      this.createAttempt = null;
      this.groupName = '';
      this.createOpen.set(false);
      this.success.set('تم إنشاء المجموعة. تقدر الآن تسند إليها الطلاب.');
      await this.loadGroups(1);
      console.info('[Admin.Groups.UI.Create.Success]', {
        groupId: created.id,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(this.describeError(error));
      console.warn('[Admin.Groups.UI.Create.Failed]', {
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.savingGroup.set(false);
    }
  }

  async loadStudents(page = 1): Promise<void> {
    const started = Date.now();
    const requestId = ++this.studentRequestId;
    const query = this.searchQuery.trim();
    this.loadingStudents.set(true);
    console.info('[Admin.Groups.UI.Students.Start]', { page, queryLength: query.length });
    try {
      const response = await firstValueFrom(this.api.searchStudents(query, page));
      if (requestId !== this.studentRequestId) return;
      this.students.set(response.items);
      this.studentsPage.set(page);
      this.moreStudents.set(response.hasMore);
      this.targetGroupIds = Object.fromEntries(
        response.items.map((student) => [student.id, student.activeGroup?.groupId ?? '']),
      );
      console.info('[Admin.Groups.UI.Students.Success]', {
        page,
        count: response.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (requestId !== this.studentRequestId) return;
      this.error.set(this.describeError(error));
      console.warn('[Admin.Groups.UI.Students.Failed]', {
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      if (requestId === this.studentRequestId) this.loadingStudents.set(false);
    }
  }

  searchStudents(): void {
    this.historyStudentId.set(null);
    this.confirmMoveId.set(null);
    this.error.set('');
    void this.loadStudents(1);
  }

  setTarget(studentId: string, groupId: string): void {
    this.targetGroupIds[studentId] = groupId;
    this.confirmMoveId.set(null);
  }

  targetChanged(student: GroupStudent): boolean {
    return (this.targetGroupIds[student.id] || null) !== (student.activeGroup?.groupId ?? null);
  }

  isGroupLoaded(id: string): boolean {
    return this.groups().some((group) => group.id === id);
  }

  async applyMove(studentId: string): Promise<void> {
    const student = this.students().find((item) => item.id === studentId);
    if (
      !student ||
      !this.targetChanged(student) ||
      this.confirmMoveId() !== studentId ||
      this.movingStudentId()
    )
      return;

    const groupId = this.targetGroupIds[studentId] || null;
    this.movingStudentId.set(studentId);
    this.error.set('');
    this.success.set('');
    const started = Date.now();
    console.info('[Admin.Groups.UI.Move.Start]', { studentId, groupId });
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(
        this.api.moveStudent(studentId, groupId, student.activeGroup?.membershipId ?? null),
      );
      this.confirmMoveId.set(null);
      await this.loadStudents(this.studentsPage());
      if (this.historyStudentId() === studentId) await this.loadHistory(studentId, 1);
      this.success.set(
        groupId
          ? 'تم نقل الطالب، وسجل المجموعات السابقة محفوظ.'
          : 'الطالب الآن بدون مجموعة، وسجل عضويته السابقة محفوظ.',
      );
      console.info('[Admin.Groups.UI.Move.Success]', {
        studentId,
        groupId: result.groupId,
        membershipId: result.membershipId,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409)
        await this.loadStudents(this.studentsPage());
      this.error.set(this.describeError(error));
      console.warn('[Admin.Groups.UI.Move.Failed]', {
        studentId,
        groupId,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.movingStudentId.set(null);
    }
  }

  async loadHistory(studentId: string, page = 1): Promise<void> {
    if (this.historyStudentId() !== studentId) this.history.set([]);
    const requestId = ++this.historyRequestId;
    this.historyStudentId.set(studentId);
    this.loadingHistory.set(true);
    const started = Date.now();
    console.info('[Admin.Groups.UI.History.Start]', { studentId, page });
    try {
      const response = await firstValueFrom(this.api.history(studentId, page));
      if (requestId !== this.historyRequestId || this.historyStudentId() !== studentId) return;
      this.history.update((current) =>
        page === 1 ? response.items : [...current, ...response.items],
      );
      this.historyPage.set(page);
      this.moreHistory.set(response.hasMore);
      console.info('[Admin.Groups.UI.History.Success]', {
        studentId,
        page,
        count: response.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (requestId !== this.historyRequestId || this.historyStudentId() !== studentId) return;
      this.error.set(this.describeError(error));
      console.warn('[Admin.Groups.UI.History.Failed]', {
        studentId,
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      if (requestId === this.historyRequestId) this.loadingHistory.set(false);
    }
  }

  formatTime(value: string): string {
    return this.dateFormatter.format(new Date(value));
  }

  private status(error: unknown): number | null {
    return error instanceof HttpErrorResponse ? error.status : null;
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.error?.error === 'membership_changed')
        return 'عضوية الطالب تغيّرت أثناء التعديل. حمّلنا أحدث بياناته، ثم راجع المجموعة وأعد المحاولة.';
      if (error.error?.error === 'invalid_group_name')
        return 'اسم المجموعة يجب أن يكون بين حرفين و120 حرفًا.';
      if (error.error?.error === 'student_not_found')
        return 'حساب الطالب غير موجود أو لم يعد طالبًا.';
      if (error.error?.error === 'group_not_found')
        return 'المجموعة غير موجودة. حدّث قائمة المجموعات.';
      if (error.status === 400) return 'البيانات غير صحيحة أو انتهت جلسة الحماية. حاول مرة أخرى.';
      if (error.status === 401 || error.status === 403) return 'لا تملك صلاحية إدارة المجموعات.';
      if (error.status === 429) return 'طلبات التعديل كثيرة. حاول بعد دقيقة.';
    }
    return 'تعذر إتمام العملية. تحقق من اتصال الـBackend وحاول مرة أخرى.';
  }
}
