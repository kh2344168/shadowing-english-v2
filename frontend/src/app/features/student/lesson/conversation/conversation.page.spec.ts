import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { StudentLearningApi } from '../../learning.api';
import { StudentConversationPage } from './conversation.page';

describe('StudentConversationPage', () => {
  it('restores the server conversation and hides sending when daily quota is spent', async () => {
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
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
      completed: { quiz: true },
      conversationScenario: 'Buying bread',
      grammarFocus: 'Could I have...?',
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      turns: [
        {
          message: 'Bread please',
          feedback: {
            reply: 'Here it is.',
            correction: 'Could I have bread?',
            betterAnswer: 'Could I have some bread?',
            grammarTip: 'Use could for requests.',
          },
        },
      ],
      remainingToday: 0,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Bread please');
    expect(fixture.nativeElement.querySelector('.conversation-bubble--student')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.conversation-bubble--tutor')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    http.verify();
  });

  it('uses lesson phrases as quick replies and explains unsupported microphones', async () => {
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
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
      completed: { quiz: true },
      targetPhrases: ['Could I have bread?'],
      openingMessage: 'What would you like?',
      conversationTurnTarget: 3,
      conversationLearningOutcome: 'Ask for bread politely',
      conversationFocusTense: 'present-simple',
    });
    await Promise.resolve();
    http.expectOne('/api/student/learning/slots/s1/conversation/turns').flush({
      turns: [],
      remainingToday: 3,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('.conversation-suggestions button') as HTMLButtonElement
    ).click();
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
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedVoice()).toBe('Puck');
    expect(fixture.nativeElement.textContent).toContain('من 3');
    expect(fixture.nativeElement.textContent).toContain('Ask for bread politely');
    expect(fixture.nativeElement.textContent).toContain('Present Simple');
    fixture.componentInstance.history.set({
      turns: Array.from({ length: 3 }, (_, index) => ({
        id: `turn-${index}`,
        message: 'Could I have bread?',
        feedback: {
          reply: 'Yes.',
          correction: '',
          betterAnswer: '',
          grammarTip: '',
          focusMet: index < 2,
        },
      })),
      completedTurns: 2,
      remainingToday: 3,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#student-message')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('الرد خارج الزمن المستهدف');
    fixture.componentInstance.history.update((history) => ({ ...history!, completedTurns: 3 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#student-message')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('أنهيت المحادثة');
    expect((voices[1] as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect(TestBed.inject(StudentLearningApi).conversationAudioUrl('s1', 'Puck', 'turn-1')).toBe(
      '/api/student/learning/slots/s1/conversation/audio?voice=Puck&turnId=turn-1',
    );
    http.verify();
  });
});
