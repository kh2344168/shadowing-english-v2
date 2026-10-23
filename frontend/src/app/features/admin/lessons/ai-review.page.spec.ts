import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminLessonStageEditorPage } from './ai-review.page';
import { StageLatestAttempt, StageProcessingStatus } from './lesson-ai.api';

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
  async function setup(
    status: 'Draft' | 'Approved',
    stageType = 'vocabulary',
    processingStatus: StageProcessingStatus = status === 'Approved' ? 'Approved' : 'NeedsReview',
    segmentResponse = [
      { position: 1, text: 'Hello there', audioUrl: `${base}/teacher-audio/1` },
    ] as { position: number; text: string; audioUrl?: string | null }[],
    probeStatus = 206,
    jobMaterial: object = material,
    savedDraft: object | null = null,
    latestAttempt: StageLatestAttempt | null = null,
  ) {
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
    http
      .expectOne('/api/admin/lessons/ai-providers')
      .flush({ configured: ['Groq'], imagesConfigured: true });
    http.expectOne(`${base}/ai`).flush({
      id: 'job-1',
      lessonVersionId: versionId,
      revision: 'rev-1',
      status,
      material: jobMaterial,
    });
    http.expectOne(`${base}/ai/draft`).flush(savedDraft);
    http.expectOne(`${base}/ai/segments`).flush(segmentResponse);
    http.expectOne(`${base}/workflow`).flush({
      stages: [
        {
          id: 'shadowing-stage',
          type: 'shadowing',
          title: 'الشادوينج',
          position: 1,
          enabled: true,
        },
        {
          id: stageId,
          type: stageType,
          title: stageType === 'conversation' ? 'المحادثة' : 'كلمات السفر',
          position: 2,
          enabled: true,
        },
      ],
    });
    http.expectOne(`${base}/ai/stages/statuses`).flush({ [stageType]: processingStatus });
    await vi.waitFor(() =>
      http.expectOne(`${base}/ai/stages/${stageType}/latest-attempt`).flush(latestAttempt),
    );
    if (
      stageType === 'listen-type' &&
      segmentResponse.some((segment) => segment.audioUrl === undefined)
    ) {
      const missing = segmentResponse.filter((segment) => segment.audioUrl === undefined);
      await vi.waitFor(() => {
        const probes = http.match((request) =>
          request.url.startsWith(`/api/admin/shadowing/lessons/versions/${versionId}/segments/`),
        );
        expect(probes).toHaveLength(missing.length);
        for (const probe of probes) {
          expect(probe.request.headers.get('Range')).toBe('bytes=0-0');
          probe.flush(new Blob(['x']), {
            status: probeStatus,
            statusText: probeStatus === 206 ? 'Partial Content' : 'Not Found',
          });
        }
      });
    }
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    return { http, fixture, page: fixture.componentInstance };
  }

  it('opens the workflow stage editor and saves its review without a general approval page', async () => {
    const { http, fixture, page } = await setup('Draft');
    expect(page.selectedStage()).toBe('vocabulary');
    expect(fixture.nativeElement.querySelector('#words-title')).not.toBeNull();
    expect(
      (
        fixture.nativeElement.querySelector(
          '.word-visual .include-toggle input',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
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

  it('explains a superseded draft and prevents repeated rejected saves without discarding edits', async () => {
    const { http, fixture, page } = await setup('Draft');
    page.draft()!.vocabulary[0].word = 'Hi';
    page.changed();
    const saving = page.save();
    await Promise.resolve();
    http.expectOne(`${base}/ai/job-1`).flush(
      { error: 'newer_ai_job_exists' },
      {
        status: 409,
        statusText: 'Conflict',
      },
    );
    await saving;
    fixture.detectChanges();
    expect(page.staleDraft()).toBe(true);
    expect(page.draft()!.vocabulary[0].word).toBe('Hi');
    expect(page.error()).toContain('معالجة أحدث');
    expect(fixture.nativeElement.querySelector('.action-bar .primary-button').disabled).toBe(true);
    await page.save();
    http.expectNone(`${base}/ai/job-1`);
    http.verify();
    fixture.destroy();
  });

  it('shows only the essential word fields and keeps extra options folded', async () => {
    const { http, fixture } = await setup('Draft');
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('.page-header')?.textContent).toContain('كلمات السفر');
    expect(page.querySelector('#words-title')?.textContent).toContain('ما الكلمات');
    expect(page.querySelector('.word-card .optional-details')?.hasAttribute('open')).toBe(false);
    expect(page.querySelector('.action-bar .primary-button')?.textContent).toContain(
      'حفظ واعتماد المرحلة',
    );
    http.verify();
    fixture.destroy();
  });

  it('lets the teacher select only recorded dictation sentences and persists that choice', async () => {
    const { http, fixture, page } = await setup('Draft', 'listen-type');
    const draft = page.draft()!;
    draft.dictation = [
      { position: 1, enabled: true, acceptedAnswers: ['Hello there'], hint: null },
      { position: 2, enabled: true, acceptedAnswers: ['How are you?'], hint: null },
      { position: 3, enabled: true, acceptedAnswers: ['Text only'], hint: null },
    ];
    page.draft.set({ ...draft });
    page.segments.set([
      { position: 1, text: 'Hello there', audioUrl: '/teacher/1/audio' },
      { position: 2, text: 'How are you?', audioUrl: '/teacher/2/audio' },
      { position: 3, text: 'Text only', audioUrl: null },
    ]);
    fixture.detectChanges();
    page.setDictationSelection(false);
    expect(page.selectedDictationCount()).toBe(0);
    expect(page.stageIssues('listen-type')).toContain(
      'اختر جملة واحدة على الأقل من المقاطع التي لها تسجيل صوتي.',
    );
    page.setDictationSelection(true);
    expect(page.draft()!.dictation!.map((item) => item.enabled)).toEqual([true, true, false]);
    page.draft()!.dictation![0].enabled = false;
    page.changed();
    fixture.detectChanges();
    expect(page.selectedDictationCount()).toBe(1);
    const choices = fixture.nativeElement.querySelectorAll(
      '.dictation-select input',
    ) as NodeListOf<HTMLInputElement>;
    expect(choices).toHaveLength(3);
    expect(choices[2].disabled).toBe(true);
    const saving = page.save();
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/job-1`);
    expect(
      request.request.body.material.dictation.map((item: { enabled: boolean }) => item.enabled),
    ).toEqual([false, true, false]);
    request.flush({ ...page.job(), revision: 'rev-2', material: request.request.body.material });
    await saving;
    http.verify();
    fixture.destroy();
  });

  it('suggests an A1 missing word and saves the teacher-selected exercise mode', async () => {
    const { http, fixture, page } = await setup('Draft', 'listen-type');
    const text = 'I go to school every day.';
    page.lessonLevel.set('A1');
    page.segments.set([{ position: 1, text, audioUrl: '/teacher/1/audio' }]);
    const suggested = page.suggestedDictation(1, text, true);
    expect(suggested.mode).toBe('missing-word');
    expect(suggested.targetWordIndex).toBe(3);
    expect(suggested.acceptedAnswers).toEqual(['school']);
    page.draft.set({ ...page.draft()!, dictation: [suggested] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('I go to _____ every day.');

    page.setDictationMode(1, 'word-order', text);
    expect(page.dictationItem(1)?.acceptedAnswers).toEqual([text]);
    expect(page.stageIssues('listen-type')).toEqual([]);
    page.setDictationMode(1, 'missing-word', text);
    expect(page.stageIssues('listen-type')).toEqual([]);
    page.selectDictationWord(1, 4, text);
    expect(page.dictationItem(1)?.acceptedAnswers).toEqual(['every']);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('كلمة مسموعة');
    expect(page.suggestedDictation(2, 'Hello', true).mode).toBe('full-sentence');
    const saving = page.save();
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/job-1`);
    expect(request.request.body.material.dictation[0]).toMatchObject({
      mode: 'missing-word',
      targetWordIndex: 4,
      acceptedAnswers: ['every'],
    });
    request.flush({ ...page.job(), revision: 'rev-2', material: request.request.body.material });
    await saving;
    http.verify();
    fixture.destroy();
  });

  it('derives the missing-word answer from the selected word without regenerating AI', async () => {
    const { http, fixture, page } = await setup('Draft', 'listen-type');
    const text = 'I go to school every day.';
    page.segments.set([{ position: 1, text, audioUrl: '/teacher/1/audio' }]);
    page.draft.set({
      ...page.draft()!,
      dictation: [
        {
          position: 1,
          enabled: true,
          hint: null,
          acceptedAnswers: ['school'],
          mode: 'missing-word',
          targetWordIndex: 3,
        },
      ],
    });
    page.selectDictationWord(1, 4, text);
    page.dictationItem(1)!.acceptedAnswers = ['school']; // stale UI data must not override the selection
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('I go to school _____ day.');
    expect(fixture.nativeElement.textContent).toContain('تتحدث تلقائيًا');
    expect(page.stageIssues('listen-type')).toEqual([]);

    const saving = page.save();
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/job-1`);
    expect(request.request.body.material.dictation[0].acceptedAnswers).toEqual(['every']);
    request.flush({ ...page.job(), revision: 'rev-2', material: request.request.body.material });
    await saving;
    http.verify();
    fixture.destroy();
  });

  it('converts an old single-word draft to a missing-word question without losing the chosen word', async () => {
    const legacy = {
      ...material,
      dictation: [
        {
          ...material.dictation[0],
          mode: 'single-word',
          targetWordIndex: 1,
          acceptedAnswers: ['there'],
          audioStartSeconds: 0.2,
          audioEndSeconds: 0.8,
        },
      ],
    };
    const { http, fixture, page } = await setup(
      'Draft',
      'listen-type',
      'NeedsReview',
      [{ position: 1, text: 'Hello there', audioUrl: '/teacher/1/audio' }],
      206,
      legacy,
    );
    expect(page.dictationItem(1)).toMatchObject({
      mode: 'missing-word',
      targetWordIndex: 1,
      acceptedAnswers: ['there'],
      audioStartSeconds: null,
      audioEndSeconds: null,
    });
    expect(page.dirty()).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('كلمة مسموعة');
    http.verify();
    fixture.destroy();
  });

  it('recovers teacher recordings when the segments API omits audioUrl', async () => {
    const { http, fixture, page } = await setup('Draft', 'listen-type', 'NeedsReview', [
      { position: 1, text: 'Hello there' },
    ]);
    expect(page.segments()[0].audioUrl).toBe(
      `/api/admin/shadowing/lessons/versions/${versionId}/segments/1/audio`,
    );
    expect(page.dictationAudioState()).toBe('ready');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('.dictation-select input') as HTMLInputElement).disabled,
    ).toBe(false);
    http.verify();
    fixture.destroy();
  });

  it('only marks an old-API segment as missing when its teacher clip returns 404', async () => {
    const { http, fixture, page } = await setup(
      'Draft',
      'listen-type',
      'NeedsReview',
      [{ position: 1, text: 'Hello there' }],
      404,
    );
    expect(page.segments()[0].audioUrl).toBeNull();
    expect(page.dictationAudioState()).toBe('missing');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('.dictation-select input') as HTMLInputElement).disabled,
    ).toBe(true);
    http.verify();
    fixture.destroy();
  });

  it('distinguishes an unverified audio request from a lesson with no recording', async () => {
    const { http, fixture, page } = await setup('Draft', 'listen-type');
    page.segments.set([{ position: 1, text: 'Hello there' }]);
    fixture.detectChanges();
    expect(page.dictationAudioState()).toBe('unverified');
    expect(page.canGenerateStage()).toBe(false);
    expect(page.stageIssues('listen-type')[0]).toContain('تعذر التحقق');
    expect(fixture.nativeElement.textContent).toContain('تعذر التحقق من التسجيل');
    expect(fixture.nativeElement.textContent).not.toContain('لا يوجد تسجيل لهذه الجملة');

    page.segments.set([{ position: 1, text: 'Hello there', audioUrl: null }]);
    fixture.detectChanges();
    expect(page.dictationAudioState()).toBe('missing');
    expect(page.canGenerateStage()).toBe(false);
    expect(page.stageIssues('listen-type')[0]).toContain('لا يوجد تسجيل صوتي محفوظ');
    expect(fixture.nativeElement.textContent).toContain('لا يوجد تسجيل لهذه الجملة');
    http.verify();
    fixture.destroy();
  });

  it('bulk selects only questions of the active test type', async () => {
    const { http, fixture, page } = await setup('Draft', 'vocabulary-quiz');
    expect(page.draft()!.quiz[0].enabled).toBeUndefined();
    page.draft()!.quiz = [
      {
        question: 'Word A',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
        explanationAr: 'شرح',
        type: 'vocabulary-card',
        enabled: true,
      },
      {
        question: 'Word B',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        explanationAr: 'شرح',
        type: 'vocabulary-card',
        enabled: true,
      },
      {
        question: 'Grammar',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 2,
        explanationAr: 'شرح',
        type: 'multiple-choice',
        enabled: true,
      },
    ];
    page.setQuestionSelection('vocabulary-card', false);
    expect(page.selectedQuestionCount('vocabulary-card')).toBe(0);
    expect(page.selectedQuestionCount('multiple-choice')).toBe(1);
    page.draft()!.quiz[1].enabled = true;
    page.changed();
    fixture.detectChanges();
    expect(page.selectedQuestionCount('vocabulary-card')).toBe(1);
    expect(fixture.nativeElement.querySelector('.selection-toolbar')).not.toBeNull();
    http.verify();
    fixture.destroy();
  });

  it('explains Groq voice terms and links to the model page when audio is rejected', async () => {
    const { http, fixture, page } = await setup('Draft');
    page.voiceConfigured.set(true);
    const speaking = page.speak('Hello');
    http
      .expectOne((request) => request.url === `${base}/ai/voice` && request.method === 'POST' &&
        request.body.text === 'Hello')
      .flush(
        new Blob([JSON.stringify({ error: 'voice_terms_required' })], { type: 'application/json' }),
        { status: 503, statusText: 'Service Unavailable' },
      );
    await speaking;
    fixture.detectChanges();
    expect(page.error()).toContain('قبول شروط');
    expect(
      fixture.nativeElement.querySelector('a[href^="https://console.groq.com/playground"]'),
    ).not.toBeNull();
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

  it('offers review instead of an empty screen when approved content has a stage needing review', async () => {
    const { http, fixture, page } = await setup('Approved', 'conversation', 'NeedsReview');
    expect(fixture.nativeElement.textContent).toContain('هذه المرحلة تحتاج مراجعة');
    expect(fixture.nativeElement.querySelector('.approved-panel__preview').textContent).toContain(
      'Say hello',
    );
    const button = fixture.nativeElement.querySelector('.approved-panel__actions .primary-button');
    expect(button.textContent).toContain('فتح نسخة لمراجعة المرحلة');
    const reopening = page.reopenApproved();
    await Promise.resolve();
    http.expectOne(`${base}/ai/job-1/reopen`).flush({
      id: 'job-2',
      lessonVersionId: versionId,
      revision: 'rev-2',
      status: 'Draft',
      material,
    });
    await reopening;
    fixture.detectChanges();
    expect(page.stageCanEdit()).toBe(true);
    expect(fixture.nativeElement.querySelector('.conversation-workspace')).not.toBeNull();
    http.verify();
    fixture.destroy();
  });

  it('shows the real failed conversation attempt even when older content can be previewed', async () => {
    const { http, fixture, page } = await setup(
      'Approved',
      'conversation',
      'NeedsReview',
      undefined,
      206,
      material,
      null,
      { id: 'failed-job', status: 'Failed', errorCode: 'provider_invalid_output' },
    );
    expect(page.latestAttempt()?.status).toBe('Failed');
    expect(fixture.nativeElement.textContent).toContain('آخر محاولة لمعالجة هذه المرحلة فشلت');
    expect(fixture.nativeElement.textContent).toContain('provider_invalid_output');
    expect(fixture.nativeElement.querySelector('.approved-panel__preview').textContent).toContain(
      'Say hello',
    );
    http.verify();
    fixture.destroy();
  });

  it('opens an existing lesson draft instead of showing the approved-stage reopen button', async () => {
    const existingDraft = {
      id: 'draft-2',
      lessonVersionId: versionId,
      revision: 'rev-2',
      status: 'Draft',
      material,
    };
    const { http, fixture, page } = await setup(
      'Approved',
      'vocabulary',
      'Approved',
      [{ position: 1, text: 'Hello there', audioUrl: '/teacher/1/audio' }],
      206,
      material,
      existingDraft,
    );
    expect(page.job()?.id).toBe('draft-2');
    expect(page.selectedStage()).toBe('vocabulary');
    expect(fixture.nativeElement.querySelector('#words-title')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.approved-panel')).toBeNull();
    http.verify();
    fixture.destroy();
  });

  it('offers multiple Pexels images and saves only the teacher-selected image', async () => {
    const { http, fixture, page } = await setup('Draft');
    const suggesting = page.suggestVocabularyImage(0);
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/job-1/vocabulary-image`);
    expect(request.request.body).toEqual({ expectedRevision: 'rev-1', cardIndex: 0, page: 1 });
    request.flush({
      options: [
        {
          imageUrl: 'https://images.pexels.com/photos/1/test.jpeg',
          photographer: 'One',
          photoUrl: 'https://www.pexels.com/photo/1',
        },
        {
          imageUrl: 'https://images.pexels.com/photos/2/test.jpeg',
          photographer: 'Two',
          photoUrl: 'https://www.pexels.com/photo/2',
        },
      ],
      provider: 'pexels',
      page: 1,
    });
    await suggesting;
    expect(page.imageOptions()[0]).toHaveLength(2);
    expect(page.draft()?.vocabulary[0].imageUrl).toBe(material.vocabulary[0].imageUrl);
    page.selectVocabularyImage(0, page.imageOptions()[0][1].imageUrl);
    expect(page.draft()?.vocabulary[0].imageUrl).toContain('/photos/2/');
    expect(page.dirty()).toBe(true);
    const nextPage = page.suggestVocabularyImage(0);
    await Promise.resolve();
    const nextRequest = http.expectOne(`${base}/ai/job-1/vocabulary-image`);
    expect(nextRequest.request.body.page).toBe(2);
    nextRequest.flush({
      options: [
        {
          imageUrl: 'https://images.pexels.com/photos/3/test.jpeg',
          photographer: 'Three',
          photoUrl: 'https://www.pexels.com/photo/3',
        },
      ],
      provider: 'pexels',
      page: 2,
    });
    await nextPage;
    expect(page.imageOptions()[0][0].imageUrl).toContain('/photos/3/');
    const saving = page.save();
    await Promise.resolve();
    const save = http.expectOne(`${base}/ai/job-1`);
    expect(save.request.body.material.vocabulary[0].imageUrl).toContain('/photos/2/');
    save.flush({ ...page.job(), revision: 'rev-2', material: save.request.body.material });
    await saving;
    http.verify();
    fixture.destroy();
  });

  it('saves the teacher conversation target, tense, vocabulary, and correction scope', async () => {
    const { http, fixture, page } = await setup('Draft', 'conversation');
    expect(fixture.nativeElement.textContent).toContain('قواعد نجاح المحادثة');
    page.setConversationSupportMode('guided');
    const draft = page.draft()!;
    draft.conversationTurnTarget = 4;
    draft.openingMessage = 'Hi! How are you?';
    draft.aiRole = 'Tutor';
    draft.studentRole = 'Learner';
    draft.conversationSuccessSteps = ['Answer the question'];
    draft.conversationFocusTense = 'present-simple';
    draft.conversationLearningOutcome = 'Describe a daily routine';
    draft.conversationCorrectionMode = 'lesson-only';
    page.toggleConversationWord('Hello', true);
    expect(page.stageIssues('conversation')).toEqual([]);
    const saving = page.save();
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/job-1`);
    expect(request.request.body.material).toMatchObject({
      conversationTurnTarget: 4,
      conversationFocusTense: 'present-simple',
      conversationLearningOutcome: 'Describe a daily routine',
      conversationCorrectionMode: 'lesson-only',
      conversationSupportMode: 'guided',
      conversationTargetWords: ['Hello'],
    });
    request.flush({ ...page.job(), revision: 'rev-2', material: request.request.body.material });
    await saving;
    http.verify();
    fixture.destroy();
  });

  it('configures first steps for a one-word answer without a tense requirement', async () => {
    const { http, fixture, page } = await setup('Draft', 'conversation');
    page.setConversationSupportMode('guided');
    const draft = page.draft()!;
    draft.conversationFocusTense = 'present-simple';
    draft.conversationCorrectionMode = 'all';
    draft.conversationTurnTarget = 10;
    page.setConversationSupportMode('first-steps');
    expect(page.draft()).toMatchObject({
      conversationSupportMode: 'first-steps',
      conversationTurnTarget: 3,
      conversationMinTurns: 2,
      conversationMaxTurns: 4,
      conversationFocusTense: null,
      conversationCorrectionMode: 'lesson-only',
      openingMessage: 'Hi! How are you?',
      conversationModelAnswer: "I'm good.",
    });
    page.draft()!.conversationLearningOutcome = 'Answer a familiar greeting';
    page.draft()!.aiRole = 'Tutor';
    page.draft()!.studentRole = 'Learner';
    page.draft()!.conversationSuccessSteps = ['Answer a greeting'];
    expect(page.stageIssues('conversation')).toEqual([]);
    page.draft()!.conversationTurnTarget = 6;
    expect(page.stageIssues('conversation').length).toBeGreaterThan(0);
    http.verify();
    fixture.destroy();
  });

  it('requires approved professional facts and valid reply bounds before review', async () => {
    const { http, fixture, page } = await setup('Draft', 'conversation');
    page.setConversationSupportMode('guided');
    const draft = page.draft()!;
    draft.conversationContextType = 'professional';
    draft.aiRole = 'Customer';
    draft.studentRole = 'Agent';
    draft.openingMessage = 'Can you help me?';
    draft.conversationLearningOutcome = 'Resolve a customer question';
    draft.conversationSuccessSteps = ['Understand the issue', 'Explain an option'];
    expect(page.stageIssues('conversation').join(' ')).toContain('حقائق الموقف');
    page.updateConversationLines(
      'conversationAllowedFacts',
      'No discount is approved\nCancellation requires confirmation',
    );
    draft.conversationMinTurns = 5;
    draft.conversationMaxTurns = 4;
    expect(page.stageIssues('conversation').join(' ')).toContain('حدًا أدنى وأقصى');
    draft.conversationMaxTurns = 10;
    expect(page.stageIssues('conversation')).toEqual([]);
    http.verify();
    fixture.destroy();
  });

  it('marks missing conversation fields beside their inputs after a blocked review click', async () => {
    const { http, fixture, page } = await setup('Draft', 'conversation');
    const issues = page.stageIssues('conversation');
    expect(issues).toContain('اكتب خطوة نجاح واحدة على الأقل، كل خطوة في سطر.');
    expect(issues.length).toBeGreaterThan(1);
    expect(fixture.nativeElement.querySelector('#conversation-success-steps').required).toBe(true);
    await page.reviewStage();
    expect(page.approvalAttempted()).toBe(true);
    fixture.detectChanges();
    const steps = fixture.nativeElement.querySelector('#conversation-success-steps');
    expect(steps.getAttribute('aria-invalid')).toBe('true');
    expect(steps.closest('.field').textContent).toContain('اكتب خطوة نجاح واحدة');
    expect(fixture.nativeElement.querySelector('input[name="conversationMinTurns"]').required).toBe(
      true,
    );
    expect(
      fixture.nativeElement.querySelector('input[name="conversationMinTurns"]').closest('.field')
        .textContent,
    ).toContain('اكتب رقمًا من 1 إلى 20');
    expect(
      fixture.nativeElement.querySelector('.mode-picker--cards').closest('.section-block')
        .textContent,
    ).toContain('اختر مستوى المساعدة');
    http.verify();
    fixture.destroy();
  });

  it('does not expose old aggregate content before a newly added stage is processed', async () => {
    const { http, fixture, page } = await setup('Draft', 'conversation', 'NotStarted');
    expect(page.stageStatus()).toBe('NotStarted');
    expect(fixture.nativeElement.querySelector('.conversation-workspace')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('هذه المرحلة لم تبدأ بعد');
    const generating = page.generate();
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/stages/conversation/generate`);
    expect(request.request.body.requestId).toEqual(expect.any(String));
    request.flush({
      id: 'new-job',
      lessonVersionId: versionId,
      revision: 'new-rev',
      status: 'Pending',
      material: null,
    });
    await generating;
    fixture.detectChanges();
    expect(page.stageStatus()).toBe('Pending');
    expect(fixture.nativeElement.querySelector('.processing-state')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.conversation-workspace')).toBeNull();
    http.verify();
    fixture.destroy();
  });

  it('sends the chosen vocabulary count when processing words', async () => {
    const { http, fixture, page } = await setup('Draft', 'vocabulary', 'NotStarted');
    expect(page.vocabularyTargetCount()).toBe(12);
    page.vocabularyTargetCount.set(7);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('#vocabulary-target-count'),
    ).not.toBeNull();
    const generating = page.generate();
    await Promise.resolve();
    const request = http.expectOne(`${base}/ai/stages/vocabulary/generate`);
    expect(request.request.body.vocabularyTargetCount).toBe(7);
    request.flush({
      id: 'new-job',
      lessonVersionId: versionId,
      revision: 'new-rev',
      status: 'Pending',
      material: null,
    });
    await generating;
    http.verify();
    fixture.destroy();
  });

  it('lets the teacher bulk-select vocabulary suggestions without saving automatically', async () => {
    const { http, fixture, page } = await setup('Draft');
    expect(page.visibleVocabularyCount()).toBe(1);
    page.setVocabularySelection(false);
    expect(page.visibleVocabularyCount()).toBe(0);
    expect(page.dirty()).toBe(true);
    page.setVocabularySelection(true);
    expect(page.visibleVocabularyCount()).toBe(1);
    http.verify();
    fixture.destroy();
  });

  it('shows a saved stage snapshot but blocks editing while another stage is processing', async () => {
    const { http, fixture, page } = await setup('Draft');
    const savedDraft = page.job();
    const refreshing = page.load();
    http.expectOne('/api/admin/lessons/ai-providers').flush({ configured: ['Groq'] });
    http.expectOne(`${base}/ai`).flush({
      ...savedDraft,
      id: 'conversation-job',
      status: 'Generating',
      stageType: 'conversation',
    });
    http.expectOne(`${base}/ai/draft`).flush(savedDraft);
    http.expectOne(`${base}/ai/segments`).flush([{ position: 1, text: 'Hello there' }]);
    http.expectOne(`${base}/workflow`).flush({
      stages: [
        {
          id: stageId,
          type: 'vocabulary',
          title: 'كلمات السفر',
          position: 1,
          enabled: true,
        },
      ],
    });
    http.expectOne(`${base}/ai/stages/statuses`).flush({
      vocabulary: 'Approved',
      conversation: 'Generating',
    });
    await vi.waitFor(() =>
      http.expectOne(`${base}/ai/stages/vocabulary/latest-attempt`).flush(null),
    );
    await refreshing;
    fixture.detectChanges();
    expect(page.job()?.id).toBe(savedDraft?.id);
    expect(page.stagePreview()).toContain('Hello');
    expect(page.stageCanEdit()).toBe(false);
    expect(fixture.nativeElement.querySelector('.stage-snapshot')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#words-title')).toBeNull();
    http.verify();
    fixture.destroy();
  });
});
