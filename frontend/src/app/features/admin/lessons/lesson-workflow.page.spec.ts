import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
  let fixture: ComponentFixture<AdminLessonWorkflowPage>;
  let page: AdminLessonWorkflowPage;
  let http: HttpTestingController;

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
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('keeps the core shadowing stage mandatory and allows optional stages to be disabled', () => {
    const [shadowing, , listenType] = page.stages();
    page.toggle(shadowing, false);
    expect(page.stages()[0].enabled).toBe(true);
    page.toggle(listenType, false);
    expect(page.stages()[2].enabled).toBe(false);
    expect(page.dirty()).toBe(true);
  });

  it('duplicates a repeatable stage with its own id and persists the plan', async () => {
    page.duplicate(page.stages()[0]);
    expect(page.stages()).toHaveLength(4);
    expect(page.stages()[1].id).not.toBe(page.stages()[0].id);
    expect(page.stages()[1].title).toContain('إضافي');

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
});
