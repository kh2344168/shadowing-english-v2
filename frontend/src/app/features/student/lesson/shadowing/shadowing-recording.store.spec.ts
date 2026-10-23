import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShadowingRecordingStore, StoredShadowingRecording } from './shadowing-recording.store';

describe('ShadowingRecordingStore account isolation', () => {
  it('shows only recordings owned by the signed-in student and hides ownerless legacy rows', async () => {
    const store = TestBed.inject(ShadowingRecordingStore);
    const base = {
      slotId: 'shared-slot', reviewMode: false, repetition: 1, durationLabel: '00:02',
      createdAt: '2026-10-23T00:00:00Z', mimeType: 'audio/webm', blob: new Blob(['voice']),
    };
    const rows = [
      { ...base, id: 'a', studentId: 'student-a' },
      { ...base, id: 'b', studentId: 'student-b' },
      { ...base, id: 'legacy' },
    ];
    const database = {
      transaction: () => ({
        objectStore: () => ({
          getAll: () => {
            const request = { result: rows, onsuccess: null as (() => void) | null, onerror: null };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
        }),
      }),
    };
    vi.spyOn(store as unknown as { open(): Promise<IDBDatabase> }, 'open')
      .mockResolvedValue(database as unknown as IDBDatabase);

    expect((await store.list('student-a', 'shared-slot', false)).map((row) => row.id)).toEqual(['a']);
    expect((await store.list('student-b', 'shared-slot', false)).map((row) => row.id)).toEqual(['b']);
    expect(await store.list('', 'shared-slot', false)).toEqual([]);
  });

  it('refuses to save a recording without an owner', async () => {
    const store = TestBed.inject(ShadowingRecordingStore);
    const recording = {
      id: 'new', studentId: '', slotId: 'shared-slot', reviewMode: false,
      repetition: 1, durationLabel: '00:02', createdAt: '2026-10-23T00:00:00Z',
      mimeType: 'audio/webm', blob: new Blob(['voice']),
    } satisfies StoredShadowingRecording;
    await expect(store.save(recording)).rejects.toThrow('recording_owner_missing');
  });
});
