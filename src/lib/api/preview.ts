import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import type { RouterOutputs } from '@/lib/trpc/router';
/**
 * Client for the per-execution preview API. Mirrors `PreviewState` from
 * `src/lib/preview/service.ts` (kept in sync by hand — the server shape is
 * the contract).
 */

import { api } from './client';

export type PreviewServerStatus = RouterOutputs['executions']['previewStatusGet']['serverStatus'];

export type PreviewManualUrl = RouterOutputs['executions']['previewStatusGet']['manualUrls'][number];

export type PreviewRemoteError = NonNullable<RouterOutputs['executions']['previewStatusGet']['remoteError']>;

export type PreviewState = RouterOutputs['executions']['previewStatusGet'];

export type PreviewLogLine = RouterOutputs['executions']['previewLogsGet']['lines'][number];

export type PreviewLogsResponse = RouterOutputs['executions']['previewLogsGet'];

export type PreviewProviderInfo = RouterOutputs['preview']['settingsGet']['providers'][number];

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

/** Which beamd binary Ri resolves to + its version — for skew legibility. */
export type BeamdBinInfo = NonNullable<RouterOutputs['preview']['settingsGet']['beamd']['bin']>;

export type PreviewSettings = RouterOutputs['preview']['settingsGet'];

function serviceQuery(service?: string | null): Record<string, string> | undefined {
  return service ? { service } : undefined;
}

export const previewApi = {
  status(executionId: string, service?: string | null) {
    return trpcClient.executions.previewStatusGet.query({params: {id: executionId}, query: rpcQuery(serviceQuery(service))});
  },

  start(executionId: string, opts: { service?: string | null; remote?: boolean } = {}) {
    return trpcClient.executions.previewStartPost.mutate({params: {id: executionId}, body: {
      service: opts.service ?? null,
      remote: opts.remote ?? false,
    }});
  },

  stop(executionId: string, service?: string | null) {
    return trpcClient.executions.previewStopPost.mutate({params: {id: executionId}, body: { service: service ?? null }});
  },

  logs(executionId: string, cursor = 0, service?: string | null) {
    return trpcClient.executions.previewLogsGet.query({params: {id: executionId}, query: rpcQuery({ cursor, ...(service ? { service } : {}) })});
  },

  setUrls(executionId: string, urls: PreviewManualUrl[]) {
    return trpcClient.executions.previewUrlsPut.mutate({params: {id: executionId}, body: { urls }});
  },

  pin(executionId: string, pinned: boolean, service?: string | null) {
    return trpcClient.executions.previewPinPost.mutate({params: {id: executionId}, body: { pinned, service: service ?? null }});
  },

  /** Re-run the workspace setup script (deps install) for this execution.
   *  Used by the preview pane's "Re-run setup" recovery when the dev server
   *  can't start because dependencies are missing. Fires in the background;
   *  `setupStatus` flips to 'running' and the gate holds Start until it lands. */
  retrySetupScript(executionId: string) {
    return trpcClient.executions.retrySetupScriptPost.mutate({params: {id: executionId}});
  },

  restoreSet(workspaceId: string) {
    return trpcClient.workspaces.previewRestoreSetPost.mutate({params: {id: workspaceId}});
  },

  settings: {
    get() {
      return trpcClient.preview.settingsGet.query({});
    },
    update(body: {
      activeProvider?: string;
      manualTemplate?: string | null;
      /** Connect this machine to beamd (drives `beamd login`). */
      connect?: { server: string; token: string; insecure?: boolean };
      /** Disconnect this machine (drives `beamd logout`). */
      disconnect?: boolean;
    }) {
      return trpcClient.preview.settingsPut.mutate({body: body});
    },
    test() {
      return trpcClient.preview.settingsTestPost.mutate({});
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
