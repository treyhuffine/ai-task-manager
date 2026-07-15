'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Plus, History as HistoryIcon, Loader2, Check, Pencil } from 'lucide-react';
import { useExecutionChatHistory, useUpdateSession } from '@/hooks/use-execution';
import { useDashboard } from '@/contexts/dashboard-context';
import { isSessionUnread, latestActivityAt } from '@/lib/utils/session-sort';
import { cn } from '@/lib/utils';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Execution chat controls: a "New chat" button (fresh conversation on the same
 * worktree — provider switching posts here too) and a history dropdown listing
 * every chat this execution has hosted, hottest first. Selecting a past chat
 * navigates to it; the execution view auto-resumes it if it's archived.
 *
 * Rows carry the rail's unread treatment (`isSessionUnread`) so a sibling chat
 * that the agent has moved on since you last looked reads as unread here too.
 * The server sorts by the same hotness key the rail uses.
 *
 * Each chat carries its own title (`chat_sessions.label`), editable inline here
 * via the pencil affordance. This is distinct from the execution's title (edited
 * in the header) — renaming a chat never touches the execution title.
 */
export function ExecutionChatControls({
  sessionId,
  onNewChat,
  newChatPending,
}: {
  sessionId: string;
  onNewChat?: () => void;
  newChatPending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { setActiveView } = useDashboard();
  const { data } = useExecutionChatHistory(sessionId, open);
  const sessions = data?.sessions ?? [];
  const qc = useQueryClient();
  const updateSession = useUpdateSession();

  // Inline chat-title editing. `editingId` is the chat row being renamed;
  // `draft` holds the in-flight text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (id: string, label: string | null) => {
    setEditingId(id);
    setDraft(label ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const commitEdit = (id: string, current: string | null) => {
    const next = draft.trim() || null;
    setEditingId(null);
    setDraft('');
    if (next === (current ?? null)) return; // no-op
    updateSession.mutate(
      { id, label: next },
      // The hook invalidates ['session', id]; the dropdown reads
      // ['session', sessionId, 'history'], so refresh that too.
      { onSuccess: () => qc.invalidateQueries({ queryKey: ['session', sessionId, 'history'] }) },
    );
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      {onNewChat && (
        <button
          type="button"
          onClick={onNewChat}
          disabled={newChatPending}
          title="New chat on this worktree"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
        >
          {newChatPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          <span className="hidden sm:inline">New chat</span>
        </button>
      )}

      <PopoverPrimitive.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) cancelEdit(); }}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            title="Chat history"
            aria-label="Chat history"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <HistoryIcon size={14} />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-h-[360px] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl outline-none"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Chats for this execution
            </div>
            {sessions.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground/80">No other chats yet.</div>
            ) : (
              sessions.map((s) => {
                const isEditing = editingId === s.id;
                // The chat you're looking at can't be unread — opening it is
                // the read receipt, and the mark-read write lands a beat later
                // than this render, so trust `isCurrent` over `lastViewedAt`.
                const unread = !s.isCurrent && isSessionUnread(s);
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5',
                      !isEditing && 'transition-colors',
                      s.isCurrent && !isEditing ? 'bg-primary/10' : !isEditing && 'hover:bg-muted/50',
                    )}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        value={draft}
                        maxLength={120}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitEdit(s.id, s.label)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitEdit(s.id, s.label);
                          } else if (e.key === 'Escape') {
                            // Swallow so Radix doesn't close the popover.
                            e.preventDefault();
                            e.stopPropagation();
                            cancelEdit();
                          }
                        }}
                        placeholder="Untitled chat"
                        className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-1.5 py-0.5 text-[12px] font-medium text-foreground focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveView(s.id);
                          setOpen(false);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          {unread && (
                            <span
                              aria-hidden
                              className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
                            />
                          )}
                          <span
                            className={cn(
                              'truncate text-[12px] text-foreground',
                              unread ? 'font-semibold' : 'font-medium',
                            )}
                          >
                            {s.label ?? 'Untitled chat'}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-muted-foreground/75">
                          {unread && <span className="text-primary">Unread · </span>}
                          {s.status === 'archived' ? 'Archived' : 'Active'} · {formatWhen(latestActivityAt(s) ?? s.startedAt)}
                        </div>
                      </button>
                    )}
                    {!isEditing && (
                      <button
                        type="button"
                        title="Rename chat"
                        aria-label="Rename chat"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(s.id, s.label);
                        }}
                        className="flex-shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                    {s.isCurrent && !isEditing && (
                      <Check size={12} className="flex-shrink-0 text-primary" strokeWidth={3} />
                    )}
                  </div>
                );
              })
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
