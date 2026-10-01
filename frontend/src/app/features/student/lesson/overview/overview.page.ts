import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
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
  ngOnInit(): void {
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
