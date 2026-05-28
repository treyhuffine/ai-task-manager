'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace, useUpdateWorkspace } from '@/hooks/use-workspaces';
import {
  usePreviewStatus,
  useStartPreview,
  useStopPreview,
  usePreviewLogs,
} from '@/hooks/use-preview';
import { resolveIframeSrc } from '@/lib/preview/resolve-iframe-src';
import { PreviewHeader } from './preview-header';
import { PreviewLogs } from './preview-logs';
import { PreviewEmpty } from './preview-empty';
import { PreviewPortlessEmpty } from './preview-portless-empty';

interface PreviewPaneProps {
  workspaceId: string | null;
  /** True when the wrapping panel has any visible area. Used to gate
   *  expensive work (iframe reload, log polling) when collapsed. */
  active?: boolean;
  /** Opens the workspace settings sheet so the user can set the command. */
  onOpenWorkspaceSettings?: () => void;
}

/**
 * Top-level preview pane. Renders one of three top-level surfaces:
 *
 *   - **Empty state** when there's no command, the process is idle, or
 *     it crashed/stopped/no-port — drives the user toward the next action.
 *   - **Iframe + logs** when the supervised process is running with a port.
 *   - **Skeleton** when status is loading for the first time.
 *
 * The iframe URL embeds the preview token in the `?_pt=` query on first
 * load; the proxy sets a path-scoped cookie on the first response, so
 * subsequent in-iframe requests authenticate via cookie without needing
 * the token. We re-mount the iframe on Start by changing its `key`, so
 * the cookie is re-issued cleanly when the supervisor rotates the token.
 */
