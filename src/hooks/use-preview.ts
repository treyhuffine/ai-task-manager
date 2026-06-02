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
    staleTime: 30_000,
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
