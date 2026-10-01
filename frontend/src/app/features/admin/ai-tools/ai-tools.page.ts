import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  DEFAULT_PROCESSOR_SETTINGS,
  LocalProcessorClient,
  ProcessorError,
} from '../ai-processing/local-processor.client';

type DownloadState = 'ready' | 'downloading' | 'downloaded' | 'failed';
type ProcessorState = 'checking' | 'connected' | 'unlinked' | 'offline' | 'failed';
type HealthOperation = 'connect' | 'verify';
type BusyOperation = 'download' | HealthOperation | null;

const SAFE_ERROR_CODES = new Set([
  'invalid_health_response',
  'invalid_job',
  'invalid_link',
  'link_required',
  'local_connection_unavailable',
  'local_request_failed',
  'package_unavailable',
  'version_mismatch',
]);

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
  private destroyed = false;

  userId = '';
  readonly downloadState = signal<DownloadState>('ready');
  readonly processorState = signal<ProcessorState>('checking');
  readonly busyOperation = signal<BusyOperation>(null);
  readonly downloadMessage = signal('');
  readonly processorMessage = signal('جارٍ التحقق من الخدمة المحلية...');
  readonly hasSavedLink = signal(false);
  readonly verificationCompleted = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const session = await firstValueFrom(this.auth.session());
      if (this.destroyed) return;
      if (!session.authenticated || !session.roles.includes('Admin') || !session.userId) {
        this.processorState.set('failed');
        this.processorMessage.set('هذه الصفحة متاحة لحساب Admin فقط.');
        return;
      }

      this.userId = session.userId;
      this.hasSavedLink.set(!!this.client.initialize(session.userId));

      // A saved browser link is not required to inspect the real service state.
      await this.runHealthCheck('verify');
    } catch {
      if (this.destroyed) return;
      this.processorState.set('failed');
      this.processorMessage.set('تعذر التحقق من حساب الأدمن. أعد تسجيل الدخول.');
    }
  }

  async downloadInstaller(): Promise<void> {
    if (!this.userId || this.busyOperation() !== null) return;

    const started = Date.now();
    this.busyOperation.set('download');
    this.downloadState.set('downloading');
    this.downloadMessage.set('جارٍ تنزيل ملف تثبيت WhisperX...');
    console.info('[Admin.AITools.Download.Start]', {
      operation: 'download_installer',
      status: 'started',
      durationMs: 0,
    });

    try {
      await this.client.downloadInstaller(DEFAULT_PROCESSOR_SETTINGS);
      if (this.destroyed) return;
      this.hasSavedLink.set(true);
      this.downloadState.set('downloaded');
      this.downloadMessage.set('تم تنزيل ملف التثبيت. افتحه مرة واحدة لإكمال التثبيت.');
      console.info('[Admin.AITools.Download.Success]', {
        operation: 'download_installer',
        status: 'downloaded',
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (this.destroyed) return;
      this.downloadState.set('failed');
      this.downloadMessage.set(this.describeDownloadError(error));
      console.warn('[Admin.AITools.Download.Failed]', {
        operation: 'download_installer',
        status: 'failed',
        durationMs: Date.now() - started,
        error: this.safeErrorCode(error),
      });
    } finally {
      if (!this.destroyed) this.busyOperation.set(null);
    }
  }

  async connectToProcessor(): Promise<void> {
    await this.runHealthCheck('connect');
  }

  async verifyProcessor(): Promise<void> {
    await this.runHealthCheck('verify');
  }

  async importLink(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);
    if (!file || !this.userId || this.busyOperation() !== null) return;

    const started = Date.now();
    this.busyOperation.set('connect');
    this.processorState.set('checking');
    this.processorMessage.set('جارٍ استعادة الربط والتحقق من الخدمة المحلية...');
    this.verificationCompleted.set(false);
    console.info('[Admin.AITools.Connect.Start]', {
      operation: 'restore_link',
      status: 'started',
      durationMs: 0,
    });

    try {
      await this.client.importLink(file);
      this.hasSavedLink.set(true);
      const status = await this.client.health();
      this.applyHealthResult('connect', status, started);
    } catch (error) {
      this.applyHealthFailure('connect', error, started);
    } finally {
      input.value = '';
      if (!this.destroyed) this.busyOperation.set(null);
    }
  }

  private async runHealthCheck(operation: HealthOperation): Promise<void> {
    if (!this.userId || this.busyOperation() !== null) return;

    const started = Date.now();
    this.busyOperation.set(operation);
    this.processorState.set('checking');
    this.processorMessage.set(
      operation === 'connect'
        ? 'جارٍ الاتصال بالخدمة المحلية والتحقق من الربط...'
        : 'جارٍ التحقق من حالة الخدمة المحلية والربط...',
    );
    this.verificationCompleted.set(false);
    this.logHealthStart(operation);

    try {
      const status = await this.client.health();
      this.applyHealthResult(operation, status, started);
    } catch (error) {
      this.applyHealthFailure(operation, error, started);
    } finally {
      if (!this.destroyed) this.busyOperation.set(null);
    }
  }

  private applyHealthResult(
    operation: HealthOperation,
    status: { linked: boolean },
    started: number,
  ): void {
    if (this.destroyed) return;
    if (typeof status?.linked !== 'boolean') {
      this.applyHealthFailure(operation, new ProcessorError('invalid_health_response'), started);
      return;
    }

    if (!status.linked) {
      this.processorState.set('unlinked');
      this.processorMessage.set(
        'استجابت الخدمة المحلية، لكنها غير مربوطة بهذا الحساب. نزّل ملف التثبيت من هنا لإعداد الربط تلقائيًا.',
      );
      this.verificationCompleted.set(false);
      console.warn(this.healthEvent(operation, 'Failed'), {
        operation,
        status: 'not_linked',
        durationMs: Date.now() - started,
      });
      return;
    }

    this.processorState.set('connected');
    this.processorMessage.set('تم التحقق من أن الخدمة المحلية تعمل ومربوطة بهذا الحساب.');
    if (operation === 'verify') this.verificationCompleted.set(true);
    console.info(this.healthEvent(operation, 'Success'), {
      operation,
      status: 'connected',
      durationMs: Date.now() - started,
    });
  }

  private applyHealthFailure(operation: HealthOperation, error: unknown, started: number): void {
    if (this.destroyed) return;
    const errorCode = this.safeErrorCode(error);
    const offline = errorCode === 'local_connection_unavailable';
    this.processorState.set(offline ? 'offline' : 'failed');
    this.processorMessage.set(this.describeHealthError(errorCode));
    this.verificationCompleted.set(false);
    console.warn(this.healthEvent(operation, 'Failed'), {
      operation,
      status: offline ? 'unavailable' : 'failed',
      durationMs: Date.now() - started,
      error: errorCode,
    });
  }

  private logHealthStart(operation: HealthOperation): void {
    console.info(this.healthEvent(operation, 'Start'), {
      operation,
      status: 'started',
      durationMs: 0,
    });
  }

  private healthEvent(operation: HealthOperation, result: 'Start' | 'Success' | 'Failed'): string {
    const name = operation === 'connect' ? 'Connect' : 'Verify';
    return '[Admin.AITools.' + name + '.' + result + ']';
  }

  private safeErrorCode(error: unknown): string {
    if (!(error instanceof ProcessorError) || !SAFE_ERROR_CODES.has(error.code)) {
      return 'unknown_error';
    }
    return error.code;
  }

  private describeHealthError(errorCode: string): string {
    switch (errorCode) {
      case 'local_connection_unavailable':
        return 'لم تستجب الخدمة المحلية على هذا الجهاز. أكمل تشغيل ملف التثبيت، ثم أعد الاتصال.';
      case 'version_mismatch':
        return 'إصدار الخدمة المحلية غير متوافق. نزّل ملف التثبيت الحالي وأعد تشغيله.';
      case 'invalid_link':
      case 'link_required':
        return 'تعذر استخدام بيانات الربط المحفوظة. نزّل ملف التثبيت من جديد لإعداد ربط صالح.';
      default:
        return 'تعذر التحقق من الخدمة المحلية. أعد المحاولة بعد التأكد من تشغيلها.';
    }
  }

  private describeDownloadError(error: unknown): string {
    const code = this.safeErrorCode(error);
    if (code === 'package_unavailable') {
      return 'تعذر تنزيل ملف التثبيت من الموقع. أعد المحاولة لاحقًا.';
    }
    return 'تعذر تنزيل ملف التثبيت. تحقق من الاتصال بالموقع ثم أعد المحاولة.';
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }
}
