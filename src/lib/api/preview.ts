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
  /** Workspace setup-script state. `running` = deps installing (server held
   *  back); `failed` = setup errored (preview may be missing deps). */
  setupStatus: 'running' | 'failed' | null;
  setupError: string | null;
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

/** The browser-approval challenge streamed during a device-code connect. */
export interface DevicePending {
  verificationUri: string;
  verificationUriComplete: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}

/** One NDJSON line from the device-code connect stream. */
export type DeviceConnectEvent =
  | { phase: 'pending'; pending: DevicePending }
  | { phase: 'connected'; server: string; slug: string }
  | { phase: 'unsupported'; code: string; message: string }
  | { phase: 'error'; code: string; message: string };

/** Which beamd binary Flow resolves to + its version — for skew legibility. */
export interface BeamdBinInfo {
  path: string;
  source: 'env' | 'path' | 'bundled-native' | 'bundled-shim' | 'fallback';
  version: string | null;
  outdated: boolean;
  minVersion: string;
}

export interface PreviewSettings {
  activeProvider: string;
  manualTemplate: string | null;
  /** beamd connection state — driven by the machine's `~/.beamd/` account,
   *  not a Flow-stored credential. `error` carries the reason when not
   *  connected (e.g. a version-skew `beamd_cli_outdated`); `bin` reports which
   *  beamd binary Flow is using. */
  beamd: {
    connected: boolean;
    server: string | null;
    error: { code: string; message: string } | null;
    bin: BeamdBinInfo | null;
  };
  providers: PreviewProviderInfo[];
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

  /** Re-run the workspace setup script (deps install) for this execution.
   *  Used by the preview pane's "Re-run setup" recovery when the dev server
   *  can't start because dependencies are missing. Fires in the background;
   *  `setupStatus` flips to 'running' and the gate holds Start until it lands. */
  retrySetupScript(executionId: string): Promise<{ ok: true } | { error: string }> {
    return api.post(`/executions/${executionId}/retry-setup-script`);
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
      /** Connect this machine to beamd (drives `beamd login`). */
      connect?: { server: string; token: string; insecure?: boolean };
      /** Disconnect this machine (drives `beamd logout`). */
      disconnect?: boolean;
    }): Promise<PreviewSettings> {
      return api.put<PreviewSettings>('/preview/settings', body);
    },
    test(): Promise<{ ok: true; server: string; slug: string; baseDomain: string; bin: BeamdBinInfo | null }> {
      return api.post<{ ok: true; server: string; slug: string; baseDomain: string; bin: BeamdBinInfo | null }>(
        '/preview/settings/test',
      );
    },
    /** Device-code (browser-approve) connect. Returns the raw NDJSON stream
     *  ({@link DeviceConnectEvent} per line); auth + 401 handling applied. */
    connectDevice(body: { server?: string; insecure?: boolean }, signal?: AbortSignal): Promise<Response> {
      return api.raw('/preview/settings/connect-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    },
  },
};
