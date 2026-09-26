'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, useUpdateWorkspace } from '@/hooks/use-workspaces';
import {
  usePreviewState,
  useStartPreview,
  useStopPreview,
  usePreviewLogs,
  useSetPreviewUrls,
  useRetryPreviewSetup,
} from '@/hooks/use-preview';
import { apiErrorText } from '@/lib/api/client';
import type { PreviewState, PreviewRemoteError, PreviewManualUrl, PreviewLogLine } from '@/lib/api/preview';
import { resolvePreviewSrc, pickReachability } from '@/lib/preview/resolve-iframe-src';
import { deriveRunStatus, type RunStatus } from './run-status';

export interface PreviewControllerOptions {
  /** Poll the process status. Off when nothing that shows it is on screen. */
  active?: boolean;
  /** Tail the process output. Only worth it while logs are visible. */
  logs?: boolean;
}

export interface PreviewController {
  executionId: string | null;
  /** Local viewer (same machine, loopback) or remote (laptop / phone via a provider). */
  mode: 'local' | 'remote';
  state: PreviewState | null;
  isLoading: boolean;
  /** The agent's start command, or null when none is set. */
  command: string | null;
  hasSetupCommand: boolean;
  runStatus: RunStatus;
  /** The execution runs on another computer (P3.5): its app runs there, and Start does nothing here. */
  elsewhere: PreviewState['elsewhere'];
  /** The setup script errored. Starting is still allowed. */
  setupFailed: boolean;
  setupError: string | null;
  isStarting: boolean;
  isStopping: boolean;
  /** A readable reason the last Start or Stop failed, if it did. */
  actionError: string | null;
  /** What the iframe should load, when anything. */
  url: string | null;
  urlMode: 'local' | 'remote';
  remoteError: PreviewRemoteError | null;
  /** A remote viewer is asking the provider for a URL. */
  isResolvingRemote: boolean;
  providerLabel: string;
  canShare: boolean;
  logLines: ReadonlyArray<PreviewLogLine>;
  /** Bumped to remount the iframe (reload, or a fresh start). */
  reloadKey: number;
  isSavingCommand: boolean;
  isSavingUrls: boolean;
  isRetryingSetup: boolean;
  start: () => void;
  stop: () => void;
  restart: () => void;
  reload: () => void;
  retrySetup: () => void;
  saveCommand: (next: string) => Promise<void>;
  saveUrls: (urls: PreviewManualUrl[]) => Promise<void>;
  /**
   * Ask the remote provider for a URL without starting anything. Safe only
   * when the server is already up, or when the provider doesn't manage the
   * server (manual URL, portless). A no-op otherwise, and in local mode.
   */
  resolveRemote: () => void;
}

/**
 * One owner for an execution's dev-server process and its preview URL,
 * shared by the Run tab (the process), the Preview tab (the interface) and
 * the tools box (status + Start/Stop). Call it once in a parent that stays
 * mounted across tab switches, so a resolved remote URL and fast polling
 * survive moving between Run and Preview.
 *
 * Running is separate from previewing: nothing here starts the server
 * unless a caller asks, and opening or closing Preview never does.
 */
