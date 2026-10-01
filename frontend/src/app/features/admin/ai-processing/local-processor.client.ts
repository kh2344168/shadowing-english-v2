import { Injectable } from '@angular/core';
import { archive, downloadFile } from './local-archive';
import { ImportedLesson, LocalLesson, validateAudio, validateManifest } from './local-lesson';

export interface ProcessorSettings {
  profile: 'shadowing-v2-1';
  leadingMs: number;
  trailingMs: number;
}
export const DEFAULT_PROCESSOR_SETTINGS: ProcessorSettings = {
  profile: 'shadowing-v2-1',
  leadingMs: 150,
  trailingMs: 100,
};
export interface ProcessorLink {
  schemaVersion: 1;
  protocolVersion: 1;
  origin: string;
  userId: string;
  token: string;
  settings: ProcessorSettings;
}
export interface ProcessorJob {
  jobId: string;
  state: 'awaiting_upload' | 'running' | 'complete' | 'failed' | 'cancelled';
  phase?: string;
  percent?: number;
  error?: string;
}
export class ProcessorError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function validateJob(raw: unknown): ProcessorJob {
  const job = raw as ProcessorJob | null;
  if (
    !job ||
    !JOB_ID.test(job.jobId) ||
    !['awaiting_upload', 'running', 'complete', 'failed', 'cancelled'].includes(job.state) ||
    (job.percent !== undefined &&
      (!Number.isFinite(job.percent) || job.percent < 0 || job.percent > 100)) ||
    (job.error !== undefined &&
      (typeof job.error !== 'string' || !/^[a-z_]{1,64}$/.test(job.error)))
  ) {
    throw new ProcessorError('invalid_job');
  }
  return job;
}

@Injectable({ providedIn: 'root' })
export class LocalProcessorClient {
  private readonly base = 'http://127.0.0.1:43127';
  private connection: ProcessorLink | null = null;
  private userId = '';
  private key = '';

  initialize(userId: string): ProcessorLink | null {
    this.userId = userId;
    this.key = `shadowing.local-processor.${userId}`;
    this.connection = null;
    try {
      const stored = localStorage.getItem(this.key);
      if (stored) this.connection = this.validateLink(JSON.parse(stored));
    } catch {
      /* A damaged/deleted connection can be restored through explicit import. */
    }
    return this.connection;
  }

  private validateLink(raw: unknown): ProcessorLink {
    const value = raw as ProcessorLink | null;
    if (
      !value ||
      value.schemaVersion !== 1 ||
      value.protocolVersion !== 1 ||
      value.origin !== location.origin ||
      value.userId !== this.userId ||
      !/^[a-f0-9]{64}$/.test(value.token) ||
      value.settings?.profile !== 'shadowing-v2-1' ||
      ![value.settings.leadingMs, value.settings.trailingMs].every(
        (padding) => Number.isInteger(padding) && padding >= 0 && padding <= 1000,
      )
    ) {
      throw new ProcessorError('invalid_link');
    }
    return {
      schemaVersion: 1,
      protocolVersion: 1,
      origin: value.origin,
      userId: value.userId,
      token: value.token,
      settings: { ...value.settings },
    };
  }

  async importLink(file: File): Promise<ProcessorLink> {
    if (file.size > 10_000) throw new ProcessorError('invalid_link');
    const value = this.validateLink(JSON.parse(await file.text()));
    localStorage.setItem(this.key, JSON.stringify(value));
    this.connection = value;
    console.info('[Admin.LocalProcessor.Link.Import.Success]', {
      protocolVersion: 1,
      userId: this.userId,
    });
    return value;
  }

