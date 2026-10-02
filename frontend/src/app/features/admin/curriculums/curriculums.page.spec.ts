import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  AuthoringLesson,
  CurriculumDraft,
  CurriculumLesson,
  GroupCurriculumState,
} from '../lesson-builder/shadowing-authoring.api';
import { AdminCurriculumsPage } from './curriculums.page';

const curriculumId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const revision = '33333333-3333-4333-8333-333333333333';
const nextRevision = '44444444-4444-4444-8444-444444444444';
const assignmentRevision = '55555555-5555-4555-8555-555555555555';
const publicationId = '66666666-6666-4666-8666-666666666666';
const zero = '00000000-0000-0000-0000-000000000000';
const base = '/api/admin/shadowing';
const draftUrl = `${base}/curriculums/${curriculumId}`;
const groupUrl = `${base}/groups/${groupId}/curriculum`;
const assignUrl = `${base}/groups/${groupId}/curriculum-assignment`;
const publishUrl = `${base}/curriculums/publish`;
const lessons: AuthoringLesson[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'التحية',
    description: 'الدرس الأول',
    segmentCount: 2,
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    versionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    title: 'التعارف',
    description: 'الدرس الثاني',
    segmentCount: 3,
  },
];
function slot(index = 0, weekNumber = 1, dayNumber = 1, sortOrder = 1): CurriculumLesson {
  const lesson = lessons[index];
  return {
    lessonId: lesson.id,
    lessonVersionId: lesson.versionId,
    title: lesson.title,
    description: lesson.description,
    segmentCount: lesson.segmentCount,
    weekNumber,
    dayNumber,
    sortOrder,
  };
}
function savedDraft(overrides: Partial<CurriculumDraft> = {}): CurriculumDraft {
  return {
    id: curriculumId,
    name: 'منهج البداية',
    description: 'مسودة مستقلة',
    draftRevision: revision,
    updatedAtUtc: '2026-10-02T10:00:00Z',
    lessons: [slot()],
    ...overrides,
  };
}
function state(overrides: Partial<GroupCurriculumState> = {}): GroupCurriculumState {
  return {
    groupId,
    groupName: 'مجموعة البداية',
    assignedCurriculumTemplateId: null,
    assignedCurriculumName: null,
    draftRevision: null,
    assignmentRevision: zero,
    versionId: null,
    publishedCurriculumTemplateId: null,
    publishedTitle: null,
    publishedDraftRevision: null,
    versionNumber: null,
    hasUnpublishedChanges: false,
    lessons: [],
    ...overrides,
  };
}
function assigned(overrides: Partial<GroupCurriculumState> = {}): GroupCurriculumState {
  return state({
    assignedCurriculumTemplateId: curriculumId,
    assignedCurriculumName: 'منهج البداية',
    draftRevision: revision,
    assignmentRevision,
    hasUnpublishedChanges: true,
    ...overrides,
  });
}

