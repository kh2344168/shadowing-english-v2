import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { routes } from '../../../app.routes';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminLessonWorkflowPage } from './lesson-workflow.page';
import { LessonWorkflow } from './lesson-workflow.api';

describe('AdminLessonWorkflowPage', () => {
  const versionId = '11111111-2222-4333-8444-555555555555';
  const workflow: LessonWorkflow = {
    lessonId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    versionId,
    versionNumber: 1,
    title: 'Test lesson',
    description: 'Description',
    lessonType: 'clip',
    level: 'B1',
    goal: '',
    revision: '99999999-8888-4777-8666-555555555555',
    aiStatus: null,
    reviewedStages: [],
    stages: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        type: 'shadowing',
        title: 'Shadowing الأساسي',
        position: 1,
        enabled: true,
        required: true,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        type: 'vocabulary',
        title: 'الكلمات',
        position: 2,
        enabled: true,
        required: true,
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        type: 'listen-type',
        title: 'اسمع واكتب',
        position: 3,
        enabled: true,
        required: false,
      },
    ],
  };
  const draft = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    lessonVersionId: versionId,
    revision: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'Draft' as const,
    providerName: null,
    errorCode: null,
    createdAtUtc: '2026-10-12T00:00:00Z',
    approvedAtUtc: null,
    material: {
      vocabulary: [
        {
          word: 'Hello',
          meaningAr: 'مرحبًا',
          exampleEn: 'Hello world',
          exampleAr: 'مرحبًا بالعالم',
        },
      ],
      quiz: [
        {
          question: 'Choose',
          options: ['Hello', 'Bye', 'Thanks', 'Sorry'],
          correctIndex: 0,
          explanationAr: 'تحية',
          type: 'multiple-choice' as const,
        },
      ],
      grammarFocus: 'Greeting',
      conversationScenario: 'Say hello',
      dictation: [{ position: 1, enabled: true, acceptedAnswers: ['Hello world'], hint: null }],
      reviewedStages: ['vocabulary' as const, 'listen-type' as const],
    },
  };
  let fixture: ComponentFixture<AdminLessonWorkflowPage>;
  let page: AdminLessonWorkflowPage;
  let http: HttpTestingController;
  const nextRequest = (url: string) => vi.waitFor(() => http.expectOne(url));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminLessonWorkflowPage],
      providers: [
        provideRouter([
          { path: 'admin/lessons/:versionId/workflow', component: AdminLessonWorkflowPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { csrf: () => of(null) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: (key: string) => (key === 'versionId' ? versionId : null) },
            },
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AdminLessonWorkflowPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`/api/admin/lessons/${versionId}/workflow`).flush(workflow);
    http.expectOne(`/api/admin/lessons/${versionId}/ai/draft`).flush(null);
    http.expectOne(`/api/admin/lessons/${versionId}/ai/stages/statuses`).flush({
      vocabulary: 'NeedsReview',
      'listen-type': 'NeedsReview',
    });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('allows a vocabulary-only lesson without shadowing', () => {
    const [shadowing, , listenType] = page.stages();
    page.toggle(shadowing, false);
    expect(page.stages()[0].enabled).toBe(false);
    page.toggle(listenType, false);
    expect(page.stages()[2].enabled).toBe(false);
    page.move(page.stages()[1], -1);
    expect(page.stages()[0].type).toBe('vocabulary');
    expect(page.dirty()).toBe(true);
  });

  it('prevents duplicate stage types until each copy has independent content', async () => {
    const vocabulary = page.library.find((item) => item.type === 'vocabulary')!;
    expect(page.canAdd(vocabulary.type)).toBe(false);
    page.add(vocabulary);
    expect(page.stages()).toHaveLength(3);
    page.add(page.library.find((item) => item.type === 'conversation')!);
    expect(page.stages()).toHaveLength(4);
    expect(page.stages()[3].type).toBe('conversation');

    const saving = page.save();
    await Promise.resolve();
    const request = http.expectOne(`/api/admin/lessons/${versionId}/workflow`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body.expectedRevision).toBe(workflow.revision);
    expect(request.request.body.stages).toHaveLength(4);
    request.flush({ revision: 'new-revision', stages: page.stages() });
    expect(await saving).toBe(true);
    expect(page.dirty()).toBe(false);
  });

  it('shows an added stage as not started without changing the status of existing stages', () => {
    page.stageStatuses.set({ vocabulary: 'Approved', 'listen-type': 'Generating' });
    page.add(page.library.find((item) => item.type === 'conversation')!);
    const [vocabulary, listenType, conversation] = page.stages().slice(1);
    expect(page.status(vocabulary).label).toBe('معتمدة');
    expect(page.status(listenType).label).toBe('قيد المعالجة');
    expect(page.status(conversation).label).toBe('لم تبدأ');
    expect(page.stageAction(conversation)).toBe('فتح المرحلة');
    expect(page.approvalIssues().join(' ')).toContain('محادثة الدرس: لم تبدأ');
  });

  it('has no separate general AI page while keeping the stage editor route', () => {
    const admin = routes.find((route) => route.path === 'admin');
    expect(admin?.children?.some((route) => route.path === 'lessons/:versionId/ai')).toBe(false);
    expect(
      admin?.children?.some((route) => route.path === 'lessons/:versionId/workflow/:stageId'),
    ).toBe(true);
  });

  it('approves a reviewed Draft even when the workflow is already saved', async () => {
    page.latestDraft.set(draft);
    fixture.detectChanges();
    expect(page.dirty()).toBe(false);
    expect(page.canSaveAndApprove()).toBe(true);
    const operation = page.saveAndApprove();
    await Promise.resolve();
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/draft`)).flush(draft);
    const approve = await nextRequest(`/api/admin/lessons/${versionId}/ai/${draft.id}/approve`);
    expect(approve.request.body.expectedRevision).toBe(draft.revision);
    approve.flush({ ...draft, status: 'Approved', approvedAtUtc: '2026-10-12T01:00:00Z' });
    (await nextRequest(`/api/admin/lessons/${versionId}/workflow`)).flush({
      ...workflow,
      aiStatus: 'Approved',
    });
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/draft`)).flush(null);
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/stages/statuses`)).flush({
      vocabulary: 'Approved',
      'listen-type': 'Approved',
    });
    await operation;
    fixture.detectChanges();
    expect(page.workflow()?.aiStatus).toBe('Approved');
    expect(page.notice()).toContain('تم حفظ الرحلة واعتماد محتوى الدرس');
    http.expectNone((request) => request.method === 'PUT');
  });

  it('saves a revised stage order without demanding a new AI draft when stages are already approved', async () => {
    page.workflow.set({ ...workflow, aiStatus: 'Approved' });
    page.stageStatuses.set({ vocabulary: 'Approved', 'listen-type': 'Approved' });
    page.move(page.stages()[1], -1);
    const operation = page.saveAndApprove();
    await Promise.resolve();
    const save = http.expectOne(`/api/admin/lessons/${versionId}/workflow`);
    save.flush({ revision: 'new-revision', stages: page.stages() });
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/draft`)).flush(null);
    await operation;
    expect(page.error()).toBe('');
    expect(page.notice()).toContain('أعد نشر المنهج');
    http.expectNone((request) => request.method === 'POST');
  });

  it('lists missing enabled stages and never approves incomplete material', async () => {
    page.latestDraft.set({
      ...draft,
      material: { ...draft.material, reviewedStages: ['vocabulary'] },
    });
    fixture.detectChanges();
    expect(page.approvalIssues().join(' ')).toContain('اسمع واكتب');
    expect(fixture.nativeElement.textContent).toContain('ما الذي ينقص قبل اعتماد محتوى الدرس؟');
    const operation = page.saveAndApprove();
    await Promise.resolve();
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/draft`)).flush(page.latestDraft());
    await operation;
    expect(page.error()).toContain('أكمل المراحل');
    http.expectNone(`/api/admin/lessons/${versionId}/ai/${draft.id}/approve`);
  });

  it('shows stage names returned by backend when approval finds missing data', async () => {
    page.latestDraft.set(draft);
    const operation = page.saveAndApprove();
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/draft`)).flush(draft);
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/${draft.id}/approve`)).flush(
      { error: 'review_incomplete', missingStages: ['listen-type'] },
      { status: 409, statusText: 'Conflict' },
    );
    await operation;
    expect(page.approvalIssues().join(' ')).toContain('اسمع واكتب');
  });

  it('stops after a failed workflow save and does not attempt approval', async () => {
    page.latestDraft.set(draft);
    page.toggle(page.stages()[2], false);
    const operation = page.saveAndApprove();
    await Promise.resolve();
    const save = http.expectOne(`/api/admin/lessons/${versionId}/workflow`);
    save.flush({ error: 'workflow_changed' }, { status: 409, statusText: 'Conflict' });
    await operation;
    expect(page.dirty()).toBe(true);
    expect(page.error()).toContain('تغيرت الرحلة');
    http.expectNone(`/api/admin/lessons/${versionId}/ai/draft`);
  });

  it('keeps a successful workflow save when approval fails and blocks double clicks', async () => {
    page.latestDraft.set(draft);
    page.rename(page.stages()[1], 'كلمات جديدة');
    const first = page.saveAndApprove();
    const second = page.saveAndApprove();
    await Promise.resolve();
    const save = http.expectOne(`/api/admin/lessons/${versionId}/workflow`);
    http.expectNone(`/api/admin/lessons/${versionId}/ai/draft`);
    save.flush({ revision: 'new-revision', stages: page.stages() });
    await Promise.resolve();
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/draft`)).flush(draft);
    (await nextRequest(`/api/admin/lessons/${versionId}/ai/${draft.id}/approve`)).flush(
      { error: 'ai_draft_changed' },
      { status: 409, statusText: 'Conflict' },
    );
    await Promise.all([first, second]);
    expect(page.dirty()).toBe(false);
    expect(page.error()).toContain('مسودة محتوى AI تغيّرت');
  });
});
