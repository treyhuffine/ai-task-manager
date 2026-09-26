'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Globe, Loader2, Play, Smartphone, X } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';
import { usePreviewSettings } from '@/hooks/use-preview';
import type { PreviewManualUrl } from '@/lib/api/preview';
import { cn } from '@/lib/utils';
import { OpenOnDevice } from './open-on-device';
import { RemotePreviewPromo } from './remote-preview-promo';
import { PreviewHeader } from './preview-header';
import { PreviewLogs } from './preview-logs';
import { PreviewEmpty } from './preview-empty';
import { PreviewManualUrl as PreviewManualUrlInput } from './preview-manual-url';
import { SetupRecovery } from './setup-recovery';
import { RunsElsewhere } from './run-view';
import type { PreviewController } from './use-preview-controller';

interface PreviewViewProps {
  controller: PreviewController;
  /**
   * Legacy all-in-one pane (the Agents view): Start / Stop and a logs strip
   * live in this header. The workbench's Preview tab leaves them out, since
   * the Run tab owns the process.
   */
  processControls?: boolean;
  /** Workbench only: jump to the Run tab (output, setup, the start command). */
  onOpenRun?: () => void;
  /** Opens the agent's settings, e.g. to set a port override. */
  onOpenWorkspaceSettings?: () => void;
}

/**
 * The app's interface: the iframe, its URL, reload, open in a new tab, open
 * on another device, and remote reachability (Beamd, portless, a manual URL).
 *
 * Two reachability modes:
 *   - **local** (viewer on the same machine as Ri): embed the dev server's
 *     loopback URL directly.
 *   - **remote** (laptop / phone): embed the active remote provider's URL.
 *
 * Both embed a real, different-origin URL, so Ri's origin stays isolated.
 *
 * In the workbench this never starts the server on its own. When the app
 * isn't running it says so and offers an explicit start. A remote viewer
 * whose server is already up asks the provider for a URL on open, which is
 * safe because nothing new gets started.
 */
export function PreviewView({ controller: c, processControls = false, onOpenRun, onOpenWorkspaceSettings }: PreviewViewProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [logsToggled, setLogsToggled] = useState<boolean | null>(null);

  const serverStatus = c.state?.serverStatus;
  const logsAutoOpen =
    serverStatus === 'starting' || serverStatus === 'crashed' || (serverStatus === 'running' && c.state?.port === null);
  const logsOpen = processControls && (logsToggled ?? logsAutoOpen);

  // A remote viewer's URL only comes back from a start call. When the server
  // is already up (started here or elsewhere), fetch it on open instead of
  // making the user press Start for something that's already running.
  const { resolveRemote } = c;
  const needsRemoteUrl = !processControls && c.mode === 'remote' && !c.url && !c.remoteError && !c.isResolvingRemote;
  useEffect(() => {
    if (needsRemoteUrl && serverStatus === 'running') resolveRemote();
  }, [needsRemoteUrl, resolveRemote, serverStatus]);

  if (!c.executionId) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-[12px] text-muted-foreground/60">
        Select an execution to preview.
      </div>
    );
  }

  if (c.isLoading) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="h-9 border-b border-border" />
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/60">
          Loading preview…
        </div>
      </div>
    );
  }

  const isStarted = !!c.state && serverStatus !== 'idle' && serverStatus !== 'stopped' && serverStatus !== 'crashed';
  const setupRunning = c.state?.setupStatus === 'running';

  return (
    <div className="flex h-full flex-col bg-background">
      <PreviewHeader
        url={c.url}
        mode={c.urlMode}
        providerLabel={c.providerLabel}
        isLive={!!c.url}
        isStarting={c.isStarting}
        isStarted={isStarted}
        disableStart={setupRunning}
        disableStartReason={setupRunning ? 'Installing dependencies…' : undefined}
        logsOpen={logsOpen}
        shareControl={
          c.canShare && c.executionId ? (
            <OpenOnDevice executionId={c.executionId} open={shareOpen} onOpenChange={setShareOpen} />
          ) : undefined
        }
        onStart={processControls ? c.start : undefined}
        onStop={processControls ? c.stop : undefined}
        onRefresh={c.reload}
        onToggleLogs={processControls ? () => setLogsToggled((v) => !(v ?? logsAutoOpen)) : undefined}
      />

      {c.canShare && <OpenOnDeviceNudge onShow={() => setShareOpen(true)} />}

      <div className="relative flex-1 overflow-hidden">
        {c.url ? (
          <iframe
            key={c.reloadKey}
            src={c.url}
            title="Preview"
            // Both modes load a different-origin URL (the dev server / the
            // tunnel), so SOP isolates Ri's origin for free. allow-same-
            // origin refers to the iframe's OWN origin (the dev app), which it
            // needs for cookies/storage/fetch.
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin"
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        ) : (
          <PreviewBody
            controller={c}
            processControls={processControls}
            onOpenRun={onOpenRun}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          />
        )}
      </div>

      {logsOpen && (
        <div className="h-32 shrink-0 border-t border-border">
          <PreviewLogs lines={c.logLines} />
        </div>
      )}
    </div>
  );
}

