import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AiMaterial, StudentLearningApi } from '../../learning.api';

@Component({
  selector: 'app-student-vocabulary-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './vocabulary.page.html',
  styleUrl: './vocabulary.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentVocabularyPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly material = signal<AiMaterial | null>(null);
  readonly completed = signal(0);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');

  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      this.material.set(data);
      this.completed.set(data.progress.vocabulary);
    } catch (ex) {
      this.error.set(
        (ex as { status?: number }).status === 404
          ? 'الكلمات لم تُعتمد وتُنشر لهذا الدرس بعد.'
          : 'تعذر تحميل الكلمات أو أن مرحلة Shadowing لم تكتمل.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  async next(): Promise<void> {
    const material = this.material();
    if (!material || this.busy() || this.completed() >= material.vocabulary.length) return;
    this.busy.set(true);
    this.error.set('');
    const position = this.completed() + 1;
    try {
      await firstValueFrom(this.auth.csrf());
      const progress = await firstValueFrom(this.api.vocabularyProgress(this.slotId, position));
      this.completed.set(progress.completed);
    } catch {
      this.error.set('تعذر حفظ التقدم. اضغط تحديث ثم حاول مجددًا.');
    } finally {
      this.busy.set(false);
    }
  }
}
