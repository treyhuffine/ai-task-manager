'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Plus, X, History as HistoryIcon, Loader2, Check } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { generateKeyBetween } from 'fractional-indexing';
import {
  useExecutionChats,
  useCloseExecutionChat,
  useUpdateSession,
} from '@/hooks/use-execution';
import { sessionsApi, type ExecutionChatHistoryEntry } from '@/lib/api/sessions';
import { useDashboard } from '@/contexts/dashboard-context';
import { isSessionUnread, latestActivityAt } from '@/lib/utils/session-sort';
import { backfillSortKeys } from '@/lib/utils/bucket-placement';
import { timestampEpoch } from '@/lib/utils/timestamps';
import { cn } from '@/lib/utils';

type ChatHistoryData = { sessions: ExecutionChatHistoryEntry[] };

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Total order for the open tabs. Manually-ordered tabs (a `tabSortKey`,
 * a fractional index) sort first among themselves; unordered tabs — a
 * brand-new chat before it's ever been dragged — fall to the right in
 * creation order. Once anything is dragged the whole visible set gets
 * backfilled keys, so the mixed state is transient.
 */
function byTabOrder(a: ExecutionChatHistoryEntry, b: ExecutionChatHistoryEntry): number {
  const ak = a.tabSortKey;
  const bk = b.tabSortKey;
  if (ak != null && bk != null) return ak < bk ? -1 : ak > bk ? 1 : 0;
  if (ak != null) return -1;
  if (bk != null) return 1;
  return timestampEpoch(a.startedAt) - timestampEpoch(b.startedAt);
}

/**
 * Chat tab strip — THE management surface for an execution's chats. Sits
 * between the execution HUD and the transcript in both the mobile and
 * desktop subtrees. Parallel chats on one worktree are the normal working
 * mode ("new chat" never closes anything), so the strip is always visible
 * for execution chats, like a browser's tab bar.
 *
 * - One tab per open (non-archived) chat plus the chat being viewed. Click
 *   switches; a switch never disturbs the worktree, terminal, or pane
 *   layout (those are execution-keyed, not chat-keyed). Drag to reorder —
 *   the manual order persists (`tabSortKey`, fractional index).
 * - Emerald pulse = agent actively working that chat (executor turn
 *   state). Primary dot + semibold = unread activity since last view.
 * - X closes: harness torn down, row archived. Closing the current tab
 *   lands on the most recent open sibling first. A lone tab has no X.
 * - Double-click a tab to rename the chat (`chat_sessions.label` — never
 *   the execution's title, which is edited in the header).
 * - The trailing history chip opens a COMPLETE jump-list of every chat on
 *   this execution (open tabs included, current one marked), so navigating
 *   from it never removes a chat from the list. Opening an archived chat
 *   there reactivates it via the view's auto-resume, graduating it back
 *   into a tab.
 *
 * Freshness: the chat list is keyed by EXECUTION, so switching chats reuses
 * one stable cache entry (no blank flash, no per-chat duplicate queries) and
 * `isCurrent` is recomputed here from the viewed `sessionId`. The global
 * session stream invalidates it on any session change, with a 30s poll as
 * belt-and-suspenders for the executor's in-memory `running` flag.
 *
 * Mounted twice by design (mobile + desktop subtrees, see
 * project_composer_double_mount). Both instances observe the same query,
 * and edit state is per-instance + interaction-driven, so the hidden
 * mount stays inert.
 */