interface PreviewBodyProps {
  controller: PreviewController;
  processControls: boolean;
  onOpenRun?: () => void;
  onOpenWorkspaceSettings?: () => void;
}

/** What to show when there's no iframe yet: status, errors, and the BYO-URL input. */
function PreviewBody({ controller: c, processControls, onOpenRun, onOpenWorkspaceSettings }: PreviewBodyProps) {
  const state = c.state;
  const serverStatus = state?.serverStatus;
  const needsServer = providerNeedsServer(state?.activeRemoteProviderId);
  const setupStatus = state?.setupStatus ?? null;

  // Read provider settings before the early returns below. Selecting Beamd and
  // having a live Beamd connection are separate states, so only advertise the
  // automatic path once both are true.
  const { data: previewSettings } = usePreviewSettings();
  const beamdReady = !!previewSettings && previewSettings.beamd.connected && previewSettings.activeProvider === 'beamd';
  const automaticProviderLabel = beamdReady
    ? previewSettings.providers.find((provider) => provider.id === previewSettings.activeProvider)?.label ?? 'Beamd'
    : null;
  const hasManualUrl = !!state?.manualUrls.some((u) => (u.service ?? null) === null && !!u.url?.trim());
  const manualInput = (
    <PreviewManualUrlInput
      urls={state?.manualUrls ?? []}
      onSave={(urls: PreviewManualUrl[]) => c.saveUrls(urls)}
      isSaving={c.isSavingUrls}
      label={automaticProviderLabel ? 'Manual URL override' : undefined}
      description={
        automaticProviderLabel
          ? `Already have another tunnel? Paste it here to override ${automaticProviderLabel} for this execution.`
          : undefined
      }
    />
  );

  // Work on another computer: its app runs there (P3.5). A tunnel of the
  // person's own, pasted here, is the one way to open it on this screen.
  if (c.elsewhere) {
    return (
      <RunsElsewhere where={c.elsewhere} command={c.command}>
        <div className="w-full border-t border-border pt-4">
          <PreviewManualUrlInput
            urls={state?.manualUrls ?? []}
            onSave={(urls: PreviewManualUrl[]) => c.saveUrls(urls)}
            isSaving={c.isSavingUrls}
            description={`Reach it through your own tunnel from ${c.elsewhere.computerName}? Paste its address to open it here.`}
          />
        </div>
      </RunsElsewhere>
    );
  }

  // The setup script is still installing deps, so the dev server is held back
  // (starting now would crash on missing node_modules).
  if (setupStatus === 'running') {
    return (
      <Centered>
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
        <span className="text-[13px] text-muted-foreground">Installing dependencies…</span>
        <span className="max-w-xs text-center text-[11px] text-muted-foreground/60">
          Running the agent&apos;s setup script. You can start the app when it finishes.
        </span>
        {onOpenRun && <SecondaryButton onClick={onOpenRun}>See output in Run</SecondaryButton>}
      </Centered>
    );
  }

  // A remote-provider error (Beamd not configured, no manual URL, …) that
  // isn't just "the server isn't up yet" gets its own actionable surface.
  const showRemoteError =
    c.mode === 'remote' &&
    c.remoteError &&
    (!needsServer || serverStatus === 'running' || serverStatus === 'idle' || serverStatus === 'stopped');

  if (c.isResolvingRemote && !showRemoteError) {
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
            {c.remoteError!.message}
          </h3>
          {c.remoteError!.hint && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">{c.remoteError!.hint}</p>
          )}
          {c.remoteError!.code === 'beamd_not_configured' || c.remoteError!.code === 'no_remote_provider' ? (
            <button
              type="button"
              onClick={() => openSettings('remote-preview')}
              className="flex items-center gap-2 rounded-md border border-border bg-foreground px-3 py-1.5 text-[13px] font-medium text-background hover:bg-foreground/90"
            >
              <Globe size={13} />
              Set up remote preview
            </button>
          ) : null}
          <div className="w-full space-y-4 border-t border-border pt-4">
            {automaticProviderLabel && (
              <RemoteProviderStatus providerLabel={automaticProviderLabel} hasManualUrl={hasManualUrl} />
            )}
            {manualInput}
          </div>
        </div>
      </Centered>
    );
  }

  const variant = resolveEmptyVariant(serverStatus, c.command, state?.port ?? null);
  const showManual = c.mode === 'remote' || state?.activeRemoteProviderId === 'manual';
  const showPromo = !automaticProviderLabel;

  // Setup recovery: surface the right path when the dev server likely can't
  // come up because dependencies are missing.
  //   - failed setup → prominent "Re-run setup" (deps install errored).
  //   - crashed + a setup command → quieter "Re-run setup" hint (covers a
  //     stale/partial install, e.g. a prior production-only `yarn install`).
  //   - crashed + NO setup command → "configure" nudge: the most common first
  //     run failure is simply forgetting to set an install step.
  const setupRecovery: { tone: 'error' | 'hint' | 'configure'; error: string | null } | null =
    setupStatus === 'failed'
      ? { tone: 'error', error: state?.setupError ?? null }
      : serverStatus === 'crashed'
        ? c.hasSetupCommand
          ? { tone: 'hint', error: null }
          : { tone: 'configure', error: null }
        : null;

  const footerNodes: React.ReactNode[] = [];
  if (setupRecovery)
    footerNodes.push(
      <SetupRecovery
        key="setup"
        tone={setupRecovery.tone}
        error={setupRecovery.error}
        onRetry={c.retrySetup}
        isRetrying={c.isRetryingSetup}
        onOpenSettings={onOpenWorkspaceSettings}
      />,
    );
  if (c.mode === 'remote' && automaticProviderLabel)
    footerNodes.push(
      <RemoteProviderStatus key="provider" providerLabel={automaticProviderLabel} hasManualUrl={hasManualUrl} />,
    );
  if (showPromo) footerNodes.push(<RemotePreviewPromo key="promo" prominent={variant === 'no-command'} />);
  if (showManual) footerNodes.push(<div key="manual">{manualInput}</div>);
  const footer = footerNodes.length ? <div className="w-full space-y-4">{footerNodes}</div> : undefined;

  if (processControls) {
    // Legacy all-in-one pane: the process lives here too.
    const startLabel =
      c.mode !== 'remote'
        ? undefined
        : hasManualUrl
          ? 'Open manual preview'
          : automaticProviderLabel
            ? `${variant === 'crashed' ? 'Restart' : 'Start'} with ${automaticProviderLabel}`
            : undefined;
    return (
      <PreviewEmpty
        variant={variant}
        command={c.command}
        exitCode={null}
        onSaveCommand={c.saveCommand}
        isSavingCommand={c.isSavingCommand}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onStart={c.start}
        isStarting={c.isStarting}
        startLabel={startLabel}
        footer={footer}
      />
    );
  }

  // Workbench: Preview is the interface. It says why there's nothing to show
  // and offers one explicit action. Output and setup live in Run.
  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-start gap-4">
        <PreviewNotLive
          variant={variant}
          command={c.command}
          isStarting={c.isStarting}
          actionError={c.actionError}
          onStart={c.start}
          onRestart={c.restart}
          onOpenRun={onOpenRun}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        />
        {footer && <div className="w-full border-t border-border pt-4">{footer}</div>}
      </div>
    </div>
  );
}

