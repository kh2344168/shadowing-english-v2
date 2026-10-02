import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthoringLesson, ShadowingAuthoringApi } from '../lesson-builder/shadowing-authoring.api';

type LessonSort = 'latest' | 'alphabetical' | 'segments';
type LessonView = 'grid' | 'list';

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
  private readonly collator = new Intl.Collator('ar', { sensitivity: 'base', numeric: true });
  private failedPage: number | null = null;
  private failedAdvance = false;
  private filterRevision = 0;

  readonly lessons = signal<AuthoringLesson[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly more = signal(false);
  readonly page = signal(0);
  readonly searchTerm = signal('');
  readonly sortMode = signal<LessonSort>('latest');
  readonly viewMode = signal<LessonView>('grid');
  readonly displayPage = signal(1);
  readonly pageSize = 5;

  readonly matchingLessons = computed(() => {
    const query = this.searchTerm().trim().toLocaleLowerCase();
    const items = this.lessons().filter(
      (lesson) =>
        !query ||
        lesson.title.toLocaleLowerCase().includes(query) ||
        lesson.description.toLocaleLowerCase().includes(query),
    );
    if (this.sortMode() === 'alphabetical') {
      items.sort((a, b) => this.collator.compare(a.title, b.title));
    } else if (this.sortMode() === 'segments') {
      items.sort((a, b) => b.segmentCount - a.segmentCount);
    }
    return items;
  });
  readonly pageCount = computed(() => Math.ceil(this.matchingLessons().length / this.pageSize));
  readonly visibleLessons = computed(() =>
    this.matchingLessons().slice(
      (this.displayPage() - 1) * this.pageSize,
      this.displayPage() * this.pageSize,
    ),
  );
  readonly rangeStart = computed(() =>
    this.visibleLessons().length ? (this.displayPage() - 1) * this.pageSize + 1 : 0,
  );
  readonly rangeEnd = computed(() =>
    this.visibleLessons().length ? this.rangeStart() + this.visibleLessons().length - 1 : 0,
  );
  readonly canNext = computed(() => this.displayPage() < this.pageCount() || this.more());
  readonly paginationPages = computed(() => {
    const start = Math.max(1, Math.min(this.displayPage() - 2, this.pageCount() - 4));
    const end = Math.min(this.pageCount(), start + 4);
    return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  });

  ngOnInit(): void {
    void this.load(1);
  }

  async load(page: number, advance = false): Promise<void> {
    if (
      this.loading() ||
      !Number.isInteger(page) ||
      page < 1 ||
      (page !== 1 && (page !== this.page() + 1 || !this.more()))
    )
      return;
    const started = Date.now();
    const revision = this.filterRevision;
    console.info('[Admin.Lessons.UI.List.Start]', { page });
    this.loading.set(true);
    this.error.set(false);
    this.failedPage = null;
    this.failedAdvance = false;
    try {
      const result = await firstValueFrom(this.api.lessons(page));
      this.lessons.update((items) => {
        const combined = page === 1 ? result.items : [...items, ...result.items];
        return [...new Map(combined.map((lesson) => [lesson.versionId, lesson])).values()];
      });
      this.more.set(result.hasMore);
      this.page.set(page);
      if (page === 1) this.displayPage.set(1);
      else if (
        advance &&
        revision === this.filterRevision &&
        this.displayPage() < this.pageCount()
      ) {
        this.displayPage.update((value) => value + 1);
      }
      console.info('[Admin.Lessons.UI.List.Success]', {
        page,
        count: result.items.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.failedPage = page;
      this.failedAdvance = advance && revision === this.filterRevision;
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

  retry(): void {
    if (this.error() && this.failedPage !== null)
      void this.load(this.failedPage, this.failedAdvance);
  }

  previousPage(): void {
    this.goToPage(this.displayPage() - 1);
  }

  goToPage(page: number): void {
    if (!this.loading() && Number.isInteger(page) && page >= 1 && page <= this.pageCount()) {
      this.displayPage.set(page);
    }
  }

  nextPage(): void {
    if (this.loading() || this.error()) return;
    if (this.displayPage() < this.pageCount()) this.displayPage.update((value) => value + 1);
    else if (this.more()) void this.load(this.page() + 1, true);
  }

  searchLessons(value: string): void {
    const started = Date.now();
    this.searchTerm.set(value.slice(0, 160));
    this.filtersChanged();
    console.info('[Admin.Lessons.UI.Search]', {
      queryLength: this.searchTerm().trim().length,
      loadedCount: this.lessons().length,
      matchCount: this.matchingLessons().length,
      durationMs: Date.now() - started,
    });
  }

  changeSort(value: string): void {
    if (value !== 'latest' && value !== 'alphabetical' && value !== 'segments') return;
    const started = Date.now();
    this.sortMode.set(value);
    this.filtersChanged();
    console.info('[Admin.Lessons.UI.Sort]', {
      sort: value,
      loadedCount: this.lessons().length,
      durationMs: Date.now() - started,
    });
  }

  changeView(value: LessonView): void {
    this.viewMode.set(value);
    console.info('[Admin.Lessons.UI.ViewMode]', { viewMode: value });
  }

  assignLesson(lesson: AuthoringLesson): void {
    console.info('[Admin.Lessons.UI.CurriculumNavigate]', {
      lessonId: lesson.id,
      lessonVersionId: lesson.versionId,
      destination: '/admin/curriculums',
    });
  }

  private filtersChanged(): void {
    this.filterRevision++;
    this.failedAdvance = false;
    this.displayPage.set(1);
  }
}
