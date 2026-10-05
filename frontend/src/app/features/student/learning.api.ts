import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface LessonCard {
  slotId: string;
  title: string;
  weekNumber: number;
  dayNumber: number;
  sortOrder: number;
  completedSegments: number;
  isComplete: boolean;
}
export interface Curriculum {
  groupName: string | null;
  publishedVersionId: string | null;
  curriculumTitle: string | null;
  items: LessonCard[];
  hasMore: boolean;
}
export interface LessonOverview {
  slotId: string;
  versionId: string;
  title: string;
  description: string;
  weekNumber: number;
  dayNumber: number;
  sortOrder: number;
  segmentCount: number;
  completedSegments: number;
  isComplete: boolean;
  hasAiContent: boolean;
}
export interface Segment {
  position: number;
  text: string;
  audioUrl: string;
}
export interface StageProgress {
  completedSegments: number;
  isComplete: boolean;
}

export interface AiMaterial {
  vocabulary: {
    word: string;
    meaningAr: string;
    exampleEn: string;
    exampleAr: string;
    kind?: 'word' | 'chunk';
    explanation?: string | null;
    extraExample?: string | null;
    usageNote?: string | null;
  }[];
  grammarFocus: string;
  conversationScenario: string;
  conversationGoals?: string[] | null;
  aiRole?: string | null;
  studentRole?: string | null;
  openingMessage?: string | null;
  targetPhrases?: string[];
  shadowingReviewEnabled?: boolean;
  quiz: {
    index: number;
    question: string;
    options: string[];
    type?: 'multiple-choice' | 'vocabulary-card' | 'word-order';
  }[];
  dictation: {
    position: number;
    segmentPosition?: number;
    audioUrl: string;
    hint?: string | null;
  }[];
  progress: {
    vocabulary: number;
    shadowingReview?: number;
    listenType: number;
    quiz: number;
    conversation: number;
  };
  completed: {
    vocabulary: boolean;
    shadowingReview?: boolean;
    listenType: boolean;
    quiz: boolean;
    conversation: boolean;
  };
}
export interface PracticeProgress {
  completed: number;
  isComplete: boolean;
}
export interface DictationFeedback {
  correct: boolean;
  wrongPositions: number[];
  expected: string;
}
export interface QuizFeedback {
  correct: boolean;
  correctIndex: number;
  explanationAr: string;
  correctAnswer?: string | null;
}
export interface ConversationFeedback {
  reply: string;
  correction: string;
  betterAnswer: string;
  grammarTip: string;
}
export interface ConversationHistory {
  turns: { message: string; feedback: ConversationFeedback }[];
  remainingToday: number;
}

@Injectable({ providedIn: 'root' })
export class StudentLearningApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/student/learning';

  curriculum(page = 1, pageSize = 20, expectedPublishedVersionId?: string): Observable<Curriculum> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (expectedPublishedVersionId) {
      params = params.set('expectedPublishedVersionId', expectedPublishedVersionId);
    }
    return this.http.get<Curriculum>(`${this.base}/curriculum`, {
      params,
    });
  }
  overview(slotId: string): Observable<LessonOverview> {
    return this.http.get<LessonOverview>(`${this.base}/slots/${encodeURIComponent(slotId)}`);
  }
  segment(slotId: string, position: number): Observable<Segment> {
    return this.http.get<Segment>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/segments/${position}`,
    );
  }
  save(slotId: string, completedSegments: number): Observable<StageProgress> {
    return this.http.put<StageProgress>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/progress`,
      { completedSegments },
    );
  }
  aiMaterial(slotId: string): Observable<AiMaterial> {
    return this.http.get<AiMaterial>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/ai-material`,
    );
  }
  vocabularyProgress(slotId: string, position: number): Observable<PracticeProgress> {
    return this.http.put<PracticeProgress>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/vocabulary/progress`,
      { position },
    );
  }
  shadowingReviewProgress(slotId: string, position: number): Observable<PracticeProgress> {
    return this.http.put<PracticeProgress>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/shadowing-review/progress`,
      { position },
    );
  }
  dictationAnswer(
    slotId: string,
    position: number,
    answer: string,
    requestId: string,
  ): Observable<DictationFeedback> {
    return this.http.post<DictationFeedback>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/listen-type/answers`,
      { requestId, position, answer },
    );
  }
  quizAnswer(
    slotId: string,
    position: number,
    answer: number | string,
    requestId: string,
  ): Observable<QuizFeedback> {
    return this.http.post<QuizFeedback>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/quiz/answers`,
      typeof answer === 'string'
        ? { requestId, position, answer }
        : { requestId, position, optionIndex: answer },
    );
  }
  conversationTurn(
    slotId: string,
    message: string,
    requestId: string,
  ): Observable<ConversationFeedback> {
    return this.http.post<ConversationFeedback>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/conversation/turns`,
      { requestId, message },
    );
  }
  conversationHistory(slotId: string): Observable<ConversationHistory> {
    return this.http.get<ConversationHistory>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/conversation/turns`,
    );
  }
}
