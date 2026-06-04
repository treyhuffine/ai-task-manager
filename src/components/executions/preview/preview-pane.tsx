'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Globe, Loader2, Smartphone, X } from 'lucide-react';
import { openBeamdSheet } from '@/components/dashboard/beamd-sheet';
import { OpenOnDevice } from './open-on-device';
import { useWorkspace, useUpdateWorkspace } from '@/hooks/use-workspaces';
import {
  usePreviewState,
  useStartPreview,
  useStopPreview,
  usePreviewLogs,
  useSetPreviewUrls,
  usePreviewSettings,
} from '@/hooks/use-preview';
import { RemotePreviewPromo } from './remote-preview-promo';
import type { PreviewState, PreviewRemoteError, PreviewManualUrl } from '@/lib/api/preview';
import { resolvePreviewSrc, pickReachability } from '@/lib/preview/resolve-iframe-src';
import { PreviewHeader } from './preview-header';
import { PreviewLogs } from './preview-logs';
import { PreviewEmpty } from './preview-empty';
import { PreviewManualUrl as PreviewManualUrlInput } from './preview-manual-url';

interface PreviewPaneProps {
  /** The execution whose worktree we're previewing. */
  executionId: string | null;
  /** The owning workspace (for the default preview command). */
  workspaceId: string | null;
  /** True when the wrapping panel is visible — gates polling / iframe work. */
  active?: boolean;
  /** Opens the workspace settings sheet so the user can set the command. */
  onOpenWorkspaceSettings?: () => void;
}

/**
 * Per-execution preview pane. Two reachability modes (§5):
 *   - **local** (viewer on the same machine as Flow): embed the dev server's
 *     loopback URL directly.
 *   - **remote** (laptop / phone): embed the active remote provider's URL
 *     (beamd / portless / manual), brought up on Start.
 *
 * Both modes embed a real, different-origin URL — no path-proxy, no base-tag
 * rewriting, no Flow-origin trust-boundary leak.
 */
