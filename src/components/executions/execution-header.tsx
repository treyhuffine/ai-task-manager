'use client';

import { useEffect, useRef, useState } from 'react';
import { GitBranch, MoreHorizontal, X, Archive } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useArchiveSession } from '@/hooks/use-workspaces';
import { useUpdateSession } from '@/hooks/use-execution';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { ChatSessionRecord, WorkspaceRecord } from '@/db/types';
import { OpenWorktreeButton } from './open-worktree-button';

interface ExecutionHeaderProps {
  session: ChatSessionRecord;
  workspace: WorkspaceRecord | undefined;
  onClose: () => void;
}

/**
 * Top strip of the execution view: workspace + label, branch + base sha,
 * status pill, action affordances. Status comes from the runtime
 * streaming map (live), the session's archived state, or just "idle"
 * when neither.
 */
export function ExecutionHeader({ session, workspace, onClose }: ExecutionHeaderProps) {
  const { streamingSessionIds, setActiveView } = useDashboard();
  const archive = useArchiveSession();
  const updateSession = useUpdateSession();
  const [menuOpen, setMenuOpen] = useState(false);

  // Inline rename: click the label → swap to input. Enter / blur saves
  // via PATCH /api/sessions/:id; Escape cancels. The local draft holds
  // the in-progress text so React Query repaints from server data don't
  // clobber the user's edit while they're typing.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(session.label ?? '');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, session.label]);

  const commitRename = () => {
    const next = draft.trim();
    setEditing(false);
    if (next === (session.label ?? '')) return; // no-op
    updateSession.mutate({ id: session.id, label: next || null });
  };

  const cancelRename = () => {
    setEditing(false);
    setDraft(session.label ?? '');
  };

  const isStreaming = streamingSessionIds.has(session.id);
  const isArchived = session.status === 'archived';

  const statusLabel = isStreaming
    ? 'running'
    : isArchived
      ? 'archived'
      : session.last_outcome_event_at
        ? 'idle'
        : 'ready';

  const statusColor = isStreaming
    ? 'bg-emerald-500'
    : isArchived
      ? 'bg-zinc-400'
      : session.last_outcome_event_at
        ? 'bg-amber-500'
        : 'bg-blue-500';

  const handleArchive = () => {
    if (!confirm(`Archive "${session.label ?? 'this execution'}"?`)) return;
    archive.mutate(
      { id: session.id, force: false },
      {
        onSuccess: () => {
          setActiveView('command');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            const body = err.body as { code?: string } | null;
            if (body?.code === 'dirty_worktree') {
              const force = confirm(
                'Worktree has uncommitted or unpushed changes. Archive anyway? Local changes will be lost.',
              );
              if (force) {
                archive.mutate(
                  { id: session.id, force: true },
                  { onSuccess: () => setActiveView('command') },
                );
              }
              return;
            }
          }
          alert(`Couldn't archive: ${err instanceof Error ? err.message : String(err)}`);
        },
      },
    );
  };

  return (
    <div className="flex-shrink-0 border-b border-border bg-background">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            {workspace?.emoji && <span>{workspace.emoji}</span>}
            <span className="font-medium truncate">{workspace?.name ?? 'Workspace'}</span>
            <span className="text-muted-foreground/40">/</span>
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                }}
                placeholder="Untitled"
                maxLength={120}
                className="flex-1 min-w-0 bg-background border border-primary/40 rounded px-1.5 py-0.5 text-[11px] font-semibold text-foreground focus:outline-none"
                spellCheck={false}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Rename"
                className={cn(
                  'truncate text-left rounded px-0.5 -mx-0.5',
                  'hover:bg-muted/50 transition-colors cursor-text',
                  session.label
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground/60 italic font-normal',
                )}
              >
                {session.label ?? 'Untitled'}
              </button>
            )}
          </div>
          {session.branch_name && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 font-mono mt-0.5">
              <GitBranch size={10} />
              <span className="truncate">{session.branch_name}</span>
              {session.base_sha && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>base @{session.base_sha.slice(0, 7)}</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <OpenWorktreeButton path={session.worktree_path} />
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 ml-1.5 mr-1">
            <span className={cn('w-1.5 h-1.5 rounded-full', statusColor, isStreaming && 'animate-pulse')} />
            {statusLabel}
          </span>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Execution menu"
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <>
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-border bg-popover shadow-lg overflow-hidden">
                  {!isArchived && (
                    <button
                      onClick={() => { setMenuOpen(false); handleArchive(); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-destructive hover:bg-destructive/10"
                    >
                      <Archive size={11} />
                      Archive execution
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Close execution"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