describe('AdminCurriculumsPage — independent curriculum flow', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<AdminCurriculumsPage>;
  let page: AdminCurriculumsPage;
  let query: Record<string, string>;
  async function drain(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }
  async function initialize(
    params: Record<string, string> = {},
    draft = savedDraft(),
    group = state(),
  ): Promise<void> {
    query = params;
    fixture = TestBed.createComponent(AdminCurriculumsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`${base}/curriculums?page=1`).flush({
      items: [{ ...draft, lessonCount: draft.lessons.length, weekCount: 1 }],
      hasMore: false,
    });
    http.expectOne(`${base}/lessons?page=1`).flush({ items: lessons, hasMore: false });
    http.expectOne(`${base}/groups?page=1`).flush({
      items: [{ id: groupId, name: group.groupName, currentVersionId: group.versionId }],
      hasMore: false,
    });
    await drain();
    if (params['curriculumId']) {
      http.expectOne(draftUrl).flush(draft);
      await drain();
    }
    if (params['groupId']) {
      http.expectOne(groupUrl).flush(group);
      await drain();
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function writing(url: string) {
    http.expectOne('/api/auth/csrf').flush(null);
    await drain();
    return http.expectOne(url);
  }
  function noWrites(): void {
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
    expect(http.match(`${base}/publish`)).toEqual([]);
  }
  beforeEach(async () => {
    query = {};
    await TestBed.configureTestingModule({
      imports: [AdminCurriculumsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return convertToParamMap(query);
              },
            },
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => http.verify());

  it('loads curricula, saved lessons and groups without automatically writing', async () => {
    await initialize();
    expect(page.curriculums()[0].id).toBe(curriculumId);
    expect(page.lessons()).toEqual(lessons);
    expect(page.groups()[0].id).toBe(groupId);
    expect(page.draft()).toBeNull();
    expect(page.loading()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('إدارة المناهج');
    noWrites();
  });
  it('retains the linked lesson without adding or publishing it', async () => {
    await initialize({ lessonVersionId: lessons[1].versionId, curriculumId });
    expect(page.selectedLessonVersionId).toBe(lessons[1].versionId);
    expect(page.slots()).toEqual([slot()]);
    expect(page.dirty()).toBe(false);
    noWrites();
  });
  it('preselects the group and restores its persisted assignment', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    expect(page.selectedGroupId()).toBe(groupId);
    expect(page.groupState()?.assignedCurriculumTemplateId).toBe(curriculumId);
    expect(page.canPublish()).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain(groupId);
    noWrites();
  });
  it('ignores invalid deep links', async () => {
    await initialize({ lessonVersionId: '<private-token>' });
    expect(page.selectedLessonVersionId).toBe('');
    expect(page.error()).toContain('غير صالح');
    noWrites();
  });
  it('shows load failure without fabricating data or exposing response contents', async () => {
    fixture = TestBed.createComponent(AdminCurriculumsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    for (const resource of ['curriculums', 'lessons', 'groups'])
      http
        .expectOne(`${base}/${resource}?page=1`)
        .flush({ error: 'credential-private' }, { status: 503, statusText: 'Unavailable' });
    await drain();
    await fixture.whenStable();
    expect(page.error()).toBeTruthy();
    expect(page.curriculums()).toEqual([]);
    expect(page.error()).not.toContain('credential-private');
    fixture.detectChanges();
    expect(page.curriculumsLoaded()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('لا توجد مناهج مطابقة');
    noWrites();
  });
  it('loads additional lesson pages to retain a library selection', async () => {
    query = { lessonVersionId: lessons[1].versionId };
    fixture = TestBed.createComponent(AdminCurriculumsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`${base}/curriculums?page=1`).flush({ items: [], hasMore: false });
    http.expectOne(`${base}/groups?page=1`).flush({ items: [], hasMore: false });
    http.expectOne(`${base}/lessons?page=1`).flush({ items: [lessons[0]], hasMore: true });
    await drain();
    http.expectOne(`${base}/lessons?page=2`).flush({ items: [lessons[1]], hasMore: false });
    await fixture.whenStable();
    expect(page.selectedLesson()).toEqual(lessons[1]);
    noWrites();
  });
  it('creates a backend draft without assignment or publication', async () => {
    await initialize();
    page.newName = 'منهج جديد';
    page.newDescription = 'وصف جديد';
    const creating = page.createCurriculum();
    const request = await writing(`${base}/curriculums`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ name: 'منهج جديد', description: 'وصف جديد' });
    request.flush(savedDraft({ name: 'منهج جديد', lessons: [] }));
    await creating;
    expect(page.slots()).toEqual([]);
    expect(page.dirty()).toBe(false);
    noWrites();
  });
  it('retries uncertain creation with the same request', async () => {
    await initialize();
    page.newName = 'منهج جديد';
    const creating = page.createCurriculum();
    const first = await writing(`${base}/curriculums`);
    const body = first.request.body;
    first.flush(null, { status: 503, statusText: 'Unavailable' });
    await creating;
    expect(page.uncertain()).toBe(true);
    const retry = page.retryFailedOperation();
    const second = await writing(`${base}/curriculums`);
    expect(second.request.body).toEqual(body);
    second.flush(savedDraft({ lessons: [] }));
    await retry;
    expect(page.uncertain()).toBe(false);
    noWrites();
  });
  it('stages add/remove/reorder until explicit Save', async () => {
    await initialize({ curriculumId });
    page.openPicker();
    page.selectedLessonVersionId = lessons[1].versionId;
    page.sortOrder = 2;
    page.applyPlacement();
    expect(page.dirty()).toBe(true);
    expect(page.slots()).toHaveLength(2);
    page.moveLesson(page.slots()[1], -1);
    expect(page.weeks()[0].days[0].lessons[0].lessonVersionId).toBe(lessons[1].versionId);
    page.removeLesson(page.slots()[0]);
    expect(page.slots()).toHaveLength(1);
    noWrites();
  });
  const invalidPositions: { field: 'weekNumber' | 'dayNumber' | 'sortOrder'; value: number }[] = [
    { field: 'weekNumber', value: 0 },
    { field: 'weekNumber', value: 53 },
    { field: 'weekNumber', value: 1.5 },
    { field: 'dayNumber', value: 0 },
    { field: 'dayNumber', value: 8 },
    { field: 'dayNumber', value: 1.5 },
    { field: 'sortOrder', value: 0 },
    { field: 'sortOrder', value: 101 },
    { field: 'sortOrder', value: Number.NaN },
  ];
  for (const { field, value } of invalidPositions)
    it(`blocks ${field}=${value}`, async () => {
      await initialize({ curriculumId });
      page.openPicker();
      page.selectedLessonVersionId = lessons[1].versionId;
      page[field] = value;
      page.applyPlacement();
      expect(page.slots()).toHaveLength(1);
      expect(page.error()).toContain('موضعًا صحيحًا');
      noWrites();
    });
  it('blocks duplicate lessons and occupied positions', async () => {
    await initialize({ curriculumId });
    page.openPicker();
    page.selectedLessonVersionId = lessons[0].versionId;
    page.applyPlacement();
    expect(page.error()).toContain('موجود بالفعل');
    page.selectedLessonVersionId = lessons[1].versionId;
    page.sortOrder = 1;
    page.applyPlacement();
    expect(page.slots()).toHaveLength(1);
    expect(page.error()).toContain('موجود بالفعل');
    noWrites();
  });
  it('blocks saving an invalid name', async () => {
    await initialize({ curriculumId });
    page.name.set('x');
    await page.saveCurriculum();
    expect(page.error()).toContain('راجع اسم');
    noWrites();
  });
  it('saves the complete ordered draft with its revision without assigning or publishing', async () => {
    await initialize({ curriculumId });
    page.name.set('منهج محفوظ');
    page.slots.set([slot(1, 2, 3, 4), slot(0, 1, 2, 2)]);
    const saving = page.saveCurriculum();
    const request = await writing(draftUrl);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({
      expectedDraftRevision: revision,
      name: 'منهج محفوظ',
      lessons: [
        { lessonVersionId: lessons[0].versionId, weekNumber: 1, dayNumber: 2, sortOrder: 2 },
        { lessonVersionId: lessons[1].versionId, weekNumber: 2, dayNumber: 3, sortOrder: 4 },
      ],
    });
    request.flush(
      savedDraft({
        name: 'منهج محفوظ',
        draftRevision: nextRevision,
        lessons: [slot(0, 1, 2, 2), slot(1, 2, 3, 4)],
      }),
    );
    await saving;
    expect(page.dirty()).toBe(false);
    noWrites();
  });
  it('prevents double clicking Save before CSRF and its response complete', async () => {
    await initialize({ curriculumId });
    page.name.set('منهج محفوظ');
    const first = page.saveCurriculum();
    const second = page.saveCurriculum();
    const tokens = http.match('/api/auth/csrf');
    expect(tokens).toHaveLength(1);
    tokens[0].flush(null);
    await drain();
    const request = http.expectOne(draftUrl);
    expect(http.match(draftUrl)).toEqual([]);
    request.flush(savedDraft({ name: 'منهج محفوظ', draftRevision: nextRevision }));
    await Promise.all([first, second]);
    noWrites();
  });
  it('Save retry preserves request ID revision positions and inputs', async () => {
    await initialize({ curriculumId });
    page.name.set('منهج محفوظ');
    page.slots.set([slot(0, 3, 5, 9)]);
    const saving = page.saveCurriculum();
    const first = await writing(draftUrl);
    const body = first.request.body;
    first.flush(null, { status: 503, statusText: 'Unavailable' });
    await saving;
    expect(page.name()).toBe('منهج محفوظ');
    expect(page.slots()[0].sortOrder).toBe(9);
    expect(page.locked()).toBe(true);
    const retry = page.retryFailedOperation();
    const second = await writing(draftUrl);
    expect(second.request.body).toEqual(body);
    second.flush(
      savedDraft({ name: 'منهج محفوظ', draftRevision: nextRevision, lessons: [slot(0, 3, 5, 9)] }),
    );
    await retry;
    expect(page.dirty()).toBe(false);
    expect(page.uncertain()).toBe(false);
    noWrites();
  });
  it('Assign separately persists a selection without publishing', async () => {
    await initialize({ curriculumId, groupId });
    const assigning = page.assignCurriculum();
    const request = await writing(assignUrl);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({
      curriculumTemplateId: curriculumId,
      expectedAssignmentRevision: zero,
    });
    request.flush(assigned());
    await assigning;
    expect(page.canPublish()).toBe(true);
    expect(page.groupState()?.versionId).toBeNull();
    noWrites();
  });
  it('blocks assignment of unsaved edits and publication before assignment', async () => {
    await initialize({ curriculumId, groupId });
    page.name.set('غير محفوظ');
    await page.assignCurriculum();
    await page.publishCurriculum();
    expect(page.canPublish()).toBe(false);
    noWrites();
  });
  it('assignment retry keeps the entire request', async () => {
    await initialize({ curriculumId, groupId });
    const assigning = page.assignCurriculum();
    const first = await writing(assignUrl);
    const body = first.request.body;
    first.flush(null, { status: 503, statusText: 'Unavailable' });
    await assigning;
    const retry = page.retryFailedOperation();
    const second = await writing(assignUrl);
    expect(second.request.body).toEqual(body);
    second.flush(assigned());
    await retry;
    expect(page.groupState()?.assignedCurriculumTemplateId).toBe(curriculumId);
    noWrites();
  });
  it('explicit Publish sends full curriculum context and updates the visible published state', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    noWrites();
    const publishing = page.publishCurriculum();
    const request = await writing(publishUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({
      groupId,
      curriculumTemplateId: curriculumId,
      expectedDraftRevision: revision,
      expectedAssignmentRevision: assignmentRevision,
      expectedVersionId: null,
    });
    expect(request.request.body.lessonVersionId).toBeUndefined();
    request.flush({ versionId: publicationId });
    await drain();
    http.expectOne(groupUrl).flush(
      assigned({
        versionId: publicationId,
        publishedCurriculumTemplateId: curriculumId,
        publishedTitle: 'منهج البداية',
        publishedDraftRevision: revision,
        versionNumber: 1,
        hasUnpublishedChanges: false,
        lessons: [slot()],
      }),
    );
    await publishing;
    fixture.detectChanges();
    expect(page.success()).toContain('تم نشر المنهج كاملًا');
    expect(page.groupState()?.lessons).toHaveLength(1);
    expect(page.canPublish()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('التحية');
    noWrites();
  });
  it('double clicking Publish sends one POST', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    const first = page.publishCurriculum();
    const second = page.publishCurriculum();
    const request = await writing(publishUrl);
    expect(http.match(publishUrl)).toEqual([]);
    request.flush({ error: 'lesson_audio_missing' }, { status: 409, statusText: 'Conflict' });
    await Promise.all([first, second]);
    noWrites();
  });
  it('uncertain Publish retries the exact request and retains all selections', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    const publishing = page.publishCurriculum();
    const first = await writing(publishUrl);
    const body = first.request.body;
    first.flush(null, { status: 503, statusText: 'Unavailable' });
    await publishing;
    expect(page.selectedGroupId()).toBe(groupId);
    expect(page.draft()?.id).toBe(curriculumId);
    expect(page.canRetryPublish()).toBe(true);
    const retry = page.retryFailedOperation();
    const second = await writing(publishUrl);
    expect(second.request.body).toEqual(body);
    second.flush({ versionId: publicationId });
    await drain();
    http
      .expectOne(groupUrl)
      .flush(assigned({ versionId: publicationId, hasUnpublishedChanges: false }));
    await retry;
    noWrites();
  });
  it('confirmed Publish followed by failed refresh cannot publish stale state again', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    const publishing = page.publishCurriculum();
    const request = await writing(publishUrl);
    request.flush({ versionId: publicationId });
    await drain();
    http.expectOne(groupUrl).flush(null, { status: 503, statusText: 'Unavailable' });
    await publishing;
    expect(page.success()).toContain('تم نشر');
    expect(page.groupState()).toBeNull();
    expect(page.canPublish()).toBe(false);
    await page.publishCurriculum();
    noWrites();
  });
  for (const [code, message] of [
    ['active_progress_prevents_republish', 'يوجد تقدم طلاب'],
    ['slot_conflict', 'موجود بالفعل'],
    ['lesson_audio_missing', 'ملفات صوت'],
  ])
    it(`explains ${code} while retaining draft/group/positions`, async () => {
      await initialize({ curriculumId, groupId }, savedDraft(), assigned());
      const publishing = page.publishCurriculum();
      const request = await writing(publishUrl);
      request.flush({ error: code }, { status: 409, statusText: 'Conflict' });
      await publishing;
      expect(page.error()).toContain(message);
      expect(page.draft()?.id).toBe(curriculumId);
      expect(page.selectedGroupId()).toBe(groupId);
      expect(page.slots()).toEqual([slot()]);
      noWrites();
    });
  it('does not publish unsaved edits after an earlier failed publication', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    const first = page.publishCurriculum();
    const request = await writing(publishUrl);
    request.flush({ error: 'lesson_audio_missing' }, { status: 409, statusText: 'Conflict' });
    await first;
    page.name.set('تعديل غير محفوظ');
    await page.publishCurriculum();
    expect(page.canPublish()).toBe(false);
    noWrites();
  });
  it('a newly saved revision starts a new publish attempt after a confirmed failure', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    const publishing = page.publishCurriculum();
    const first = await writing(publishUrl);
    const originalId = first.request.body.requestId;
    first.flush({ error: 'lesson_audio_missing' }, { status: 409, statusText: 'Conflict' });
    await publishing;
    page.name.set('مسودة جديدة');
    const saving = page.saveCurriculum();
    const save = await writing(draftUrl);
    save.flush(savedDraft({ name: 'مسودة جديدة', draftRevision: nextRevision }));
    await drain();
    http.expectOne(groupUrl).flush(assigned({ draftRevision: nextRevision }));
    await saving;
    const next = page.publishCurriculum();
    const request = await writing(publishUrl);
    expect(request.request.body.requestId).not.toBe(originalId);
    expect(request.request.body.expectedDraftRevision).toBe(nextRevision);
    request.flush({ error: 'lesson_audio_missing' }, { status: 409, statusText: 'Conflict' });
    await next;
    noWrites();
  });
  it('publication conflict reads latest group state and requires explicit review', async () => {
    await initialize({ curriculumId, groupId }, savedDraft(), assigned());
    const publishing = page.publishCurriculum();
    const request = await writing(publishUrl);
    request.flush({ error: 'publication_changed' }, { status: 409, statusText: 'Conflict' });
    await drain();
    http.expectOne(groupUrl).flush(assigned({ versionId: publicationId }));
    await publishing;
    expect(page.reviewRequired()).toBe(true);
    expect(page.canPublish()).toBe(false);
    await page.publishCurriculum();
    noWrites();
    const reload = page.reloadSaved();
    http.expectOne(draftUrl).flush(savedDraft());
    await drain();
    http.expectOne(groupUrl).flush(assigned({ versionId: publicationId }));
    await reload;
    expect(page.reviewRequired()).toBe(false);
    expect(page.groupState()?.versionId).toBe(publicationId);
    noWrites();
  });
  it('stale Save retains edits until explicit reload', async () => {
    await initialize({ curriculumId });
    page.name.set('تعديل محلي');
    const saving = page.saveCurriculum();
    const request = await writing(draftUrl);
    request.flush({ error: 'draft_changed' }, { status: 409, statusText: 'Conflict' });
    await saving;
    expect(page.name()).toBe('تعديل محلي');
    expect(page.reviewRequired()).toBe(true);
    await page.saveCurriculum();
    noWrites();
    const reload = page.reloadSaved();
    http.expectOne(draftUrl).flush(savedDraft({ name: 'تعديل آخر', draftRevision: nextRevision }));
    await reload;
    expect(page.name()).toBe('تعديل آخر');
    expect(page.dirty()).toBe(false);
    expect(page.reviewRequired()).toBe(false);
  });
  it('refresh restores persisted order assignment and publication entirely through GET', async () => {
    await initialize({ curriculumId });
    fixture.destroy();
    const persisted = savedDraft({ lessons: [slot(1, 2, 3, 7), slot(0, 5, 1, 2)] });
    await initialize(
      { curriculumId, groupId },
      persisted,
      assigned({
        versionId: publicationId,
        publishedCurriculumTemplateId: curriculumId,
        publishedDraftRevision: revision,
        hasUnpublishedChanges: false,
        lessons: persisted.lessons,
      }),
    );
    expect(page.weeks().map((week) => week.number)).toEqual([2, 5]);
    expect(page.weeks()[0].days[0].lessons[0].sortOrder).toBe(7);
    expect(page.groupState()?.versionId).toBe(publicationId);
    expect(page.dirty()).toBe(false);
    noWrites();
  });
  it('diagnostics record safe results counts and duration without content or credentials', async () => {
    await initialize({ curriculumId });
    page.name.set('Private curriculum title sentinel');
    page.description.set('Private curriculum description sentinel');
    const saving = page.saveCurriculum();
    const request = await writing(draftUrl);
    request.flush(
      {
        error: 'token-private-sentinel',
        transcript: 'private-transcript-sentinel',
        credentials: 'private-password-sentinel',
      },
      { status: 503, statusText: 'Unavailable' },
    );
    await saving;
    const logs = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
    ]);
    expect(logs).toContain('Admin.Curriculum.UI.Load.Start');
    expect(logs).toContain('Admin.Curriculum.UI.Load.Success');
    expect(logs).toContain('Admin.Curriculum.UI.Update.Start');
    expect(logs).toContain('Admin.Curriculum.UI.Update.Failed');
    expect(logs).toContain('durationMs');
    expect(logs).toContain('count');
    for (const privateValue of [
      'Private curriculum title sentinel',
      'Private curriculum description sentinel',
      'token-private-sentinel',
      'private-transcript-sentinel',
      'private-password-sentinel',
    ])
      expect(logs).not.toContain(privateValue);
  });
});
