import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import {
  DEFAULT_PROCESSOR_SETTINGS,
  LocalProcessorClient,
  ProcessorError,
} from '../ai-processing/local-processor.client';
import {
  AdminAiProvidersApi,
  AiFallbackAttempt,
  AiProviderCapability,
  AiProviderCatalogItem,
  AiProviderConfig,
} from './ai-providers.api';

type DownloadState = 'ready' | 'downloading' | 'downloaded' | 'failed';
type ProcessorState = 'checking' | 'connected' | 'unlinked' | 'offline' | 'failed';
type HealthOperation = 'connect' | 'verify';
type BusyOperation = 'download' | HealthOperation | null;


interface ProviderCard {
  definition: AiProviderCatalogItem;
  config: AiProviderConfig | null;
}

interface ProviderForm {
  capability: AiProviderCapability;
  providerKey: string;
  showKey: boolean;
  accountId: string;
  projectId: string;
  model: string;
  priority: number;
  enabled: boolean;
}

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
  imports: [RouterLink, FormsModule, DragDropModule, NgTemplateOutlet],
  templateUrl: './ai-tools.page.html',
  styleUrl: './ai-tools.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAIToolsPage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly client = inject(LocalProcessorClient);
  private readonly providersApi = inject(AdminAiProvidersApi);
  private destroyed = false;

  userId = '';
  readonly downloadState = signal<DownloadState>('ready');
  readonly processorState = signal<ProcessorState>('checking');
  readonly busyOperation = signal<BusyOperation>(null);
  readonly downloadMessage = signal('');
  readonly processorMessage = signal('جارٍ التحقق من الخدمة المحلية...');
  readonly hasSavedLink = signal(false);
  readonly verificationCompleted = signal(false);

  readonly processorLastSuccess = signal<string | null>(null);
  readonly processorVersion = signal('غير معروف');

  readonly providerCatalog = signal<AiProviderCatalogItem[]>([]);
  readonly providerConfigs = signal<AiProviderConfig[]>([]);
  readonly providersLoading = signal(true);
  readonly providerError = signal('');
  readonly providerNotice = signal('');
  readonly encryptionReady = signal(false);
  readonly providerBusy = signal<string | null>(null);
  readonly providerDialogOpen = signal(false);
  readonly editingProviderId = signal<string | null>(null);
  readonly replaceConfirmation = signal(false);
  readonly removeConfirmationId = signal<string | null>(null);
  readonly fallbackBusy = signal<AiProviderCapability | null>(null);
  readonly fallbackAttempts = signal<Record<string, AiFallbackAttempt[]>>({});

  providerForm: ProviderForm = this.emptyProviderForm('text');

  async ngOnInit(): Promise<void> {
    try {
      const session = await firstValueFrom(this.auth.session());
      if (this.destroyed) return;
      if (!session.authenticated || !session.roles.includes('Admin') || !session.userId) {
        this.processorState.set('failed');
        this.processorMessage.set('هذه الصفحة متاحة لحساب Admin فقط.');
        this.providersLoading.set(false);
        return;
      }

      this.userId = session.userId;
      this.hasSavedLink.set(!!this.client.initialize(session.userId));

      // A saved browser link is not required to inspect the real service state.
      await Promise.all([this.runHealthCheck('verify'), this.loadProviders()]);
    } catch {
      if (this.destroyed) return;
      this.processorState.set('failed');
      this.processorMessage.set('تعذر التحقق من حساب الأدمن. أعد تسجيل الدخول.');
      this.providersLoading.set(false);
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
    status: { linked: boolean; protocolVersion: number; profile?: string },
    started: number,
  ): void {
    if (this.destroyed) return;
    if (Number.isFinite(status?.protocolVersion)) {
      this.processorVersion.set(status.profile ? `${status.profile} · protocol v${status.protocolVersion}` : `protocol v${status.protocolVersion}`);
    }
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
    this.processorLastSuccess.set(new Date().toISOString());
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



  async loadProviders(showLoading = true): Promise<void> {
    if (!this.userId) return;
    if (showLoading) this.providersLoading.set(true);
    this.providerError.set('');
    const started = Date.now();
    console.info('[Admin.AITools.Providers.Load.Start]', { operation: 'provider_list', durationMs: 0 });
    try {
      const [catalog, state] = await Promise.all([
        firstValueFrom(this.providersApi.catalog()),
        firstValueFrom(this.providersApi.list()),
      ]);
      if (this.destroyed) return;
      this.providerCatalog.set(catalog);
      this.providerConfigs.set(state.items);
      this.encryptionReady.set(state.encryptionReady);
      console.info('[Admin.AITools.Providers.Load.Success]', {
        configured: state.items.length,
        encryptionReady: state.encryptionReady,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (this.destroyed) return;
      this.providerError.set(this.describeProviderError(error));
      console.warn('[Admin.AITools.Providers.Load.Failed]', {
        code: this.providerErrorCode(error),
        durationMs: Date.now() - started,
      });
    } finally {
      if (!this.destroyed && showLoading) this.providersLoading.set(false);
    }
  }

  providerCards(capability: AiProviderCapability): ProviderCard[] {
    const configs = this.providerConfigs().filter((item) => item.capability === capability);
    const definitions = this.providerCatalog().filter((item) => item.capability === capability);
    const byKey = new Map(configs.map((item) => [item.providerKey, item] as const));
    return definitions
      .map((definition) => ({ definition, config: byKey.get(definition.providerKey) ?? null }))
      .sort((a, b) => {
        const aRank = a.config?.enabled && a.config.hasCredential ? 0 : a.config ? 1 : 2;
        const bRank = b.config?.enabled && b.config.hasCredential ? 0 : b.config ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        return (a.config?.priority ?? a.definition.defaultPriority) - (b.config?.priority ?? b.definition.defaultPriority);
      });
  }

  enabledConfigs(capability: AiProviderCapability): AiProviderConfig[] {
    return this.providerConfigs()
      .filter((item) => item.capability === capability && item.enabled && item.hasCredential && item.implemented)
      .sort((a, b) => a.priority - b.priority || a.providerName.localeCompare(b.providerName));
  }

  configuredFor(capability: AiProviderCapability): number {
    return this.providerConfigs().filter((item) => item.capability === capability && item.hasCredential).length;
  }

  enabledFor(capability: AiProviderCapability): number {
    return this.providerConfigs().filter(
      (item) => item.capability === capability && item.hasCredential && item.enabled,
    ).length;
  }

  connectedFor(capability: AiProviderCapability): number {
    return this.providerConfigs().filter(
      (item) => item.capability === capability && item.hasCredential && item.status === 'connected',
    ).length;
  }

  configuredImageProviders(): number {
    return this.configuredFor('image-generation') + this.configuredFor('image-search');
  }

  configuredCards(capability: AiProviderCapability): ProviderCard[] {
    return this.providerCards(capability).filter((card) => !!card.config?.hasCredential);
  }

  availableProviderCards(capability: AiProviderCapability): ProviderCard[] {
    return this.providerCards(capability).filter((card) => !card.config?.hasCredential);
  }

  availableToAddFor(capability: AiProviderCapability): number {
    return this.availableProviderCards(capability).filter((card) => card.definition.implemented).length;
  }

  implementedFor(capability: AiProviderCapability): number {
    return this.providerCatalog().filter((item) => item.capability === capability && item.implemented).length;
  }

  openAddProvider(capability: AiProviderCapability, providerKey?: string): void {
    if (this.providerBusy() !== null || this.fallbackBusy() !== null) return;
    const definitions = this.providerCatalog().filter((item) => item.capability === capability);
    const selected = definitions.find((item) => item.providerKey === providerKey && item.implemented)
      ?? definitions.find((item) => item.implemented);
    this.providerForm = this.emptyProviderForm(capability);
    if (selected) this.applyDefinitionToForm(selected);
    this.editingProviderId.set(null);
    this.replaceConfirmation.set(false);
    this.providerDialogOpen.set(true);
    this.providerError.set('');
  }

  openEditProvider(config: AiProviderConfig): void {
    if (this.providerBusy() !== null || this.fallbackBusy() !== null) return;
    this.providerForm = {
      capability: config.capability,
      providerKey: config.providerKey,
      showKey: false,
      accountId: config.accountId ?? '',
      projectId: config.projectId ?? '',
      model: config.model ?? '',
      priority: config.priority,
      enabled: config.enabled,
    };
    this.editingProviderId.set(config.id);
    this.replaceConfirmation.set(false);
    this.providerDialogOpen.set(true);
    this.providerError.set('');
  }

  closeProviderDialog(): void {
    if (this.providerBusy() === 'save') return;
    this.providerForm.showKey = false;
    this.providerDialogOpen.set(false);
    this.editingProviderId.set(null);
    this.replaceConfirmation.set(false);
  }

  onProviderBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeProviderDialog();
  }

  onCapabilityChanged(): void {
    const selected = this.providerCatalog().find(
      (item) => item.capability === this.providerForm.capability && item.implemented,
    );
    this.providerForm.providerKey = '';
    this.providerForm.model = '';
    this.providerForm.accountId = '';
    this.providerForm.projectId = '';
    if (selected) this.applyDefinitionToForm(selected);
  }

  onProviderChanged(): void {
    const definition = this.currentFormDefinition();
    if (definition) this.applyDefinitionToForm(definition, false);
  }

  currentFormDefinition(): AiProviderCatalogItem | null {
    return this.providerCatalog().find(
      (item) => item.capability === this.providerForm.capability && item.providerKey === this.providerForm.providerKey,
    ) ?? null;
  }

  formDefinitions(): AiProviderCatalogItem[] {
    return this.providerCatalog().filter(
      (item) => item.capability === this.providerForm.capability && item.implemented,
    );
  }

  configById(id: string | null): AiProviderConfig | null {
    if (!id) return null;
    return this.providerConfigs().find((item) => item.id === id) ?? null;
  }

  canSaveProvider(apiKeyValue: string): boolean {
    const definition = this.currentFormDefinition();
    const editing = this.editingProviderId();
    const current = editing ? this.providerConfigs().find((item) => item.id === editing) : null;
    const hasKey = apiKeyValue.trim().length >= 8 || !!current?.hasCredential;
    return !!definition?.implemented && hasKey && this.providerForm.priority >= 1 && this.providerForm.priority <= 100 &&
      (!definition.requiresAccountId || this.providerForm.accountId.trim().length >= 4) &&
      (definition.capability !== 'text' || this.providerForm.model.trim().length >= 2) &&
      this.providerBusy() === null && this.fallbackBusy() === null && this.encryptionReady();
  }

  async saveAndTestProvider(keyInput: HTMLInputElement, confirmReplace = false): Promise<void> {
    if (!this.canSaveProvider(keyInput.value)) return;
    const editingId = this.editingProviderId();
    const current = editingId ? this.providerConfigs().find((item) => item.id === editingId) : null;
    const apiKey = keyInput.value.trim();
    const replacingKey = !!current?.hasCredential && apiKey.length > 0;
    if (replacingKey && !confirmReplace) {
      this.replaceConfirmation.set(true);
      return;
    }

    const started = Date.now();
    this.providerBusy.set('save');
    this.providerError.set('');
    this.providerNotice.set('');
    console.info('[Admin.AITools.Provider.Save.Start]', {
      provider: this.providerForm.providerKey,
      capability: this.providerForm.capability,
      editing: !!editingId,
      durationMs: 0,
    });
    try {
      let saved: AiProviderConfig;
      if (current) {
        saved = await firstValueFrom(this.providersApi.update(current.id, {
          requestId: this.requestId(),
          expectedRevision: current.revision,
          apiKey: apiKey || null,
          accountId: this.clean(this.providerForm.accountId),
          projectId: this.clean(this.providerForm.projectId),
          model: this.clean(this.providerForm.model),
          priority: this.providerForm.priority,
          enabled: this.providerForm.enabled,
          confirmReplaceCredential: confirmReplace,
        }));
      } else {
        saved = await firstValueFrom(this.providersApi.create({
          requestId: this.requestId(),
          capability: this.providerForm.capability,
          providerKey: this.providerForm.providerKey,
          apiKey,
          accountId: this.clean(this.providerForm.accountId),
          projectId: this.clean(this.providerForm.projectId),
          model: this.clean(this.providerForm.model),
          priority: this.providerForm.priority,
          enabled: this.providerForm.enabled,
        }));
      }
      this.upsertProvider(saved);
      // Once the server accepted a new provider, keep subsequent retries on the same row even if
      // the connection-test request itself fails or its response is lost.
      this.editingProviderId.set(saved.id);
      keyInput.value = '';
      this.providerForm.showKey = false;
      const tested = await firstValueFrom(this.providersApi.test(saved.id));
      this.upsertProvider(tested.provider);
      this.providerNotice.set(
        tested.success
          ? saved.enabled ? 'تم حفظ الإعداد واختبار الاتصال بنجاح.' : 'تم حفظ الإعداد واختبار الاتصال بنجاح، والمزود ما زال معطلاً.'
          : `تم حفظ الإعداد، لكن اختبار الاتصال فشل: ${this.failureLabel(tested.failureReason)}.`,
      );
      console.info('[Admin.AITools.Provider.Save.Success]', {
        providerId: saved.id,
        provider: saved.providerKey,
        capability: saved.capability,
        testStatus: tested.status,
        durationMs: Date.now() - started,
      });
      this.providerDialogOpen.set(false);
      this.editingProviderId.set(null);
      this.replaceConfirmation.set(false);
    } catch (error) {
      this.providerError.set(this.describeProviderError(error));
      console.warn('[Admin.AITools.Provider.Save.Failed]', {
        code: this.providerErrorCode(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.providerBusy.set(null);
    }
  }

  async testProvider(config: AiProviderConfig): Promise<void> {
    if (this.providerBusy() !== null || this.fallbackBusy() !== null || !config.hasCredential) return;
    const started = Date.now();
    this.providerBusy.set(`test:${config.id}`);
    this.providerError.set('');
    this.providerNotice.set('');
    console.info('[Admin.AITools.Provider.Test.Start]', { providerId: config.id, provider: config.providerKey, durationMs: 0 });
    try {
      const result = await firstValueFrom(this.providersApi.test(config.id));
      this.upsertProvider(result.provider);
      this.providerNotice.set(result.success ? `${config.providerName}: تم الاتصال بنجاح.` : `${config.providerName}: ${this.failureLabel(result.failureReason)}.`);
      console.info('[Admin.AITools.Provider.Test.Success]', {
        providerId: config.id,
        provider: config.providerKey,
        status: result.status,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.providerError.set(this.describeProviderError(error));
      console.warn('[Admin.AITools.Provider.Test.Failed]', {
        providerId: config.id,
        code: this.providerErrorCode(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.providerBusy.set(null);
    }
  }

  async toggleProvider(config: AiProviderConfig): Promise<void> {
    if (this.providerBusy() !== null || this.fallbackBusy() !== null || (!config.hasCredential && !config.enabled)) return;
    const next = !config.enabled;
    const started = Date.now();
    this.providerBusy.set(`toggle:${config.id}`);
    this.providerError.set('');
    try {
      const updated = await firstValueFrom(this.providersApi.toggle(config.id, config.revision, next, this.requestId()));
      this.upsertProvider(updated);
      this.providerNotice.set(next ? `تم تفعيل ${config.providerName}.` : `تم تعطيل ${config.providerName}.`);
      console.info('[Admin.AITools.Provider.Toggle.Success]', {
        providerId: config.id,
        enabled: next,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.providerError.set(this.describeProviderError(error));
      console.warn('[Admin.AITools.Provider.Toggle.Failed]', {
        providerId: config.id,
        code: this.providerErrorCode(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.providerBusy.set(null);
    }
  }

  requestRemoveCredentials(config: AiProviderConfig): void {
    if (!config.hasCredential || this.providerBusy() !== null || this.fallbackBusy() !== null) return;
    this.removeConfirmationId.set(config.id);
  }

  async removeCredentials(config: AiProviderConfig): Promise<void> {
    if (this.removeConfirmationId() !== config.id || this.providerBusy() !== null) return;
    const started = Date.now();
    this.providerBusy.set(`remove:${config.id}`);
    this.providerError.set('');
    try {
      const updated = await firstValueFrom(
        this.providersApi.removeCredentials(config.id, config.revision, this.requestId()),
      );
      this.upsertProvider(updated);
      this.removeConfirmationId.set(null);
      this.providerNotice.set(`تم حذف بيانات اعتماد ${config.providerName} من الخادم.`);
      console.info('[Admin.AITools.Provider.CredentialRemove.Success]', {
        providerId: config.id,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.providerError.set(this.describeProviderError(error));
      console.warn('[Admin.AITools.Provider.CredentialRemove.Failed]', {
        providerId: config.id,
        code: this.providerErrorCode(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.providerBusy.set(null);
    }
  }

  async dropProvider(event: CdkDragDrop<AiProviderConfig[]>, capability: AiProviderCapability): Promise<void> {
    if (event.previousIndex === event.currentIndex || this.providerBusy() !== null || this.fallbackBusy() !== null) return;
    const rows = [...event.container.data];
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    await this.persistOrder(capability, rows);
  }

  async moveProvider(config: AiProviderConfig, direction: -1 | 1): Promise<void> {
    if (this.providerBusy() !== null || this.fallbackBusy() !== null) return;
    const rows = this.enabledConfigs(config.capability);
    const index = rows.findIndex((item) => item.id === config.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= rows.length) return;
    moveItemInArray(rows, index, target);
    await this.persistOrder(config.capability, rows);
  }

  private async persistOrder(capability: AiProviderCapability, rows: AiProviderConfig[]): Promise<void> {
    const previous = this.providerConfigs();
    const priority = new Map(rows.map((item, index) => [item.id, index + 1]));
    this.providerConfigs.set(previous.map((item) => priority.has(item.id) ? { ...item, priority: priority.get(item.id)! } : item));
    const started = Date.now();
    this.providerBusy.set(`order:${capability}`);
    this.providerError.set('');
    console.info('[Admin.AITools.Provider.Order.Start]', { capability, count: rows.length, durationMs: 0 });
    try {
      await firstValueFrom(this.providersApi.reorder(capability, rows.map((item) => item.id), this.requestId()));
      await this.loadProviders(false);
      this.providerNotice.set('تم حفظ ترتيب fallback.');
      console.info('[Admin.AITools.Provider.Order.Success]', { capability, count: rows.length, durationMs: Date.now() - started });
    } catch (error) {
      this.providerConfigs.set(previous);
      this.providerError.set(this.describeProviderError(error));
      console.warn('[Admin.AITools.Provider.Order.Failed]', {
        capability,
        code: this.providerErrorCode(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.providerBusy.set(null);
    }
  }

  async testFallback(capability: AiProviderCapability): Promise<void> {
    if (this.fallbackBusy() || this.providerBusy() !== null) return;
    const started = Date.now();
    this.fallbackBusy.set(capability);
    this.providerError.set('');
    this.providerNotice.set('');
    this.fallbackAttempts.update((state) => ({ ...state, [capability]: [] }));
    console.info('[Admin.AITools.FallbackTest.Start]', { capability, durationMs: 0 });
    try {
      const result = await firstValueFrom(this.providersApi.testFallback(capability));
      this.fallbackAttempts.update((state) => ({ ...state, [capability]: result.attempts }));
      await this.loadProviders(false);
      this.providerNotice.set(result.success ? 'نجح اختبار fallback وتوقف بعد أول مزود ناجح.' : 'لم ينجح أي مزود مفعّل في اختبار fallback.');
      console.info('[Admin.AITools.FallbackTest.Success]', {
        capability,
        success: result.success,
        attempts: result.attempts.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      this.providerError.set(this.describeProviderError(error));
      console.warn('[Admin.AITools.FallbackTest.Failed]', {
        capability,
        code: this.providerErrorCode(error),
        durationMs: Date.now() - started,
      });
    } finally {
      this.fallbackBusy.set(null);
    }
  }

  attemptsFor(capability: AiProviderCapability): AiFallbackAttempt[] {
    return this.fallbackAttempts()[capability] ?? [];
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'connected': return 'متصل';
      case 'invalid': return 'المفتاح غير صالح';
      case 'disabled': return 'معطّل';
      case 'rate_limited': return 'تم تجاوز الحد المجاني';
      case 'unavailable': return 'المزود غير متاح مؤقتًا';
      case 'model_unavailable': return 'النموذج المحدد غير متاح';
      case 'connection_failed': return 'تعذر الاتصال';
      case 'untested': return 'لم يتم الاختبار';
      default: return 'غير مُعد';
    }
  }

  failureLabel(reason: string | null): string {
    switch (reason) {
      case 'invalid_key': return 'المفتاح غير صالح';
      case 'rate_limit_exceeded': return 'تم تجاوز الحد المجاني أو حد الاستخدام';
      case 'provider_unavailable': return 'المزود غير متاح مؤقتًا';
      case 'model_unavailable': return 'النموذج المحدد غير متاح';
      case 'connection_timeout': return 'انتهت مهلة الاتصال';
      case 'provider_not_configured': return 'لم تتم إضافة بيانات الاعتماد';
      case 'credential_encryption_not_configured': return 'تشفير مفاتيح المزود غير مهيأ على الخادم';
      case 'credential_decryption_failed': return 'تعذر فتح بيانات الاعتماد المحفوظة';
      case 'not_implemented': return 'غير متاح في الكود حاليًا';
      default: return 'تعذر الاتصال';
    }
  }

  capabilityLabel(capability: AiProviderCapability): string {
    switch (capability) {
      case 'text': return 'Text AI';
      case 'image-generation': return 'Image Generation';
      case 'image-search': return 'Image Search';
    }
  }

  providerMark(providerKey: string): string {
    const marks: Record<string, string> = {
      groq: 'Groq', cloudflare: 'CF', gemini: 'G', mistral: 'M', openrouter: 'OR',
      'gemini-image': 'G', 'cloudflare-image': 'CF', 'openrouter-image': 'OR',
      pexels: 'Pexels', pixabay: 'Pixabay', unsplash: 'Unsplash',
    };
    return marks[providerKey] ?? providerKey.slice(0, 2).toUpperCase();
  }

  formatProviderTime(value: string | null): string {
    if (!value) return 'لا يوجد';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'غير معروف' : new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(date);
  }

  private emptyProviderForm(capability: AiProviderCapability): ProviderForm {
    return { capability, providerKey: '', showKey: false, accountId: '', projectId: '', model: '', priority: 1, enabled: true };
  }

  private applyDefinitionToForm(definition: AiProviderCatalogItem, resetPriority = true): void {
    this.providerForm.providerKey = definition.providerKey;
    if (resetPriority) this.providerForm.priority = this.nextPriority(definition.capability, definition.defaultPriority);
    if (definition.models.length) this.providerForm.model = definition.models[0];
    else this.providerForm.model = '';
    if (!definition.requiresAccountId) this.providerForm.accountId = '';
    if (!definition.supportsProjectId) this.providerForm.projectId = '';
  }

  private nextPriority(capability: AiProviderCapability, fallback: number): number {
    const priorities = this.providerConfigs().filter((item) => item.capability === capability).map((item) => item.priority);
    return Math.min(100, priorities.length ? Math.max(...priorities) + 1 : fallback);
  }

  private upsertProvider(provider: AiProviderConfig): void {
    this.providerConfigs.update((items) => [provider, ...items.filter((item) => item.id !== provider.id)]);
  }

  private clean(value: string): string | null {
    const result = value.trim();
    return result ? result : null;
  }

  private requestId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues !== 'function') {
      throw new Error('secure_random_unavailable');
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private providerErrorCode(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'unknown_error';
    const code = typeof error.error?.error === 'string' ? error.error.error : '';
    return /^[a-z_]{1,64}$/.test(code) ? code : `http_${error.status}`;
  }

  private describeProviderError(error: unknown): string {
    switch (this.providerErrorCode(error)) {
      case 'credential_encryption_not_configured': return 'الخادم غير مهيأ لتشفير مفاتيح AI. أضف AI_PROVIDER_MASTER_KEY كسرّ خادم قبل حفظ أي مفتاح.';
      case 'provider_not_implemented': return 'هذا المزود غير متاح في الكود حاليًا.';
      case 'provider_already_configured': return 'المزود مُضاف بالفعل. استخدم تعديل الإعداد.';
      case 'credential_replace_confirmation_required': return 'استبدال المفتاح الحالي يحتاج تأكيدًا صريحًا.';
      case 'provider_changed': return 'تغيّر إعداد المزود من جلسة أخرى. أعد تحميل الحالة ثم حاول مجددًا.';
      case 'provider_order_changed': return 'تغيّر ترتيب المزودين. أعد تحميل القائمة ثم رتبها من جديد.';
      case 'invalid_api_key': return 'صيغة المفتاح غير صالحة.';
      case 'account_id_required': return 'Cloudflare Account ID مطلوب لهذا المزود.';
      case 'model_required': return 'اختر نموذجًا قبل الحفظ.';
      case 'invalid_csrf': return 'تعذر التحقق من جلسة الإدارة. أعد المحاولة.';
      case 'http_401': case 'http_403': return 'انتهت جلسة الإدارة أو لا توجد صلاحية كافية.';
      case 'http_429': return 'طلبات إدارة المزودين كثيرة الآن. انتظر قليلًا ثم أعد المحاولة.';
      default: return 'تعذر تنفيذ إدارة مزود AI. لم يتم عرض أو تسجيل المفتاح.';
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }
}
