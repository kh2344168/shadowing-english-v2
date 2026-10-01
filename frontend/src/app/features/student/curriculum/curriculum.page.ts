import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Curriculum, LessonCard, StudentLearningApi } from '../learning.api';

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
  private page = 0;
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.page = 0;
    this.lessons.set([]);
    this.course.set(null);
    this.error.set(false);
    this.loading.set(true);
    await this.nextPage();
    this.loading.set(false);
  }
  async nextPage(): Promise<void> {
    if (this.loadingMore() || (this.page && !this.course()?.hasMore)) return;
    const started = Date.now();
    const requestedPage = this.page + 1;
    console.info('[Student.Curriculum.UI.Page.Start]', { page: requestedPage, pageSize: 20 });
    this.loadingMore.set(true);
    this.error.set(false);
    try {
      const result = await firstValueFrom(this.api.curriculum(requestedPage, 20));
      this.page++;
      this.course.set(result);
      this.lessons.update((items) => [...items, ...result.items]);
      console.info('[Student.Curriculum.UI.Page.Success]', {
        page: requestedPage,
        count: result.items.length,
        hasMore: result.hasMore,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(true);
      console.warn('[Student.Curriculum.UI.Page.Failed]', {
        page: requestedPage,
        status: (error as { status?: number }).status ?? null,
        durationMs: Date.now() - started,
      });
    } finally {
      this.loadingMore.set(false);
    }
  }
}
