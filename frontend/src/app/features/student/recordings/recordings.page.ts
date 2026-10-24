import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  ShadowingRecordingStore,
  StoredShadowingRecording,
} from '../lesson/shadowing/shadowing-recording.store';

interface RecordingView {
  recording: StoredShadowingRecording;
  url: string;
}

@Component({
  selector: 'app-student-recordings-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './recordings.page.html',
  styleUrl: './recordings.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentRecordingsPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly store = inject(ShadowingRecordingStore);
  private destroyed = false;

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly recordings = signal<RecordingView[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.releaseUrls();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const session = await firstValueFrom(this.auth.session());
      if (!session.authenticated || !session.userId || !session.roles.includes('Student'))
        throw new Error('student_session_required');
      const rows = await this.store.listForStudent(session.userId);
      if (this.destroyed) return;
      this.releaseUrls();
      this.recordings.set(rows.map((recording) => ({
        recording,
        url: URL.createObjectURL(recording.blob),
      })));
    } catch {
      if (!this.destroyed) this.error.set(true);
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }

  private releaseUrls(): void {
    for (const item of this.recordings()) URL.revokeObjectURL(item.url);
    this.recordings.set([]);
  }
}
