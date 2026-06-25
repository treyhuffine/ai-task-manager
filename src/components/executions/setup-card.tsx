'use client';

import { useEffect, useState } from 'react';
import { GitBranch, Folder, Sparkles, AlertCircle, ArrowDownToLine, Loader2, RotateCw } from 'lucide-react';
import { useRetrySetup, useRetrySetupScript } from '@/hooks/use-execution';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { ThinkingDots } from './thinking-dots';

interface SetupCardProps {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | undefined;
}

/**
 * Inline summary of how the execution was set up — chronologically the
 * first thing that happened. Renders as a series of subtle rows
 * (icon + text), not a bordered card, so it reads as part of the
 * transcript rather than a distinct UI panel.
 *
 * Two states:
 *
 *   - **Setting up** (git workspace, no worktreePath yet) — what we
 *     know so far + a final "creating worktree…" row with animated
 *     dots and elapsed time. The known rows fill in once provisioning
 *     finishes.
 *
 *   - **Ready** — final list of what we know: workspace, branch + base
 *     SHA (git only), worktree path or cwd. Stays at the top of the
 *     transcript permanently as the chronological start of the session.
 */
export function SetupCard({ session, workspace }: SetupCardProps) {
  if (!workspace) return null;

  const isGit = workspace.isGit;
  const hasError = isGit && !session.worktreePath && !!session.setupError;
  // Treat error state as terminal — drop the spinner row so the user
  // doesn't see "creating worktree…" next to a "setup failed" row.
  const isSettingUp = isGit && !session.worktreePath && !hasError;

  return (
    <div className="space-y-1.5 mb-1">
      <SetupRow
        icon={<Sparkles size={11} className="text-primary/70" />}
        text={
          (session.execution?.label ?? session.label) ? (
            <>
              Started{' '}
              <span className="font-mono text-foreground/90">{session.execution?.label ?? session.label}</span>
              <span className="text-muted-foreground/60"> in </span>
              <span className="text-foreground/90">{workspace.name}</span>
            </>
          ) : (
            <>
              Started in <span className="text-foreground/90">{workspace.name}</span>
              <span className="text-muted-foreground/60"> · name will come from your first message</span>
            </>
          )
        }
      />

      {/* Git-ready: branch + base SHA + worktree path */}
      {isGit && session.branchName && (
        <SetupRow
          icon={<GitBranch size={11} />}
          text={
            <span className="font-mono">
              <span className="text-muted-foreground/80">Branched </span>
              <span className="text-foreground/90">{session.branchName}</span>
              <span className="text-muted-foreground/80"> from </span>
              <span className="text-foreground/90">{workspace.baseBranch ?? 'main'}</span>
              {session.baseSha && (
                <span className="text-muted-foreground/60">
                  {' @'}
                  {session.baseSha.slice(0, 7)}
                </span>
              )}
            </span>
          }
        />
      )}

      {session.worktreePath && (
        <SetupRow
          icon={<Folder size={11} />}
          text={<span className="font-mono text-muted-foreground/70 truncate">{session.worktreePath}</span>}
        />
      )}

      {/* Non-git workspace — single row noting no isolation. */}
      {!isGit && (
        <SetupRow
          icon={<AlertCircle size={11} className="text-amber-500/80" />}
          text={
            <span>
              Non-git workspace · agent runs in{' '}
              <span className="font-mono text-foreground/80">{workspace.cwd}</span>
              <span className="text-muted-foreground/60"> · no isolation</span>
            </span>
          }
        />
      )}

      {/* Loading row — last item, removed once worktreePath lands.
          Anchored to `setupStartedAt` so the counter resets on each
          retry; falls back to `startedAt` for rows created before this
          column existed. */}
      {isSettingUp && (
        <SettingUpRow
          baseBranch={workspace.baseBranch ?? 'main'}
          startedAt={session.setupStartedAt ?? session.startedAt}
        />
      )}

      {/* Failure row — replaces the spinner when provisioning errors. */}
      {hasError && (
        <SetupErrorRow
          sessionId={session.id}
          error={session.setupError ?? 'Unknown error'}
          prNumber={session.prNumber ?? null}
        />
      )}

      {/* Background setup script — runs after the worktree is ready, so the
          session is already chattable. Non-blocking; just a status row. */}
      {session.worktreePath && session.setupScriptStatus === 'running' && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <ThinkingDots />
          <span>Running setup script…</span>
        </div>
      )}
      {session.setupScriptStatus === 'failed' && (
        <SetupScriptErrorRow
          sessionId={session.id}
          error={session.setupScriptError ?? 'Setup script failed'}
        />
      )}
    </div>
  );
}

function SetupScriptErrorRow({ sessionId, error }: { sessionId: string; error: string }) {
  const retry = useRetrySetupScript(sessionId);
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <AlertCircle size={11} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-amber-600 dark:text-amber-400 font-medium">Setup script failed</div>
        <div className="text-muted-foreground/80 font-mono text-[10.5px] break-all whitespace-pre-wrap">{error}</div>
        <button
          type="button"
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
          className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 disabled:opacity-50 transition-colors"
        >
          {retry.isPending ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
          Retry setup
        </button>
      </div>
    </div>
  );
}

function SetupErrorRow({
  sessionId,
  error,
  prNumber,
}: {
  sessionId: string;
  error: string;
  prNumber: number | null;
}) {
  const retry = useRetrySetup(sessionId);
  const handleClick = () => {
    retry.mutate(undefined, {
      onError: (err) => {
        alert(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    });
  };
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <AlertCircle size={11} className="text-rose-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-rose-600 dark:text-rose-400 font-medium">
          {prNumber != null
            ? `Couldn't fetch PR #${prNumber}`
            : "Couldn't create worktree"}
        </div>
        <div className="text-muted-foreground/80 font-mono text-[10.5px] break-all">
          {error}
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={retry.isPending}
          className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md border border-rose-500/40 bg-rose-500/10 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 disabled:opacity-50 transition-colors"
        >
          {retry.isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <ArrowDownToLine size={11} />
          )}
          Pull
        </button>
      </div>
    </div>
  );
}

function SetupRow({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="text-muted-foreground/60 flex-shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

function SettingUpRow({ baseBranch, startedAt }: { baseBranch: string; startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => secondsSince(startedAt));
  useEffect(() => {
    const tick = () => setElapsed(secondsSince(startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <ThinkingDots />
      <span>
        Creating worktree off{' '}
        <span className="font-mono text-foreground/80">{baseBranch}</span>
        <span className="ml-1.5 font-mono text-muted-foreground/60">{elapsed}s</span>
      </span>
    </div>
  );
}

function secondsSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}
