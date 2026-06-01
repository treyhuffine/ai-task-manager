/**
 * Client for the per-execution preview API. Mirrors `PreviewState` from
 * `src/lib/preview/service.ts` (kept in sync by hand — the server shape is
 * the contract).
 */

import { api } from './client';

export type PreviewServerStatus = 'idle' | 'starting' | 'running' | 'crashed' | 'stopped';

export interface PreviewManualUrl {
  service: string | null;
  url: string;
  label: string | null;
}

export interface PreviewRemoteError {
  code: string;
  message: string;
  hint?: string;
}

export interface PreviewState {
  executionId: string;
  service: string | null;
  /** Service names for a multi-service worktree (empty for single-service). */
  availableServices: string[];
  previewName: string;
  assignedPort: number | null;
  serverStatus: PreviewServerStatus;
  port: number | null;
  message: string | null;
  localUrl: string | null;
  pinned: boolean;
  activeRemoteProviderId: string;
  activeRemoteProviderLabel: string;
  remoteUrl: string | null;
  remoteError: PreviewRemoteError | null;
  manualUrls: PreviewManualUrl[];
}

export interface PreviewLogLine {
  seq: number;
  at: string;
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface PreviewLogsResponse {
  cursor: number;
  lines: PreviewLogLine[];
}

export interface PreviewProviderInfo {
  id: string;
  label: string;
  kind: 'dynamic' | 'static';
}

export interface PreviewSettings {
  activeProvider: string;
  manualTemplate: string | null;
  beamdBinPath: string | null;
  beamd: { server: string | null; configured: boolean; insecure: boolean };
  providers: PreviewProviderInfo[];
}

export interface BeamdStatus {
  profile: string;
  agentRunning: boolean;
  server: string;
  slug: string;
  healthy: boolean;
}

function serviceQuery(service?: string | null): Record<string, string> | undefined {
  return service ? { service } : undefined;
}

export const previewApi = {
  status(executionId: string, service?: string | null): Promise<PreviewState> {
    return api.get<PreviewState>(`/executions/${executionId}/preview/status`, {
      query: serviceQuery(service),
    });
  },

  start(executionId: string, opts: { service?: string | null; remote?: boolean } = {}): Promise<PreviewState> {
    return api.post<PreviewState>(`/executions/${executionId}/preview/start`, {
      service: opts.service ?? null,
      remote: opts.remote ?? false,
    });
  },

  stop(executionId: string, service?: string | null): Promise<PreviewState> {
    return api.post<PreviewState>(`/executions/${executionId}/preview/stop`, { service: service ?? null });
  },

  logs(executionId: string, cursor = 0, service?: string | null): Promise<PreviewLogsResponse> {
    return api.get<PreviewLogsResponse>(`/executions/${executionId}/preview/logs`, {
      query: { cursor, ...(service ? { service } : {}) },
    });
  },

  setUrls(executionId: string, urls: PreviewManualUrl[]): Promise<{ urls: PreviewManualUrl[] }> {
    return api.put<{ urls: PreviewManualUrl[] }>(`/executions/${executionId}/preview-urls`, { urls });
  },

  pin(executionId: string, pinned: boolean, service?: string | null): Promise<PreviewState> {
    return api.post<PreviewState>(`/executions/${executionId}/preview/pin`, { pinned, service: service ?? null });
  },

  restoreSet(workspaceId: string): Promise<{ results: Array<{ executionId: string; service: string | null; ok: boolean; error?: string }> }> {
    return api.post(`/workspaces/${workspaceId}/preview/restore-set`);
  },

  settings: {
    get(): Promise<PreviewSettings> {
      return api.get<PreviewSettings>('/preview/settings');
    },
    update(body: {
      activeProvider?: string;
      manualTemplate?: string | null;
      beamdBinPath?: string | null;
      beamdServer?: string | null;
      beamdToken?: string | null;
      beamdInsecure?: boolean;
    }): Promise<PreviewSettings> {
      return api.put<PreviewSettings>('/preview/settings', body);
    },
    test(): Promise<{ ok: true; server: string; slug: string; baseDomain: string }> {
      return api.post<{ ok: true; server: string; slug: string; baseDomain: string }>('/preview/settings/test');
    },
  },
};
