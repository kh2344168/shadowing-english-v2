import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
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
    expect(fixture.nativeElement.querySelector('.conversation-history')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#student-message')).toBeTruthy();
    page.history.update((history) => ({ ...history!, completedTurns: 2 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('أنهيت مرحلة المحادثة');
    http.verify();
  });

  it('shows the daily limit and never offers a composer when quota is spent', async () => {
    const { http, fixture } = await setup(material, { ...emptyHistory, remainingToday: 0 });
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('وصلت للحد اليومي');
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