export function ExecutionChatTabs({
  sessionId,
  executionId,
  onNewChat,
  newChatPending,
}: {
  /** The chat currently being viewed. */
  sessionId: string;
  /** The execution these chats belong to (stable across chat switches). */
  executionId: string;
  onNewChat?: () => void;
  newChatPending?: boolean;
}) {
  const { setActiveView } = useDashboard();
  const qc = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data } = useExecutionChats(executionId, sessionId, { refetchInterval: 30_000 });
  const closeChat = useCloseExecutionChat();
  const updateSession = useUpdateSession();

  // Inline rename (double-click a tab). `editingId` is the chat being
  // renamed; `draft` holds the in-flight text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const sensors = useSensors(
    // Small drag starts a reorder; a plain click (no movement) still
    // switches, and a double-click still renames.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Warm EVERY sibling chat's full session row on mount so navigating to
  // one — a tab click or a pick from the history menu — switches instantly.
  // A cold session row makes ExecutionView drop to its full-view skeleton
  // AND makes the worktree-scoped panels (file tree, viewer, terminal)
  // blank to their "no scope yet" state until `useSession` resolves the
  // execution id — which reads as the whole session reloading. Archived
  // chats are prefetched here too (not lazily on menu-open) so a dropdown
  // pick gets the same generous lead time a tab does; warming only on
  // menu-open raced the click on slower machines. Prefetch dedupes by key,
  // so the double mount and repeated renders are harmless.
  const prefetchIds = [
    ...new Set((data?.sessions ?? []).filter((s) => s.id !== sessionId).map((s) => s.id)),
  ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const cid of prefetchIds) {
      void qc.prefetchQuery({
        queryKey: ['session', cid],
        queryFn: () => sessionsApi.get(cid),
        staleTime: 30_000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchIds.join(','), sessionId]);

  if (!data) return null;

  // `isCurrent` is recomputed from the viewed chat rather than trusted from
  // the server response — the cache entry is shared across every chat of
  // the execution, so the server's per-request flag would be stale for all
  // but whichever chat happened to fetch it.
  const entries = data.sessions.map((s) => ({ ...s, isCurrent: s.id === sessionId }));
  const open = entries.filter((s) => s.status === 'active' || s.isCurrent);
  const tabs = [...open].sort(byTabOrder);
  const dragEnabled = tabs.length > 1;

  // The dropdown is a COMPLETE jump-list of every chat on this execution —
  // open tabs included — so navigating to one never drops it from the list
  // (the prior version listed only archived chats, and opening one made it
  // vanish). Server order is hotness, which reads as a "recent chats" menu.
  // Shown whenever there's more than one chat to jump between.
  const showMenu = entries.length > 1;
  const menuUnread = entries.some((s) => !s.isCurrent && isSessionUnread(s));

  const handleClose = (entry: ExecutionChatHistoryEntry) => {
    if (entry.isCurrent) {
      // Land on the most recent remaining open chat BEFORE archiving the
      // one being viewed, so the view never points at a closed chat (the
      // auto-resume would just flip it right back on).
      const fallback = tabs.filter((t) => t.id !== entry.id).at(-1);
      if (!fallback) return;
      setActiveView(fallback.id);
    }
    closeChat.mutate(entry.id);
  };

  const commitRename = (id: string, current: string | null) => {
    const next = draft.trim() || null;
    setEditingId(null);
    setDraft('');
    if (next === (current ?? null)) return; // no-op
    updateSession.mutate(
      { id, label: next },
      // The hook invalidates ['session', id]; the strip reads the
      // execution chat-list projection, so refresh that too.
      {
        onSuccess: () =>
          qc.invalidateQueries({
            predicate: (q) => q.queryKey[0] === 'execution' && q.queryKey[2] === 'chats',
          }),
      },
    );
  };

  const cacheKey = ['execution', executionId, 'chats'] as const;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex((t) => t.id === active.id);
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Backfill any null keys in the current visible order first, so the
    // moved tab lands between two real neighbors (generateKeyBetween(null,
    // null) would collide across drags). Mirrors the task-list reorder.
    const keyed = tabs.map((t) => ({ id: t.id, sortKey: t.tabSortKey }));
    const normalized = backfillSortKeys(keyed);
    const normPatches: { id: string; sortKey: string }[] = [];
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].tabSortKey !== normalized[i].sortKey) {
        normPatches.push({ id: tabs[i].id, sortKey: normalized[i].sortKey! });
      }
    }

    const reordered = arrayMove(normalized, oldIndex, newIndex);
    const prevKey = newIndex > 0 ? reordered[newIndex - 1].sortKey : null;
    const nextKey = newIndex < reordered.length - 1 ? reordered[newIndex + 1].sortKey : null;
    const movedKey = generateKeyBetween(prevKey, nextKey);
    const movedId = active.id as string;

    // Optimistic: write the new keys into the shared execution chat-list
    // cache so the strip re-sorts instantly. Roll back on error.
    const nextKeys = new Map<string, string>();
    normPatches.forEach((p) => nextKeys.set(p.id, p.sortKey));
    nextKeys.set(movedId, movedKey);
    const prevData = qc.getQueryData<ChatHistoryData>(cacheKey);
    qc.setQueryData<ChatHistoryData>(cacheKey, (old) =>
      old
        ? {
            sessions: old.sessions.map((s) =>
              nextKeys.has(s.id) ? { ...s, tabSortKey: nextKeys.get(s.id)! } : s,
            ),
          }
        : old,
    );

    const patches = [...normPatches.filter((p) => p.id !== movedId), { id: movedId, sortKey: movedKey }];
    Promise.all(patches.map((p) => sessionsApi.update(p.id, { tabSortKey: p.sortKey })))
      .then(() =>
        qc.invalidateQueries({
          predicate: (q) => q.queryKey[0] === 'execution' && q.queryKey[2] === 'chats',
        }),
      )
      .catch(() => {
        if (prevData) qc.setQueryData(cacheKey, prevData);
      });
  };

  return (
    <div className="flex h-9 flex-shrink-0 items-center gap-0.5 border-b border-border bg-background px-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((s) => (
              <ChatTab
                key={s.id}
                entry={s}
                canClose={tabs.length > 1}
                dragEnabled={dragEnabled}
                closing={closeChat.isPending}
                editing={editingId === s.id}
                draft={draft}
                onDraftChange={setDraft}
                onCommitRename={() => commitRename(s.id, s.label)}
                onCancelRename={() => {
                  setEditingId(null);
                  setDraft('');
                }}
                onStartRename={() => {
                  setEditingId(s.id);
                  setDraft(s.label ?? '');
                }}
                onActivate={() => {
                  if (!s.isCurrent) setActiveView(s.id);
                }}
                onClose={() => handleClose(s)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {onNewChat && (
          <button
            type="button"
            onClick={onNewChat}
            disabled={newChatPending}
            title="New chat on this worktree"
            aria-label="New chat"
            className="ml-0.5 inline-flex size-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          >
            {newChatPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          </button>
        )}
      </div>

      {showMenu && (
        <PopoverPrimitive.Root open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              title="All chats"
              aria-label="All chats"
              className="ml-1 flex h-7 flex-shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <HistoryIcon size={11} />
              <span>{entries.length}</span>
              {menuUnread && (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              className="z-50 max-h-[320px] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl outline-none"
            >
              <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                All chats
              </div>
              {entries.map((s) => {
                const unread = !s.isCurrent && isSessionUnread(s);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if (!s.isCurrent) setActiveView(s.id);
                      setHistoryOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      s.isCurrent ? 'bg-primary/10' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                      <span className="flex w-full items-center gap-1.5">
                        {unread && (
                          <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                        )}
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-[12px] text-foreground',
                            unread ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {s.label ?? 'Untitled chat'}
                        </span>
                        {s.running && (
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-emerald-500"
                          />
                        )}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground/75">
                        {s.isCurrent ? (
                          'Current'
                        ) : (
                          <>
                            {unread && <span className="text-primary">Unread · </span>}
                            {s.status === 'archived' && 'Archived · '}
                            {formatWhen(latestActivityAt(s) ?? s.startedAt)}
                          </>
                        )}
                      </span>
                    </span>
                    {s.isCurrent && (
                      <Check size={12} className="flex-shrink-0 text-primary" strokeWidth={3} />
                    )}
                  </button>
                );
              })}
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      )}
    </div>
  );
}

function ChatTab({
  entry,
  canClose,
  dragEnabled,
  closing,
  editing,
  draft,
  onDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onActivate,
  onClose,
}: {
  entry: ExecutionChatHistoryEntry;
  canClose: boolean;
  dragEnabled: boolean;
  closing: boolean;
  editing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onActivate: () => void;
  onClose: () => void;
}) {
  // The chat you're looking at can't be unread — opening it is the read
  // receipt, and the mark-read write lands a beat later than this render,
  // so trust `isCurrent` over `lastViewedAt`.
  const unread = !entry.isCurrent && isSessionUnread(entry);
  const label = entry.label ?? 'Untitled chat';
  const tooltip = [
    label,
    entry.running ? 'Working' : null,
    formatWhen(latestActivityAt(entry) ?? entry.startedAt),
  ]
    .filter(Boolean)
    .join(' · ');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled: !dragEnabled || editing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        'group flex h-7 flex-shrink-0 items-center rounded transition-colors',
        entry.isCurrent
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        isDragging && 'z-10 opacity-60 shadow-lg',
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={120}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onCancelRename();
            }
          }}
          placeholder="Untitled chat"
          className="mx-1 w-36 rounded border border-primary/40 bg-background px-1.5 py-0.5 text-[12px] font-medium text-foreground focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onActivate}
          onDoubleClick={onStartRename}
          title={tooltip}
          // Drag the tab by its body (like a browser tab). MouseSensor's
          // 5px activation lets a plain click/double-click through.
          {...listeners}
          className={cn(
            'flex h-full min-w-0 touch-none items-center gap-1.5 pl-2 text-[12px] font-medium',
            canClose ? 'pr-1' : 'pr-2',
            dragEnabled && 'cursor-grab active:cursor-grabbing',
          )}
        >
          {unread && (
            <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
          )}
          <span className={cn('max-w-[9rem] truncate', unread && 'font-semibold')}>{label}</span>
          {entry.running && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-emerald-500"
            />
          )}
        </button>
      )}
      {canClose && !editing && (
        <button
          type="button"
          onClick={onClose}
          disabled={closing}
          title="Close chat"
          aria-label="Close chat"
          className={cn(
            'mr-1 inline-flex size-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
            !entry.isCurrent && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}
