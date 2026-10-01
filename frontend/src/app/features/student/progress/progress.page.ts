import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Curriculum, StudentLearningApi } from '../learning.api';

@Component({
  selector: 'app-student-progress-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './progress.page.html',
  styleUrl: './progress.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentProgressPage implements OnInit {
  private readonly api = inject(StudentLearningApi);
  readonly data = signal<Curriculum | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    const started = Date.now();
    console.info('[Student.Progress.UI.Load.Start]', { page: 1, pageSize: 20 });
    this.loading.set(true);
    this.error.set(false);
    try {
      const data = await firstValueFrom(this.api.curriculum(1, 20));
      this.data.set(data);
      console.info('[Student.Progress.UI.Load.Success]', {
        count: data.items.length,
        completed: this.completed(data),
        hasMore: data.hasMore,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(true);
      console.warn('[Student.Progress.UI.Load.Failed]', {
        status: (error as { status?: number }).status ?? null,
        durationMs: Date.now() - started,
      });
    } finally {
      this.loading.set(false);
    }
  }
  completed(course: Curriculum): number {
    return course.items.filter((item) => item.isComplete).length;
  }
}
