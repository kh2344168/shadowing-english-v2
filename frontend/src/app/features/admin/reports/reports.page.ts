import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface ConversationReport {
  studentId: string;
  studentEmail: string;
  slotId: string;
  lessonVersionId: string;
  lessonTitle: string;
  createdAtUtc: string;
  result: {
    goalMet: boolean;
    replyCount: number;
    relevantReplies?: number;
    metSteps: string[];
    missingSteps: string[];
    issues: { original: string; suggested: string; reason: string; kind: string }[];
    retrySentence?: string | null;
    outcome: string;
  };
}
@Component({
  selector: 'app-admin-reports-page',
  standalone: true,
  templateUrl: './reports.page.html',
  styleUrl: './reports.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReportsPage implements OnInit {
  private readonly http = inject(HttpClient);
  readonly items = signal<ConversationReport[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly hasMore = signal(false);
  readonly page = signal(1);

  ngOnInit(): void {
    void this.load(1);
  }

  async load(page: number): Promise<void> {
    if (this.loading() && page !== 1) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.http.get<{
          items: ConversationReport[];
          hasMore: boolean;
        }>(`/api/admin/reports/conversations?page=${page}`),
      );
      this.items.set(page === 1 ? response.items : [...this.items(), ...response.items]);
      this.page.set(page);
      this.hasMore.set(response.hasMore);
    } catch {
      this.error.set('تعذر تحميل تقارير المحادثات. حاول مجددًا.');
    } finally {
      this.loading.set(false);
    }
  }
}
