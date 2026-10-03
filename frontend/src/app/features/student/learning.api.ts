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
}
