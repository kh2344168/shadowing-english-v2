import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { GroupCurriculum } from '../lesson-builder/shadowing-authoring.api';
import { AdminCurriculumsPage } from './curriculums.page';

describe('AdminCurriculumsPage', () => {
  const base = '/api/admin/shadowing';
  const group = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'مجموعة المحادثة',
    currentVersionId: null,
  };
  const otherGroup = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'مجموعة أخرى',
    currentVersionId: null,
  };
  const lesson = {
    id: '33333333-3333-4333-8333-333333333333',
    versionId: '44444444-4444-4444-8444-444444444444',
    title: 'Saved lesson',
    description: 'Saved description',
    segmentCount: 3,
  };
  const otherLesson = {
    ...lesson,
    id: '55555555-5555-4555-8555-555555555555',
    versionId: '66666666-6666-4666-8666-666666666666',
    title: 'Another lesson',
  };
  const oldVersion = '77777777-7777-4777-8777-777777777777';
  const newVersion = '88888888-8888-4888-8888-888888888888';
  const query = { groupId: group.id, lessonVersionId: lesson.versionId };
  let fixture: ComponentFixture<AdminCurriculumsPage>;
  let page: AdminCurriculumsPage;
  let http: HttpTestingController;
  let currentQuery: Record<string, string>;

  const empty = (groupId = group.id): GroupCurriculum => ({
    groupId,
    versionId: null,
    lessons: [],
  });
  const published = (versionId: string): GroupCurriculum => ({
    groupId: group.id,
    versionId,
    lessons: [
      {
        lessonId: lesson.id,
        lessonVersionId: lesson.versionId,
        title: lesson.title,
        weekNumber: 2,
        dayNumber: 3,
        sortOrder: 4,
      },
    ],
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminCurriculumsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    currentQuery = {};
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot, 'queryParamMap', 'get').mockImplementation(
      () => convertToParamMap(currentQuery),
    );
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    http.verify();
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  async function drain(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  function create(params: Record<string, string> = {}): void {
    currentQuery = params;
    fixture = TestBed.createComponent(AdminCurriculumsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  async function start(params: Record<string, string> = {}, snapshot = empty()): Promise<void> {
    create(params);
    http.expectOne(`${base}/groups?page=1`).flush({ items: [group, otherGroup], hasMore: false });
    http
      .expectOne(`${base}/lessons?page=1`)
      .flush({ items: [lesson, otherLesson], hasMore: false });
    await drain();
    if (params['groupId'])
      http.expectOne(`${base}/groups/${params['groupId']}/curriculum`).flush(snapshot);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function send(): Promise<{ pending: Promise<void>; posted: TestRequest }> {
    const pending = page.publish();
    http.expectOne('/api/auth/csrf').flush(null);
    await drain();
    return { pending, posted: http.expectOne(`${base}/publish`) };
  }

  async function succeed(posted: TestRequest, pending: Promise<void>): Promise<string> {
    const versionId = posted.request.body.requestId as string;
    posted.flush({ groupId: group.id, versionId, slotId: '99999999-9999-4999-8999-999999999999' });
    await drain();
    http.expectOne(`${base}/groups/${group.id}/curriculum`).flush(published(versionId));
    await pending;
    fixture.detectChanges();
    return versionId;
  }

  it('loads groups and saved lessons without automatically publishing or using Lesson Builder', async () => {
    await start();
    expect(page.groups().length).toBe(2);
    expect(page.lessons().length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('إدارة المناهج');
    expect(fixture.nativeElement.textContent).toContain(group.name);
    expect(fixture.nativeElement.textContent).toContain(lesson.title);
    expect(fixture.nativeElement.textContent).not.toContain(group.id);
    expect(fixture.nativeElement.querySelector('a[href="/admin/lesson-builder"]')).toBeNull();
    expect(page.canPublish()).toBe(false);
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('preselects query lessonVersionId and displays its description and segment count', async () => {
    await start({ lessonVersionId: lesson.versionId });
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    expect(fixture.nativeElement.textContent).toContain(lesson.description);
    expect(fixture.nativeElement.textContent).toContain('3 مقطع');
    page.selectGroup(group.id);
    http.expectOne(`${base}/groups/${group.id}/curriculum`).flush(empty());
    await fixture.whenStable();
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    expect(TestBed.inject(Router).navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { groupId: group.id, lessonVersionId: lesson.versionId },
      }),
    );
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('preselects query groupId and reads its actual published version', async () => {
    await start({ groupId: group.id }, published(oldVersion));
    expect(page.selectedGroupId()).toBe(group.id);
    expect(page.curriculum()?.versionId).toBe(oldVersion);
    expect(page.selectedGroup()?.currentVersionId).toBe(oldVersion);
    expect(fixture.nativeElement.textContent).toContain('يوجد منهج منشور');
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('finds deep-linked groups and lessons beyond the first page', async () => {
    create({ groupId: otherGroup.id, lessonVersionId: otherLesson.versionId });
    http.expectOne(`${base}/groups?page=1`).flush({ items: [group], hasMore: true });
    http.expectOne(`${base}/lessons?page=1`).flush({ items: [lesson], hasMore: true });
    await drain();
    http.expectOne(`${base}/groups?page=2`).flush({ items: [otherGroup], hasMore: false });
    http.expectOne(`${base}/lessons?page=2`).flush({ items: [otherLesson], hasMore: false });
    await drain();
    http.expectOne(`${base}/groups/${otherGroup.id}/curriculum`).flush(empty(otherGroup.id));
    await fixture.whenStable();
    expect(page.selectedGroup()?.id).toBe(otherGroup.id);
    expect(page.selectedLesson()?.versionId).toBe(otherLesson.versionId);
    expect(page.canPublish()).toBe(true);
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it.each([
    ['weekNumber', 0],
    ['weekNumber', 53],
    ['weekNumber', 1.5],
    ['weekNumber', null],
    ['dayNumber', 0],
    ['dayNumber', 8],
    ['dayNumber', 1.5],
    ['dayNumber', null],
    ['sortOrder', 0],
    ['sortOrder', 101],
    ['sortOrder', 1.5],
    ['sortOrder', null],
  ] as const)('blocks invalid %s=%s before any write', async (field, value) => {
    await start(query);
    page.setPosition(field, value);
    fixture.detectChanges();
    expect(page.canPublish()).toBe(false);
    expect(
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    await page.publish();
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('sends the correct selected lesson, group, position and read snapshot after explicit publication', async () => {
    await start(query, { ...empty(), versionId: oldVersion });
    page.setPosition('weekNumber', 2);
    page.setPosition('dayNumber', 3);
    page.setPosition('sortOrder', 4);
    const { pending, posted } = await send();
    expect(posted.request.method).toBe('POST');
    expect(posted.request.body).toEqual({
      requestId: expect.any(String),
      groupId: group.id,
      lessonVersionId: lesson.versionId,
      expectedVersionId: oldVersion,
      weekNumber: 2,
      dayNumber: 3,
      sortOrder: 4,
    });
    await succeed(posted, pending);
    expect(page.success()).toBe('تم إضافة الدرس إلى منهج المجموعة ونشره للطلاب.');
    expect(fixture.nativeElement.querySelector('ol')?.textContent).toContain(lesson.title);
    expect(page.selectedGroupId()).toBe(group.id);
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    expect(page.weekNumber()).toBe(2);
    await page.publish();
    expect(http.match(`${base}/publish`)).toEqual([]);
  });

  it('prevents double clicks both while obtaining CSRF and while posting', async () => {
    await start(query);
    const pending = page.publish();
    await page.publish();
    expect(page.publishing()).toBe(true);
    http.expectOne('/api/auth/csrf').flush(null);
    await drain();
    const posted = http.expectOne(`${base}/publish`);
    await page.publish();
    expect(http.match(`${base}/publish`)).toEqual([]);
    page.selectGroup(otherGroup.id);
    page.selectLesson(otherLesson.versionId);
    page.setPosition('weekNumber', 12);
    expect(page.selectedGroupId()).toBe(group.id);
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    expect(page.weekNumber()).toBe(1);
    await succeed(posted, pending);
  });

  it('retains requestId, expectedVersionId and every input after an uncertain failure, even after a read refresh', async () => {
    await start(query, { ...empty(), versionId: oldVersion });
    page.setPosition('weekNumber', 2);
    page.setPosition('dayNumber', 3);
    page.setPosition('sortOrder', 4);
    const first = await send();
    const body = first.posted.request.body;
    first.posted.error(new ProgressEvent('error'));
    await first.pending;
    expect(page.success()).toBe('');
    expect(page.selectedGroupId()).toBe(group.id);
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    expect([page.weekNumber(), page.dayNumber(), page.sortOrder()]).toEqual([2, 3, 4]);
    const refresh = page.loadCurriculum();
    http.expectOne(`${base}/groups/${group.id}/curriculum`).flush(published(body.requestId));
    await refresh;
    const retry = await send();
    expect(retry.posted.request.body).toEqual(body);
    await succeed(retry.posted, retry.pending);
  });

  it('uses a new requestId when the administrator changes a failed attempt', async () => {
    await start(query);
    const first = await send();
    const id = first.posted.request.body.requestId;
    first.posted.flush({ error: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
    await first.pending;
    page.setPosition('sortOrder', 2);
    const second = await send();
    expect(second.posted.request.body.requestId).not.toBe(id);
    expect(second.posted.request.body.sortOrder).toBe(2);
    await succeed(second.posted, second.pending);
  });

  it('shows published lessons on a fresh page by reading the curriculum API again', async () => {
    await start(query);
    const { pending, posted } = await send();
    const version = await succeed(posted, pending);
    fixture.destroy();
    await start(query, published(version));
    expect(page.curriculum()?.versionId).toBe(version);
    expect(fixture.nativeElement.querySelector('ol')?.textContent).toContain(lesson.title);
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it.each([
    ['active_progress_prevents_republish', 'تقدم طلاب'],
    ['slot_conflict', 'موجود بالفعل'],
    ['lesson_audio_missing', 'ملفات الصوت غير متاحة'],
  ])('explains %s without clearing the form or claiming publication', async (code, message) => {
    await start(query, { ...empty(), versionId: oldVersion });
    page.setPosition('weekNumber', 2);
    page.setPosition('dayNumber', 3);
    page.setPosition('sortOrder', 4);
    const { pending, posted } = await send();
    posted.flush({ error: code }, { status: 409, statusText: 'Conflict' });
    await pending;
    expect(page.publishError()).toContain(message);
    expect(page.success()).toBe('');
    expect(page.selectedGroupId()).toBe(group.id);
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    expect([page.weekNumber(), page.dayNumber(), page.sortOrder()]).toEqual([2, 3, 4]);
  });

  it.each(['publication_changed', 'publish_request_conflict'])(
    'reloads on %s and requires review before a new explicit request',
    async (code) => {
      await start(query, { ...empty(), versionId: oldVersion });
      const first = await send();
      const oldRequestId = first.posted.request.body.requestId;
      first.posted.flush({ error: code }, { status: 409, statusText: 'Conflict' });
      await drain();
      expect(page.reviewRequired()).toBe(true);
      expect(page.canPublish()).toBe(false);
      http.expectOne(`${base}/groups/${group.id}/curriculum`).flush(published(newVersion));
      await first.pending;
      await page.publish();
      expect(http.match((request) => request.method !== 'GET')).toEqual([]);
      expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
      page.confirmReview();
      const retry = await send();
      expect(retry.posted.request.body.requestId).not.toBe(oldRequestId);
      expect(retry.posted.request.body.expectedVersionId).toBe(newVersion);
      await succeed(retry.posted, retry.pending);
    },
  );

  it('blocks publishing when the curriculum read fails, retaining the chosen lesson and group', async () => {
    await start({ lessonVersionId: lesson.versionId });
    page.selectGroup(group.id);
    http
      .expectOne(`${base}/groups/${group.id}/curriculum`)
      .flush({ error: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(page.curriculumError()).toBeTruthy();
    expect(page.selectedGroupId()).toBe(group.id);
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    await page.publish();
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('keeps confirmed publish success when only the following read fails', async () => {
    await start(query);
    const { pending, posted } = await send();
    posted.flush({ groupId: group.id, versionId: posted.request.body.requestId, slotId: 'slot' });
    await drain();
    http
      .expectOne(`${base}/groups/${group.id}/curriculum`)
      .flush({ error: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
    await pending;
    expect(page.success()).toContain('تم إضافة الدرس');
    expect(page.curriculumError()).toBeTruthy();
    expect(page.publishError()).toBe('');
    await page.publish();
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('ignores an older curriculum response after switching groups and preserves the lesson', async () => {
    await start({ lessonVersionId: lesson.versionId });
    page.selectGroup(group.id);
    const older = http.expectOne(`${base}/groups/${group.id}/curriculum`);
    page.selectGroup(otherGroup.id);
    http.expectOne(`${base}/groups/${otherGroup.id}/curriculum`).flush(empty(otherGroup.id));
    older.flush(published(oldVersion));
    await fixture.whenStable();
    expect(page.curriculum()?.groupId).toBe(otherGroup.id);
    expect(page.curriculum()?.lessons).toEqual([]);
    expect(page.selectedLessonVersionId()).toBe(lesson.versionId);
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('reports list failures and allows explicit read retries without any publication', async () => {
    create();
    http
      .expectOne(`${base}/groups?page=1`)
      .flush({ credentials: 'SECRET' }, { status: 503, statusText: 'Unavailable' });
    http
      .expectOne(`${base}/lessons?page=1`)
      .flush({ transcript: 'PRIVATE' }, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(page.groupsError()).toBeTruthy();
    expect(page.lessonsError()).toBeTruthy();
    const groups = page.loadGroups();
    const lessons = page.loadLessons();
    http.expectOne(`${base}/groups?page=1`).flush({ items: [group], hasMore: false });
    http.expectOne(`${base}/lessons?page=1`).flush({ items: [lesson], hasMore: false });
    await Promise.all([groups, lessons]);
    expect(page.groupsError()).toBe('');
    expect(page.lessonsError()).toBe('');
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('emits safe load and publish diagnostics without lesson content, credentials or tokens', async () => {
    await start(query);
    const first = await send();
    first.posted.flush(
      {
        error: 'slot_conflict',
        token: 'SECRET_TOKEN',
        credentials: 'SECRET_PASSWORD',
        transcript: 'PRIVATE_TRANSCRIPT',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await first.pending;
    const retry = await send();
    await succeed(retry.posted, retry.pending);
    const output = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
    ]);
    for (const marker of [
      'Load.Start',
      'Load.Success',
      'Publish.Start',
      'Publish.Success',
      'Publish.Failed',
    ])
      expect(output).toContain(`Admin.Curriculum.UI.${marker}`);
    for (const privateValue of [
      'SECRET_TOKEN',
      'SECRET_PASSWORD',
      'PRIVATE_TRANSCRIPT',
      lesson.title,
      lesson.description,
    ])
      expect(output).not.toContain(privateValue);
  });
});
