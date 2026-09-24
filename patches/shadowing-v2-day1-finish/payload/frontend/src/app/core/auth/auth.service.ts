import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AuthSession {
  authenticated: boolean;
  userId: string | null;
  roles: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  csrf(): Observable<void> {
    return this.http.get<void>('/api/auth/csrf');
  }

  session(): Observable<AuthSession> {
    return this.http.get<AuthSession>('/api/auth/session');
  }

  login(email: string, password: string): Observable<AuthSession> {
    return this.http.post<AuthSession>('/api/auth/login', { email, password });
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }
}
