/**
 * Hooks for the preview pane — keyed by execution (each agent execution has
 * its own worktree, and previews are per-worktree).
 *
 * `usePreviewState` short-polls the cheap status snapshot. `useStartPreview`
 * brings the preview up for the current viewer's reachability (local
 * loopback vs the active remote provider). Logs are pulled with a cursor.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  previewApi,
  type PreviewState,
  type PreviewLogLine,
  type PreviewManualUrl,
  type PreviewSettings,
  type DevicePending,
  type DeviceConnectEvent,
} from '@/lib/api/preview';

const PREVIEW_KEY = (id: string) => ['execution', id, 'preview'] as const;
const PREVIEW_SETTINGS_KEY = ['preview', 'settings'] as const;
const LOGS_BUFFER_CAP = 1000;

export function usePreviewState(
  executionId: string | null,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useQuery({
    queryKey: executionId ? PREVIEW_KEY(executionId) : ['execution', '_', 'preview'],
    queryFn: () => previewApi.status(executionId!),
    enabled: !!executionId && (options.enabled ?? true),
    refetchInterval: options.refetchInterval ?? 4_000,
    refetchOnWindowFocus: true,
  });
}

export function useStartPreview(executionId: string | null) {
  const qc = useQueryClient();
  return useMutation<PreviewState, Error, { remote: boolean }>({
    mutationFn: async ({ remote }) => {
      if (!executionId) throw new Error('no_execution');
      return previewApi.start(executionId, { remote });
    },
    onSuccess: (data) => {
      if (!executionId) return;
      qc.setQueryData(PREVIEW_KEY(executionId), data);
    },
  });
}

export function useStopPreview(executionId: string | null) {
  const qc = useQueryClient();
  return useMutation<PreviewState, Error, void>({
    mutationFn: async () => {
      if (!executionId) throw new Error('no_execution');
      return previewApi.stop(executionId);
    },
    onSuccess: (data) => {
      if (!executionId) return;
      qc.setQueryData(PREVIEW_KEY(executionId), data);
    },
  });
}

export function usePinPreview(executionId: string | null) {
  const qc = useQueryClient();
  return useMutation<PreviewState, Error, boolean>({
    mutationFn: async (pinned) => {
      if (!executionId) throw new Error('no_execution');
      return previewApi.pin(executionId, pinned);
    },
    onSuccess: (data) => {
      if (!executionId) return;
      qc.setQueryData(PREVIEW_KEY(executionId), data);
    },
  });
}

/**
 * Re-run the workspace setup script (deps install) for this execution, then
 * invalidate the preview state so the gate updates. Used by the preview pane's
 * "Re-run setup" recovery when the dev server can't start because dependencies
 * are missing. Also nudges the session/rail queries so the SetupCard's
 * "Running setup script…" row reflects the new run.
 */
export function useRetryPreviewSetup(executionId: string | null) {
  const qc = useQueryClient();
  return useMutation<{ ok: true } | { error: string }, Error, void>({
    mutationFn: async () => {
      if (!executionId) throw new Error('no_execution');
      return previewApi.retrySetupScript(executionId);
    },
    onSuccess: () => {
      if (!executionId) return;
      qc.invalidateQueries({ queryKey: PREVIEW_KEY(executionId) });
      qc.invalidateQueries({ queryKey: ['sessions', 'rail'] });
    },
  });
}

export function useSetPreviewUrls(executionId: string | null) {
  const qc = useQueryClient();
  return useMutation<{ urls: PreviewManualUrl[] }, Error, PreviewManualUrl[]>({
    mutationFn: async (urls) => {
      if (!executionId) throw new Error('no_execution');
      return previewApi.setUrls(executionId, urls);
    },
    onSuccess: () => {
      if (!executionId) return;
      qc.invalidateQueries({ queryKey: PREVIEW_KEY(executionId) });
    },
  });
}

/**
 * Tail the supervised dev-server logs. Cursor-based — keeps a monotonically
 * growing buffer capped at LOGS_BUFFER_CAP, polling only while enabled.
 */
