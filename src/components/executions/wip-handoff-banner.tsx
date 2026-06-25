'use client';

import { useState } from 'react';
import { ArrowRightLeft, Copy, X, AlertTriangle, Loader2 } from 'lucide-react';
import { useSessionWip, useApplyWip } from '@/hooks/use-execution';
import type { WipApplyResult } from '@/lib/api/sessions';

interface WipHandoffBannerProps {
  sessionId: string;
  /** True once `worktreePath` is populated — gates the WIP fetch so we
   *  don't probe before the worktree exists. */
  worktreeReady: boolean;
}

/**
 * Banner above the transcript prompting the user about uncommitted work
 * in the source repo. Worktrees only check out from a commit, so any
 * WIP the user had stays behind in the source repo unless we move or
 * copy it. The user is presented with three options:
 *
 *   - **Move** — git stash + pop. WIP leaves source, lands in worktree.
 *   - **Copy** — file copy. WIP stays in source, also lands in worktree.
 *   - **Dismiss** — leave it; the user wanted a clean worktree.
 *
 * Dismiss state is in-memory only. Reload re-runs detection — if the
 * source still has WIP, the prompt comes back showing whatever's
 * actually there *now* (not a snapshot).
 */
export function WipHandoffBanner({ sessionId, worktreeReady }: WipHandoffBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [conflict, setConflict] = useState<{ stashMessage: string | null } | null>(null);
  const { data: wip, isLoading } = useSessionWip(sessionId, worktreeReady && !dismissed);
  const apply = useApplyWip(sessionId);

  if (dismissed || conflict) {
    return conflict ? <ConflictNotice info={conflict} onDismiss={() => setConflict(null)} /> : null;
  }
  if (isLoading || !wip) return null;

  const modifiedCount = wip.modified.length;
  const untrackedCount = wip.untracked.length;
  if (modifiedCount === 0 && untrackedCount === 0) return null;

  const isPending = apply.isPending;
  const handle = (action: 'copy' | 'move') => {
    apply.mutate(action, {
      onSuccess: (result: WipApplyResult) => {
        if (result.action === 'move' && result.conflict) {
          setConflict({ stashMessage: result.stashMessage ?? null });
          return;
        }
        setDismissed(true);
      },
    });
  };

  return (
    <div className="border-b border-border bg-amber-500/5 px-5 py-2.5">
      <div className="max-w-3xl mx-auto flex items-center gap-3 flex-wrap">
        <p className="text-[11px] text-foreground/90 flex-1 min-w-0">
          <span className="font-medium">Uncommitted work in source repo.</span>{' '}
          <span className="text-muted-foreground">
            {summarize(modifiedCount, untrackedCount)} stayed behind when this worktree was created.
          </span>
        </p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ActionButton
            primary
            disabled={isPending}
            onClick={() => handle('move')}
            icon={isPending && apply.variables === 'move' ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightLeft size={11} />}
            label="Move"
            hint="git stash + pop"
          />
          <ActionButton
            disabled={isPending}
            onClick={() => handle('copy')}
            icon={isPending && apply.variables === 'copy' ? <Loader2 size={11} className="animate-spin" /> : <Copy size={11} />}
            label="Copy"
            hint="leave a copy in source"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      {apply.isError && (
        <p className="max-w-3xl mx-auto mt-1.5 text-[11px] text-red-500/90">
          {apply.error.message}
        </p>
      )}
    </div>
  );
}

function summarize(modified: number, untracked: number): string {
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (untracked > 0) parts.push(`${untracked} new`);
  return parts.join(', ');
}

function ActionButton(props: {
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  const { primary, disabled, onClick, icon, label, hint } = props;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'text-foreground hover:bg-foreground/5 border border-border'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ConflictNotice({
  info,
  onDismiss,
}: {
  info: { stashMessage: string | null };
  onDismiss: () => void;
}) {
  return (
    <div className="border-b border-border bg-red-500/5 px-5 py-2.5">
      <div className="max-w-3xl mx-auto flex items-start gap-3">
        <AlertTriangle size={12} className="text-red-500/80 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 text-[11px]">
          <p className="font-medium text-foreground/90">
            Stash applied with conflicts.
          </p>
          <p className="text-muted-foreground mt-0.5">
            Your WIP is in the worktree with conflict markers. Resolve and run{' '}
            <code className="font-mono text-foreground/80">git stash drop</code> when done.
            {info.stashMessage && (
              <>
                {' '}Stash:{' '}
                <code className="font-mono text-foreground/80">{info.stashMessage}</code>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors"
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
