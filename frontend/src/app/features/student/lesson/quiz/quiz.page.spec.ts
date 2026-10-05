import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { StudentQuizPage } from './quiz.page';

describe('StudentQuizPage', () => {
  it('submits a word-order answer without sending or receiving the solution in material', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentQuizPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slotId: 's2' }) } },
        },
        { provide: AuthService, useValue: { csrf: () => of({}) } },
      ],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(StudentQuizPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/s2/ai-material').flush({
      completed: { listenType: true },
      progress: { quiz: 0 },
      quiz: [
        { index: 1, question: 'Arrange', type: 'word-order', options: ['from', 'here', 'Hello'] },
      ],
    });
    await fixture.whenStable();
    fixture.componentInstance.addWord(2);
    fixture.componentInstance.addWord(0);
    fixture.componentInstance.addWord(1);
    void fixture.componentInstance.submit();
    await Promise.resolve();
    const answer = http.expectOne('/api/student/learning/slots/s2/quiz/answers');
    expect(answer.request.body).toMatchObject({ position: 1, answer: 'Hello from here' });
    expect(answer.request.body.optionIndex).toBeUndefined();
    answer.flush({ correct: true, correctIndex: 0, explanationAr: 'صحيح' });
    await fixture.whenStable();
    expect(fixture.componentInstance.completed()).toBe(1);
    http.verify();
    fixture.destroy();
  });
  it('does not receive the correct answer until the selected option is submitted', async () => {
    await TestBed.configureTestingModule({
      imports: [StudentQuizPage],
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
    const fixture = TestBed.createComponent(StudentQuizPage);
    fixture.detectChanges();
    http.expectOne('/api/student/learning/slots/s1/ai-material').flush({
      completed: { listenType: true },
      progress: { quiz: 0 },
      quiz: [{ index: 1, question: 'Choose', options: ['a', 'b', 'c', 'd'] }],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await Promise.resolve();
    const write = http.expectOne('/api/student/learning/slots/s1/quiz/answers');
    expect(write.request.body).toMatchObject({ position: 1, optionIndex: 1 });
    write.flush({ correct: false, correctIndex: 2, explanationAr: 'الإجابة ج' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('الإجابة ج');
    http.verify();
  });
});
