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
  completedStages: number;
  totalStages: number;
  isComplete: boolean;
}
export interface Curriculum {
  groupName: string | null;
  publishedVersionId: string | null;
  curriculumTitle: string | null;
  items: LessonCard[];
  hasMore: boolean;
}
export interface StageOverview {
  key: string;
  title: string;
  description: string;
  icon: string;
  position: number;
  required: boolean;
  isComplete: boolean;
  isUnlocked: boolean;
  route: string;
}
export interface StageLink {
  key: string;
  title: string;
  position: number;
  route: string;
}
export interface LessonOverview {
  studentId?: string;
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
  totalStages: number;
  completedStages: number;
  stages: StageOverview[];
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
  stages?: StageLink[] | null;
  vocabulary: {
    word: string;
    meaningAr: string;
    exampleEn: string;
    exampleAr: string;
    kind?: 'word' | 'chunk';
    explanation?: string | null;
    extraExample?: string | null;
    usageNote?: string | null;
    imageUrl?: string | null;
  }[];
  grammarFocus: string;
  conversationScenario: string;
  conversationGoals?: string[] | null;
  aiRole?: string | null;
  studentRole?: string | null;
  openingMessage?: string | null;
  conversationTurnTarget?: number | null;
  conversationLearningOutcome?: string | null;
  conversationFocusTense?: string | null;
  conversationSupportMode?: 'first-steps' | 'guided' | 'independent' | null;
  conversationHelpAr?: string | null;
  conversationModelAnswer?: string | null;
  conversationCorrectionMode?: 'lesson-only' | 'all' | null;
  conversationContextType?: 'situation' | 'clip' | 'professional' | null;
  conversationAllowedFacts?: string[] | null;
  conversationSuccessSteps?: string[] | null;
  conversationMinTurns?: number | null;
  conversationMaxTurns?: number | null;
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
    mode?: 'missing-word' | 'word-order' | 'single-word' | 'full-sentence' | null;
    promptText?: string | null;
    wordOptions?: string[] | null;
    audioStartSeconds?: number | null;
    audioEndSeconds?: number | null;
  }[];
  dictationState?: {
    nextPosition: number | null;
    masteredCount: number;
    reviewRemaining: number;
    isReviewRound: boolean;
    attemptCount: number;
  };
  progress: {
    vocabulary: number;
    grammar?: number;
    vocabularyQuiz?: number;
    grammarQuiz?: number;
    wordOrder?: number;
    shadowingReview?: number;
    listenType: number;
    quiz: number;
    conversation: number;
  };
  completed: {
    shadowing?: boolean;
    vocabulary: boolean;
    grammar?: boolean;
    vocabularyQuiz?: boolean;
    grammarQuiz?: boolean;
    wordOrder?: boolean;
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
  nextPosition?: number | null;
  masteredCount?: number;
  reviewRemaining?: number;
  isReviewRound?: boolean;
  attemptCount?: number;
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
  focusMet?: boolean | null;
  metSteps?: string[] | null;
  issues?: { original: string; suggested: string; reason: string; kind: string }[] | null;
  criticalFactError?: boolean;
}
export interface ConversationResult {
  goalMet: boolean;
  replyCount: number;
  relevantReplies?: number;
  metSteps: string[];
  missingSteps: string[];
  issues: { original: string; suggested: string; reason: string; kind: string }[];
  retrySentence?: string | null;
  endedEarly: boolean;
  outcome: string;
}
export interface ConversationReviewItem {
  slotId: string;
  lessonTitle: string;
  createdAtUtc: string;
  result: ConversationResult;
}
export interface ConversationHistory {
  turns: { id: string; message: string; feedback: ConversationFeedback }[];
  completedTurns?: number;
  turnTarget?: number;
  minTurns?: number | null;
  maxTurns?: number | null;
  metSteps?: string[];
  missingSteps?: string[];
  goalMet?: boolean;
  canFinish?: boolean;
  timedOut?: boolean;
  report?: ConversationResult | null;
  remainingToday: number;
}

@Injectable({ providedIn: 'root' })
export class StudentLearningApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/student/learning';

  conversationReview(): Observable<ConversationReviewItem[]> {
    return this.http.get<ConversationReviewItem[]>(`${this.base}/conversation-review`);
  }

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
  vocabularyAudio(slotId: string, position: number, part: 'word' | 'example') {
    return this.http.post(`${this.base}/slots/${encodeURIComponent(slotId)}/vocabulary/audio`, {}, {
      params: { position, part },
      responseType: 'blob',
    });
  }
  grammarProgress(slotId: string): Observable<PracticeProgress> {
    return this.http.put<PracticeProgress>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/grammar/progress`,
      {},
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
    stageKey?: string,
  ): Observable<QuizFeedback> {
    return this.http.post<QuizFeedback>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/quiz/answers`,
      typeof answer === 'string'
        ? { requestId, position, answer, stageKey }
        : { requestId, position, optionIndex: answer, stageKey },
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
  finishConversation(slotId: string): Observable<ConversationResult> {
    return this.http.post<ConversationResult>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/conversation/finish`,
      {},
    );
  }
  transcribeConversation(slotId: string, audio: Blob): Observable<{ text: string }> {
    const form = new FormData();
    form.append('audio', audio, 'student.webm');
    return this.http.post<{ text: string }>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/conversation/transcribe`,
      form,
    );
  }
  conversationAudio(slotId: string, voice: string, turnId?: string) {
    const path = `${this.base}/slots/${encodeURIComponent(slotId)}/conversation/audio`;
    const params = new URLSearchParams({ voice });
    if (turnId) params.set('turnId', turnId);
    return this.http.post(`${path}?${params}`, {}, { responseType: 'blob' });
  }
}
