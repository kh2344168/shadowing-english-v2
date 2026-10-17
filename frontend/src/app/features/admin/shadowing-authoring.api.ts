import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface AuthoringLesson {
  id: string;
  versionId: string;
  title: string;
  description: string;
  segmentCount: number;
}

export interface LessonEditDetails {
  id: string;
  versionId: string;
  versionNumber: number;
  title: string;
  description: string;
  segments: { position: number; text: string; audioUrl: string }[];
}

export interface LessonEditResult extends AuthoringLesson {
  aiNeedsReview: boolean;
}

export interface AuthoringGroup {
  id: string;
  name: string;
  currentVersionId: string | null;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export interface CurriculumPosition {
  lessonVersionId: string;
  weekNumber: number;
  dayNumber: number;
  sortOrder: number;
}

export interface CurriculumLesson extends CurriculumPosition {
  lessonId: string;
  title: string;
  description: string;
  segmentCount: number;
}

export interface CurriculumSummary {
  id: string;
  name: string;
  description: string;
  draftRevision: string;
  updatedAtUtc: string | null;
  lessonCount: number;
  weekCount: number;
}

export interface CurriculumDraft {
  id: string;
  name: string;
  description: string;
  draftRevision: string;
  updatedAtUtc: string | null;
  lessons: CurriculumLesson[];
}

export interface CurriculumSaveRequest {
  requestId: string;
  expectedDraftRevision: string;
  name: string;
  description: string;
  lessons: CurriculumPosition[];
}

export interface CurriculumAssignRequest {
  requestId: string;
  curriculumTemplateId: string;
  expectedAssignmentRevision: string;
}

export interface CurriculumPublishRequest {
  requestId: string;
  groupId: string;
  curriculumTemplateId: string;
  expectedDraftRevision: string;
  expectedAssignmentRevision: string;
  expectedVersionId: string | null;
}

export interface GroupCurriculumState {
  groupId: string;
  groupName: string;
  assignedCurriculumTemplateId: string | null;
  assignedCurriculumName: string | null;
  draftRevision: string | null;
  assignmentRevision: string;
  versionId: string | null;
  publishedCurriculumTemplateId: string | null;
  publishedTitle: string | null;
  publishedDraftRevision: string | null;
  versionNumber: number | null;
  hasUnpublishedChanges: boolean;
  aiContentStates?: {
    lessonVersionId: string;
    status:
      'no_ai_content' | 'draft_needs_approval' | 'approved_needs_publish' | 'approved_published';
  }[];
  lessons: Pick<
    CurriculumLesson,
    'lessonId' | 'lessonVersionId' | 'title' | 'weekNumber' | 'dayNumber' | 'sortOrder'
  >[];
}

export interface CurriculumPublication {
  versionId: string;
  groupId: string;
  curriculumTemplateId: string;
  sourceDraftRevision: string;
  versionNumber: number;
}

@Injectable({ providedIn: 'root' })
export class ShadowingAuthoringApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/shadowing';

  lessons(page = 1): Observable<Page<AuthoringLesson>> {
    return this.http.get<Page<AuthoringLesson>>(`${this.base}/lessons`, {
      params: new HttpParams().set('page', page),
    });
  }

  lessonDetails(id: string): Observable<LessonEditDetails> {
    return this.http.get<LessonEditDetails>(`${this.base}/lessons/${encodeURIComponent(id)}`);
  }

  lessonSegmentAudio(versionId: string, position: number): Observable<Blob> {
    return this.http.get(
      `${this.base}/lessons/versions/${encodeURIComponent(versionId)}/segments/${position}/audio`,
      { responseType: 'blob' },
    );
  }

  editLesson(
    id: string,
    expectedVersionId: string,
    requestId: string,
    title: string,
    description: string,
    segments: { position: number; text: string; audio: File | null }[],
  ): Observable<LessonEditResult> {
    const body = new FormData();
    body.append('expectedVersionId', expectedVersionId);
    body.append('requestId', requestId);
    body.append('title', title);
    body.append('description', description);
    body.append('segments', JSON.stringify(segments.map((segment) => segment.text.trim())));
    body.append('sourcePositions', JSON.stringify(segments.map((segment) => segment.position)));
    segments.forEach((segment, index) => {
      if (segment.audio) body.append(`audio${index}`, segment.audio);
    });
    return this.http.put<LessonEditResult>(`${this.base}/lessons/${encodeURIComponent(id)}`, body);
  }

  deleteLessonPermanently(id: string, expectedVersionId: string): Observable<void> {
    return this.http.request<void>('DELETE', `${this.base}/lessons/${encodeURIComponent(id)}`, {
      body: { expectedVersionId, permanentlyDelete: true },
    });
  }

  curriculums(page = 1): Observable<Page<CurriculumSummary>> {
    return this.http.get<Page<CurriculumSummary>>(`${this.base}/curriculums`, {
      params: new HttpParams().set('page', page),
    });
  }

  curriculum(id: string): Observable<CurriculumDraft> {
    return this.http.get<CurriculumDraft>(`${this.base}/curriculums/${encodeURIComponent(id)}`);
  }

  createCurriculum(request: {
    requestId: string;
    name: string;
    description: string;
  }): Observable<CurriculumDraft> {
    return this.http.post<CurriculumDraft>(`${this.base}/curriculums`, request);
  }

  saveCurriculum(id: string, request: CurriculumSaveRequest): Observable<CurriculumDraft> {
    return this.http.put<CurriculumDraft>(
      `${this.base}/curriculums/${encodeURIComponent(id)}`,
      request,
    );
  }

  groupCurriculum(id: string): Observable<GroupCurriculumState> {
    return this.http.get<GroupCurriculumState>(
      `${this.base}/groups/${encodeURIComponent(id)}/curriculum`,
    );
  }

  assignCurriculum(id: string, request: CurriculumAssignRequest): Observable<GroupCurriculumState> {
    return this.http.put<GroupCurriculumState>(
      `${this.base}/groups/${encodeURIComponent(id)}/curriculum-assignment`,
      request,
    );
  }

  publishCurriculum(request: CurriculumPublishRequest): Observable<CurriculumPublication> {
    return this.http.post<CurriculumPublication>(`${this.base}/curriculums/publish`, request);
  }

  groups(page = 1): Observable<Page<AuthoringGroup>> {
    return this.http.get<Page<AuthoringGroup>>(`${this.base}/groups`, {
      params: new HttpParams().set('page', page),
    });
  }

  create(
    requestId: string,
    title: string,
    description: string,
    segments: { text: string; audio: File }[],
    level = 'B1',
    goal = '',
  ): Observable<AuthoringLesson> {
    const body = new FormData();
    body.append('requestId', requestId);
    body.append('title', title);
    body.append('description', description);
    body.append('level', level);
    body.append('goal', goal);
    body.append('segments', JSON.stringify(segments.map((segment) => segment.text)));
    segments.forEach((segment, index) => body.append(`audio${index}`, segment.audio));
    return this.http.post<AuthoringLesson>(`${this.base}/lessons`, body);
  }
}
