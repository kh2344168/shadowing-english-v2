import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminAiReviewPage } from './ai-review.page';

describe('AdminAiReviewPage', () => {
  it('saves selected chunks, dictation sentences and quiz types before approval', async () => {
    await TestBed.configureTestingModule({
      imports: [AdminAiReviewPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ versionId: 'version-1' }) } },
        },
        { provide: AuthService, useValue: { csrf: () => of({}) } },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminAiReviewPage);
    fixture.detectChanges();
    http.expectOne('/api/admin/lessons/ai-providers').flush({ configured: ['Groq'] });
    http.expectOne('/api/admin/lessons/version-1/ai').flush({
      id: 'job-1',
      lessonVersionId: 'version-1',
      revision: 'rev-1',
      status: 'Draft',
      material: {
        vocabulary: [
          {
            word: 'Hello world',
            kind: 'chunk',
            meaningAr: 'تحية',
            exampleEn: 'Hello world',
            exampleAr: 'مرحبًا',
          },
        ],
        quiz: [
          {
            question: 'Choose',
            options: ['a', 'b', 'c', 'd'],
            correctIndex: 0,
            explanationAr: 'قاعدة',
          },
        ],
        grammarFocus: 'Greeting',
        conversationScenario: 'Say hello',
        dictation: [
          { position: 1, enabled: true, acceptedAnswers: ['Hello world'], hint: null },
          { position: 2, enabled: true, acceptedAnswers: ['How are you'], hint: null },
        ],
      },
    });
    http.expectOne('/api/admin/lessons/version-1/ai/segments').flush([
      { position: 1, text: 'Hello world' },
      { position: 2, text: 'How are you' },
    ]);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    await vi.waitFor(() => expect(component.job()?.material).toBeTruthy());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.stage-tile')).toHaveLength(7);
    expect(fixture.nativeElement.querySelector('#words-title')).toBeNull();
    component.openStage('vocabulary');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#words-title')).not.toBeNull();
    expect(component.allStagesReviewed()).toBe(false);
    expect(component.failureReason('providers_unavailable_or_invalid_output')).toContain(
      'Ai.Provider',
    );
    expect(component.failureReason('generated_activity_invalid')).toContain('الجمل');
    expect(component.draft()?.dictation).toEqual([
      { position: 1, enabled: true, acceptedAnswers: ['Hello world'], hint: null },
      { position: 2, enabled: true, acceptedAnswers: ['How are you'], hint: null },
    ]);
    component.dictationItem(1)!.enabled = false;
    component.draft()!.quiz[0].type = 'vocabulary-card';
    component.changed();
    void component.save();
    await Promise.resolve();
    const save = http.expectOne('/api/admin/lessons/version-1/ai/job-1');
    expect(save.request.body.material.vocabulary[0].kind).toBe('chunk');
    expect(save.request.body.material.dictation[0].enabled).toBe(false);
    expect(save.request.body.material.quiz[0].type).toBe('vocabulary-card');
    save.flush({ ...component.job(), revision: 'rev-2', material: save.request.body.material });
    await fixture.whenStable();
    void component.reviewStage();
    await Promise.resolve();
    const review = http.expectOne('/api/admin/lessons/version-1/ai/job-1');
    expect(review.request.body.material.reviewedStages).toEqual(['vocabulary']);
    review.flush({ ...component.job(), revision: 'rev-3', material: review.request.body.material });
    await fixture.whenStable();
    expect(component.stageReviewed('vocabulary')).toBe(true);
    expect(component.selectedStage()).toBe('listen-type');
    expect(component.allStagesReviewed()).toBe(false);
    http.verify();
    fixture.destroy();
  });

  it('opens an approved workflow stage as a safe editable draft', async () => {
    const versionId = '11111111-2222-4333-8444-555555555555';
    const stageId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await TestBed.configureTestingModule({
      imports: [AdminAiReviewPage],
      providers: [
        provideRouter([
          { path: 'admin/lessons/:versionId/workflow', component: AdminAiReviewPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ versionId, stageId }) },
          },
        },
        { provide: AuthService, useValue: { csrf: () => of({}) } },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminAiReviewPage);
    fixture.detectChanges();
    const material = {
      vocabulary: [
        {
          word: 'Hello',
          meaningAr: 'مرحبًا',
          exampleEn: 'Hello there',
          exampleAr: 'مرحبًا بك',
          imageUrl: 'https://example.com/hello.jpg',
        },
      ],
      quiz: [
        {
          question: 'Choose',
          options: ['a', 'b', 'c', 'd'],
          correctIndex: 0,
          explanationAr: 'شرح',
        },
      ],
      grammarFocus: 'Greeting',
      conversationScenario: 'Say hello',
      dictation: [{ position: 1, enabled: true, acceptedAnswers: ['Hello there'], hint: null }],
      reviewedStages: ['vocabulary'],
    };
    http.expectOne('/api/admin/lessons/ai-providers').flush({ configured: ['Groq'] });
    http.expectOne(`/api/admin/lessons/${versionId}/ai`).flush({
      id: 'job-approved',
      lessonVersionId: versionId,
      revision: 'rev-approved',
      status: 'Approved',
      material,
    });
    http
      .expectOne(`/api/admin/lessons/${versionId}/ai/segments`)
      .flush([{ position: 1, text: 'Hello there' }]);
    http.expectOne(`/api/admin/lessons/${versionId}/workflow`).flush({
      lessonId: 'lesson-1',
      versionId,
      versionNumber: 1,
      title: 'Lesson',
      description: '',
      revision: 'workflow-rev',
      aiStatus: 'Approved',
      reviewedStages: ['vocabulary'],
      stages: [
        {
          id: 'shadowing-stage',
          type: 'shadowing',
          title: 'Shadowing الأساسي',
          position: 1,
          enabled: true,
          required: true,
        },
        {
          id: stageId,
          type: 'vocabulary',
          title: 'كلمات السفر المهمة',
          position: 2,
          enabled: true,
          required: true,
        },
      ],
    });
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.job()?.status).toBe('Approved'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.approved-panel')).not.toBeNull();
    expect(fixture.componentInstance.stageTitle('vocabulary')).toBe('كلمات السفر المهمة');

    const reopening = fixture.componentInstance.reopenApproved();
    await Promise.resolve();
    const request = http.expectOne(`/api/admin/lessons/${versionId}/ai/job-approved/reopen`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.expectedRevision).toBe('rev-approved');
    request.flush({
      id: 'job-draft',
      lessonVersionId: versionId,
      revision: 'rev-draft',
      status: 'Draft',
      material,
    });
    await reopening;
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedStage()).toBe('vocabulary');
    expect(fixture.nativeElement.querySelector('#words-title')).not.toBeNull();
    fixture.componentInstance.clearVocabularyImage(0);
    expect(fixture.componentInstance.draft()!.vocabulary[0].imageUrl).toBeNull();
    http.verify();
    fixture.destroy();
  });
});
