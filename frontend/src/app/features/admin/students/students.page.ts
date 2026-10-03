import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AdminGroupsApi,
  GroupHistoryItem,
  GroupStudent,
  StudyGroup,
} from '../groups/groups.api';

@Component({
  selector: 'app-admin-students-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './students.page.html',
  styleUrl: './students.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminStudentsPage implements OnInit {
  private readonly api = inject(AdminGroupsApi);
  private readonly auth = inject(AuthService);
  private studentRequest = 0;
  private historyRequest = 0;
  private readonly dateFormatter = new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  readonly students = signal<GroupStudent[]>([]);
  readonly groups = signal<StudyGroup[]>([]);
  readonly history = signal<GroupHistoryItem[]>([]);
  readonly loadingStudents = signal(true);
  readonly loadingGroups = signal(false);
  readonly loadingHistory = signal(false);
  readonly creating = signal(false);
  readonly movingStudentId = signal<string | null>(null);
  readonly confirmMoveId = signal<string | null>(null);
  readonly historyStudentId = signal<string | null>(null);
  readonly createOpen = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly page = signal(1);
  readonly more = signal(false);
  readonly groupsPage = signal(0);
  readonly moreGroups = signal(false);
  readonly historyPage = signal(1);
  readonly moreHistory = signal(false);
  readonly hasGroups = computed(() => this.groups().length > 0);

  searchQuery = '';
  email = '';
  password = '';
  targetGroupIds: Record<string, string> = {};

  ngOnInit(): void {
    void Promise.all([this.loadGroups(), this.loadStudents(1)]);
  }

  async loadGroups(page = 1): Promise<void> {
    if (this.loadingGroups()) return;
    const started = Date.now();
    this.loadingGroups.set(true);
    console.info('[Admin.Students.UI.Groups.Start]', { page });
    try {
      const response = await firstValueFrom(this.api.listGroups(page));
      this.groups.update((current) =>
        page === 1
          ? response.items
          : [...new Map([...current, ...response.items].map((item) => [item.id, item])).values()],
      );
      this.groupsPage.set(page);
      this.moreGroups.set(response.hasMore);
      console.info('[Admin.Students.UI.Groups.Success]', {
        page,
        count: response.items.length,
        hasMore: response.hasMore,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(this.describe(error));
      console.warn('[Admin.Students.UI.Groups.Failed]', {
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.loadingGroups.set(false);
    }
  }

  async loadStudents(page = 1): Promise<void> {
    const request = ++this.studentRequest;
    const query = this.searchQuery.trim();
    const started = Date.now();
    this.loadingStudents.set(true);
    this.error.set('');
    console.info('[Admin.Students.UI.List.Start]', { page, queryLength: query.length });
    try {
      const response = await firstValueFrom(this.api.searchStudents(query, page));
      if (request !== this.studentRequest) return;
      this.students.set(response.items);
      this.page.set(page);
      this.more.set(response.hasMore);
      this.targetGroupIds = Object.fromEntries(
        response.items.map((student) => [student.id, student.activeGroup?.groupId ?? '']),
      );
      this.confirmMoveId.set(null);
      console.info('[Admin.Students.UI.List.Success]', {
        page,
        count: response.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (request !== this.studentRequest) return;
      this.error.set(this.describe(error));
      console.warn('[Admin.Students.UI.List.Failed]', {
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      if (request === this.studentRequest) this.loadingStudents.set(false);
    }
  }

  search(): void {
    this.historyStudentId.set(null);
    this.history.set([]);
    void this.loadStudents(1);
  }

  async createStudent(): Promise<void> {
    const email = this.email.trim();
    const password = this.password;
    if (this.creating() || !email || password.length < 10) return;
    const started = Date.now();
    this.creating.set(true);
    this.error.set('');
    this.success.set('');
    console.info('[Admin.Students.UI.Create.Start]', { emailLength: email.length });
    try {
      await firstValueFrom(this.auth.csrf());
      const created = await firstValueFrom(this.api.createStudent(email, password));
      this.password = '';
      this.email = '';
      this.createOpen.set(false);
      this.searchQuery = created.email;
      await this.loadStudents(1);
      this.success.set('تم إنشاء حساب الطالب. كلمة المرور لا تُعرض أو تُحفظ في الصفحة.');
      console.info('[Admin.Students.UI.Create.Success]', {
        studentId: created.id,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.password = '';
      this.error.set(this.describe(error));
      console.warn('[Admin.Students.UI.Create.Failed]', {
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.creating.set(false);
    }
  }

  setTarget(studentId: string, groupId: string): void {
    this.targetGroupIds[studentId] = groupId;
    this.confirmMoveId.set(null);
  }

  targetChanged(student: GroupStudent): boolean {
    return (this.targetGroupIds[student.id] || null) !== (student.activeGroup?.groupId ?? null);
  }

  selectedGroupName(studentId: string): string {
    const id = this.targetGroupIds[studentId];
    return id ? this.groups().find((group) => group.id === id)?.name ?? 'المجموعة المحددة' : 'بدون مجموعة';
  }

  curriculumState(student: GroupStudent): string {
    if (!student.activeGroup) return 'بدون مجموعة — لا يوجد منهج متاح.';
    const group = this.groups().find((item) => item.id === student.activeGroup?.groupId);
    if (!group) return 'المجموعة الحالية غير محمّلة؛ تحقّق من حالة النشر قبل الحكم على الإتاحة.';
    if (!group.currentVersionId) {
      return group.assignedCurriculumTemplateId
        ? 'المنهج مُسند كمسودة فقط؛ لم يُنشر للطلاب.'
        : 'لا يوجد منهج منشور لهذه المجموعة.';
    }
    return 'يوجد إصدار منشور للمجموعة؛ Student API يطبق الإتاحة الفعلية للدروس.';
  }

  async applyMove(student: GroupStudent): Promise<void> {
    if (!this.targetChanged(student) || this.confirmMoveId() !== student.id || this.movingStudentId()) return;
    const targetGroupId = this.targetGroupIds[student.id] || null;
    const started = Date.now();
    this.movingStudentId.set(student.id);
    this.error.set('');
    this.success.set('');
    console.info('[Admin.Students.UI.Move.Start]', { studentId: student.id, targetGroupId });
    try {
      await firstValueFrom(this.auth.csrf());
      const result = await firstValueFrom(
        this.api.moveStudent(student.id, targetGroupId, student.activeGroup?.membershipId ?? null),
      );
      this.confirmMoveId.set(null);
      await this.loadStudents(this.page());
      if (this.historyStudentId() === student.id) await this.loadHistory(student.id, 1);
      this.success.set(targetGroupId ? 'تم إسناد/نقل الطالب وحُفظ تاريخ المجموعات.' : 'تم إلغاء المجموعة الحالية مع حفظ التاريخ.');
      console.info('[Admin.Students.UI.Move.Success]', {
        studentId: student.id,
        groupId: result.groupId,
        membershipId: result.membershipId,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) await this.loadStudents(this.page());
      this.error.set(this.describe(error));
      console.warn('[Admin.Students.UI.Move.Failed]', {
        studentId: student.id,
        targetGroupId,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.movingStudentId.set(null);
    }
  }

  async loadHistory(studentId: string, page = 1): Promise<void> {
    const request = ++this.historyRequest;
    if (page === 1 || this.historyStudentId() !== studentId) this.history.set([]);
    this.historyStudentId.set(studentId);
    this.loadingHistory.set(true);
    const started = Date.now();
    console.info('[Admin.Students.UI.History.Start]', { studentId, page });
    try {
      const response = await firstValueFrom(this.api.history(studentId, page));
      if (request !== this.historyRequest || this.historyStudentId() !== studentId) return;
      this.history.update((current) => (page === 1 ? response.items : [...current, ...response.items]));
      this.historyPage.set(page);
      this.moreHistory.set(response.hasMore);
      console.info('[Admin.Students.UI.History.Success]', {
        studentId,
        page,
        count: response.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (request !== this.historyRequest) return;
      this.error.set(this.describe(error));
      console.warn('[Admin.Students.UI.History.Failed]', {
        studentId,
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      if (request === this.historyRequest) this.loadingHistory.set(false);
    }
  }

  closeHistory(): void {
    this.historyRequest++;
    this.historyStudentId.set(null);
    this.history.set([]);
  }

  formatTime(value: string | null): string {
    return value ? this.dateFormatter.format(new Date(value)) : 'حتى الآن';
  }

  private status(error: unknown): number | null {
    return error instanceof HttpErrorResponse ? error.status : null;
  }

  private describe(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const code = error.error?.error;
      if (code === 'student_email_exists') return 'يوجد حساب بهذا البريد بالفعل.';
      if (code === 'invalid_student_account') return 'تحقق من البريد وكلمة المرور ومتطلبات الأمان.';
      if (code === 'membership_changed') return 'تغيّرت عضوية الطالب أثناء التعديل. تم تحميل أحدث حالة؛ راجعها ثم أعد التأكيد.';
      if (code === 'student_not_found') return 'حساب الطالب غير موجود أو لم يعد يحمل دور Student.';
      if (code === 'group_not_found') return 'المجموعة لم تعد موجودة. حدّث الصفحة.';
      if (error.status === 401 || error.status === 403) return 'لا تملك صلاحية إدارة الطلاب.';
      if (error.status === 429) return 'طلبات التعديل كثيرة حاليًا. حاول بعد قليل.';
    }
    return 'تعذر إتمام العملية. تحقق من اتصال الـBackend وحاول مرة أخرى.';
  }
}