export function PreviewPane({ workspaceId, active = true, onOpenWorkspaceSettings }: PreviewPaneProps) {
  const { data: ws } = useWorkspace(workspaceId);
  const command = ws?.previewCommand ?? null;

  const startMut = useStartPreview(workspaceId);
  const stopMut = useStopPreview(workspaceId);
  const updateWorkspace = useUpdateWorkspace();
  const handleSaveCommand = async (next: string) => {
    if (!workspaceId) return;
    await updateWorkspace.mutateAsync({ id: workspaceId, previewCommand: next || null });
  };

  // Status: faster refresh while starting up so port-detection is snappy.
  const [pollFastUntil, setPollFastUntil] = useState<number>(0);
  const fastWindow = Date.now() < pollFastUntil;
  const statusQuery = usePreviewStatus(workspaceId, {
    enabled: !!workspaceId && active,
    refetchInterval: !active ? false : fastWindow ? 1_500 : 4_000,
  });
  const status = statusQuery.data ?? null;

  // Logs poll only while running / starting, and the panel is active.
  const wantLogs =
    !!workspaceId && active && (status?.status === 'starting' || status?.status === 'running');
  const { lines: logLines } = usePreviewLogs(workspaceId, {
    enabled: wantLogs,
    pollMs: 1_500,
  });

  // Show logs when nothing's running yet but the process is starting up,
  // or when it crashed (so the user can see the error). Otherwise collapsed
  // by default — the iframe takes the spotlight.
  const [logsManuallyToggled, setLogsManuallyToggled] = useState<boolean | null>(null);
  const logsAutoOpen =
    status?.status === 'starting' ||
    status?.status === 'crashed' ||
    status?.status === 'running' && status.port === null;
  const logsOpen = logsManuallyToggled ?? logsAutoOpen;

  // Iframe key — bumped on Start so the iframe re-mounts and picks up
  // the freshly minted preview token.
  const [iframeKey, setIframeKey] = useState(0);
  const lastTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (status?.previewToken && status.previewToken !== lastTokenRef.current) {
      lastTokenRef.current = status.previewToken;
      setIframeKey((k) => k + 1);
    }
  }, [status?.previewToken]);

  const handleStart = () => {
    setPollFastUntil(Date.now() + 30_000);
    setLogsManuallyToggled(null);
    startMut.mutate();
  };
  const handleStop = () => {
    setLogsManuallyToggled(null);
    stopMut.mutate();
  };
  const handleRefresh = () => {
    setIframeKey((k) => k + 1);
  };

  const baseUrl = workspaceId ? `/preview/${workspaceId}/` : '';
  const pathProxyUrl = useMemo(() => {
    if (!workspaceId) return '';
    return status?.previewToken
      ? `${baseUrl}?_pt=${encodeURIComponent(status.previewToken)}`
      : baseUrl;
  }, [workspaceId, status?.previewToken, baseUrl]);

  // Hybrid embedding: when the browser can reach the dev server's
  // native URL directly (loopback `*.localhost`, or a Tailscale URL
  // when the browser is on the tailnet), iframe that. Otherwise fall
  // back to the path proxy. Direct embed gives full app fidelity (no
  // path-prefix breakage, no CORS-to-baked-in-absolute-URL issues)
  // and as a bonus is a different origin so the dev app can't read
  // Flow's localStorage or session cookie. See `resolve-iframe-src.ts`.
  const resolved = useMemo(() => {
    if (!status) return null;
    return resolveIframeSrc({
      workspaceId: workspaceId ?? '',
      status,
      pathProxyUrl,
    });
  }, [status, workspaceId, pathProxyUrl]);

  const isPortless = status?.mode === 'portless';
  const isRunning = status?.status === 'running' && status.port !== null;
  const isStarting = status?.status === 'starting' || startMut.isPending;
  /** Portless owns lifecycle — Flow can't start/stop, no logs strip. */
  const canControl = !isPortless;

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-[12px] text-muted-foreground/60">
        Select an execution to preview.
      </div>
    );
  }

  // First-paint skeleton while status loads.
  if (statusQuery.isLoading && !status) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="h-9 border-b border-border" />
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/60">
          Loading preview…
        </div>
      </div>
    );
  }

  const emptyVariant = resolveEmptyVariant(status?.status, command, status?.port ?? null);

  return (
    <div className="flex h-full flex-col bg-background">
      <PreviewHeader
        url={resolved?.url ?? baseUrl}
        embedMode={resolved?.mode ?? 'proxy'}
        isLive={isRunning}
        isStarting={isStarting}
        isStarted={!!status && status.status !== 'idle' && status.status !== 'stopped' && status.status !== 'crashed'}
        canControl={canControl}
        logsOpen={logsOpen}
        onStart={handleStart}
        onStop={handleStop}
        onRefresh={handleRefresh}
        onToggleLogs={() => setLogsManuallyToggled((v) => !(v ?? logsAutoOpen))}
      />

      <div className="relative flex-1 overflow-hidden">
        {isRunning && resolved ? (
          <iframe
            key={iframeKey}
            src={resolved.url}
            title="Workspace preview"
            // Sandbox notes:
            //   - `allow-same-origin` is required because the dev app
            //     needs its own cookies, fetch, and storage to work
            //     properly. In *proxy* mode the iframe is on Flow's
            //     origin — that's a real trust boundary issue (the dev
            //     app's JS can read Flow's localStorage / session cookie).
            //     We mitigate via cookie path-scoping and outbound
            //     Set-Cookie rewriting, but the complete fix is the
            //     direct-embed mode below — which is a *different*
            //     origin from Flow, so SOP isolates everything for free.
            //     See `docs/workspace-preview-spec.md` "Trust boundary".
            //   - `allow-popups` lets the dev app open new tabs/windows.
            //     We deliberately do NOT include `allow-popups-to-escape-
            //     sandbox` — popups inherit our sandbox flags, so they
            //     can't be used to escape into a fully privileged window.
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin"
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        ) : isPortless ? (
          <PreviewPortlessEmpty
            hostname={status?.hostname ?? '<workspace>'}
            message={status?.message ?? null}
          />
        ) : (
          <PreviewEmpty
            variant={emptyVariant}
            command={command}
            exitCode={status?.exitCode ?? null}
            exitSignal={null}
            onSaveCommand={handleSaveCommand}
            isSavingCommand={updateWorkspace.isPending}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            onStart={handleStart}
            isStarting={startMut.isPending}
          />
        )}
      </div>

      {canControl && logsOpen && (
        <div className="h-32 shrink-0 border-t border-border">
          <PreviewLogs lines={logLines} />
        </div>
      )}
    </div>
  );
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
