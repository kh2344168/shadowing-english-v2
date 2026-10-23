import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { LessonStageType } from './lesson-workflow.api';

export type StageProcessingStatus =
  'NotStarted' | 'Pending' | 'Generating' | 'NeedsReview' | 'Approved' | 'Failed';
export type StageProcessingStatuses = Partial<Record<LessonStageType, StageProcessingStatus>>;
export interface StageLatestAttempt {
  id: string;
  status: 'Pending' | 'Generating' | 'Draft' | 'Approved' | 'Failed';
  errorCode: string | null;
}

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
  mode?: 'full-sentence' | 'missing-word' | 'word-order' | 'single-word';
  targetWordIndex?: number | null;
  audioStartSeconds?: number | null;
  audioEndSeconds?: number | null;
}
export interface LessonSegmentReview {
  position: number;
  text: string;
  audioUrl?: string | null;
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
  conversationSupportMode?: 'first-steps' | 'guided' | 'independent' | null;
  conversationHelpAr?: string | null;
  conversationModelAnswer?: string | null;
  conversationContextType?: 'situation' | 'clip' | 'professional' | null;
  conversationAllowedFacts?: string[] | null;
  conversationSuccessSteps?: string[] | null;
  conversationMinTurns?: number | null;
  conversationMaxTurns?: number | null;
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
  vocabularyOnly?: boolean;
  vocabularyTargetCount?: number | null;
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
  stageType?: LessonStageType | null;
  autoPublishedGroups?: number;
  autoPublishFailed?: boolean;
}

@Injectable({ providedIn: 'root' })
export class LessonAiApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/lessons';
  providers() {
    return this.http.get<{
      configured: string[];
      imagesConfigured?: boolean;
      voiceConfigured?: boolean;
    }>(`${this.base}/ai-providers`);
  }
  voice(versionId: string, text: string, voice: string) {
    return this.http.post(`${this.base}/${encodeURIComponent(versionId)}/ai/voice`, { text, voice }, {
      responseType: 'blob',
    });
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
  stageStatuses(versionId: string) {
    return this.http.get<StageProcessingStatuses>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/stages/statuses`,
    );
  }
  latestStageAttempt(versionId: string, stageType: LessonStageType) {
    return this.http.get<StageLatestAttempt | null>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/stages/${encodeURIComponent(stageType)}/latest-attempt`,
    );
  }
  generateStage(
    versionId: string,
    stageType: LessonStageType,
    requestId: string,
    vocabularyTargetCount?: number,
  ) {
    return this.http.post<LessonAiJob>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/stages/${encodeURIComponent(stageType)}/generate`,
      { requestId, vocabularyTargetCount },
    );
  }
  segments(versionId: string) {
    return this.http.get<LessonSegmentReview[]>(
      `${this.base}/${encodeURIComponent(versionId)}/ai/segments`,
    );
  }
  teacherSegmentAudioUrl(versionId: string, position: number): string {
    return `/api/admin/shadowing/lessons/versions/${encodeURIComponent(versionId)}/segments/${position}/audio`;
  }
  probeTeacherSegmentAudio(versionId: string, position: number) {
    return this.http.get(this.teacherSegmentAudioUrl(versionId, position), {
      responseType: 'blob',
      headers: { Range: 'bytes=0-0' },
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
