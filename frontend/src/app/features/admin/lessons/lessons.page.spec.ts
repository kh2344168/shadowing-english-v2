import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthoringLesson, ShadowingAuthoringApi } from '../lesson-builder/shadowing-authoring.api';
import { AdminLessonsPage } from './lessons.page';

@Component({ selector: 'app-library-destination', standalone: true, template: '' })
class LibraryDestination {}

function lesson(
  number: number,
  title: string,
  description: string,
  segmentCount: number,
): AuthoringLesson {
  const suffix = String(number).padStart(12, '0');
  return {
    id: `11111111-1111-4111-8111-${suffix}`,
    versionId: `22222222-2222-4222-8222-${suffix}`,
    title,
    description,
    segmentCount,
  };
}

const first = lesson(1, 'Zebra', 'At the airport', 15);
const second = lesson(2, 'Apple', 'Ordering meals', 4);
const third = lesson(3, 'Banana', 'Daily conversation', 8);
const fourth = lesson(4, 'Orange', 'Speaking at work', 7);
const fifth = lesson(5, 'Kiwi', '', 3);
const sixth = lesson(6, 'Travel', 'Customer service', 10);
const seventh = lesson(7, 'Hotel', 'Checking in', 5);
const initialLessons = [first, second, third, fourth, fifth];