export function PreviewPane({ executionId, workspaceId, active = true, onOpenWorkspaceSettings }: PreviewPaneProps) {
  const { data: ws } = useWorkspace(workspaceId);
  const command = ws?.startCommand ?? null;

  const updateWorkspace = useUpdateWorkspace();
  const handleSaveCommand = async (next: string) => {
    if (!workspaceId) return;
    await updateWorkspace.mutateAsync({ id: workspaceId, startCommand: next || null });
  };

  // The viewer's reachability is fixed for this mount (depends on where the
  // browser is, not on render state).
  const mode = useMemo(() => pickReachability(), []);

  const [pollFastUntil, setPollFastUntil] = useState(0);
  const fastWindow = Date.now() < pollFastUntil;
  const stateQuery = usePreviewState(executionId, {
    enabled: !!executionId && active,
    refetchInterval: !active ? false : fastWindow ? 1_500 : 4_000,
  });
  const state = stateQuery.data ?? null;

  const startMut = useStartPreview(executionId);
  const stopMut = useStopPreview(executionId);
  const setUrlsMut = useSetPreviewUrls(executionId);

  // Remote resolution (URL or actionable error) is held here, not in the
  // polled status — the cheap status endpoint never brings a tunnel up.
  const [remoteResolved, setRemoteResolved] = useState<{ url: string | null; error: PreviewRemoteError | null } | null>(null);

  // Reset remote resolution when switching executions.
  useEffect(() => { setRemoteResolved(null); }, [executionId]);

  // Keep fetching through 'crashed' too: a fast crash exits before the first
  // poll, so without this the captured stderr (the actual error) never reaches
  // the client and the panel sits on "Waiting for output…".
  const wantLogs =
    !!executionId &&
    active &&
    (state?.serverStatus === 'starting' || state?.serverStatus === 'running' || state?.serverStatus === 'crashed');
  const { lines: logLines } = usePreviewLogs(executionId, {
    enabled: wantLogs,
    pollMs: 1_500,
  });

  const [logsManuallyToggled, setLogsManuallyToggled] = useState<boolean | null>(null);
  const logsAutoOpen =
    state?.serverStatus === 'starting' ||
    state?.serverStatus === 'crashed' ||
    (state?.serverStatus === 'running' && state.port === null);
  const logsOpen = logsManuallyToggled ?? logsAutoOpen;

  const [iframeKey, setIframeKey] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);

  // Compose the state the picker sees: local URL comes from the poll, remote
  // URL/error from the last Start (held above).
  const stateForResolve: PreviewState | null = state
    ? {
        ...state,
        remoteUrl: remoteResolved?.url ?? null,
        remoteError: remoteResolved?.error ?? state.remoteError,
      }
    : null;
  const resolved = useMemo(() => resolvePreviewSrc(stateForResolve), [stateForResolve]);
  const remoteError = remoteResolved?.error ?? state?.remoteError ?? null;

  const handleStart = () => {
    setPollFastUntil(Date.now() + 30_000);
    setLogsManuallyToggled(null);
    setIframeKey((k) => k + 1);
    startMut.mutate(
      { remote: mode === 'remote' },
      {
        onSuccess: (data) => {
          if (mode === 'remote') setRemoteResolved({ url: data.remoteUrl, error: data.remoteError });
        },
      },
    );
  };
  const handleStop = () => {
    setLogsManuallyToggled(null);
    setRemoteResolved(null);
    stopMut.mutate();
  };
  const handleRefresh = () => setIframeKey((k) => k + 1);
  const handleSaveUrls = async (urls: PreviewManualUrl[]) => {
    await setUrlsMut.mutateAsync(urls);
    // Re-resolve remote with the freshly-saved URL if we're in remote mode.
    if (mode === 'remote') handleStart();
  };

  // Lazy start on first view (§11): when the preview tab becomes visible and
  // the server is down, cold-start it (server + tunnel for remote). Fires
  // once per execution view — the ref guard means a manual Stop won't
  // immediately bounce back, while reopening a (cold/idle-evicted) preview
  // spins it up. Pairs with the idle-evict sweep.
  const autoStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !executionId || !state) return;
    if (autoStartedRef.current === executionId) return;
    const startable = state.serverStatus === 'idle' || state.serverStatus === 'stopped';
    if (startable && !!command && !startMut.isPending) {
      autoStartedRef.current = executionId;
      handleStart();
    } else if (!startable) {
      // Already running/starting/crashed — mark engaged so we don't auto-start later.
      autoStartedRef.current = executionId;
    }
    // handleStart is a stable-enough closure; the ref guard prevents re-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, executionId, state?.serverStatus, command]);

  const isRunning = state?.serverStatus === 'running';
  // Sharing is meaningful once the dev server is actually serving content —
  // that's when a tunnel will have something to forward.
  const canShare = isRunning && !!executionId;
  const isStarting = state?.serverStatus === 'starting' || startMut.isPending;
  const isStarted =
    !!state && state.serverStatus !== 'idle' && state.serverStatus !== 'stopped' && state.serverStatus !== 'crashed';
  const providerLabel = state?.activeRemoteProviderLabel ?? 'Remote';

  if (!executionId) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-[12px] text-muted-foreground/60">
        Select an execution to preview.
      </div>
    );
  }

  if (stateQuery.isLoading && !state) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="h-9 border-b border-border" />
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/60">
          Loading preview…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <PreviewHeader
        url={resolved.url}
        mode={resolved.mode}
        providerLabel={providerLabel}
        isLive={!!resolved.url}
        isStarting={isStarting}
        isStarted={isStarted}
        logsOpen={logsOpen}
        shareControl={
          canShare ? (
            <OpenOnDevice executionId={executionId} open={shareOpen} onOpenChange={setShareOpen} />
          ) : undefined
        }
        onStart={handleStart}
        onStop={handleStop}
        onRefresh={handleRefresh}
        onToggleLogs={() => setLogsManuallyToggled((v) => !(v ?? logsAutoOpen))}
      />

      {canShare && <OpenOnDeviceNudge onShow={() => setShareOpen(true)} />}

      <div className="relative flex-1 overflow-hidden">
        {resolved.url ? (
          <iframe
            key={iframeKey}
            src={resolved.url}
            title="Workspace preview"
            // Both modes load a different-origin URL (the dev server / the
            // tunnel), so SOP isolates Flow's origin for free. allow-same-
            // origin refers to the iframe's OWN origin (the dev app), which it
            // needs for cookies/storage/fetch.
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin"
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        ) : (
          <PreviewBody
            mode={mode}
            state={state}
            command={command}
            remoteError={remoteError}
            isStartingRemote={startMut.isPending && mode === 'remote'}
            onSaveCommand={handleSaveCommand}
            isSavingCommand={updateWorkspace.isPending}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            onStart={handleStart}
            isStarting={startMut.isPending}
            onSaveUrls={handleSaveUrls}
            isSavingUrls={setUrlsMut.isPending}
          />
        )}
      </div>

      {logsOpen && (
        <div className="h-32 shrink-0 border-t border-border">
          <PreviewLogs lines={logLines} />
        </div>
      )}
    </div>
  );
}

interface PreviewBodyProps {
  mode: 'local' | 'remote';
  state: PreviewState | null;
  command: string | null;
  remoteError: PreviewRemoteError | null;
  isStartingRemote: boolean;
  onSaveCommand: (next: string) => Promise<void> | void;
  isSavingCommand: boolean;
  onOpenWorkspaceSettings?: () => void;
  onStart: () => void;
  isStarting: boolean;
  onSaveUrls: (urls: PreviewManualUrl[]) => Promise<void> | void;
  isSavingUrls: boolean;
}

