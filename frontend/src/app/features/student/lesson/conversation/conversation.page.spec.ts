import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { StudentLearningApi } from '../../learning.api';
import { StudentConversationPage } from './conversation.page';

const material = {
  completed: { quiz: true, conversation: false },
  progress: { conversation: 0 },
  conversationScenario: 'Greeting a friend',
  openingMessage: 'Hi! How are you?',
  conversationLearningOutcome: 'Answer a greeting',
  conversationSupportMode: 'first-steps',
  conversationHelpAr: 'يمكنك الرد بكلمة واحدة.',
  conversationModelAnswer: 'Good.',
  conversationCorrectionMode: 'lesson-only',
  conversationTurnTarget: 3,
  targetPhrases: ['Good'],
};
const emptyHistory = { turns: [], completedTurns: 0, turnTarget: 3, remainingToday: 3 };

describe('StudentConversationPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockMicrophone() {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent, mediaDevices: { getUserMedia } });
    class Recorder {
      static isTypeSupported = () => true;
      static last: Recorder;
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      onerror?: () => void;
      constructor() {
        Recorder.last = this;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['x'.repeat(200)], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder);
    vi.stubGlobal(
      'AudioContext',
      class {
        createAnalyser() {
          return {
            fftSize: 256,
            getByteTimeDomainData: (samples: Uint8Array) => samples.fill(160),
          };
        }
        createMediaStreamSource() {
          return { connect: vi.fn() };
        }
        resume() {
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
      },
    );
    return { getUserMedia, stream, stopTrack, Recorder };
  }

  async function setup(aiMaterial: object = material, history: object = emptyHistory) {
    await TestBed.configureTestingModule({
      imports: [StudentConversationPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId: 's1' }) } },
        },
        { provide: AuthService, useValue: { csrf: () => of({}) } },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentConversationPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush(aiMaterial);
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush(history);
    await fixture.whenStable();
    fixture.detectChanges();
    return { http, fixture, page: fixture.componentInstance };
  }

  it('captures voice, shows a real level meter, stops and transcribes without sending automatically', async () => {
    const { stopTrack } = mockMicrophone();
    const { http, fixture, page } = await setup();
    await page.toggleRecording();
    await new Promise((resolve) => setTimeout(resolve, 120));
    fixture.detectChanges();
    expect(page.recording()).toBe(true);
    expect(page.microphoneLevel()).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelector('[role="meter"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.conversation-mic').textContent).toContain('stop');
    await page.toggleRecording();
    await Promise.resolve();
    const request = http.expectOne('/api/student/learning/slots/s1/conversation/transcribe');
    expect(request.request.body.get('audio').size).toBe(200);
    request.flush({ text: 'Good morning' });
    await fixture.whenStable();
    expect(page.message).toBe('Good morning');
    expect(page.recording()).toBe(false);
    expect(page.transcribing()).toBe(false);
    expect(stopTrack).toHaveBeenCalledOnce();
    http.verify();
  });

  it('prevents duplicate microphone requests and releases late permission after leaving', async () => {
    const { getUserMedia, stream, stopTrack } = mockMicrophone();
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const { http, fixture, page } = await setup();
    const pending = page.toggleRecording();
    await page.toggleRecording();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(page.requestingMicrophone()).toBe(true);
    fixture.destroy();
    grant(stream);
    await pending;
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(page.recording()).toBe(false);
    http.verify();
  });

  it('cancels recording without uploading and reports recorder failure', async () => {
    const { Recorder } = mockMicrophone();
    const { http, page } = await setup();
    page.message = 'Keep my draft';
    await page.toggleRecording();
    page.cancelRecording();
    expect(page.message).toBe('Keep my draft');
    expect(page.recording()).toBe(false);
    await page.toggleRecording();
    Recorder.last.onerror?.();
    expect(page.recording()).toBe(false);
    expect(page.voiceNotice()).toContain('توقف التسجيل');
    http.verify();
  });

  it('explains denied permission and keeps text entry available', async () => {
    const { getUserMedia } = mockMicrophone();
    getUserMedia.mockRejectedValue({ name: 'NotAllowedError' });
    const { http, fixture, page } = await setup();
    await page.toggleRecording();
    fixture.detectChanges();
    expect(page.requestingMicrophone()).toBe(false);
    expect(page.voiceNotice()).toContain('السماح بالميكروفون مرفوض');
    expect(fixture.nativeElement.querySelector('#student-message').disabled).toBe(false);
    http.verify();
  });

  it('preserves typed text when transcription is not configured or rate limited', async () => {
    mockMicrophone();
    const { http, page } = await setup();
    page.message = 'My draft';
    for (const status of [503, 429]) {
      await page.toggleRecording();
      await page.toggleRecording();
      await Promise.resolve();
      http
        .expectOne('/api/student/learning/slots/s1/conversation/transcribe')
        .flush(
          { error: status === 503 ? 'voice_not_configured' : 'rate_limit' },
          { status, statusText: 'Unavailable' },
        );
      await Promise.resolve();
      expect(page.message).toBe('My draft');
      expect(page.transcribing()).toBe(false);
      expect(page.dailyLimitReached()).toBe(false);
      expect(page.voiceNotice()).toContain(status === 503 ? 'غير مفعّلة' : 'طلبات الصوت');
    }
    http.verify();
  });

  it('offers goal-based finish or extra practice and restores the final report', async () => {
    const configured = {
      ...material,
      conversationContextType: 'situation',
      conversationSuccessSteps: ['Ask for the gate'],
      conversationMinTurns: 2,
      conversationMaxTurns: 4,
      conversationTurnTarget: 4,
    };
    const history = {
      turns: [
        {
          id: 't1',
          message: 'Where is the gate?',
          feedback: {
            reply: 'Gate 2. Anything else?',
            correction: '',
            betterAnswer: '',
            grammarTip: '',
            focusMet: true,
            metSteps: ['Ask for the gate'],
            issues: [],
          },
        },
        {
          id: 't2',
          message: 'Thank you',
          feedback: {
            reply: 'You are welcome',
            correction: '',
            betterAnswer: '',
            grammarTip: '',
            focusMet: true,
            metSteps: [],
            issues: [],
          },
        },
      ],
      completedTurns: 2,
      turnTarget: 4,
      minTurns: 2,
      maxTurns: 4,
      metSteps: ['Ask for the gate'],
      missingSteps: [],
      goalMet: true,
      canFinish: true,
      report: null,
      remainingToday: 3,
    };
    const { http, fixture, page } = await setup(configured, history);
    expect(fixture.nativeElement.textContent).toContain('أنجزت هدف الدرس');
    expect(fixture.nativeElement.querySelector('#student-message')).toBeTruthy();
    const finishing = page.finish();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/finish').flush({
      goalMet: true,
      replyCount: 2,
      metSteps: ['Ask for the gate'],
      missingSteps: [],
      issues: [],
      retrySentence: null,
      endedEarly: true,
      outcome: 'goal-met',
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      ...history,
      report: {
        goalMet: true,
        replyCount: 2,
        metSteps: ['Ask for the gate'],
        missingSteps: [],
        issues: [],
        retrySentence: null,
        endedEarly: true,
        outcome: 'goal-met',
      },
    });
    await finishing;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ما نجحت فيه');
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    http.verify();
  });

  it('opens the saved report, groups issues from the whole chat, and leaves the transcript readable', async () => {
    const issue = (kind: string, original: string, suggested: string) => ({
      kind,
      original,
      suggested,
      reason: 'راجع هذا الجزء',
    });
    const { http, fixture, page } = await setup(material, {
      ...emptyHistory,
      minTurns: 1,
      turns: [
        {
          id: 'one',
          message: 'I goed',
          feedback: {
            reply: 'What next?',
            focusMet: true,
            issues: [issue('grammar', 'I goed', 'I went')],
          },
        },
        {
          id: 'two',
          message: 'I wnet home',
          feedback: { reply: 'Okay', focusMet: true, issues: [issue('spelling', 'wnet', 'went')] },
        },
      ],
      report: {
        goalMet: true,
        replyCount: 2,
        relevantReplies: 2,
        metSteps: ['أجاب عن السؤال'],
        missingSteps: [],
        issues: [issue('grammar', 'I goed', 'I went')],
        endedEarly: false,
        outcome: 'goal-met',
      },
    });
    expect(page.reportOpen()).toBe(true);
    expect(page.reportIssues()).toHaveLength(2);
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('القواعد');
    expect(dialog.textContent).toContain('الكتابة والإملاء');
    expect(dialog.textContent).toContain('I went');
    expect(dialog.textContent).toContain('wnet');
    page.closeReport();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.conversation-bubble--student')).toHaveLength(2);
    (
      fixture.nativeElement.querySelector('.conversation-finish__report') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    http.verify();
  });

  it('lets the student retry a corrected sentence before revealing the suggestion', async () => {
    const { http, fixture } = await setup(material, {
      ...emptyHistory,
      minTurns: 2,
      maxTurns: 4,
      report: {
        goalMet: false,
        replyCount: 1,
        relevantReplies: 1,
        metSteps: [],
        missingSteps: [],
        issues: [],
        retrySentence: 'I feel exhausted.',
        endedEarly: true,
        outcome: 'incomplete',
      },
    });
    expect(fixture.nativeElement.textContent).not.toContain('الاقتراح:');
    const input = fixture.nativeElement.querySelector(
      '#conversation-retry-input',
    ) as HTMLInputElement;
    input.value = 'I am exhausted.';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('.conversation-retry button') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('I feel exhausted.');
    http.verify();
  });

  it('makes the first question primary, reveals help gradually, and counts a suitable Good reply once', async () => {
    const { http, fixture, page } = await setup();
    expect(
      fixture.nativeElement.querySelector('.conversation-question__text').textContent,
    ).toContain('Hi! How are you?');
    expect(fixture.nativeElement.textContent).toContain('كلمة واحدة أو عبارة قصيرة تكفي');
    expect(fixture.nativeElement.textContent).not.toContain('Good.');
    expect(fixture.nativeElement.textContent).not.toContain('زمن نحوي');
    const helpButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.conversation-help-actions button'),
    ) as HTMLButtonElement[];
    helpButtons[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('يمكنك الرد بكلمة واحدة');
    helpButtons[1].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('مثال ممكن، مش الإجابة الوحيدة');
    expect(fixture.nativeElement.textContent).toContain('Good.');

    const audio = vi.spyOn(page, 'playReply').mockResolvedValue();
    page.message = 'Good';
    void page.send();
    void page.send();
    await Promise.resolve();
    const write = http.expectOne('/api/student/learning/slots/s1/conversation/turns');
    expect(write.request.method).toBe('POST');
    expect(write.request.body.message).toBe('Good');
    write.flush({
      reply: 'Great! What else?',
      correction: '',
      betterAnswer: '',
      grammarTip: '',
      focusMet: true,
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      turns: [
        {
          id: 'turn-1',
          message: 'Good',
          feedback: {
            reply: 'Great! What else?',
            correction: '',
            betterAnswer: '',
            grammarTip: '',
            focusMet: true,
          },
        },
      ],
      completedTurns: 1,
      turnTarget: 3,
      remainingToday: 2,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.completedReplies()).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('رد مناسب؛ اتضاف لتقدمك');
    expect(
      fixture.nativeElement.querySelector('.conversation-question__text').textContent,
    ).toContain('Great! What else?');
    expect(audio).toHaveBeenCalledWith('turn-1', true);
    http.verify();
  });

  it('does not advance for an unrelated answer and treats a lesson synonym as an improvement', async () => {
    const { http, fixture, page } = await setup();
    vi.spyOn(page, 'playReply').mockResolvedValue();
    page.message = 'Banana';
    void page.send();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      reply: 'How are you?',
      correction: '',
      betterAnswer: '',
      grammarTip: '',
      focusMet: false,
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      turns: [
        {
          id: 'turn-1',
          message: 'Banana',
          feedback: {
            reply: 'How are you?',
            correction: '',
            betterAnswer: 'I am good.',
            grammarTip: '',
            focusMet: false,
          },
        },
      ],
      completedTurns: 0,
      turnTarget: 3,
      remainingToday: 2,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.completedReplies()).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('ردك لم يرتبط بالسؤال بعد');
    expect(fixture.nativeElement.textContent).toContain('اقتراح تحسين، مش خطأ');
    expect(fixture.nativeElement.querySelector('#student-message')).toBeTruthy();
    http.verify();
  });

  it('restores the server history and completes only at the accepted-turn target', async () => {
    const { http, fixture, page } = await setup(
      { ...material, conversationTurnTarget: 2 },
      {
        turns: [
          {
            id: 'turn-1',
            message: 'Good',
            feedback: {
              reply: 'And your friend?',
              correction: '',
              betterAnswer: '',
              grammarTip: '',
              focusMet: true,
            },
          },
          {
            id: 'turn-2',
            message: 'Banana',
            feedback: {
              reply: 'How is your friend?',
              correction: '',
              betterAnswer: '',
              grammarTip: '',
              focusMet: false,
            },
          },
        ],
        completedTurns: 1,
        turnTarget: 2,
        remainingToday: 2,
      },
    );
    expect(page.completedReplies()).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.conversation-question__text').textContent,
    ).toContain('How is your friend?');
    expect(fixture.nativeElement.querySelector('.conversation-thread')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#student-message')).toBeTruthy();
    page.history.update((history) => ({ ...history!, completedTurns: 2 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('أنهيت مرحلة المحادثة');
    http.verify();
  });

  it('shows the complete conversation as visible chat bubbles without opening a history panel', async () => {
    const { http, fixture, page } = await setup(material, {
      turns: [
        {
          id: 't1',
          message: 'Good',
          feedback: {
            reply: 'What do you like?',
            correction: '',
            betterAnswer: '',
            grammarTip: '',
            focusMet: true,
          },
        },
        {
          id: 't2',
          message: 'Football',
          feedback: {
            reply: 'Who do you play with?',
            correction: '',
            betterAnswer: '',
            grammarTip: '',
            focusMet: true,
          },
        },
      ],
      completedTurns: 2,
      turnTarget: 3,
      remainingToday: 1,
    });
    const thread = fixture.nativeElement.querySelector('.conversation-thread') as HTMLElement;
    expect(thread).toBeTruthy();
    expect(thread.querySelector('details')).toBeNull();
    expect(
      Array.from(thread.querySelectorAll('.conversation-bubble--student')).map((bubble) =>
        bubble.textContent?.trim(),
      ),
    ).toEqual(['Good', 'Football']);
    expect(
      Array.from(thread.querySelectorAll('.conversation-bubble--tutor p')).map((bubble) =>
        bubble.textContent?.trim(),
      ),
    ).toEqual(['Hi! How are you?', 'What do you like?', 'Who do you play with?']);
    expect(thread.querySelector('.conversation-question__text')?.textContent).toContain(
      'Who do you play with?',
    );

    const trigger = fixture.nativeElement.querySelector(
      '.conversation-voice-trigger',
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    fixture.detectChanges();
    expect(page.voicePickerOpen()).toBe(true);
    (
      fixture.nativeElement.querySelectorAll(
        '.conversation-voice-picker button',
      )[1] as HTMLButtonElement
    ).click();
    expect(page.selectedVoice()).toBe('Puck');
    expect(page.voicePickerOpen()).toBe(false);
    http.verify();
  });

  it('shows the daily limit and never offers a composer when quota is spent', async () => {
    const { http, fixture } = await setup(material, { ...emptyHistory, remainingToday: 0 });
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('وصلت للحد اليومي');
    http.verify();
  });

  it('lets a student resume an unfinished conversation after a long break', async () => {
    const { http, fixture, page } = await setup(material, {
      ...emptyHistory,
      turns: [{ id: 'old', message: 'Yes', feedback: { reply: 'What else?', focusMet: true } }],
      completedTurns: 1,
      timedOut: true, // Older API responses may still contain the retired flag.
    });
    expect(fixture.nativeElement.querySelector('#student-message')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('توقفت المحادثة بعد فترة خمول');
    page.message = 'I used my phone';
    void page.send();
    await Promise.resolve();
    const turn = http.expectOne('/api/student/learning/slots/s1/conversation/turns');
    expect(turn.request.method).toBe('POST');
    turn.flush({ reply: 'Great.' });
    await Promise.resolve();
    http
      .expectOne('/api/student/learning/slots/s1/conversation/turns')
      .flush({ ...emptyHistory, completedTurns: 2 });
    await fixture.whenStable();
    http.verify();
  });

  it('still offers an early evaluation when structured practice uses its daily quota', async () => {
    const { http, fixture } = await setup(material, {
      ...emptyHistory,
      minTurns: 2,
      maxTurns: 4,
      canFinish: false,
      remainingToday: 0,
    });
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    expect(fixture.nativeElement.querySelector('.conversation-end-early')).toBeTruthy();
    http.verify();
  });

  it('handles a 429 response without submitting again', async () => {
    const { http, fixture, page } = await setup();
    page.message = 'Good';
    void page.send();
    await Promise.resolve();
    http
      .expectOne('/api/student/learning/slots/s1/conversation/turns')
      .flush({ error: 'daily_ai_limit' }, { status: 429, statusText: 'Too Many Requests' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.dailyLimitReached()).toBe(true);
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    expect(page.error().length).toBeGreaterThan(0);
    http.verify();
  });

  it('keeps legacy material generic and preserves quick phrases, voice and microphone fallback', async () => {
    const { http, fixture, page } = await setup(
      {
        completed: { quiz: true },
        progress: { conversation: 1 },
        conversationSupportMode: null,
        targetPhrases: ['Could I have bread?'],
        conversationScenario: 'Buying bread',
        openingMessage: 'What would you like?',
      },
      {
        turns: [
          {
            id: 'turn-1',
            message: 'Bread please',
            feedback: {
              reply: 'Here it is.',
              correction: '',
              betterAnswer: '',
              grammarTip: '',
              focusMet: null,
            },
          },
        ],
        remainingToday: 3,
      },
    );
    expect(page.completedReplies()).toBe(1);
    expect(fixture.nativeElement.textContent).not.toContain('كلمة واحدة أو عبارة قصيرة تكفي');
    expect(fixture.nativeElement.querySelector('.conversation-help-actions')).toBeNull();
    (
      fixture.nativeElement.querySelector('.conversation-suggestions button') as HTMLButtonElement
    ).click();
    expect(page.message).toBe('Could I have bread?');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('#student-message') as HTMLInputElement).value,
    ).toBe('Could I have bread?');
    (fixture.nativeElement.querySelector('.conversation-mic') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('الميكروفون غير مدعوم');
    const voices = fixture.nativeElement.querySelectorAll('.conversation-voice-picker button');
    expect(voices.length).toBe(3);
    (voices[1] as HTMLButtonElement).click();
    expect(page.selectedVoice()).toBe('Puck');
    expect(TestBed.inject(StudentLearningApi).conversationAudioUrl('s1', 'Puck', 'turn-1')).toBe(
      '/api/student/learning/slots/s1/conversation/audio?voice=Puck&turnId=turn-1',
    );
    http.verify();
  });

  it('uses a larger reply space in independent mode without asking for personal details', async () => {
    const { http, fixture } = await setup({
      ...material,
      conversationSupportMode: 'independent',
      studentRole: 'Customer',
      conversationHelpAr: null,
      conversationModelAnswer: null,
    });
    expect(fixture.nativeElement.querySelector('textarea#student-message')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('دورك');
    expect(fixture.nativeElement.textContent).toContain('من غير تفاصيل شخصية غير لازمة');
    http.verify();
  });

  it('blocks another send when POST succeeds but refreshing history fails', async () => {
    const { http, fixture, page } = await setup();
    page.message = 'Good';
    void page.send();
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      reply: 'Well done.',
      correction: '',
      betterAnswer: '',
      grammarTip: '',
      focusMet: true,
    });
    await Promise.resolve();
    http
      .expectOne('/api/student/learning/slots/s1/conversation/turns')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.syncNeeded()).toBe(true);
    expect(page.message).toBe('Good');
    expect(
      (fixture.nativeElement.querySelector('.conversation-send') as HTMLButtonElement).disabled,
    ).toBe(true);
    void page.send();
    http.expectNone('/api/student/learning/slots/s1/conversation/turns');
    void page.load();
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush(material);
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      turns: [
        {
          id: 'turn-1',
          message: 'Good',
          feedback: {
            reply: 'Well done.',
            correction: '',
            betterAnswer: '',
            grammarTip: '',
            focusMet: true,
          },
        },
      ],
      completedTurns: 1,
      turnTarget: 3,
      remainingToday: 2,
    });
    await fixture.whenStable();
    expect(page.syncNeeded()).toBe(false);
    expect(page.message).toBe('');
    http.verify();
  });
});
