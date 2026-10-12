import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminLessonStageEditorPage } from './ai-review.page';

describe('AdminLessonStageEditorPage', () => {
  const versionId = '11111111-2222-4333-8444-555555555555';
  const stageId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const base = `/api/admin/lessons/${versionId}`;
  const material = {
    vocabulary: [
      {
        word: 'Hello',
        kind: 'word',
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
        type: 'multiple-choice',
      },
    ],
    grammarFocus: 'Greeting',
    conversationScenario: 'Say hello',
    dictation: [{ position: 1, enabled: true, acceptedAnswers: ['Hello there'], hint: null }],
    reviewedStages: [],
  };
  async function setup(status: 'Draft' | 'Approved') {
    await TestBed.configureTestingModule({
      imports: [AdminLessonStageEditorPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ versionId, stageId }),
            },
          },
        },
        { provide: AuthService, useValue: { csrf: () => of({}) } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminLessonStageEditorPage);
    fixture.detectChanges();
    http.expectOne('/api/admin/lessons/ai-providers').flush({ configured: ['Groq'] });
    http
      .expectOne(`${base}/ai`)
      .flush({ id: 'job-1', lessonVersionId: versionId, revision: 'rev-1', status, material });
    http.expectOne(`${base}/ai/segments`).flush([{ position: 1, text: 'Hello there' }]);
    http.expectOne(`${base}/workflow`).flush({
      stages: [
        {
          id: 'shadowing-stage',
          type: 'shadowing',
          title: 'الشادوينج',
          position: 1,
          enabled: true,
        },
        { id: stageId, type: 'vocabulary', title: 'كلمات السفر', position: 2, enabled: true },
      ],
    });
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    return { http, fixture, page: fixture.componentInstance };
  }

  it('opens the workflow stage editor and saves its review without a general approval page', async () => {
    const { http, fixture, page } = await setup('Draft');
    expect(page.selectedStage()).toBe('vocabulary');
    expect(fixture.nativeElement.querySelector('#words-title')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.stage-grid')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('اعتماد محتوى الدرس');
    page.clearVocabularyImage(0);
    page.changed();
    const saving = page.save();
    await Promise.resolve();
    const save = http.expectOne(`${base}/ai/job-1`);
    expect(save.request.body.material.vocabulary[0].imageUrl).toBeNull();
    save.flush({ ...page.job(), revision: 'rev-2', material: save.request.body.material });
    await saving;
    const reviewing = page.reviewStage();
    await Promise.resolve();
    const review = http.expectOne(`${base}/ai/job-1`);
    expect(review.request.body.material.reviewedStages).toEqual(['vocabulary']);
    review.flush({ ...page.job(), revision: 'rev-3', material: review.request.body.material });
    await reviewing;
    expect(page.stageReviewed('vocabulary')).toBe(true);
    http.verify();
    fixture.destroy();
  });

  it('reopens approved content as an editable draft for the selected stage', async () => {
    const { http, fixture, page } = await setup('Approved');
    expect(fixture.nativeElement.querySelector('.approved-panel')).not.toBeNull();
    expect(page.stageTitle('vocabulary')).toBe('كلمات السفر');
    const reopening = page.reopenApproved();
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/job-1/reopen`);
    expect(request.request.body.expectedRevision).toBe('rev-1');
    request.flush({
      id: 'job-2',
      lessonVersionId: versionId,
      revision: 'rev-2',
      status: 'Draft',
      material,
    });
    await reopening;
    fixture.detectChanges();
    expect(page.selectedStage()).toBe('vocabulary');
    expect(fixture.nativeElement.querySelector('#words-title')).not.toBeNull();
    http.verify();
    fixture.destroy();
  });
});
