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

export interface AuthoringGroup {
  id: string;
  name: string;
  currentVersionId: string | null;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export interface Publication {
  groupId: string;
  versionId: string;
  slotId: string;
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
  ): Observable<AuthoringLesson> {
    const body = new FormData();
    body.append('requestId', requestId);
    body.append('title', title);
    body.append('description', description);
    body.append('segments', JSON.stringify(segments.map((segment) => segment.text)));
    segments.forEach((segment, index) => body.append(`audio${index}`, segment.audio));
    return this.http.post<AuthoringLesson>(`${this.base}/lessons`, body);
  }

  publish(request: {
    requestId: string;
    groupId: string;
    lessonVersionId: string;
    expectedVersionId: string | null;
    weekNumber: number;
    dayNumber: number;
    sortOrder: number;
  }): Observable<Publication> {
    return this.http.post<Publication>(`${this.base}/publish`, request);
  }
}
