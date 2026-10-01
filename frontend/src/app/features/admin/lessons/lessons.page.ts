import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthoringLesson, ShadowingAuthoringApi } from '../lesson-builder/shadowing-authoring.api';

@Component({
  selector: 'app-admin-lessons-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './lessons.page.html',
  styleUrl: './lessons.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLessonsPage implements OnInit {
  private readonly api = inject(ShadowingAuthoringApi);
  readonly lessons = signal<AuthoringLesson[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly more = signal(false);
  readonly page = signal(0);
  ngOnInit(): void {
    void this.load(1);
  }
  async load(page: number): Promise<void> {
    const started = Date.now();
    console.info('[Admin.Lessons.UI.List.Start]', { page });
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await firstValueFrom(this.api.lessons(page));
      this.lessons.update((items) => (page === 1 ? result.items : [...items, ...result.items]));
      this.more.set(result.hasMore);
      this.page.set(page);
      console.info('[Admin.Lessons.UI.List.Success]', {
        page,
        count: result.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(true);
      console.warn('[Admin.Lessons.UI.List.Failed]', {
        page,
        status: (error as { status?: number }).status ?? null,
        durationMs: Date.now() - started,
      });
    } finally {
      this.loading.set(false);
    }
  }
}
