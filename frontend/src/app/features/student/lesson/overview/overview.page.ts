import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LessonOverview, StudentLearningApi } from '../../learning.api';

@Component({
  selector: 'app-student-overview-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './overview.page.html',
  styleUrl: './overview.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentLessonOverviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);

  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly lesson = signal<LessonOverview | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly missing = signal(false);
  readonly progressPercent = computed(() => {
    const lesson = this.lesson();
    if (!lesson || lesson.segmentCount < 1) return 0;
    return Math.min(100, Math.round((lesson.completedSegments / lesson.segmentCount) * 100));
  });
  readonly remainingSegments = computed(() => {
    const lesson = this.lesson();
    return lesson ? Math.max(lesson.segmentCount - lesson.completedSegments, 0) : 0;
  });
  readonly actionLabel = computed(() => {
    const lesson = this.lesson();
    if (!lesson) return '';
    if (lesson.isComplete) return 'راجع تدريب Shadowing';
    return lesson.completedSegments > 0 ? 'أكمل التدريب' : 'ابدأ التدريب';
  });

  ngOnInit(): void {
    if (!this.slotId) {
      this.missing.set(true);
      this.loading.set(false);
      console.warn('[Student.Overview.UI.Route.MissingSlotId]');
      return;
    }
    void this.load();
  }

  async load(): Promise<void> {
    const started = Date.now();
    console.info('[Student.Overview.UI.Load.Start]', { slotId: this.slotId });
    this.loading.set(true);
    this.error.set(false);
    this.missing.set(false);
    try {
      const lesson = await firstValueFrom(this.api.overview(this.slotId));
      this.lesson.set(lesson);
      console.info('[Student.Overview.UI.Load.Success]', {
        slotId: this.slotId,
        segmentCount: lesson.segmentCount,
        completedSegments: lesson.completedSegments,
        isComplete: lesson.isComplete,
        durationMs: Date.now() - started,
      });
    } catch (ex) {
      const status = (ex as { status?: number }).status ?? null;
      if (status === 404) this.missing.set(true);
      else this.error.set(true);
      console.warn('[Student.Overview.UI.Load.Failed]', {
        slotId: this.slotId,
        status,
        durationMs: Date.now() - started,
      });
    } finally {
      this.loading.set(false);
    }
  }
}
