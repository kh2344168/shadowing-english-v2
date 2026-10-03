import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Curriculum, LessonCard, StudentLearningApi } from '../learning.api';

@Component({
  selector: 'app-student-dashboard-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './student-dashboard.page.html',
  styleUrl: './student-dashboard.page.scss',
})
export class StudentDashboardPage implements OnInit {
  private readonly api = inject(StudentLearningApi);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly curriculum = signal<Curriculum | null>(null);
  readonly visibleLessons = computed(() =>
    [...(this.curriculum()?.items ?? [])].sort(StudentDashboardPage.compareLessons),
  );
  readonly currentLesson = computed(
    () => this.visibleLessons().find((lesson) => !lesson.isComplete) ?? null,
  );
  readonly completedCount = computed(
    () => this.visibleLessons().filter((lesson) => lesson.isComplete).length,
  );

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const started = Date.now();
    console.info('[Student.Dashboard.UI.Load.Start]', { page: 1, pageSize: 5 });
    this.loading.set(true);
    this.error.set(false);
    try {
      const curriculum = await firstValueFrom(this.api.curriculum(1, 5));
      this.curriculum.set(curriculum);
      console.info('[Student.Dashboard.UI.Load.Success]', {
        groupAssigned: curriculum.groupName !== null,
        curriculumPublished: curriculum.curriculumTitle !== null,
        count: curriculum.items.length,
        hasMore: curriculum.hasMore,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(true);
      console.warn('[Student.Dashboard.UI.Load.Failed]', {
        status: (error as { status?: number }).status ?? null,
        durationMs: Date.now() - started,
      });
    } finally {
      this.loading.set(false);
    }
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