function PreviewNotLive({
  variant,
  command,
  isStarting,
  actionError,
  onStart,
  onRestart,
  onOpenRun,
  onOpenWorkspaceSettings,
}: {
  variant: ReturnType<typeof resolveEmptyVariant>;
  command: string | null;
  isStarting: boolean;
  actionError: string | null;
  onStart: () => void;
  onRestart: () => void;
  onOpenRun?: () => void;
  onOpenWorkspaceSettings?: () => void;
}) {
  const cmd = <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">{command}</code>;
  const error = actionError && (
    <p className="flex items-start gap-1.5 text-[12px] text-rose-600 dark:text-rose-400">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      {actionError}
    </p>
  );

  if (variant === 'no-command') {
    return (
      <>
        <Heading>Preview needs a start command</Heading>
        <Subtle>Tell Ri how to run this app in Run, and Preview will show it here for every execution of this agent.</Subtle>
        {onOpenRun && <PrimaryButton onClick={onOpenRun}>Set up in Run</PrimaryButton>}
      </>
    );
  }

  if (variant === 'starting') {
    return (
      <>
        <Heading>Starting {cmd}…</Heading>
        <Subtle>The preview shows up as soon as the app answers on its port.</Subtle>
        {onOpenRun && <SecondaryButton onClick={onOpenRun}>See output in Run</SecondaryButton>}
      </>
    );
  }

  if (variant === 'running-no-port') {
    return (
      <>
        <Heading>The app is running, but no port was found</Heading>
        <Subtle>
          Its output never printed a <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">localhost:PORT</code> line.
          Set the port in the agent&apos;s setup, then restart it from Run.
        </Subtle>
        <div className="flex flex-wrap gap-2">
          {onOpenRun && <SecondaryButton onClick={onOpenRun}>Open Run</SecondaryButton>}
          {onOpenWorkspaceSettings && <SecondaryButton onClick={onOpenWorkspaceSettings}>Open agent setup</SecondaryButton>}
        </div>
      </>
    );
  }

  if (variant === 'crashed') {
    return (
      <>
        <Heading>
          <span className="flex items-center gap-2">
            <AlertCircle size={15} className="text-rose-500" />
            {cmd} failed
          </span>
        </Heading>
        <Subtle>The app exited before it could be previewed. Its output in Run says why.</Subtle>
        {error}
        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={onRestart} disabled={isStarting}>
            <Play size={12} className="fill-current" />
            {isStarting ? 'Starting…' : 'Restart'}
          </PrimaryButton>
          {onOpenRun && <SecondaryButton onClick={onOpenRun}>Open Run</SecondaryButton>}
        </div>
      </>
    );
  }

  // idle / stopped
  return (
    <>
      <Heading>The app isn&apos;t running</Heading>
      <Subtle>Preview shows {cmd} running in this worktree. Closing Preview never stops it.</Subtle>
      {error}
      <div className="flex flex-wrap gap-2">
        <PrimaryButton onClick={onStart} disabled={isStarting}>
          <Play size={12} className="fill-current" />
          {isStarting ? 'Starting…' : `Start ${command ?? 'the app'}`}
        </PrimaryButton>
        {onOpenRun && <SecondaryButton onClick={onOpenRun}>Open Run</SecondaryButton>}
      </div>
    </>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-semibold text-foreground">{children}</h3>;
}

function Subtle({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-foreground px-3 py-1.5 text-[13px] font-medium text-background hover:bg-foreground/90',
        disabled && 'opacity-60',
      )}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
    >
      {children}
    </button>
  );
}

