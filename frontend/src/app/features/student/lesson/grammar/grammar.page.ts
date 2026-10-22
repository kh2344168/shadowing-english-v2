import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AiMaterial, StudentLearningApi } from '../../learning.api';
import { adjacentStage, stageAt, stageReady, stageReadyForStudent } from '../stage-flow';

@Component({
  selector: 'app-student-grammar-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './grammar.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentGrammarPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly material = signal<AiMaterial | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly complete = signal(false);
  readonly stage = computed(() => stageAt(this.material()?.stages, 'grammar'));
  readonly previousStage = computed(() => adjacentStage(this.material()?.stages, 'grammar', -1));
  readonly nextStage = computed(() => adjacentStage(this.material()?.stages, 'grammar', 1));

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.material.set(null);
    try {
      const material = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (!stageReady(material, 'grammar') && !(await stageReadyForStudent(this.api, this.slotId, material, 'grammar'))) {
        this.error.set('أكمل المراحل السابقة أولًا.');
      } else {
        this.material.set(material);
        this.complete.set(material.completed.grammar === true);
      }
    } catch {
      this.error.set('تعذر تحميل القواعد لهذا الدرس.');
    } finally {
      this.loading.set(false);
    }
  }

  async finish(): Promise<void> {
    if (!this.material() || this.busy() || this.complete()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.auth.csrf());
      await firstValueFrom(this.api.grammarProgress(this.slotId));
      this.complete.set(true);
    } catch {
      this.error.set('تعذر حفظ تقدمك. حاول مرة أخرى.');
    } finally {
      this.busy.set(false);
    }
  }
}
