import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface AdminAccount {
  id: string;
  email: string;
  isPrimaryAdmin: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminAccountsApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/accounts';

  me(): Observable<{ isPrimaryAdmin: boolean }> {
    return this.http.get<{ isPrimaryAdmin: boolean }>(`${this.base}/me`);
  }

  list(): Observable<AdminAccount[]> {
    return this.http.get<AdminAccount[]>(this.base);
  }

  create(email: string, password: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(this.base, { email, password });
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${encodeURIComponent(id)}`);
  }
}
