import { Injectable } from '@angular/core';

export interface StoredShadowingRecording {
  id: string;
  studentId: string;
  slotId: string;
  reviewMode: boolean;
  repetition: number;
  durationLabel: string;
  createdAt: string;
  mimeType: string;
  blob: Blob;
}

@Injectable({ providedIn: 'root' })
export class ShadowingRecordingStore {
  private readonly databaseName = 'shadowing-v2-local';
  private readonly storeName = 'shadowing-recordings';
  private readonly maxPerStage = 6;

  async list(studentId: string, slotId: string, reviewMode: boolean): Promise<StoredShadowingRecording[]> {
    if (!studentId) return [];
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).getAll();
      request.onerror = () => reject(request.error ?? new Error('indexeddb_read_failed'));
      request.onsuccess = () => {
        const rows = (request.result as StoredShadowingRecording[])
          .filter((item) => item.studentId === studentId && item.slotId === slotId && item.reviewMode === reviewMode)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        resolve(rows);
      };
    });
  }

  async save(recording: StoredShadowingRecording): Promise<void> {
    if (!recording.studentId) throw new Error('recording_owner_missing');
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const request = transaction.objectStore(this.storeName).put(recording);
      request.onerror = () => reject(request.error ?? new Error('indexeddb_write_failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb_transaction_failed'));
    });
    await this.trim(recording.studentId, recording.slotId, recording.reviewMode);
  }

  async delete(id: string, studentId: string): Promise<void> {
    if (!studentId) throw new Error('recording_owner_missing');
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const lookup = store.get(id);
      lookup.onsuccess = () => {
        if ((lookup.result as StoredShadowingRecording | undefined)?.studentId === studentId)
          store.delete(id);
      };
      lookup.onerror = () => reject(lookup.error ?? new Error('indexeddb_read_failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb_delete_failed'));
    });
  }

  private async trim(studentId: string, slotId: string, reviewMode: boolean): Promise<void> {
    const rows = await this.list(studentId, slotId, reviewMode);
    const excess = rows.slice(this.maxPerStage);
    for (const row of excess) await this.delete(row.id, studentId);
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexeddb_unavailable'));
        return;
      }
      const request = indexedDB.open(this.databaseName, 1);
      request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }
}
