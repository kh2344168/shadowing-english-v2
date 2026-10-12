import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { StudentGrammarPage } from './grammar.page';

describe('StudentGrammarPage', () => {
  it('completes a grammar stage and follows the configured next stage', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentGrammarPage],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: {
          snapshot: { paramMap: convertToParamMap({ slotId: 's1' }) },
        } },
        { provide: AuthService, useValue: { csrf: () => of({}) } },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentGrammarPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
      grammarFocus: 'Use could for polite requests.',
      completed: { vocabulary: true, grammar: false },
      stages: [
        { key: 'vocabulary', title: 'الكلمات', position: 2, route: '/vocabulary' },
        { key: 'grammar', title: 'القواعد', position: 5, route: '/grammar' },
        { key: 'conversation', title: 'المحادثة', position: 7, route: '/conversation' },
      ],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Use could for polite requests.');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await Promise.resolve();
    const request = http.expectOne('/api/student/learning/slots/s1/grammar/progress');
    expect(request.request.method).toBe('PUT');
    request.flush({ completed: 1, isComplete: true });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/conversation"]')).toBeTruthy();
    http.verify();
  });
});
