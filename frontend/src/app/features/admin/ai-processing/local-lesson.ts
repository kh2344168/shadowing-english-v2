import { Injectable } from '@angular/core';
import { readArchive } from './local-archive';

export interface LocalClip {
  text: string;
  start: number;
  end: number;
  audioFile: string;
  bytes: number;
  sha256: string;
}
export interface LocalLesson {
  schemaVersion: 1;
  profile: 'shadowing-v2-1';
  jobId: string;
  title: string;
  description: string;
  duration: number;
  reviewRequired: true;
  segments: LocalClip[];
}
export interface ImportedLesson {
  manifest: LocalLesson;
  files: File[];
}

export function validateManifest(raw: unknown): LocalLesson {
  const value = raw as LocalLesson | null;
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.profile !== 'shadowing-v2-1' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.jobId) ||
    value.reviewRequired !== true ||
    typeof value.title !== 'string' ||
    value.title.trim().length < 2 ||
    value.title.length > 160 ||
    typeof value.description !== 'string' ||
    value.description.length > 1000 ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    value.duration > 600 ||
    !Array.isArray(value.segments) ||
    value.segments.length < 1 ||
    value.segments.length > 20
  ) {
    throw new Error('invalid_manifest');
  }
  let previousStart = -1;
  value.segments.forEach((clip, index) => {
    if (
      !clip ||
      typeof clip.text !== 'string' ||
      !clip.text.trim() ||
      clip.text.length > 1000 ||
      !Number.isFinite(clip.start) ||
      !Number.isFinite(clip.end) ||
      clip.start < 0 ||
      clip.start < previousStart ||
      clip.end <= clip.start ||
      clip.end > value.duration ||
      clip.audioFile !== `segment-${String(index + 1).padStart(2, '0')}.wav` ||
      !Number.isInteger(clip.bytes) ||
      clip.bytes < 46 ||
      clip.bytes > 2_000_000 ||
      !/^[a-f0-9]{64}$/.test(clip.sha256)
    )
      throw new Error('invalid_manifest');
    previousStart = clip.start;
  });
  return value;
}

export async function validateAudio(clip: LocalClip, bytes: Uint8Array): Promise<File> {
  if (bytes.length !== clip.bytes || bytes.length < 46 || (bytes.length - 44) % 2 !== 0)
    throw new Error('invalid_audio');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decode = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  if (
    decode(0, 4) !== 'RIFF' ||
    decode(8, 12) !== 'WAVE' ||
    decode(12, 16) !== 'fmt ' ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== 16000 ||
    view.getUint32(28, true) !== 32000 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    decode(36, 40) !== 'data' ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    Math.abs((bytes.length - 44) / 32000 - (clip.end - clip.start)) > 1 / 16000
  ) {
    throw new Error('invalid_audio');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const checksum = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (checksum !== clip.sha256) throw new Error('audio_checksum_mismatch');
  return new File([bytes.slice().buffer as ArrayBuffer], clip.audioFile, { type: 'audio/wav' });
}

export async function importLesson(file: File): Promise<ImportedLesson> {
  const started = Date.now();
  console.info('[Admin.LocalProcessor.Import.Start]', { bytes: file.size });
  try {
    if (file.size > 45_000_000 || !file.name.toLowerCase().endsWith('.zip'))
      throw new Error('invalid_archive');
    const entries = readArchive(await file.arrayBuffer());
    const manifestBytes = entries.get('manifest.json');
    if (!manifestBytes || manifestBytes.length > 50_000) throw new Error('invalid_manifest');
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
    if (entries.size !== manifest.segments.length + 1) throw new Error('invalid_archive');
    const files: File[] = [];
    for (const clip of manifest.segments) {
      const data = entries.get(clip.audioFile);
      if (!data) throw new Error('invalid_archive');
      files.push(await validateAudio(clip, data));
    }
    console.info('[Admin.LocalProcessor.Import.Success]', {
      jobId: manifest.jobId,
      segments: files.length,
      bytes: file.size,
      durationMs: Date.now() - started,
    });
    return { manifest, files };
  } catch {
    console.warn('[Admin.LocalProcessor.Import.Failed]', { durationMs: Date.now() - started });
    throw new Error('invalid_result_package');
  }
}

@Injectable({ providedIn: 'root' })
export class LocalDraftTransfer {
  private pending: { userId: string; lesson: ImportedLesson } | null = null;
  hasDraft(): boolean {
    return this.pending !== null;
  }
  set(userId: string, lesson: ImportedLesson): void {
    this.pending = { userId, lesson };
  }
  take(userId: string): ImportedLesson | null {
    const value = this.pending;
    this.pending = null;
    return value?.userId === userId ? value.lesson : null;
  }
  clear(): void {
    this.pending = null;
  }
}
