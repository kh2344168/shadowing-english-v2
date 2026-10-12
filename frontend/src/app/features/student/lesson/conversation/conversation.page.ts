import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AiMaterial, ConversationHistory, StudentLearningApi } from '../../learning.api';
import { adjacentStage, stageReady } from '../stage-flow';

@Component({
  selector: 'app-student-conversation-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './conversation.page.html',
  styleUrl: './conversation.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentConversationPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(StudentLearningApi);
  private readonly auth = inject(AuthService);
  readonly slotId = this.route.snapshot.paramMap.get('slotId') ?? '';
  readonly material = signal<AiMaterial | null>(null);
  readonly previousStage = computed(() => adjacentStage(this.material()?.stages, 'conversation', -1));
  readonly nextStage = computed(() => adjacentStage(this.material()?.stages, 'conversation', 1));
  readonly history = signal<ConversationHistory | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  message = '';
  private pendingId = '';
  private pendingMessage = '';

  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.aiMaterial(this.slotId));
      if (!stageReady(data, 'conversation') || (!data.stages && !data.completed.quiz)) {
        this.material.set(null);
        this.error.set('أكمل المراحل السابقة قبل المحادثة.');
      } else {
        this.material.set(data);
        this.history.set(await firstValueFrom(this.api.conversationHistory(this.slotId)));
      }
    } catch (ex) {
      this.error.set(
        (ex as { status?: number }).status === 404
          ? 'المحادثة لم تُنشر لهذا الدرس بعد.'
          : 'تعذر تحميل المحادثة.',
      );
    } finally {
      this.loading.set(false);
    }
  }
  async send(): Promise<void> {
    const text = this.message.trim(),
      history = this.history();
    if (
      !this.material() ||
      !history ||
      this.busy() ||
      !text ||
      text.length > 400 ||
      history.remainingToday < 1 ||
      history.turns.length >= 10
    )
      return;
    this.busy.set(true);
    this.error.set('');
    if (!this.pendingId || this.pendingMessage !== text) {
      this.pendingId = crypto.randomUUID();
      this.pendingMessage = text;
    }
    try {
      await firstValueFrom(this.auth.csrf());
      await firstValueFrom(this.api.conversationTurn(this.slotId, text, this.pendingId));
      this.pendingId = '';
      this.pendingMessage = '';
      this.message = '';
      this.history.set(await firstValueFrom(this.api.conversationHistory(this.slotId)));
    } catch (ex) {
      const status = (ex as { status?: number }).status;
      this.error.set(
        status === 429
          ? 'وصلت للحد اليومي للذكاء الاصطناعي. ارجع بكرة.'
          : status === 503
            ? 'خدمات الذكاء الاصطناعي مش متاحة حاليًا. جرّب لاحقًا.'
            : 'لم نتمكن من إرسال الرسالة. اضغط تحديث للتأكد قبل إعادة المحاولة.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
