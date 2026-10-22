import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export type LessonStageType =
  | 'content'
  | 'shadowing'
  | 'vocabulary'
  | 'listen-type'
  | 'grammar'
  | 'vocabulary-quiz'
  | 'grammar-quiz'
  | 'word-order'
  | 'conversation';

export interface LessonWorkflowStage {
  id: string;
  type: LessonStageType;
  title: string;
  position: number;
  enabled: boolean;
  required: boolean;
}

export interface LessonWorkflow {
  lessonId: string;
  versionId: string;
  versionNumber: number;
  title: string;
  description: string;
  lessonType: 'situation' | 'clip' | 'manual';
  level: string;
  goal: string;
  revision: string;
  stages: LessonWorkflowStage[];
  aiStatus: 'Pending' | 'Generating' | 'Draft' | 'Approved' | 'Failed' | null;
  reviewedStages: string[];
}

@Injectable({ providedIn: 'root' })
export class LessonWorkflowApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/lessons';

  create(request: {
    title: string;
    lessonType: 'situation' | 'clip' | 'manual';
    level: string;
    goal: string;
    sourceText: string;
  }) {
    return this.http.post<{ lessonId: string; versionId: string }>(
      `${this.base}/definitions`,
      request,
    );
  }

  get(versionId: string) {
    return this.http.get<LessonWorkflow>(`${this.base}/${encodeURIComponent(versionId)}/workflow`);
  }

  save(versionId: string, expectedRevision: string, stages: LessonWorkflowStage[]) {
    return this.http.put<{
      revision: string;
      stages: LessonWorkflowStage[];
      autoPublishedGroups?: number;
      autoPublishFailed?: boolean;
    }>(`${this.base}/${encodeURIComponent(versionId)}/workflow`, { expectedRevision, stages });
  }
}
