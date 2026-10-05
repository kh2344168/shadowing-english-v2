import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
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
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    http.verify();
  });
});