export function usePreviewController(
  executionId: string | null,
  workspaceId: string | null,
  { active = true, logs = true }: PreviewControllerOptions = {},
): PreviewController {
  const { data: ws } = useWorkspace(workspaceId);
  const command = ws?.startCommand?.trim() ? ws.startCommand : null;
  const hasSetupCommand = !!ws?.setupCommand?.trim();

  const updateWorkspace = useUpdateWorkspace();
  const saveCommand = useCallback(
    async (next: string) => {
      if (!workspaceId) return;
      await updateWorkspace.mutateAsync({ id: workspaceId, startCommand: next || null });
    },
    [updateWorkspace, workspaceId],
  );

  // Reachability is fixed for the mount: it depends on where the browser is.
  const mode = useMemo(() => pickReachability(), []);

  // Poll fast for 30s after Start / Retry so the status flips promptly.
  const [fastPolling, setFastPolling] = useState(false);
  const fastPollTimerRef = useRef<number | null>(null);
  const beginFastPolling = useCallback(() => {
    setFastPolling(true);
    if (fastPollTimerRef.current) window.clearTimeout(fastPollTimerRef.current);
    fastPollTimerRef.current = window.setTimeout(() => {
      setFastPolling(false);
      fastPollTimerRef.current = null;
    }, 30_000);
  }, []);
  useEffect(() => () => {
    if (fastPollTimerRef.current) window.clearTimeout(fastPollTimerRef.current);
  }, []);

  const stateQuery = usePreviewState(executionId, {
    enabled: !!executionId && active,
    refetchInterval: !active ? false : fastPolling ? 1_500 : 4_000,
  });
  const state = stateQuery.data ?? null;

  const startMut = useStartPreview(executionId);
  const stopMut = useStopPreview(executionId);
  const setUrlsMut = useSetPreviewUrls(executionId);
  const retrySetupMut = useRetryPreviewSetup(executionId);

  // The remote URL (or an actionable error) comes back only from a start
  // call, never from the cheap status poll, so it is held here.
  const [remoteResolved, setRemoteResolved] = useState<{
    executionId: string;
    url: string | null;
    error: PreviewRemoteError | null;
  } | null>(null);
  const remoteResolvedUrl = remoteResolved?.executionId === executionId ? remoteResolved.url : null;
  const remoteResolvedError = remoteResolved?.executionId === executionId ? remoteResolved.error : null;

  // Keep tailing through 'crashed' too: a fast crash exits before the first
  // poll, and its stderr is the actual error.
  const wantLogs =
    logs &&
    !!executionId &&
    active &&
    (state?.serverStatus === 'starting' || state?.serverStatus === 'running' || state?.serverStatus === 'crashed');
  const { lines: logLines, clear: clearLogs } = usePreviewLogs(executionId, { enabled: wantLogs, pollMs: 1_500 });

  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const resolved = useMemo(() => {
    const stateForResolve: PreviewState | null = state
      ? { ...state, remoteUrl: remoteResolvedUrl, remoteError: remoteResolvedError ?? state.remoteError }
      : null;
    return resolvePreviewSrc(stateForResolve);
  }, [remoteResolvedError, remoteResolvedUrl, state]);
  const remoteError = remoteResolvedError ?? state?.remoteError ?? null;

  const startRemoteAware = useCallback(() => {
    setActionError(null);
    if (mode === 'remote') setRemoteResolved(null);
    startMut.mutate(
      { remote: mode === 'remote' },
      {
        onSuccess: (data) => {
          if (mode === 'remote' && executionId) {
            setRemoteResolved({ executionId, url: data.remoteUrl, error: data.remoteError });
          }
        },
        onError: (err) => setActionError(apiErrorText(err)),
      },
    );
  }, [executionId, mode, startMut]);

  const elsewhere = state?.elsewhere ?? null;
  const start = useCallback(() => {
    // Its app runs on its own computer, never here.
    if (elsewhere) return;
    beginFastPolling();
    // A new spawn restarts the server's log sequence at 0, so the client
    // cursor has to start over too or the new run's first lines are skipped.
    clearLogs();
    setReloadKey((k) => k + 1);
    startRemoteAware();
  }, [beginFastPolling, clearLogs, elsewhere, startRemoteAware]);

  const stop = useCallback(() => {
    setActionError(null);
    setRemoteResolved(null);
    stopMut.mutate(undefined, { onError: (err) => setActionError(apiErrorText(err)) });
  }, [stopMut]);

  const restart = useCallback(() => {
    setActionError(null);
    setRemoteResolved(null);
    stopMut.mutate(undefined, {
      onSuccess: () => start(),
      onError: (err) => setActionError(apiErrorText(err)),
    });
  }, [start, stopMut]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const retrySetup = useCallback(() => {
    beginFastPolling();
    retrySetupMut.mutate();
  }, [beginFastPolling, retrySetupMut]);

  const providerNeedsServer = state?.activeRemoteProviderId !== 'portless' && state?.activeRemoteProviderId !== 'manual';
  const hasManualUrl = !!state?.manualUrls.some((u) => (u.service ?? null) === null && !!u.url?.trim());

  const resolveRemote = useCallback(() => {
    if (mode !== 'remote' || !executionId || startMut.isPending) return;
    const serverUp = state?.serverStatus === 'running';
    if (!serverUp && providerNeedsServer && !hasManualUrl) return;
    startRemoteAware();
  }, [executionId, hasManualUrl, mode, providerNeedsServer, startMut.isPending, startRemoteAware, state?.serverStatus]);

  const saveUrls = useCallback(
    async (urls: PreviewManualUrl[]) => {
      await setUrlsMut.mutateAsync(urls);
      // A manual URL resolves without the server. Anything else waits for Run.
      if (mode === 'remote') {
        const setsManual = urls.some((u) => (u.service ?? null) === null && !!u.url?.trim());
        if (setsManual || state?.serverStatus === 'running') startRemoteAware();
        else setRemoteResolved(null);
      }
    },
    [mode, setUrlsMut, startRemoteAware, state?.serverStatus],
  );

  const runStatus = deriveRunStatus(state, command);
  const isRunning = state?.serverStatus === 'running';

  return {
    executionId,
    mode,
    state,
    isLoading: stateQuery.isLoading && !state,
    command,
    hasSetupCommand,
    runStatus,
    elsewhere,
    setupFailed: state?.setupStatus === 'failed',
    setupError: state?.setupError ?? null,
    isStarting: state?.serverStatus === 'starting' || startMut.isPending,
    isStopping: stopMut.isPending,
    actionError,
    // Elsewhere, only the address pasted for it: nothing runs here to show.
    url: elsewhere ? pastedUrl(state) : resolved.url,
    urlMode: resolved.mode,
    remoteError,
    isResolvingRemote: startMut.isPending && mode === 'remote',
    providerLabel: state?.activeRemoteProviderLabel ?? 'Remote',
    canShare: isRunning && !!executionId,
    logLines,
    reloadKey,
    isSavingCommand: updateWorkspace.isPending,
    isSavingUrls: setUrlsMut.isPending,
    isRetryingSetup: retrySetupMut.isPending,
    start,
    stop,
    restart,
    reload,
    retrySetup,
    saveCommand,
    saveUrls,
    resolveRemote,
  };
}

/** The URL pasted on the execution for its app, if any. */
function pastedUrl(state: PreviewState | null): string | null {
  return state?.manualUrls.find((u) => (u.service ?? null) === null && !!u.url?.trim())?.url.trim() ?? null;
}
