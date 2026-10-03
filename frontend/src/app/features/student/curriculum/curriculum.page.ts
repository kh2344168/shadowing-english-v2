import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Curriculum, LessonCard, StudentLearningApi } from '../learning.api';

interface CurriculumDayGroup {
  dayNumber: number;
  lessons: LessonCard[];
}

interface CurriculumWeekGroup {
  weekNumber: number;
  lessonCount: number;
  days: CurriculumDayGroup[];
}

@Component({
  selector: 'app-student-curriculum-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './curriculum.page.html',
  styleUrl: './curriculum.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentCurriculumPage implements OnInit {
  private readonly api = inject(StudentLearningApi);

  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly error = signal(false);
  readonly course = signal<Curriculum | null>(null);
  readonly lessons = signal<LessonCard[]>([]);
  readonly page = signal(0);
  readonly publishedVersionId = signal<string | null>(null);
  readonly versionChanged = signal(false);

  readonly sortedLessons = computed(() =>
    [...this.lessons()].sort(StudentCurriculumPage.compareLessons),
  );
  readonly weeks = computed<CurriculumWeekGroup[]>(() => {
    const byWeek = new Map<number, Map<number, LessonCard[]>>();
    for (const lesson of this.sortedLessons()) {
      const byDay = byWeek.get(lesson.weekNumber) ?? new Map<number, LessonCard[]>();
      const dayLessons = byDay.get(lesson.dayNumber) ?? [];
      dayLessons.push(lesson);
      byDay.set(lesson.dayNumber, dayLessons);
      byWeek.set(lesson.weekNumber, byDay);
    }

    return [...byWeek.entries()]
      .sort(([a], [b]) => a - b)
      .map(([weekNumber, byDay]) => ({
        weekNumber,
        lessonCount: [...byDay.values()].reduce((total, day) => total + day.length, 0),
        days: [...byDay.entries()]
          .sort(([a], [b]) => a - b)
          .map(([dayNumber, dayLessons]) => ({
            dayNumber,
            lessons: [...dayLessons].sort(StudentCurriculumPage.compareLessons),
          })),
      }));
  });
  readonly completedCount = computed(
    () => this.sortedLessons().filter((lesson) => lesson.isComplete).length,
  );

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const started = Date.now();
    console.info('[Student.Curriculum.UI.Load.Start]', { page: 1, pageSize: 20 });
    this.page.set(0);
    this.lessons.set([]);
    this.course.set(null);
    this.publishedVersionId.set(null);
    this.versionChanged.set(false);
    this.error.set(false);
    this.loading.set(true);
    await this.nextPage();
    this.loading.set(false);
    console.info('[Student.Curriculum.UI.Load.End]', {
      loadedPage: this.page(),
      count: this.lessons().length,
      failed: this.error(),
      durationMs: Date.now() - started,
    });
  }

  async nextPage(): Promise<void> {
    if (this.loadingMore() || (this.page() > 0 && !this.course()?.hasMore)) return;

    const started = Date.now();
    const requestedPage = this.page() + 1;
    console.info('[Student.Curriculum.UI.Page.Start]', { page: requestedPage, pageSize: 20 });
    this.loadingMore.set(true);
    this.error.set(false);

    try {
      const result = await firstValueFrom(
        this.api.curriculum(
          requestedPage,
          20,
          requestedPage > 1 ? (this.publishedVersionId() ?? undefined) : undefined,
        ),
      );
      if (requestedPage > 1 && result.publishedVersionId !== this.publishedVersionId()) {
        this.resetForVersionChange();
        return;
      }
      if (requestedPage === 1) this.publishedVersionId.set(result.publishedVersionId);
      this.page.set(requestedPage);
      this.course.set(result);
      this.lessons.update((items) => {
        const merged = [...items, ...result.items];
        return [...new Map(merged.map((lesson) => [lesson.slotId, lesson])).values()];
      });
      console.info('[Student.Curriculum.UI.Page.Success]', {
        page: requestedPage,
        count: result.items.length,
        totalLoaded: this.lessons().length,
        hasMore: result.hasMore,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const failure = error as { status?: number; error?: { error?: string } };
      if (failure.status === 409 && failure.error?.error === 'curriculum_version_changed') {
        this.resetForVersionChange();
        return;
      }
      this.error.set(true);
      console.warn('[Student.Curriculum.UI.Page.Failed]', {
        page: requestedPage,
        status: failure.status ?? null,
        durationMs: Date.now() - started,
      });
    } finally {
      this.loadingMore.set(false);
    }
  }

  private resetForVersionChange(): void {
    this.lessons.set([]);
    this.course.set(null);
    this.page.set(0);
    this.publishedVersionId.set(null);
    this.versionChanged.set(true);
    this.error.set(true);
  }

  private static compareLessons(a: LessonCard, b: LessonCard): number {
    return (
      a.weekNumber - b.weekNumber ||
      a.dayNumber - b.dayNumber ||
      a.sortOrder - b.sortOrder ||
      a.slotId.localeCompare(b.slotId)
    );
  }
}