  async downloadInstaller(settings: ProcessorSettings): Promise<Blob> {
    if (!this.userId) throw new ProcessorError('unauthorized');
    const started = Date.now();
    console.info('[Admin.LocalProcessor.Install.Download.Start]', { userId: this.userId });
    try {
      if (!this.connection) {
        const random = crypto.getRandomValues(new Uint8Array(32));
        this.connection = {
          schemaVersion: 1,
          protocolVersion: 1,
          origin: location.origin,
          userId: this.userId,
          token: Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join(''),
          settings,
        };
      }
      this.connection = this.validateLink({ ...this.connection, settings });
      console.info('[Admin.LocalProcessor.Install.Package.Start]', {
        path: '/downloads/local-processor-package.json',
      });
      const response = await fetch('/downloads/local-processor-package.json', {
        credentials: 'omit',
        cache: 'no-cache',
      });
      console.info('[Admin.LocalProcessor.Install.Package.Result]', {
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - started,
      });
      if (!response.ok) throw new ProcessorError('package_unavailable');
      const body = await response.text();
      if (body.length > 256_000) throw new ProcessorError('invalid_package');
      const value = JSON.parse(body) as {
        protocolVersion: number;
        files: { name: string; text: string }[];
      };
      const names = [
        'contracts.py',
        'worker.py',
        'server.py',
        'prepare.py',
        'requirements.txt',
        'Install.cmd',
        'Install.ps1',
        'Start.cmd',
        'Start.ps1',
        'StartHidden.ps1',
        'PrepareLesson.cmd',
        'PrepareLesson.ps1',
        'README_AR.md',
      ];
      if (
        value.protocolVersion !== 1 ||
        !Array.isArray(value.files) ||
        value.files.length !== names.length ||
        !value.files.every(
          (file, index) => file.name === names[index] && typeof file.text === 'string',
        )
      )
        throw new ProcessorError('invalid_package');
      const encoder = new TextEncoder();
      const files = value.files.map((file) => ({
        name: file.name,
        bytes: encoder.encode(file.text),
      }));
      files.push({
        name: 'shadowing-link.json',
        bytes: encoder.encode(JSON.stringify(this.connection)),
      });
      localStorage.setItem(this.key, JSON.stringify(this.connection));
      const packageBlob = archive(files);
      downloadFile(packageBlob, 'Shadowing-V2-Local-Processor.zip');
      console.info('[Admin.LocalProcessor.Install.Download.Success]', {
        files: files.length,
        bytes: packageBlob.size,
        durationMs: Date.now() - started,
      });
      return packageBlob;
    } catch (error) {
      const code = error instanceof ProcessorError ? error.code : 'package_unavailable';
      console.warn('[Admin.LocalProcessor.Install.Download.Failed]', {
        code,
        durationMs: Date.now() - started,
      });
      throw new ProcessorError(code);
    }
  }

  async health(): Promise<{
    linked: boolean;
    activeJobId?: string | null;
    settings?: ProcessorSettings;
  }> {
    const result = await this.json<{
      protocolVersion: number;
      linked: boolean;
      activeJobId?: string | null;
      settings?: ProcessorSettings;
    }>('/v1/health', 'GET', undefined, undefined, 5000);
    if (result.protocolVersion !== 1) throw new ProcessorError('version_mismatch');
    if (
      typeof result.linked !== 'boolean' ||
      (result.activeJobId != null && !JOB_ID.test(result.activeJobId))
    )
      throw new ProcessorError('invalid_job');
    return result;
  }

  savedJob(): string | null {
    const saved = localStorage.getItem(`${this.key}.job`);
    return saved && JOB_ID.test(saved) ? saved : null;
  }
  forgetJob(): void {
    localStorage.removeItem(`${this.key}.job`);
  }

