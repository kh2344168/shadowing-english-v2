import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface PagedResult<T> {
  items: T[];
  hasMore: boolean;
}

export interface StudyGroup {
  id: string;
  name: string;
}

export interface ActiveGroupMembership {
  membershipId: string;
  groupId: string;
  groupName: string;
  startedAtUtc: string;
}

export interface GroupStudent {
  id: string;
  email: string;
  activeGroup: ActiveGroupMembership | null;
}

export interface GroupHistoryItem {
  membershipId: string;
  groupId: string;
  groupName: string;
  startedAtUtc: string;
  endedAtUtc: string | null;
}

export interface MoveGroupResult {
  membershipId: string | null;
  groupId: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminGroupsApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/groups';

  listGroups(page = 1): Observable<PagedResult<StudyGroup>> {
    return this.http.get<PagedResult<StudyGroup>>(this.base, {
      params: new HttpParams().set('page', page).set('pageSize', 50),
    });
  }

  createGroup(name: string, requestId: string): Observable<StudyGroup> {
    return this.http.post<StudyGroup>(this.base, { name, requestId });
  }

  searchStudents(query: string, page = 1): Observable<PagedResult<GroupStudent>> {
    return this.http.get<PagedResult<GroupStudent>>(`${this.base}/students`, {
      params: new HttpParams().set('query', query).set('page', page).set('pageSize', 20),
    });
  }

  moveStudent(
    studentId: string,
    groupId: string | null,
    expectedMembershipId: string | null,
  ): Observable<MoveGroupResult> {
    return this.http.put<MoveGroupResult>(
      `${this.base}/students/${encodeURIComponent(studentId)}/membership`,
      { groupId, expectedMembershipId },
    );
  }

  history(studentId: string, page = 1): Observable<PagedResult<GroupHistoryItem>> {
    return this.http.get<PagedResult<GroupHistoryItem>>(
      `${this.base}/students/${encodeURIComponent(studentId)}/history`,
      { params: new HttpParams().set('page', page).set('pageSize', 20) },
    );
  }
}
