'use client';

import { useEffect, useState } from 'react';
import { GitBranch, Folder, Sparkles, AlertCircle } from 'lucide-react';
import type { ChatSessionRecord, WorkspaceRecord } from '@/db/types';
import { ThinkingDots } from './thinking-dots';

interface SetupCardProps {
  session: ChatSessionRecord;
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
 *   - **Setting up** (git workspace, no worktree_path yet) — what we
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

  const isGit = workspace.is_git;
  const isSettingUp = isGit && !session.worktree_path;

  return (
    <div className="space-y-1.5 mb-1">
      <SetupRow
        icon={<Sparkles size={11} className="text-primary/70" />}
        text={
          session.label ? (
            <>
              Started{' '}
              <span className="font-mono text-foreground/90">{session.label}</span>
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
      {isGit && session.branch_name && (
        <SetupRow
          icon={<GitBranch size={11} />}
          text={
            <span className="font-mono">
              <span className="text-muted-foreground/80">Branched </span>
              <span className="text-foreground/90">{session.branch_name}</span>
              <span className="text-muted-foreground/80"> from </span>
              <span className="text-foreground/90">{workspace.base_branch ?? 'main'}</span>
              {session.base_sha && (
                <span className="text-muted-foreground/60">
                  {' @'}
                  {session.base_sha.slice(0, 7)}
                </span>
              )}
            </span>
          }
        />
      )}

      {session.worktree_path && (
        <SetupRow
          icon={<Folder size={11} />}
          text={<span className="font-mono text-muted-foreground/70 truncate">{session.worktree_path}</span>}
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

      {/* Loading row — last item, removed once worktree_path lands. */}
      {isSettingUp && (
        <SettingUpRow
          baseBranch={workspace.base_branch ?? 'main'}
          startedAt={session.started_at}
        />
      )}
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