/** What to show when there's no iframe yet — status, errors, and the BYO-URL input. */
function PreviewBody(props: PreviewBodyProps) {
  const { mode, state, command, remoteError } = props;
  const serverStatus = state?.serverStatus;
  const needsServer = providerNeedsServer(state);

  // Remote preview is "set up" once beamd is the connected, active provider —
  // until then we surface it as an option in the empty states (prominently
  // when nothing's configured yet, subtly otherwise). Once set up, the header
  // "Phone" button is the always-present, subtle entry point.
  const { data: previewSettings } = usePreviewSettings();
  const remoteSetUp = !!previewSettings && previewSettings.beamd.connected && previewSettings.activeProvider === 'beamd';

  // A remote-provider error (beamd not configured, no manual URL, …) that
  // isn't just "the server isn't up yet" gets its own actionable surface.
  const showRemoteError =
    mode === 'remote' &&
    remoteError &&
    (!needsServer || serverStatus === 'running' || serverStatus === 'idle' || serverStatus === 'stopped');

  if (props.isStartingRemote && !showRemoteError) {
    return (
      <Centered>
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
        <span className="text-[13px] text-muted-foreground">Bringing up the preview…</span>
      </Centered>
    );
  }

  if (showRemoteError) {
    return (
      <Centered>
        <div className="flex w-full max-w-md flex-col items-start gap-4">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            <AlertCircle size={15} className="text-amber-500" />
            {remoteError!.message}
          </h3>
          {remoteError!.hint && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">{remoteError!.hint}</p>
          )}
          {remoteError!.code === 'beamd_not_configured' || remoteError!.code === 'no_remote_provider' ? (
            <button
              type="button"
              onClick={openBeamdSheet}
              className="flex items-center gap-2 rounded-md border border-border bg-foreground px-3 py-1.5 text-[13px] font-medium text-background hover:bg-foreground/90"
            >
              <Globe size={13} />
              Set up remote preview
            </button>
          ) : null}
          <PreviewManualUrlInput urls={state?.manualUrls ?? []} onSave={props.onSaveUrls} isSaving={props.isSavingUrls} />
        </div>
      </Centered>
    );
  }

  // Otherwise drive off the supervised server's status (both modes need the
  // server when the active provider manages it). Offer the BYO-URL input in
  // remote mode or when the manual provider is active.
  const variant = resolveEmptyVariant(serverStatus, command, state?.port ?? null);
  const showManual = mode === 'remote' || state?.activeRemoteProviderId === 'manual';
  // Offer remote preview as an option every time there's no live preview on
  // screen (this body only renders when there's no iframe) — big in the
  // "nothing set up yet" state, subtle in every other (idle, stopped, crashed,
  // starting…). Hidden only once remote is actually set up, where the header
  // "Phone" button takes over.
  const showPromo = !remoteSetUp;

  const footerNodes: React.ReactNode[] = [];
  if (showPromo) footerNodes.push(<RemotePreviewPromo key="promo" prominent={variant === 'no-command'} />);
  if (showManual)
    footerNodes.push(
      <PreviewManualUrlInput
        key="manual"
        urls={state?.manualUrls ?? []}
        onSave={props.onSaveUrls}
        isSaving={props.isSavingUrls}
      />,
    );

  return (
    <PreviewEmpty
      variant={variant}
      command={command}
      exitCode={null}
      onSaveCommand={props.onSaveCommand}
      isSavingCommand={props.isSavingCommand}
      onOpenWorkspaceSettings={props.onOpenWorkspaceSettings}
      onStart={props.onStart}
      isStarting={props.isStarting}
      footer={footerNodes.length ? <div className="w-full space-y-4">{footerNodes}</div> : undefined}
    />
  );
}

const NUDGE_DISMISSED_KEY = 'flow.preview.openOnDevice.nudged';

/**
 * One-time discovery hint for "Open on another device". Icons alone don't
 * teach the feature, so the first time a preview goes live we surface a thin,
 * dismissible strip pointing at it. Dismissal is permanent (localStorage).
 */
function OpenOnDeviceNudge({ onShow }: { onShow: () => void }) {
  // Start hidden to avoid a flash before localStorage is read.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(NUDGE_DISMISSED_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const close = () => {
    try {
      localStorage.setItem(NUDGE_DISMISSED_KEY, '1');
    } catch {
      /* private mode — best-effort */
    }
    setDismissed(true);
  };

  if (dismissed) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-1.5 text-[11px]">
      <Smartphone size={12} className="shrink-0 text-primary" />
      <span className="flex-1 text-muted-foreground">See this on your real phone — one scan, no deploy.</span>
      <button
        type="button"
        onClick={() => {
          onShow();
          close();
        }}
        className="rounded border border-border bg-background px-2 py-0.5 font-medium text-foreground hover:bg-muted"
      >
        Show me
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-6 py-10">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

function providerNeedsServer(state: PreviewState | null): boolean {
  // localhost + beamd manage the server; portless + manual don't.
  const id = state?.activeRemoteProviderId;
  return id !== 'portless' && id !== 'manual';
}

function resolveEmptyVariant(
  status: string | undefined,
  command: string | null,
  port: number | null,
): React.ComponentProps<typeof PreviewEmpty>['variant'] {
  if (!command || !command.trim()) return 'no-command';
  if (status === 'starting') return 'starting';
  if (status === 'running' && port === null) return 'running-no-port';
  if (status === 'crashed') return 'crashed';
  if (status === 'stopped') return 'stopped';
  return 'idle';
}
