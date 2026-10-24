import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface ShadowingCompletionPayload {
  requestId: string;
  reviewMode: boolean;
  repetitions: number;
  trainingSeconds: number;
  averageSpeechMatchScore: number | null;
  bestSpeechMatchScore: number | null;
  speechRecognitionSupported: boolean;
}

export interface ShadowingCompletionResponse {
  saved: boolean;
  attemptId: string;
  recordedAtUtc: string;
  recordingSaved: boolean;
}

@Injectable({ providedIn: 'root' })
export class ShadowingReportingApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/student/learning';

  saveCompletion(
    slotId: string,
    payload: ShadowingCompletionPayload,
  ): Observable<ShadowingCompletionResponse> {
    const body = new FormData();
    body.set('requestId', payload.requestId);
    body.set('reviewMode', String(payload.reviewMode));
    body.set('repetitions', String(payload.repetitions));
    body.set('trainingSeconds', String(payload.trainingSeconds));
    body.set('speechRecognitionSupported', String(payload.speechRecognitionSupported));
    if (payload.averageSpeechMatchScore !== null) {
      body.set('averageSpeechMatchScore', String(payload.averageSpeechMatchScore));
    }
    if (payload.bestSpeechMatchScore !== null) {
      body.set('bestSpeechMatchScore', String(payload.bestSpeechMatchScore));
    }
    return this.http.post<ShadowingCompletionResponse>(
      `${this.base}/slots/${encodeURIComponent(slotId)}/shadowing/completion`,
      body,
    );
  }
}