function RemoteProviderStatus({ providerLabel, hasManualUrl }: { providerLabel: string; hasManualUrl: boolean }) {
  return (
    <div className="flex w-full items-start gap-2">
      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-medium text-foreground">{providerLabel} connected</span>
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {hasManualUrl ? 'Override active' : 'Automatic'}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {hasManualUrl
            ? `The manual URL below is in use. Clear it to return to ${providerLabel}.`
            : `Starting this preview will open a ${providerLabel} tunnel automatically.`}
        </p>
      </div>
    </div>
  );
}

const NUDGE_DISMISSED_KEY = 'ri.preview.openOnDevice.nudged';

/**
 * One-time discovery hint for "Open on another device". Icons alone don't
 * teach the feature, so the first time a preview goes live we surface a thin,
 * dismissible strip pointing at it. Dismissal is permanent (localStorage).
 */
function OpenOnDeviceNudge({ onShow }: { onShow: () => void }) {
  // Start hidden to avoid a flash before localStorage is read.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        setDismissed(localStorage.getItem(NUDGE_DISMISSED_KEY) === '1');
      } catch {
        setDismissed(false);
      }
    }, 0);
    return () => window.clearTimeout(id);
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
      <span className="flex-1 text-muted-foreground">See this on your real phone: one scan, no deploy.</span>
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

function providerNeedsServer(providerId: string | undefined): boolean {
  // localhost + Beamd manage the server. portless + manual don't.
  return providerId !== 'portless' && providerId !== 'manual';
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
