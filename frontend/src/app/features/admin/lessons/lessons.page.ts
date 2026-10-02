import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
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
  readonly failedPage = signal(0);
  readonly search = signal('');
  readonly sort = signal<'newest' | 'oldest' | 'name'>('newest');
  readonly view = signal<'grid' | 'list'>('grid');
  readonly visibleLessons = computed(() => {
    const search = this.search().trim().toLocaleLowerCase();
    const items = this.lessons().filter((item) =>
      `${item.title} ${item.description}`.toLocaleLowerCase().includes(search),
    );
    if (this.sort() === 'oldest') return [...items].reverse();
    if (this.sort() === 'name') return [...items].sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    return items;
  });
  ngOnInit(): void {
    void this.load(1);
  }
  async load(page: number): Promise<void> {
    if (this.loading() && this.page() !== 0) return;
    const started = Date.now();
    console.info('[Admin.Lessons.UI.List.Start]', { page });
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await firstValueFrom(this.api.lessons(page));
      this.lessons.update((items) => (page === 1 ? result.items : [...items, ...result.items]));
      this.more.set(result.hasMore);
      this.page.set(page);
      this.failedPage.set(0);
      console.info('[Admin.Lessons.UI.List.Success]', {
        page,
        count: result.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.error.set(true);
      this.failedPage.set(page);
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
