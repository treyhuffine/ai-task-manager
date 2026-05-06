'use client';

import { GitBranch, Archive } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useDiffStats, useArchiveSession } from '@/hooks/use-workspaces';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api/client';
import type { ChatSessionRecord } from '@/db/types';

interface SessionRowProps {
  session: ChatSessionRecord;
  showWorkspaceLabel?: string;
}

/**
 * One session under a workspace. Renders label + diff stats + activity
 * indicator. Status indicator follows three rules:
 *
 *   1. live streaming — animated pulse + "working"
 *   2. needs_review (last_outcome > last_viewed) — small dot + relative time
 *   3. idle — relative time only
 */
export function SessionRow({ session, showWorkspaceLabel }: SessionRowProps) {
  const { activeView, setActiveView, streamingSessionIds } = useDashboard();
  const { data: diffStats } = useDiffStats(session.worktree_path ? session.id : null);
  const archive = useArchiveSession();

  const isStreaming = streamingSessionIds.has(session.id);
  const lastOutcome = session.last_outcome_event_at;
  const needsReview = !isStreaming
    && lastOutcome
    && lastOutcome > (session.last_viewed_at ?? '1970-01-01');

  const timestamp = lastOutcome ?? session.started_at;
  const isActive = activeView === session.id;

  // Label is null for executions created via the no-modal flow until
  // the first user message arrives and the server derives one. Show a
  // muted placeholder until then so the row stays orientable.
  const label = session.label ?? 'Untitled';
  const labelIsPlaceholder = !session.label;

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (archive.isPending) return;
    if (!confirm(`Archive "${label}"?`)) return;
    archive.mutate(
      { id: session.id, force: false },
      {
        onError: (err) => {
          // Worktree has uncommitted/unpushed work — ask the user before
          // force-removing. The 409 from /api/sessions/:id/archive carries
          // code: 'dirty_worktree'.
          if (err instanceof ApiError && err.status === 409) {
            const body = err.body as { code?: string } | null;
            if (body?.code === 'dirty_worktree') {
              const force = confirm(
                `"${label}" has uncommitted or unpushed changes. Archive anyway? ` +
                'Local changes in the worktree will be lost.',
              );
              if (force) archive.mutate({ id: session.id, force: true });
              return;
            }
          }
          alert(`Couldn't archive: ${err instanceof Error ? err.message : String(err)}`);
        },
      },
    );
  };

  return (
    <div
      onClick={() => setActiveView(session.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setActiveView(session.id);
        }
      }}
      className={cn(
        'w-full group flex items-center gap-2 pl-5 pr-1.5 py-1.5 rounded-md transition-colors text-left cursor-pointer',
        isActive
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
      )}
    >
      <GitBranch size={10} className="flex-shrink-0 opacity-50" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className={cn('text-[11px] truncate', labelIsPlaceholder ? 'italic text-muted-foreground/70' : 'font-medium')}>{label}</span>
          {showWorkspaceLabel && (
            <span className="text-[9px] text-muted-foreground/60 truncate">· {showWorkspaceLabel}</span>
          )}
        </div>
        {diffStats && (
          <div className="flex items-center gap-1.5 text-[9px] font-mono leading-none mt-0.5">
            <span className="text-emerald-500/80">+{diffStats.additions}</span>
            <span className="text-rose-500/80">-{diffStats.deletions}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0 text-[9px]">
        {/* Archive button — only on hover, replaces the timestamp visual on row hover */}
        <button
          onClick={handleArchive}
          aria-label="Archive execution"
          title="Archive execution"
          className="hidden group-hover:flex items-center justify-center p-0.5 rounded hover:bg-destructive/10 text-muted-foreground/70 hover:text-destructive transition-colors"
        >
          <Archive size={11} />
        </button>
        {/* Status / timestamp — hidden when row is hovered so the archive button takes its place */}
        <div className="flex items-center gap-1 group-hover:hidden">
          {isStreaming ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-500/80 font-medium">working</span>
            </>
          ) : needsReview ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full border border-amber-500" />
              <span className="text-muted-foreground/70">{formatCompactRelative(timestamp)}</span>
            </>
          ) : (
            <span className="text-muted-foreground/60">{formatCompactRelative(timestamp)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
