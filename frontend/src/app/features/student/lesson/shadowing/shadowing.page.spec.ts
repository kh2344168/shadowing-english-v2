import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { StudentShadowingPage } from './shadowing.page';

describe('StudentShadowingPage V1 parity on V2 contracts', () => {
  beforeEach(() => localStorage.clear());
  async function setup(path = 'student/lessons/:slotId/shadowing') {
    await TestBed.configureTestingModule({
      imports: [StudentShadowingPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ slotId: 'slot-1' }),
              routeConfig: { path },
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(StudentShadowingPage);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    return { fixture, http, router };
  }


  it('defaults to a smooth student turn without a forced timer', async () => {
    const { fixture, http } = await setup();
    expect(fixture.componentInstance.studentTurnTimeLimitEnabled).toBe(false);
    expect(fixture.componentInstance.countdownPauseSeconds).toBe(0);
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();
    http.verify();
    fixture.destroy();
  });

  it('loads the overview and only the current segment, not the whole lesson', async () => {
    const { fixture, http } = await setup();

    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      versionId: 'version-1',
      title: 'Personal information',
      description: '',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 4,
      completedSegments: 1,
      isComplete: false,
      hasAiContent: true,
    });
    await Promise.resolve();

    http.expectOne('/api/student/learning/slots/slot-1/segments/2').flush({
      position: 2,
      text: 'Where are you from?',
      audioUrl: '/api/student/learning/slots/slot-1/segments/2/audio',
    });

    await fixture.whenStable();

    expect(fixture.componentInstance.currentSegmentIndex).toBe(1);
    expect(fixture.componentInstance.currentSegment?.text).toBe('Where are you from?');
    expect(fixture.componentInstance.lesson?.segments).toHaveLength(4);
    expect(fixture.componentInstance.lesson?.segments[0].loaded).toBe(false);
    http.verify();
    fixture.destroy();
  });

  it('ignores repeated segment navigation while the first transition is still running', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();

    const page = fixture.componentInstance;
    const makeSegment = (position: number) => ({
      position,
      text: `Sentence ${position}`,
      audioUrl: `/audio/${position}`,
      translation: null,
      ipa: null,
      pronunciationHint: null,
      start: 0,
      end: 0,
      loaded: true,
    });
    page.lesson = {
      id: 'slot-1', title: 'Test', description: '', segmentCount: 3,
      hasAiContent: false, segments: [makeSegment(1), makeSegment(2), makeSegment(3)],
    };
    page.currentSegmentIndex = 0;
    page.currentSegment = page.lesson.segments[0];
    page.state = 'teacher';

    let releaseMedia!: () => void;
    const mediaReady = new Promise<void>((resolve) => { releaseMedia = resolve; });
    const internal = page as unknown as {
      selectSegment(index: number): Promise<void>;
      waitForMediaReady(): Promise<void>;
      playCurrentTeacherSegment(): Promise<void>;
    };
    vi.spyOn(internal, 'waitForMediaReady').mockReturnValue(mediaReady);
    vi.spyOn(internal, 'playCurrentTeacherSegment').mockResolvedValue();

    const firstNavigation = internal.selectSegment(1);
    expect(page.segmentNavigationInProgress).toBe(true);
    await internal.selectSegment(2);
    expect(page.currentSegmentIndex).toBe(1);

    releaseMedia();
    await firstNavigation;
    expect(page.segmentNavigationInProgress).toBe(false);
    expect(internal.playCurrentTeacherSegment).toHaveBeenCalledTimes(1);
    http.verify();
    fixture.destroy();
  });

  it('restores review progress from the V2 AI material contract', async () => {
    const { fixture, http } = await setup('student/lessons/:slotId/shadowing-review');

    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      versionId: 'version-1',
      title: 'Personal information',
      description: '',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 4,
      completedSegments: 4,
      isComplete: true,
      hasAiContent: true,
    });
    await Promise.resolve();

    http.expectOne('/api/student/learning/slots/slot-1/ai-material').flush({
      vocabulary: [],
      grammarFocus: '',
      conversationScenario: '',
      shadowingReviewEnabled: true,
      quiz: [],
      dictation: [],
      progress: {
        vocabulary: 0,
        shadowingReview: 2,
        listenType: 0,
        quiz: 0,
        conversation: 0,
      },
      completed: {
        vocabulary: true,
        shadowingReview: false,
        listenType: false,
        quiz: false,
        conversation: false,
      },
    });
    await Promise.resolve();

    http.expectOne('/api/student/learning/slots/slot-1/segments/3').flush({
      position: 3,
      text: 'What do you do?',
      audioUrl: '/api/student/learning/slots/slot-1/segments/3/audio',
    });

    await fixture.whenStable();
    expect(fixture.componentInstance.reviewMode).toBe(true);
    expect(fixture.componentInstance.currentSegmentIndex).toBe(2);
    http.verify();
    fixture.destroy();
  });

  it('changes teacher speed locally without writing progress', async () => {
    const { fixture, http } = await setup();
    fixture.componentInstance.setTeacherPlaybackRate(1.5);
    expect(fixture.componentInstance.teacherPlaybackRate).toBe(1.5);

    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1',
      versionId: 'version-1',
      title: 'Test',
      description: '',
      weekNumber: 1,
      dayNumber: 1,
      sortOrder: 1,
      segmentCount: 0,
      completedSegments: 0,
      isComplete: false,
      hasAiContent: false,
    });

    await fixture.whenStable();
    http.verify();
    fixture.destroy();
  });

  it('does not fabricate a speech score when recognition produced no text', async () => {
    const { fixture, http } = await setup();
    expect(fixture.componentInstance.completionMatchScore).toBeNull();
    expect(fixture.componentInstance.completionBestRepetitionScore).toBeNull();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();
    http.verify();
    fixture.destroy();
  });

  it('treats extra repetitions as session review, not a different server completion rule', async () => {
    const { fixture, http } = await setup();
    fixture.componentInstance.setSessionTarget(3);
    expect(fixture.componentInstance.sessionTargetRepetitions).toBe(3);
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();
    http.verify();
    fixture.destroy();
  });

  it('uses live teacher waveform bars while the teacher is speaking', async () => {
    const { fixture, http } = await setup();
    const page = fixture.componentInstance;
    page.teacherWaveBars = [40, 30, 20, 10, 50, 35, 25, 15, 45, 32, 22, ...Array(31).fill(8)];
    page.state = 'teacher';
    expect(page.teacherWaveBarsSlice.slice(0, 4)).toEqual([40, 30, 20, 10]);

    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();
    http.verify();
    fixture.destroy();
  });

  it('recognizes a finished student turn after real speech followed by silence', async () => {
    const { fixture, http } = await setup();
    const page = fixture.componentInstance;
    const internal = page as unknown as {
      studentVoiceDetected: boolean;
      studentFirstVoiceAt: number;
      studentLastVoiceAt: number;
      studentTurnStartedAt: number;
      shouldAutoAdvanceAfterStudentSilence(now: number): boolean;
    };
    internal.studentVoiceDetected = true;
    internal.studentTurnStartedAt = 1_000;
    internal.studentFirstVoiceAt = 1_200;
    internal.studentLastVoiceAt = 1_700;
    expect(internal.shouldAutoAdvanceAfterStudentSilence(3_250)).toBe(true);
    expect(internal.shouldAutoAdvanceAfterStudentSilence(2_200)).toBe(false);

    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();
    http.verify();
    fixture.destroy();
  });

  it('renders the completion state independently from report upload', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();

    const page = fixture.componentInstance;
    const internal = page as unknown as {
      stageComplete: boolean;
      finishSession(): Promise<void>;
    };
    internal.stageComplete = false;
    await internal.finishSession();

    expect(page.state).toBe('finished');
    expect(page.isCompletionModalOpen).toBe(true);
    http.verify();
    fixture.destroy();
  });

  it('does not open vocabulary before shadowing is fully complete', async () => {
    const { fixture, http, router } = await setup();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 16,
      completedSegments: 2, isComplete: false, hasAiContent: true,
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/slot-1/segments/3').flush({
      position: 3, text: 'Sentence three', audioUrl: '/audio/3',
    });
    await fixture.whenStable();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    await fixture.componentInstance.continueToNextStage();

    expect(navigate).toHaveBeenCalledWith(['/student/lessons', 'slot-1', 'overview']);
    http.verify();
    fixture.destroy();
  });

  it('shows the current microphone bars during the student turn', async () => {
    const { fixture, http } = await setup();
    const page = fixture.componentInstance;
    page.voiceBars = [52, 41, 33, 26, 18, 12, 24, 36, 48, 39, 31, ...Array(31).fill(8)];
    page.state = 'student';
    expect(page.studentWaveBarsSlice.slice(0, 4)).toEqual([52, 41, 33, 26]);

    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();
    http.verify();
    fixture.destroy();
  });

  it('keeps a partial student recording when the student stops manually', async () => {
    const { fixture, http } = await setup();
    http.expectOne('/api/student/learning/slots/slot-1').flush({
      slotId: 'slot-1', versionId: 'version-1', title: 'Test', description: '',
      weekNumber: 1, dayNumber: 1, sortOrder: 1, segmentCount: 0,
      completedSegments: 0, isComplete: false, hasAiContent: false,
    });
    await fixture.whenStable();

    const page = fixture.componentInstance;
    const fakeRecording = {
      meta: {
        id: 'local-1', repetitionFrom: 1, countsTowardProgress: false,
        durationLabel: '00:02', createdAt: new Date().toISOString(), includesTeacher: false,
      },
      url: 'blob:test',
      blob: new Blob(['voice'], { type: 'audio/webm' }),
    };
    const internal = page as unknown as {
      stopLocalRecording(keep: boolean): Promise<typeof fakeRecording | null>;
      addLocalRecording(recording: typeof fakeRecording): Promise<void>;
    };
    vi.spyOn(internal, 'stopLocalRecording').mockResolvedValue(fakeRecording);
    vi.spyOn(internal, 'addLocalRecording').mockResolvedValue();

    await page.stopTraining();

    expect(internal.stopLocalRecording).toHaveBeenCalledWith(true);
    expect(internal.addLocalRecording).toHaveBeenCalledWith(fakeRecording);
    http.verify();
    fixture.destroy();
  });

});