  async start(
    value: {
      requestId: string;
      title: string;
      description: string;
      lines: string[];
      settings: ProcessorSettings;
    },
    media: File,
    signal: AbortSignal,
    received?: (job: ProcessorJob) => void,
  ): Promise<ProcessorJob> {
    if (!this.connection) throw new ProcessorError('link_required');
    const connection = this.validateLink({ ...this.connection, settings: value.settings });
    await this.json('/v1/settings', 'POST', connection.settings, signal);
    localStorage.setItem(this.key, JSON.stringify(connection));
    this.connection = connection;
    const extension = media.name.slice(media.name.lastIndexOf('.')).toLowerCase();
    localStorage.setItem(`${this.key}.job`, this.id(value.requestId));
    const job = validateJob(await this.json('/v1/jobs', 'POST', { ...value, extension }, signal));
    localStorage.setItem(`${this.key}.job`, job.jobId);
    received?.(job);
    if (job.state === 'awaiting_upload') {
      const response = await this.call(
        `/v1/jobs/${job.jobId}/source`,
        'PUT',
        media,
        signal,
        120_000,
      );
      return validateJob(await response.json());
    }
    return job;
  }

  async job(jobId: string, signal?: AbortSignal): Promise<ProcessorJob> {
    return validateJob(await this.json(`/v1/jobs/${this.id(jobId)}`, 'GET', undefined, signal));
  }
  async cancel(jobId: string): Promise<ProcessorJob> {
    return validateJob(await this.json(`/v1/jobs/${this.id(jobId)}/cancel`, 'POST', {}));
  }
  async remove(jobId: string): Promise<void> {
    await this.json(`/v1/jobs/${this.id(jobId)}`, 'DELETE');
    this.forgetJob();
  }
  recut(
    jobId: string,
    segments: { text: string; start: number; end: number }[],
  ): Promise<LocalLesson> {
    return this.json(`/v1/jobs/${this.id(jobId)}/recut`, 'POST', { segments });
  }
  async result(jobId: string, signal?: AbortSignal): Promise<ImportedLesson> {
    const manifest = validateManifest(
      await this.json(`/v1/jobs/${this.id(jobId)}/result`, 'GET', undefined, signal),
    );
    const files: File[] = [];
    for (const clip of manifest.segments) {
      const response = await this.call(
        `/v1/jobs/${this.id(jobId)}/audio/${clip.audioFile}`,
        'GET',
        undefined,
        signal,
      );
      if (Number(response.headers.get('content-length')) > 2_000_000)
        throw new ProcessorError('invalid_audio');
      files.push(await validateAudio(clip, new Uint8Array(await response.arrayBuffer())));
    }
    return { manifest, files };
  }
  async export(jobId: string): Promise<void> {
    const response = await this.call(`/v1/jobs/${this.id(jobId)}/export`, 'GET');
    downloadFile(await response.blob(), 'Shadowing-Lesson-Result.zip');
  }

  private id(value: string): string {
    if (!JOB_ID.test(value)) throw new ProcessorError('invalid_job');
    return value;
  }
  private async json<T>(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
    timeout = 10_000,
  ): Promise<T> {
    const response = await this.call(
      path,
      method,
      body === undefined ? undefined : JSON.stringify(body),
      signal,
      timeout,
    );
    return response.json() as Promise<T>;
  }
  private async call(
    path: string,
    method: string,
    body?: BodyInit,
    signal?: AbortSignal,
    timeout = 10_000,
  ): Promise<Response> {
    const started = Date.now();
    console.info('[Admin.LocalProcessor.Request.Start]', {
      method,
      operation: path.split('/').at(-1),
    });
    const headers: Record<string, string> = {};
    if (this.connection) headers['Authorization'] = `Bearer ${this.connection.token}`;
    if (typeof body === 'string') headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(this.base + path, {
        method,
        headers,
        body,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new ProcessorError(
          typeof result.error === 'string' && /^[a-z_]{1,64}$/.test(result.error)
            ? result.error
            : 'local_request_failed',
        );
      }
      console.info('[Admin.LocalProcessor.Request.Success]', {
        method,
        status: response.status,
        durationMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      console.warn('[Admin.LocalProcessor.Request.Failed]', {
        method,
        code: error instanceof ProcessorError ? error.code : 'local_connection_unavailable',
        durationMs: Date.now() - started,
      });
      if (signal?.aborted) throw new ProcessorError('cancelled');
      throw error instanceof ProcessorError
        ? error
        : new ProcessorError('local_connection_unavailable');
    }
  }
}
