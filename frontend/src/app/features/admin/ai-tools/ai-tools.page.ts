import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  DEFAULT_PROCESSOR_SETTINGS,
  LocalProcessorClient,
  ProcessorError,
} from '../ai-processing/local-processor.client';

type ToolState = 'idle' | 'preparing' | 'package-ready' | 'checking' | 'connected' | 'failed';

@Component({
  selector: 'app-admin-ai-tools-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './ai-tools.page.html',
  styleUrl: './ai-tools.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAIToolsPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly client = inject(LocalProcessorClient);
  private installerUrl = '';
  private destroyed = false;

  userId = '';
  readonly state = signal<ToolState>('idle');
  readonly message = signal('لم يتم التحقق من أداة WhisperX على هذا الكمبيوتر بعد.');
  readonly downloadUrl = signal('');
  readonly hasSavedLink = signal(false);

  async ngOnInit(): Promise<void> {
    const started = Date.now();
    console.info('[Admin.AITools.Page.Start]');
    try {
      const session = await firstValueFrom(this.auth.session());
      if (this.destroyed) return;
      if (!session.authenticated || !session.roles.includes('Admin') || !session.userId) {
        this.fail('هذه الصفحة متاحة لحساب Admin فقط.', 'unauthorized', started);
        return;
      }

      this.userId = session.userId;
      const saved = this.client.initialize(session.userId);
      this.hasSavedLink.set(!!saved);
      console.info('[Admin.AITools.Page.Ready]', {
        userId: session.userId,
        savedLink: !!saved,
        durationMs: Date.now() - started,
      });

      if (saved) await this.checkConnection(false);
    } catch {
      this.fail('تعذر التحقق من حساب الأدمن. أعد تسجيل الدخول.', 'session_failed', started);
    }
  }

  async downloadInstaller(): Promise<void> {
    if (!this.userId || this.state() === 'preparing') return;
    const started = Date.now();
    this.clearDownload();
    this.state.set('preparing');
    this.message.set('جارٍ تجهيز حزمة WhisperX الخاصة بهذا الحساب...');
    console.info('[Admin.AITools.WhisperX.Package.Start]', { userId: this.userId });

    try {
      const blob = await this.client.downloadInstaller(DEFAULT_PROCESSOR_SETTINGS);
      if (this.destroyed) return;
      this.installerUrl = URL.createObjectURL(blob);
      this.downloadUrl.set(this.installerUrl);
      this.hasSavedLink.set(true);
      this.state.set('package-ready');
      this.message.set(
        'تم تجهيز الحزمة وتنزيلها. فك الضغط ثم شغّل Install.cmd، وبعد انتهاء النافذة اضغط «تحقق من التثبيت».',
      );
      console.info('[Admin.AITools.WhisperX.Package.Success]', {
        bytes: blob.size,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const code = error instanceof ProcessorError ? error.code : 'package_failed';
      this.fail(this.describe(error), code, started, '[Admin.AITools.WhisperX.Package.Failed]');
    }
  }

  async checkConnection(userInitiated = true): Promise<void> {
    if (!this.userId || this.state() === 'checking') return;
    const started = Date.now();
    this.state.set('checking');
    this.message.set('جارٍ التحقق من تشغيل WhisperX والربط المحلي...');
    console.info('[Admin.AITools.WhisperX.Check.Start]', {
      userId: this.userId,
      userInitiated,
    });

    try {
      const status = await this.client.health();
      if (this.destroyed) return;
      if (!status.linked) {
        this.state.set('failed');
        this.message.set(
          'الأداة تعمل، لكن ملف الربط غير مطابق لهذا الحساب. استورد shadowing-link.json من مجلد الأداة.',
        );
        console.warn('[Admin.AITools.WhisperX.Check.Failed]', {
          code: 'not_linked',
          durationMs: Date.now() - started,
        });
        return;
      }

      this.state.set('connected');
      this.message.set('تم التثبيت والربط بنجاح. WhisperX جاهز لمعالجة الدروس على هذا الكمبيوتر.');
      console.info('[Admin.AITools.WhisperX.Check.Success]', {
        linked: true,
        activeJob: !!status.activeJobId,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const code = error instanceof ProcessorError ? error.code : 'check_failed';
      this.fail(this.describe(error), code, started, '[Admin.AITools.WhisperX.Check.Failed]');
    }
  }

  async importLink(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file || !this.userId) return;
    const started = Date.now();
    this.state.set('checking');
    this.message.set('جارٍ التحقق من ملف الربط...');
    console.info('[Admin.AITools.WhisperX.Link.Start]', {
      name: file.name,
      bytes: file.size,
    });

    try {
      await this.client.importLink(file);
      this.hasSavedLink.set(true);
      console.info('[Admin.AITools.WhisperX.Link.Success]', {
        durationMs: Date.now() - started,
      });
      await this.checkConnection(false);
    } catch {
      this.state.set('failed');
      this.message.set('فشل استيراد ملف الربط. استخدم shadowing-link.json الخاص بهذا الموقع والحساب.');
      console.warn('[Admin.AITools.WhisperX.Link.Failed]', {
        durationMs: Date.now() - started,
      });
    } finally {
      input.value = '';
    }
  }

  private fail(
    message: string,
    code: string,
    started: number,
    event = '[Admin.AITools.Failed]',
  ): void {
    if (this.destroyed) return;
    this.state.set('failed');
    this.message.set(message);
    console.warn(event, { code, durationMs: Date.now() - started });
  }

  private describe(error: unknown): string {
    const code = error instanceof ProcessorError ? error.code : 'unknown';
    switch (code) {
      case 'local_connection_unavailable':
        return 'لم يتم العثور على WhisperX يعمل على هذا الكمبيوتر. إذا لم تثبته بعد نزّل الحزمة وشغّل Install.cmd. إذا كان مثبتًا، شغّل Shadowing V2 Local Processor من Start Menu.';
      case 'version_mismatch':
        return 'إصدار الأداة المثبت قديم أو غير متوافق. نزّل الحزمة الحالية وأعد التثبيت.';
      case 'package_unavailable':
        return 'تعذر تجهيز حزمة التثبيت من الموقع. تحقق من ملفات public/downloads ثم أعد المحاولة.';
      case 'invalid_link':
      case 'link_required':
        return 'ملف الربط مفقود أو غير صالح لهذا الحساب.';
      default:
        return 'تعذر إكمال العملية. راجع رسالة الخطأ ثم أعد المحاولة.';
    }
  }

  private clearDownload(): void {
    if (this.installerUrl) URL.revokeObjectURL(this.installerUrl);
    this.installerUrl = '';
    this.downloadUrl.set('');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearDownload();
  }
}
