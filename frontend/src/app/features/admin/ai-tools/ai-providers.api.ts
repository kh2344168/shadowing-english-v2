import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type AiProviderCapability = 'text' | 'image-generation' | 'image-search' | 'voice';
export type AiProviderStatus =
  | 'not_configured'
  | 'untested'
  | 'connected'
  | 'invalid'
  | 'disabled'
  | 'rate_limited'
  | 'unavailable'
  | 'model_unavailable'
  | 'terms_required'
  | 'connection_failed';

export interface AiProviderCatalogItem {
  providerKey: string;
  displayName: string;
  capability: AiProviderCapability;
  implemented: boolean;
  requiresAccountId: boolean;
  supportsProjectId: boolean;
  models: string[];
  defaultPriority: number;
  unavailableReason: string | null;
}

export interface AiProviderConfig {
  id: string;
  capability: AiProviderCapability;
  providerKey: string;
  providerName: string;
  implemented: boolean;
  enabled: boolean;
  status: AiProviderStatus;
  priority: number;
  hasCredential: boolean;
  maskedKey: string | null;
  accountId: string | null;
  projectId: string | null;
  model: string | null;
  lastSuccessfulRequestUtc: string | null;
  lastFailedRequestUtc: string | null;
  lastFailureReason: string | null;
  updatedBy: string;
  updatedAtUtc: string;
  revision: string;
}

export interface ConfigureProviderRequest {
  requestId: string;
  capability: AiProviderCapability;
  providerKey: string;
  apiKey: string;
  accountId: string | null;
  projectId: string | null;
  model: string | null;
  priority: number;
  enabled: boolean;
}

export interface UpdateProviderRequest {
  requestId: string;
  expectedRevision: string;
  apiKey: string | null;
  accountId: string | null;
  projectId: string | null;
  model: string | null;
  priority: number;
  enabled: boolean;
  confirmReplaceCredential: boolean;
}

export interface AiProviderTestResult {
  success: boolean;
  status: AiProviderStatus;
  failureReason: string | null;
  provider: AiProviderConfig;
}

export interface AiFallbackAttempt {
  attempt: number;
  providerKey: string;
  providerName: string;
  success: boolean;
  status: AiProviderStatus;
  failureReason: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminAiProvidersApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/ai-providers';

  catalog(): Observable<AiProviderCatalogItem[]> {
    return this.http.get<AiProviderCatalogItem[]>(`${this.base}/catalog`);
  }

  list(): Observable<{ encryptionReady: boolean; items: AiProviderConfig[] }> {
    return this.http.get<{ encryptionReady: boolean; items: AiProviderConfig[] }>(this.base);
  }

  create(request: ConfigureProviderRequest): Observable<AiProviderConfig> {
    return this.http.post<AiProviderConfig>(this.base, request);
  }

  update(id: string, request: UpdateProviderRequest): Observable<AiProviderConfig> {
    return this.http.put<AiProviderConfig>(`${this.base}/${encodeURIComponent(id)}`, request);
  }

  toggle(id: string, revision: string, enabled: boolean, requestId: string): Observable<AiProviderConfig> {
    return this.http.put<AiProviderConfig>(`${this.base}/${encodeURIComponent(id)}/enabled`, {
      requestId,
      expectedRevision: revision,
      enabled,
    });
  }

  test(id: string): Observable<AiProviderTestResult> {
    return this.http.post<AiProviderTestResult>(`${this.base}/${encodeURIComponent(id)}/test`, {});
  }

  removeCredentials(id: string, revision: string, requestId: string): Observable<AiProviderConfig> {
    return this.http.post<AiProviderConfig>(`${this.base}/${encodeURIComponent(id)}/remove-credentials`, {
      requestId,
      expectedRevision: revision,
      confirm: true,
    });
  }

  reorder(capability: AiProviderCapability, orderedIds: string[], requestId: string): Observable<{ result: string }> {
    return this.http.put<{ result: string }>(`${this.base}/order`, {
      requestId,
      capability,
      orderedIds,
    });
  }

  testFallback(capability: AiProviderCapability): Observable<{ success: boolean; attempts: AiFallbackAttempt[] }> {
    return this.http.post<{ success: boolean; attempts: AiFallbackAttempt[] }>(`${this.base}/fallback-test`, {
      capability,
    });
  }
}