describe('AdminLessonsPage V1 parity', () => {
  let fixture: ComponentFixture<AdminLessonsPage>;
  let http: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLessonsPage],
      providers: [
        provideRouter([
          { path: 'admin/ai-processing', component: LibraryDestination },
          { path: 'admin/curriculums', component: LibraryDestination },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fixture = TestBed.createComponent(AdminLessonsPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  async function render(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function initial(items = initialLessons, hasMore = false): Promise<void> {
    const request = http.expectOne('/api/admin/shadowing/lessons?page=1');
    expect(request.request.method).toBe('GET');
    request.flush({ items, hasMore });
    await render();
  }
  function button(label: string): HTMLButtonElement {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const found = buttons.find((item) => item.textContent?.includes(label));
    expect(found).toBeTruthy();
    return found!;
  }
  function titles(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.lesson-title')).map((item) =>
      (item as HTMLElement).textContent!.trim(),
    );
  }
  function search(value: string): void {
    const input = fixture.nativeElement.querySelector('#lesson-search') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  function sort(value: string): void {
    const select = fixture.nativeElement.querySelector('#lesson-sort') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('loads backend data in API order with saved badges, real metadata and no visible IDs', async () => {
    await initial();
    expect(titles()).toEqual(initialLessons.map((item) => item.title));
    expect(fixture.nativeElement.querySelectorAll('.lesson-card').length).toBe(5);
    const card = fixture.nativeElement.querySelector('.lesson-card') as HTMLElement;
    expect(card.textContent).toContain('محفوظ');
    expect(card.textContent).toContain(first.description);
    expect(card.textContent).toContain('15');
    expect(fixture.nativeElement.textContent).toContain('بدون وصف.');
    for (const item of initialLessons) {
      expect(fixture.nativeElement.textContent).not.toContain(item.id);
      expect(fixture.nativeElement.textContent).not.toContain(item.versionId);
    }
  });

  it('shows loading without an empty state or quick add before the response', async () => {
    expect(fixture.componentInstance.loading()).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'جارٍ تحميل الدروس',
    );
    expect(fixture.nativeElement.querySelector('.quick-add-card')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('لا توجد دروس محفوظة');
    await initial();
  });

  it('preserves the requested content structure inside the shared shell', async () => {
    await initial();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe('مكتبة الدروس والتمارين');
    expect(fixture.nativeElement.querySelector('main')?.getAttribute('dir')).toBe('rtl');
    expect(fixture.nativeElement.querySelectorAll('.workflow-steps li').length).toBe(3);
    expect(fixture.nativeElement.querySelector('.workflow-steps')?.textContent).toContain(
      'إنشاء ومعالجة وحفظ الدرس',
    );
    expect(fixture.nativeElement.querySelector('.workflow-steps')?.textContent).toContain(
      'اختر المجموعة ثم انشر للطلاب',
    );
    expect(fixture.nativeElement.textContent).toContain('حفظ الدرس لا يعني نشره');
    expect(fixture.nativeElement.querySelector('aside')).toBeNull();
    expect(fixture.nativeElement.querySelector('.library-toolbar')).toBeTruthy();
    expect(
      fixture.nativeElement
        .querySelector('.lesson-collection')
        ?.lastElementChild?.classList.contains('quick-add-card'),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('.pagination-footer')).toBeTruthy();
  });

  it('shows a useful empty state with no invented lesson count', async () => {
    await initial([]);
    expect(fixture.nativeElement.textContent).toContain('لا توجد دروس محفوظة حتى الآن.');
    expect(fixture.nativeElement.textContent).toContain('0 درس محمّل');
    expect(fixture.nativeElement.querySelectorAll('.lesson-card').length).toBe(0);
    expect(fixture.nativeElement.querySelector('.pagination-footer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.quick-add-card')).toBeTruthy();
  });

  it('shows an initial error and retries page one', async () => {
    http
      .expectOne('/api/admin/shadowing/lessons?page=1')
      .flush({}, { status: 500, statusText: 'Server Error' });
    await render();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'تعذر تحميل مكتبة الدروس',
    );
    expect(fixture.nativeElement.textContent).not.toContain('لا توجد دروس محفوظة');
    button('إعادة المحاولة').click();
    await initial();
    expect(fixture.componentInstance.error()).toBe(false);
    expect(titles()).toEqual(initialLessons.map((item) => item.title));
  });

  it('searches titles case-insensitively and ignores surrounding spaces', async () => {
    await initial();
    search('  aPpLe  ');
    expect(titles()).toEqual(['Apple']);
    expect(fixture.nativeElement.textContent).toContain('1 درس');
    expect(http.match(() => true)).toEqual([]);
  });

  it('searches loaded descriptions without claiming segment-text or level search', async () => {
    await initial();
    search('AIRPORT');
    expect(titles()).toEqual(['Zebra']);
    const placeholder = fixture.nativeElement
      .querySelector('#lesson-search')
      .getAttribute('placeholder');
    expect(placeholder).toContain('عنوان');
    expect(placeholder).toContain('الوصف');
    expect(placeholder).not.toContain('جمل');
    expect(placeholder).not.toContain('مستوى');
    expect(fixture.nativeElement.textContent).toContain(
      'البحث والترتيب يشملان الدروس المحمّلة فقط',
    );
    expect(http.match(() => true)).toEqual([]);
  });

  it('distinguishes no search matches from an empty library and clears the search', async () => {
    await initial();
    search('not present');
    expect(titles()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('لا توجد دروس مطابقة للعنوان أو الوصف');
    expect(fixture.nativeElement.textContent).not.toContain('لا توجد دروس محفوظة');
    const clear = fixture.nativeElement.querySelector('.search-clear') as HTMLButtonElement;
    clear.click();
    fixture.detectChanges();
    expect(titles()).toEqual(initialLessons.map((item) => item.title));
    expect((fixture.nativeElement.querySelector('#lesson-search') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('sorts alphabetically using the rendered sort control', async () => {
    await initial();
    sort('alphabetical');
    expect(titles()).toEqual(['Apple', 'Banana', 'Kiwi', 'Orange', 'Zebra']);
  });

  it('sorts by highest segment count', async () => {
    await initial();
    sort('segments');
    expect(titles()).toEqual(['Zebra', 'Banana', 'Orange', 'Apple', 'Kiwi']);
    expect(fixture.componentInstance.matchingLessons().map((item) => item.segmentCount)).toEqual([
      15, 8, 7, 4, 3,
    ]);
  });

  it('restores newest API ordering without mutating the source after other sorts', async () => {
    await initial();
    sort('alphabetical');
    sort('segments');
    sort('latest');
    expect(titles()).toEqual(initialLessons.map((item) => item.title));
    expect(fixture.componentInstance.lessons()).toEqual(initialLessons);
  });

  it('switches grid/list layout and selected accessibility state without losing data', async () => {
    await initial();
    search('a');
    const before = titles();
    const list = fixture.nativeElement.querySelector(
      'button[aria-label="عرض كقائمة"]',
    ) as HTMLButtonElement;
    list.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('.lesson-collection')
        ?.classList.contains('lesson-collection--list'),
    ).toBe(true);
    expect(list.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual(before);
    const grid = fixture.nativeElement.querySelector(
      'button[aria-label="عرض شبكي"]',
    ) as HTMLButtonElement;
    grid.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.lesson-collection')?.getAttribute('data-view-mode'),
    ).toBe('grid');
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    expect(list.getAttribute('aria-pressed')).toBe('false');
    expect(http.match(() => true)).toEqual([]);
  });

  it('navigates the header create action to AI Processing', async () => {
    await initial();
    (fixture.nativeElement.querySelector('.library-create') as HTMLAnchorElement).click();
    await render();
    expect(router.url).toBe('/admin/ai-processing');
  });

  it('navigates the empty-state create action to AI Processing', async () => {
    await initial([]);
    (fixture.nativeElement.querySelector('.library-state a') as HTMLAnchorElement).click();
    await render();
    expect(router.url).toBe('/admin/ai-processing');
  });

  it('navigates the quick-add card to AI Processing without uploading in the library', async () => {
    await initial();
    (fixture.nativeElement.querySelector('.quick-add-card') as HTMLAnchorElement).click();
    await render();
    expect(router.url).toBe('/admin/ai-processing');
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    expect(http.match(() => true)).toEqual([]);
  });

  it('passes the selected version safely to curriculums', async () => {
    await initial();
    const link = fixture.nativeElement.querySelectorAll(
      '.lesson-card-actions a',
    )[1] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      '/admin/curriculums?lessonVersionId=' + second.versionId,
    );
    link.click();
    await render();
    expect(router.parseUrl(router.url).queryParams).toEqual({ lessonVersionId: second.versionId });
    expect(router.url).toContain('/admin/curriculums?');
    expect(console.info).toHaveBeenCalledWith('[Admin.Lessons.UI.CurriculumNavigate]', {
      lessonId: second.id,
      lessonVersionId: second.versionId,
      destination: '/admin/curriculums',
    });
    expect(http.match(() => true)).toEqual([]);
  });

  it('never publishes or creates a lesson on load, search, sorting or view changes', async () => {
    const api = TestBed.inject(ShadowingAuthoringApi);
    const publish = vi.spyOn(api, 'publish');
    const create = vi.spyOn(api, 'create');
    await initial();
    search('a');
    sort('alphabetical');
    fixture.componentInstance.changeView('list');
    expect(publish).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('hides unsupported actions, fields and fake filters rather than rendering dead controls', async () => {
    await initial();
    const text = fixture.nativeElement.textContent as string;
    for (const label of [
      'مراجعة المحتوى',
      'نسخ الدرس',
      'أرشفة',
      'حذف',
      'تصدير',
      'استيراد',
      'JSON',
      'المستوى A1',
      'video/mp4',
      'التكرار الافتراضي',
      'CDN',
    ]) {
      expect(text).not.toContain(label);
    }
    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(
      links.every(
        (link) =>
          link.getAttribute('href')?.startsWith('/admin/ai-processing') ||
          link.getAttribute('href')?.startsWith('/admin/curriculums'),
      ),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(1);
  });

  it('paginates cached results using working previous/next controls without duplicate GETs', async () => {
    await initial([...initialLessons, sixth, seventh]);
    button('التالي').click();
    fixture.detectChanges();
    expect(titles()).toEqual(['Travel', 'Hotel']);
    expect(fixture.nativeElement.textContent).toContain('6–7');
    expect(fixture.componentInstance.displayPage()).toBe(2);
    button('السابق').click();
    fixture.detectChanges();
    expect(titles()).toEqual(initialLessons.map((item) => item.title));
    expect(fixture.componentInstance.displayPage()).toBe(1);
    expect(http.match(() => true)).toEqual([]);
  });

  it('navigates numbered pages that represent actual loaded results', async () => {
    await initial([...initialLessons, sixth]);
    const pages = fixture.nativeElement.querySelectorAll('.page-number');
    expect(pages.length).toBe(2);
    (pages[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(titles()).toEqual(['Travel']);
    expect((pages[1] as HTMLButtonElement).getAttribute('aria-current')).toBe('page');
  });

  it('loads the next API page after reaching the last loaded display page', async () => {
    await initial(initialLessons, true);
    button('تحميل المزيد').click();
    fixture.detectChanges();
    expect(titles()).toEqual(initialLessons.map((item) => item.title));
    expect(button('تحميل المزيد').disabled).toBe(true);
    http
      .expectOne('/api/admin/shadowing/lessons?page=2')
      .flush({ items: [sixth, seventh], hasMore: false });
    await render();
    expect(titles()).toEqual(['Travel', 'Hotel']);
    expect(fixture.componentInstance.page()).toBe(2);
    expect(fixture.componentInstance.more()).toBe(false);
    expect(button('التالي').disabled).toBe(true);
  });

  it('keeps existing work after a later-page error and retries the exact failed API page', async () => {
    await initial(initialLessons, true);
    button('تحميل المزيد').click();
    http
      .expectOne('/api/admin/shadowing/lessons?page=2')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await render();
    expect(fixture.componentInstance.page()).toBe(1);
    expect(titles()).toEqual(initialLessons.map((item) => item.title));
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'الدروس المحمّلة ما زالت متاحة',
    );
    const retry = button('إعادة المحاولة');
    retry.click();
    retry.click();
    http.expectOne('/api/admin/shadowing/lessons?page=2').flush({ items: [sixth], hasMore: false });
    await render();
    expect(titles()).toEqual(['Travel']);
    expect(fixture.componentInstance.displayPage()).toBe(2);
  });

  it('prevents duplicate API calls from rapid next clicks', async () => {
    await initial(initialLessons, true);
    const next = button('تحميل المزيد');
    next.click();
    next.click();
    next.click();
    http.expectOne('/api/admin/shadowing/lessons?page=2').flush({ items: [sixth], hasMore: false });
    await render();
    expect(fixture.componentInstance.lessons()).toHaveLength(6);
  });

  it('deduplicates overlapping versions when loading more', async () => {
    await initial(initialLessons, true);
    button('تحميل المزيد').click();
    http
      .expectOne('/api/admin/shadowing/lessons?page=2')
      .flush({ items: [first, sixth], hasMore: false });
    await render();
    expect(fixture.componentInstance.lessons()).toEqual([...initialLessons, sixth]);
    expect(titles()).toEqual(['Travel']);
  });

  it('resets to the first display page when searching or sorting across all loaded data', async () => {
    await initial([...initialLessons, sixth]);
    button('التالي').click();
    fixture.detectChanges();
    search('AIRPORT');
    expect(titles()).toEqual(['Zebra']);
    expect(fixture.componentInstance.displayPage()).toBe(1);
    search('');
    button('التالي').click();
    fixture.detectChanges();
    sort('alphabetical');
    expect(fixture.componentInstance.displayPage()).toBe(1);
    expect(titles()).toEqual(['Apple', 'Banana', 'Kiwi', 'Orange', 'Travel']);
  });

  it('does not unexpectedly advance after a user changes search while a GET is in flight', async () => {
    await initial(initialLessons, true);
    button('تحميل المزيد').click();
    search('customer');
    http.expectOne('/api/admin/shadowing/lessons?page=2').flush({ items: [sixth], hasMore: false });
    await render();
    expect(fixture.componentInstance.displayPage()).toBe(1);
    expect(titles()).toEqual(['Travel']);
    expect((fixture.nativeElement.querySelector('#lesson-search') as HTMLInputElement).value).toBe(
      'customer',
    );
  });

  it('does not invent total counts or unknown page numbers from hasMore', async () => {
    await initial([first, second], true);
    expect(fixture.nativeElement.textContent).toContain('2 درس محمّل');
    expect(fixture.nativeElement.querySelectorAll('.page-number').length).toBe(1);
    expect(fixture.componentInstance.paginationPages()).toEqual([1]);
    expect(fixture.componentInstance.pageCount()).toBe(1);
    expect(fixture.nativeElement.textContent).not.toContain('18 درس');
  });

  it('reloads backend data on a fresh page instance instead of relying on local lesson storage', async () => {
    await initial([first]);
    fixture.destroy();
    fixture = TestBed.createComponent(AdminLessonsPage);
    fixture.detectChanges();
    await initial([second, first]);
    expect(titles()).toEqual(['Apple', 'Zebra']);
  });

  it('has mobile-friendly semantic controls without fixed desktop layout in its markup', async () => {
    await initial();
    expect(fixture.nativeElement.querySelector('main')?.getAttribute('style')).toBeNull();
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label="عرض كقائمة"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#lesson-search')?.getAttribute('type')).toBe(
      'search',
    );
    expect(
      fixture.nativeElement.querySelector('nav[aria-label="صفحات الدروس المحمّلة"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.innerHTML).not.toMatch(/width:\s*(980|1200|1440)px/);
  });

  it('logs safe diagnostics without search strings, content, or backend error bodies', async () => {
    await initial(initialLessons, true);
    search('airport');
    sort('segments');
    fixture.componentInstance.changeView('list');
    search('');
    button('تحميل المزيد').click();
    http
      .expectOne('/api/admin/shadowing/lessons?page=2')
      .flush(
        { error: 'private-error', transcript: 'private-transcript', token: 'private-token' },
        { status: 500, statusText: 'Server Error' },
      );
    await render();
    expect(console.info).toHaveBeenCalledWith('[Admin.Lessons.UI.List.Start]', { page: 1 });
    expect(console.info).toHaveBeenCalledWith(
      '[Admin.Lessons.UI.List.Success]',
      expect.objectContaining({ page: 1, count: 5, durationMs: expect.any(Number) }),
    );
    expect(console.info).toHaveBeenCalledWith(
      '[Admin.Lessons.UI.Search]',
      expect.objectContaining({ queryLength: 7, matchCount: 1, durationMs: expect.any(Number) }),
    );
    expect(console.info).toHaveBeenCalledWith(
      '[Admin.Lessons.UI.Sort]',
      expect.objectContaining({ sort: 'segments' }),
    );
    expect(console.info).toHaveBeenCalledWith('[Admin.Lessons.UI.ViewMode]', { viewMode: 'list' });
    expect(console.warn).toHaveBeenCalledWith(
      '[Admin.Lessons.UI.List.Failed]',
      expect.objectContaining({ page: 2, status: 500, durationMs: expect.any(Number) }),
    );
    const logs = JSON.stringify([
      vi.mocked(console.info).mock.calls,
      vi.mocked(console.warn).mock.calls,
    ]);
    for (const value of [
      first.title,
      first.description,
      'airport',
      'private-error',
      'private-transcript',
      'private-token',
    ])
      expect(logs).not.toContain(value);
  });
});
