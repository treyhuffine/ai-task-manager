/**
 * Hooks for the preview pane.
 *
 * The status query refetches every few seconds while the pane is open
 * (status transitions out-of-band when the dev server starts up, the
 * port appears, the process crashes, etc.). The mutations invalidate
 * the status query on success so the UI reacts immediately.
 *
 * Logs are pulled with a cursor: each refetch asks for "everything since
 * seq N" and the hook accumulates the result into a buffer the pane
 * renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  workspacesApi,
  type AppPreviewStatusResponse,
  type AppPreviewStartResponse,
  type AppPreviewLogLine,
} from '@/lib/api/workspaces';

const PREVIEW_KEY = (id: string) => ['workspace', id, 'preview'] as const;
const LOGS_BUFFER_CAP = 1000;

export function usePreviewStatus(
  workspaceId: string | null,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
) {
  return useQuery({
    queryKey: workspaceId ? PREVIEW_KEY(workspaceId) : ['workspace', '_', 'preview'],
    queryFn: () => workspacesApi.appPreview.status(workspaceId!),
    enabled: !!workspaceId && (options.enabled ?? true),
    // Default to 4s while the pane is open. Caller can pass `false`
    // when the pane is hidden, or bump to 1.5s when in `starting`
    // state for snappier UX.
    refetchInterval: options.refetchInterval ?? 4_000,
    refetchOnWindowFocus: true,
  });
}

export function useStartPreview(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation<AppPreviewStartResponse, Error, void>({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('no_workspace');
      return workspacesApi.appPreview.start(workspaceId);
    },
    onSuccess: (data) => {
      if (!workspaceId) return;
      qc.setQueryData(PREVIEW_KEY(workspaceId), data as AppPreviewStatusResponse);
    },
  });
}

export function useStopPreview(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, void>({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('no_workspace');
      return workspacesApi.appPreview.stop(workspaceId);
    },
    onSuccess: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: PREVIEW_KEY(workspaceId) });
    },
  });
}

export function useRefreshPreviewToken(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation<{ preview_token: string }, Error, void>({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('no_workspace');
      return workspacesApi.appPreview.refreshToken(workspaceId);
    },
    onSuccess: (data) => {
      if (!workspaceId) return;
      const prev = qc.getQueryData<AppPreviewStatusResponse>(PREVIEW_KEY(workspaceId));
      if (prev) {
        qc.setQueryData(PREVIEW_KEY(workspaceId), {
          ...prev,
          preview_token: data.preview_token,
        });
      }
    },
  });
}

/**
 * Tail the supervised process logs. Cursor-based — the hook keeps a
 * monotonically growing buffer capped at LOGS_BUFFER_CAP entries, and
 * polls only when the caller passes `enabled: true`.
 */
export function usePreviewLogs(
  workspaceId: string | null,
  options: { enabled?: boolean; pollMs?: number } = {},
) {
  const enabled = options.enabled ?? true;
  const pollMs = options.pollMs ?? 1_500;

  const [lines, setLines] = useState<AppPreviewLogLine[]>([]);
  const cursorRef = useRef(0);
  const wsRef = useRef<string | null>(null);

  // Reset state when the workspace id changes.
  useEffect(() => {
    if (wsRef.current !== workspaceId) {
      wsRef.current = workspaceId;
      cursorRef.current = 0;
      setLines([]);
    }
  }, [workspaceId]);

  // Polling loop — vanilla setInterval so we get pause-on-hidden via the
  // `enabled` flag without the TanStack Query intermediary state.
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await workspacesApi.appPreview.logs(workspaceId, cursorRef.current);
        if (cancelled) return;
        if (res.lines.length > 0) {
          cursorRef.current = res.cursor;
          setLines((prev) => {
            const merged = [...prev, ...res.lines];
            if (merged.length > LOGS_BUFFER_CAP) {
              return merged.slice(merged.length - LOGS_BUFFER_CAP);
            }
            return merged;
          });
        }
      } catch {
        // Transient network failure; next tick will catch up.
      }
    };
    // Fire once immediately, then on interval.
    tick();
    const t = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, workspaceId, pollMs]);

  const clear = useCallback(() => {
    cursorRef.current = 0;
    setLines([]);
  }, []);

  return { lines, clear };
}
