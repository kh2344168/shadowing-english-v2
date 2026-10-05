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
    expect(fixture.nativeElement.querySelectorAll('.stage-row')).toHaveLength(4);
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
});
