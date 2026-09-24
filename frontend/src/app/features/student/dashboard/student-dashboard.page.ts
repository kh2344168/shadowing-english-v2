import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface HealthResponse {
  status: string;
  application: string;
}

@Component({
  selector: 'app-student-dashboard-page',
  standalone: true,
  templateUrl: './student-dashboard.page.html',
  styleUrl: './student-dashboard.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentDashboardPage implements OnInit {
  private readonly http = inject(HttpClient);

  readonly apiStatus = signal<'checking' | 'connected' | 'failed'>('checking');

  ngOnInit(): void {
    const startedAt = performance.now();

    console.info('[Foundation.Health.Start]');

    this.http.get<HealthResponse>('/health').subscribe({
      next: (response) => {
        const connected = response.status === 'ok';

        this.apiStatus.set(connected ? 'connected' : 'failed');

        console.info('[Foundation.Health.Result]', {
          status: response.status,
          connected,
          durationMs: Math.round(performance.now() - startedAt),
        });
      },
      error: (error) => {
        this.apiStatus.set('failed');

        console.error('[Foundation.Health.Error]', {
          status: error.status,
          durationMs: Math.round(performance.now() - startedAt),
        });
      },
    });
  }
}