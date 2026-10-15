import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export interface VocabularyCard {
  word: string;
  meaningAr: string;
  exampleEn: string;
  exampleAr: string;
  kind?: 'word' | 'chunk';
  includeForStudent?: boolean;
  explanation?: string | null;
  extraExample?: string | null;
  usageNote?: string | null;
  testLater?: boolean;
  imageUrl?: string | null;
  repeatForReview?: boolean;
}
export interface VocabularyImageOption {
  imageUrl: string;
  photographer: string;
  photoUrl: string;
}
export interface DictationCard {
  position: number;
  enabled: boolean;
  acceptedAnswers: string[];
  hint: string | null;
}
export interface LessonSegmentReview {
  position: number;
  text: string;
}
export interface QuizCard {
  question: string;
  options: string[];
  correctIndex: number;
  explanationAr: string;
  type?: 'multiple-choice' | 'vocabulary-card' | 'word-order';
  enabled?: boolean;
  correctAnswer?: string | null;
}
export interface LessonMaterial {
  vocabulary: VocabularyCard[];
  quiz: QuizCard[];
  grammarFocus: string;
  conversationScenario: string;
  dictation?: DictationCard[] | null;
  conversationGoals?: string[] | null;
  aiRole?: string | null;
  studentRole?: string | null;
  openingMessage?: string | null;
  conversationTurnTarget?: number | null;
  conversationLearningOutcome?: string | null;
  conversationFocusTense?: string | null;
  conversationTargetWords?: string[] | null;
  conversationCorrectionMode?: 'lesson-only' | 'all';
  shadowingReviewEnabled?: boolean;
  reviewedStages?: Array<
    | 'vocabulary'
    | 'listen-type'
    | 'grammar'
    | 'vocabulary-quiz'
    | 'grammar-quiz'
    | 'word-order'
    | 'conversation'
    | 'quiz'
  > | null;
}
export interface LessonAiJob {
  id: string;
  lessonVersionId: string;
  revision: string;
  status: 'Pending' | 'Generating' | 'Draft' | 'Approved' | 'Failed';
  providerName: string | null;
  errorCode: string | null;
  createdAtUtc: string;
  approvedAtUtc: string | null;
  material: LessonMaterial | null;
}

@Injectable({ providedIn: 'root' })
export class LessonAiApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/lessons';
  providers() {
    return this.http.get<{ configured: string[]; imagesConfigured?: boolean }>(`${this.base}/ai-providers`);
  }
  vocabularyImages(versionId: string, job: LessonAiJob, cardIndex: number, page: number) {
    return this.http.post<{ options: VocabularyImageOption[]; provider: 'pexels'; page: number }>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/${encodeURIComponent(job.id)}/vocabulary-image`,
      { expectedRevision: job.revision, cardIndex, page },
    );
  }
  get(versionId: string) {
    return this.http.get<LessonAiJob | null>(`${this.base}/${encodeURIComponent(versionId)}/ai`);
  }
  latestDraft(versionId: string) {
    return this.http.get<LessonAiJob | null>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/draft`,
    );
  }
  segments(versionId: string) {
    return this.http.get<LessonSegmentReview[]>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/segments`,
    );
  }
  start(versionId: string, requestId: string) {
    return this.http.post<LessonAiJob>(`${this.base}/${encodeURIComponent(versionId)}/ai`, {
      requestId,
    });
  }
  update(versionId: string, job: LessonAiJob, material: LessonMaterial) {
    return this.http.put<LessonAiJob>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/${encodeURIComponent(job.id)}`,
      { expectedRevision: job.revision, material },
    );
  }
  reopen(versionId: string, job: LessonAiJob, requestId: string) {
    return this.http.post<LessonAiJob>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/${encodeURIComponent(job.id)}/reopen`,
      { requestId, expectedRevision: job.revision },
    );
  }
  approve(versionId: string, job: LessonAiJob) {
    return this.http.post<LessonAiJob>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/${encodeURIComponent(job.id)}/approve`,
      { expectedRevision: job.revision },
    );
  }
}