export function usePreviewLogs(
  executionId: string | null,
  options: { enabled?: boolean; pollMs?: number } = {},
) {
  const enabled = options.enabled ?? true;
  const pollMs = options.pollMs ?? 1_500;

  const [lines, setLines] = useState<PreviewLogLine[]>([]);
  const cursorRef = useRef(0);
  const idRef = useRef<string | null>(null);

  // Reset the buffer when the execution changes.
  useEffect(() => {
    if (idRef.current !== executionId) {
      idRef.current = executionId;
      cursorRef.current = 0;
      setLines([]);
    }
  }, [executionId]);

  useEffect(() => {
    if (!enabled || !executionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await previewApi.logs(executionId, cursorRef.current);
        if (cancelled) return;
        if (res.lines.length > 0) {
          cursorRef.current = res.cursor;
          setLines((prev) => {
            const merged = [...prev, ...res.lines];
            return merged.length > LOGS_BUFFER_CAP ? merged.slice(merged.length - LOGS_BUFFER_CAP) : merged;
          });
        }
      } catch {
        // Transient — next tick catches up.
      }
    };
    tick();
    const t = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, executionId, pollMs]);

  const clear = useCallback(() => {
    cursorRef.current = 0;
    setLines([]);
  }, []);

  return { lines, clear };
}

// ─── Global preview settings ──────────────────────────────────

export function usePreviewSettings(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: PREVIEW_SETTINGS_KEY,
    queryFn: () => previewApi.settings.get(),
    enabled: options.enabled ?? true,
    // A valid login rarely changes, so cache it for a while to avoid
    // re-spawning `beamd status`. While disconnected, keep it short so a
    // terminal `beamd login` is detected quickly. The surfaces that matter
    // (Beamd sheet, "Phone" popover) also force a refetch on open.
    staleTime: (query) => (query.state.data?.beamd.connected ? 5 * 60_000 : 15_000),
  });
}

export function useUpdatePreviewSettings() {
  const qc = useQueryClient();
  return useMutation<PreviewSettings, Error, Parameters<typeof previewApi.settings.update>[0]>({
    mutationFn: (body) => previewApi.settings.update(body),
    onSuccess: (data) => {
      qc.setQueryData(PREVIEW_SETTINGS_KEY, data);
    },
  });
}

export function useTestBeamd() {
  return useMutation({
    mutationFn: () => previewApi.settings.test(),
  });
}

export interface DeviceConnectState {
  status: 'idle' | 'starting' | 'pending' | 'connected' | 'unsupported' | 'error';
  pending: DevicePending | null;
  error: string | null;
  connectedServer: string | null;
}

const IDLE_DEVICE_STATE: DeviceConnectState = {
  status: 'idle',
  pending: null,
  error: null,
  connectedServer: null,
};

/**
 * Drive a device-code (browser-approve) connect. Opens the NDJSON stream,
 * surfaces the `pending` challenge so the UI can show the code + approval link,
 * and resolves to `connected` | `unsupported` | `error`. `unsupported` is the
 * signal to fall back to the API-key form. `cancel()` aborts the stream (kills
 * the underlying `beamd` process server-side).
 */
export function useConnectDevice() {
  const qc = useQueryClient();
  const [state, setState] = useState<DeviceConnectState>(IDLE_DEVICE_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => (s.status === 'pending' || s.status === 'starting' ? IDLE_DEVICE_STATE : s));
  }, []);

  const reset = useCallback(() => setState(IDLE_DEVICE_STATE), []);

  const start = useCallback(
    async (opts: { server?: string; insecure?: boolean } = {}) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ ...IDLE_DEVICE_STATE, status: 'starting' });
      try {
        const res = await previewApi.settings.connectDevice(opts, ac.signal);
        if (!res.body) throw new Error('No response stream.');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let evt: DeviceConnectEvent;
            try {
              evt = JSON.parse(line) as DeviceConnectEvent;
            } catch {
              continue;
            }
            if (evt.phase === 'pending') {
              setState({ status: 'pending', pending: evt.pending, error: null, connectedServer: null });
            } else if (evt.phase === 'connected') {
              setState({ status: 'connected', pending: null, error: null, connectedServer: evt.server });
              qc.invalidateQueries({ queryKey: PREVIEW_SETTINGS_KEY });
            } else if (evt.phase === 'unsupported') {
              setState({ status: 'unsupported', pending: null, error: evt.message, connectedServer: null });
            } else {
              setState({ status: 'error', pending: null, error: evt.message, connectedServer: null });
            }
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return; // user cancelled — cancel() already reset
        setState({
          status: 'error',
          pending: null,
          error: err instanceof Error ? err.message : String(err),
          connectedServer: null,
        });
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
      }
    },
    [qc],
  );

  return { ...state, start, cancel, reset };
}
