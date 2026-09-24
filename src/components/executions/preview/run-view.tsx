'use client';

import { AlertCircle, AppWindow, Loader2, Play, RotateCw, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CommandEditor } from './preview-empty';
import { PreviewLogs } from './preview-logs';
import { SetupRecovery } from './setup-recovery';
import { RUN_STATUS_LABEL, runDotClass, runIsActive } from './run-status';
import type { PreviewController } from './use-preview-controller';

interface RunViewProps {
  controller: PreviewController;
  /** Start the app and open Preview, on purpose. */
  onStartAndPreview?: () => void;
  /** Switch to the Preview tab. */
  onOpenPreview?: () => void;
  /** Opens the agent's settings (setup command, port override). */
  onOpenWorkspaceSettings?: () => void;
}

/**
 * The Run tab: the app's process. Its status in words, one labeled action
 * (Start, Stop or Restart), the live output, and setup when there's no
 * start command yet. Running is separate from previewing: starting here
 * never opens Preview, and closing Preview never stops anything.
 */
export function RunView({ controller: c, onStartAndPreview, onOpenPreview, onOpenWorkspaceSettings }: RunViewProps) {
  if (!c.executionId) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-[12px] text-muted-foreground/60">
        No execution selected.
      </div>
    );
  }

  const status = c.runStatus;
  const active = runIsActive(status);
  const port = c.state?.port ?? null;
  const detail = status === 'running' && port ? `localhost:${port}` : null;
  const hasOutput = c.logLines.length > 0;

  const setupRecovery: { tone: 'error' | 'hint' | 'configure'; error: string | null } | null = c.setupFailed
    ? { tone: 'error', error: c.setupError }
    : status === 'crashed'
      ? c.hasSetupCommand
        ? { tone: 'hint', error: null }
        : { tone: 'configure', error: null }
      : null;

  return (
    <div className="flex h-full flex-col bg-background">
      {status !== 'not-configured' && (
        <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border px-3">
          <span aria-hidden className={cn('h-2 w-2 flex-shrink-0 rounded-full', runDotClass(status))} />
          <span className="whitespace-nowrap text-[12.5px] font-medium text-foreground">{RUN_STATUS_LABEL[status]}</span>
          {c.command && (
            <code className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground" title={c.command}>
              {c.command}
            </code>
          )}
          {detail && <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground/70">· {detail}</span>}
          <span className="flex-1" />
          {active ? (
            <>
              {status !== 'starting' && (
                <RunButton onClick={c.restart} disabled={c.isStopping || c.isStarting} title={`Stop and start ${c.command ?? 'the app'} again`}>
                  <RotateCw size={12} />
                  Restart
                </RunButton>
              )}
              <RunButton onClick={c.stop} disabled={c.isStopping} title={`Stop ${c.command ?? 'the app'}. Preview can stay open.`}>
                {c.isStopping ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} className="fill-current" />}
                Stop
              </RunButton>
              {status === 'running' && onOpenPreview && (
                <RunButton onClick={onOpenPreview} title="Open Preview">
                  <AppWindow size={12} />
                  Preview
                </RunButton>
              )}
            </>
          ) : status === 'installing' ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Start is available when setup finishes
            </span>
          ) : (
            <>
              {onStartAndPreview && (
                <RunButton onClick={onStartAndPreview} disabled={c.isStarting} title={`Run ${c.command} and open Preview`}>
                  <AppWindow size={12} />
                  Start &amp; preview
                </RunButton>
              )}
              <RunButton primary onClick={c.start} disabled={c.isStarting} title={`Run ${c.command} in this worktree without opening Preview`}>
                {c.isStarting ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} className="fill-current" />}
                {status === 'crashed' ? 'Restart' : 'Start'}
              </RunButton>
            </>
          )}
        </div>
      )}

      {c.actionError && (
        <div className="flex flex-shrink-0 items-start gap-2 border-b border-border bg-rose-500/5 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          {c.actionError}
        </div>
      )}

      {setupRecovery && (
        <div className="flex-shrink-0 border-b border-border px-3 py-3">
          <SetupRecovery
            tone={setupRecovery.tone}
            error={setupRecovery.error}
            onRetry={c.retrySetup}
            isRetrying={c.isRetryingSetup}
            onOpenSettings={onOpenWorkspaceSettings}
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {status === 'not-configured' ? (
          <RunSetup controller={c} />
        ) : status === 'installing' ? (
          <Centered>
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
            <span className="text-[13px] text-muted-foreground">Installing dependencies…</span>
            <span className="max-w-xs text-center text-[11.5px] text-muted-foreground/70">
              The agent&apos;s setup script is running in this worktree. Starting now would fail on missing packages.
            </span>
          </Centered>
        ) : status === 'stopped' && !hasOutput ? (
          <RunStopped controller={c} />
        ) : (
          <div className="flex h-full flex-col">
            {status === 'stopped' && (
              <div className="flex-shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground/80">
                Output from the last run
              </div>
            )}
            {status === 'running-no-port' && (
              <div className="flex flex-shrink-0 items-start gap-2 border-b border-border bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  Running, but the output never printed a localhost port, so Preview can&apos;t find it.
                  {onOpenWorkspaceSettings && (
                    <>
                      {' '}
                      <button type="button" onClick={onOpenWorkspaceSettings} className="underline underline-offset-2 hover:text-foreground">
                        Set the port in the agent&apos;s setup
                      </button>
                      , then restart.
                    </>
                  )}
                </span>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <PreviewLogs lines={c.logLines} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** No start command yet: ask for one, right here. */
function RunSetup({ controller: c }: { controller: PreviewController }) {
  return (
    <Centered>
      <div className="flex w-full max-w-md flex-col items-start gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">How does this app run?</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Give Ri the command that starts your dev server. Anything that prints a{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-[12px]">localhost:PORT</code> line works: pnpm dev, flask run,
          cargo run, python -m http.server. It&apos;s saved to the agent, so every execution uses it, and Preview shows the result.
        </p>
        <CommandEditor initialValue="" startInEditMode placeholder="pnpm dev" onSave={c.saveCommand} isSaving={c.isSavingCommand} />
      </div>
    </Centered>
  );
}

/** Stopped with nothing to show yet: the command (editable) and how to start it. */
function RunStopped({ controller: c }: { controller: PreviewController }) {
  return (
    <Centered>
      <div className="flex w-full max-w-md flex-col items-start gap-3">
        <h3 className="text-[15px] font-semibold text-foreground">The app isn&apos;t running</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Start runs this command in the worktree. Its output shows here, and Preview shows the app once it answers on its port.
        </p>
        <CommandEditor initialValue={c.command ?? ''} onSave={c.saveCommand} isSaving={c.isSavingCommand} />
      </div>
    </Centered>
  );
}

function RunButton({
  children,
  onClick,
  disabled,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50',
        primary
          ? 'border-transparent bg-foreground text-background hover:bg-foreground/90'
          : 'border-border bg-background text-foreground/90 hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-background px-6 py-10">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}
