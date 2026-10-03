import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AdminGroupsApi,
  AdminStudentDetail,
  AdminStudentLessonProgress,
  GroupHistoryItem,
} from '../../groups/groups.api';

@Component({
  selector: 'app-admin-student-details-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './student-details.page.html',
  styleUrl: './student-details.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminStudentDetailsPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(AdminGroupsApi);
  private detailRequest = 0;
  private historyRequest = 0;
  private readonly dateFormatter = new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  readonly detail = signal<AdminStudentDetail | null>(null);
  readonly history = signal<GroupHistoryItem[]>([]);
  readonly loading = signal(true);
  readonly loadingMoreLessons = signal(false);
  readonly loadingHistory = signal(false);
  readonly loadingMoreHistory = signal(false);
  readonly error = signal('');
  readonly historyError = signal('');
  readonly lessonPage = signal(1);
  readonly historyPage = signal(1);
  readonly moreHistory = signal(false);

  readonly progressPercent = computed(() => {
    const summary = this.detail()?.progress;
    if (!summary?.totalSegments) return 0;
    return Math.min(100, Math.round((summary.completedSegments / summary.totalSegments) * 100));
  });

  readonly hasUnpublishedChanges = computed(() => {
    const detail = this.detail();
    if (!detail?.assignedCurriculum || !detail.publication) return false;
    return (
      detail.assignedCurriculum.id !== detail.publication.curriculumTemplateId ||
      detail.assignedCurriculum.draftRevision !== detail.publication.sourceDraftRevision
    );
  });

  ngOnInit(): void {
    const studentId = this.route.snapshot.paramMap.get('studentId') ?? '';
    if (!studentId) {
      this.error.set('معرف الطالب غير موجود.');
      this.loading.set(false);
      return;
    }
    void this.load(studentId, 1);
    void this.loadHistory(studentId, 1);
  }

  async load(studentId: string, page = 1): Promise<void> {
    const request = ++this.detailRequest;
    const started = Date.now();
    const append = page > 1;
    if (append) this.loadingMoreLessons.set(true);
    else this.loading.set(true);
    this.error.set('');
    console.info('[Admin.StudentDetails.UI.Load.Start]', { studentId, page });
    try {
      const response = await firstValueFrom(this.api.studentDetail(studentId, page));
      if (request !== this.detailRequest) return;
      if (append && this.detail()) {
        const current = this.detail()!;
        const known = new Set(current.lessons.map((item) => item.slotId));
        this.detail.set({
          ...response,
          lessons: [...current.lessons, ...response.lessons.filter((item) => !known.has(item.slotId))],
        });
      } else {
        this.detail.set(response);
      }
      this.lessonPage.set(page);
      console.info('[Admin.StudentDetails.UI.Load.Success]', {
        studentId,
        page,
        returnedLessons: response.lessons.length,
        visibleLessons: response.progress.visibleLessons,
        hasMore: response.hasMoreLessons,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (request !== this.detailRequest) return;
      this.error.set(this.describe(error));
      console.warn('[Admin.StudentDetails.UI.Load.Failed]', {
        studentId,
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      if (request === this.detailRequest) {
        this.loading.set(false);
        this.loadingMoreLessons.set(false);
      }
    }
  }

  async loadMoreLessons(): Promise<void> {
    const detail = this.detail();
    if (!detail?.hasMoreLessons || this.loadingMoreLessons()) return;
    await this.load(detail.student.id, this.lessonPage() + 1);
  }

  async loadHistory(studentId: string, page = 1): Promise<void> {
    const request = ++this.historyRequest;
    const started = Date.now();
    const append = page > 1;
    if (append) this.loadingMoreHistory.set(true);
    else this.loadingHistory.set(true);
    this.historyError.set('');
    console.info('[Admin.StudentDetails.UI.History.Start]', { studentId, page });
    try {
      const response = await firstValueFrom(this.api.history(studentId, page));
      if (request !== this.historyRequest) return;
      this.history.update((current) => {
        if (!append) return response.items;
        const known = new Set(current.map((item) => item.membershipId));
        return [...current, ...response.items.filter((item) => !known.has(item.membershipId))];
      });
      this.historyPage.set(page);
      this.moreHistory.set(response.hasMore);
      console.info('[Admin.StudentDetails.UI.History.Success]', {
        studentId,
        page,
        count: response.items.length,
        hasMore: response.hasMore,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (request !== this.historyRequest) return;
      this.historyError.set('تعذر تحميل تاريخ المجموعات.');
      console.warn('[Admin.StudentDetails.UI.History.Failed]', {
        studentId,
        page,
        status: this.status(error),
        durationMs: Date.now() - started,
      });
    } finally {
      if (request === this.historyRequest) {
        this.loadingHistory.set(false);
        this.loadingMoreHistory.set(false);
      }
    }
  }

  async loadMoreHistory(): Promise<void> {
    const detail = this.detail();
    if (!detail || !this.moreHistory() || this.loadingMoreHistory()) return;
    await this.loadHistory(detail.student.id, this.historyPage() + 1);
  }

  lessonStatus(lesson: AdminStudentLessonProgress): string {
    if (lesson.isComplete) return 'مكتمل';
    if (lesson.completedSegments > 0) return 'قيد التقدم';
    return 'لم يبدأ';
  }

  lessonPercent(lesson: AdminStudentLessonProgress): number {
    if (!lesson.totalSegments) return 0;
    return Math.min(100, Math.round((lesson.completedSegments / lesson.totalSegments) * 100));
  }

  publicationLabel(detail: AdminStudentDetail): string {
    if (!detail.activeGroup) return 'الطالب بدون مجموعة؛ لا يوجد منهج متاح.';
    if (!detail.publication) {
      return detail.assignedCurriculum
        ? 'يوجد منهج مسند كمسودة، لكنه غير منشور للطالب.'
        : 'لا يوجد منهج منشور للمجموعة الحالية.';
    }
    if (!detail.publication.isAvailableNow) {
      return `تم إنشاء إصدار منشور، لكنه غير متاح للطالب حتى ${this.formatTime(detail.publication.availableAtUtc)}.`;
    }
    return 'الإصدار المنشور الحالي متاح الآن؛ الدروس أدناه هي فقط الدروس التي تسمح بها قواعد Student API الحالية.';
  }

  formatTime(value: string | null | undefined): string {
    return value ? this.dateFormatter.format(new Date(value)) : '—';
  }

  private status(error: unknown): number | null {
    return error instanceof HttpErrorResponse ? error.status : null;
  }

  private describe(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404 || error.error?.error === 'student_not_found') return 'الطالب غير موجود أو لم يعد يحمل دور Student.';
      if (error.status === 401 || error.status === 403) return 'لا تملك صلاحية عرض ملف الطالب.';
    }
    return 'تعذر تحميل ملف الطالب من الـBackend. حاول مرة أخرى.';
  }
}
