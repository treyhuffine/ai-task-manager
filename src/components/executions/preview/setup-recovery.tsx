'use client';

import { AlertCircle, Loader2, RotateCw } from 'lucide-react';

/**
 * Setup recovery shown under the empty/crashed preview state. Three tones:
 *   - `error`     — a failed setup script (surfaces its output + "Re-run setup").
 *   - `hint`      — server crashed despite a configured setup command; deps may
 *                   be stale/partial. Softer "Re-run setup" nudge.
 *   - `configure` — server crashed and NO setup command is set; the likely fix
 *                   is adding an install step. Points at workspace settings.
 * The re-run action triggers the workspace setup command, which the preview
 * gate then waits on before starting the dev server.
 */
export function SetupRecovery({
  tone,
  error,
  onRetry,
  isRetrying,
  onOpenSettings,
}: {
  tone: 'error' | 'hint' | 'configure';
  error: string | null;
  onRetry: () => void;
  isRetrying: boolean;
  onOpenSettings?: () => void;
}) {
  const isError = tone === 'error';
  const isConfigure = tone === 'configure';
  const title = isError
    ? 'Setup script failed'
    : isConfigure
      ? 'No setup command configured'
      : 'Dependencies may be missing';
  const body = isError
    ? 'The agent’s setup script errored, so the preview may be missing dependencies.'
    : isConfigure
      ? 'The dev server couldn’t start. If your app needs a dependency install (e.g. yarn install / pnpm install), add it as the agent’s setup command. It runs once per worktree before the preview starts.'
      : 'The dev server couldn’t start. If dependencies aren’t installed, re-run the agent’s setup script.';
  return (
    <div className="w-full rounded-md border border-border bg-card/40 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle size={13} className={isError ? 'mt-0.5 shrink-0 text-amber-500' : 'mt-0.5 shrink-0 text-muted-foreground'} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-[13px] font-medium text-foreground">{title}</div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{body}</p>
          {error && (
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 px-2 py-1.5 font-mono text-[10.5px] text-muted-foreground/90">
              {error}
            </pre>
          )}
          {isConfigure ? (
            onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background hover:bg-foreground/90"
              >
                Set a setup command
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              {isRetrying ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
              Re-run setup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
