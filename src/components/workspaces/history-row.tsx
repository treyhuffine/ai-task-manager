'use client';

import { GitBranch, Pin } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { coverAttachmentUrl } from '@/lib/attachments/view';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { splitHighlight } from '@/lib/search/highlight';
import { cn } from '@/lib/utils';
import type { RailSession } from '@/lib/api/sessions';
import { hasChatStatus, StatusPip, useChatStatus } from './chat-status';
import { SessionRowMenu } from './session-row-menu';
import { useSessionRowHover } from './session-hover-context';
import { executionView } from '@/lib/client/active-view';

interface HistoryRowProps {
  session: RailSession;
  /** When set (search results), renders a highlighted transcript snippet
   *  beneath the workspace/branch line. Match terms are wrapped in the
   *  `@/lib/search/highlight` sentinels. */
  snippet?: string | null;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  onOpenLauncher?: (workspaceId: string) => void;
}

/**
 * One row in the rail's Recent tab. Two-line layout:
 *
 *   Line 1 — execution label (bold when unread), with the right-edge date.
 *   Line 2 — workspace name · branch.
 *
 * The avatar carries the workspace identity so a vertical scan parses
 * "which project did this work happen in" before reading the label, and its
 * corner carries the chat's status, the same dot as the agent tree (needs
 * input, working, unread, background). No diff stats: in the rail they don't
 * help decide where to go, they live in the execution's header.
 *
 * Archived sessions render muted but still navigable so the user can
 * jump back into past work; the row's `isArchived` flag just tones the
 * left edge so the eye reads the active rows first. They carry no status.
 */
export function HistoryRow({
  session,
  snippet,
  onOpenWorkspaceSettings,
  onOpenLauncher,
}: HistoryRowProps) {
  const { activeSessionId, setActiveView } = useDashboard();
  const status = useChatStatus(session);
  const { rowRef, onMouseEnter, onMouseLeave, closeNow } = useSessionRowHover(session.id);

  const isActive = activeSessionId === session.id;
  const isArchived = session.status === 'archived';
  // Only active executions live in the rail, so only they can be pinned.
  // Archived rows carry a cleared pin and hide the Pin menu item entirely.
  const isPinned = !isArchived && !!session.execution?.pinnedAt;

  const handleOpen = () => {
    closeNow();
    setActiveView(executionView(session.id));
  };

  const label = sessionDisplayLabel(session);
  const labelIsPlaceholder = !(session.label ?? session.execution?.label);

  const wsName = session.workspaceName ?? 'Agent removed';
  const wsImage = coverAttachmentUrl(session.workspaceAttachments);
  const wsEmoji = session.workspaceEmoji;
  const branch = session.branchName;

  const timestamp = sessionRankedAt(session);

  return (
    <div
      ref={rowRef}
      onClick={handleOpen}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className={cn(
        'relative group flex items-start gap-1.5 px-2 py-1.5 rounded-md transition-colors text-left cursor-pointer',
        isActive ? 'bg-secondary' : 'hover:bg-muted/40',
        isArchived && !isActive && 'opacity-60',
      )}
    >
      <span className="relative flex-shrink-0">
        <WorkspaceAvatar wsImage={wsImage} wsEmoji={wsEmoji} wsName={wsName} />
        {hasChatStatus(status) && (
          // A disc of the row's background keeps the dot legible on any avatar.
          <span className="absolute -top-1 -right-1 flex rounded-full bg-background p-[2px]">
            <StatusPip {...status} />
          </span>
        )}
      </span>

      <div className="flex-1 min-w-0 leading-tight">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'flex-1 text-[11.5px] truncate',
              labelIsPlaceholder
                ? 'italic text-muted-foreground/70'
                : 'font-medium text-foreground/90',
              status.isUnread && !labelIsPlaceholder && 'font-semibold text-foreground',
            )}
          >
            {label}
          </span>
          <span className="text-[9px] text-muted-foreground/60 flex-shrink-0 transition-opacity group-hover:opacity-0 group-has-data-[state=open]:opacity-0">
            {formatCompactRelative(timestamp)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[9.5px] text-muted-foreground/70 mt-0.5 min-w-0">
          {isPinned && (
            <Pin size={9} className="fill-current text-muted-foreground/50 flex-shrink-0 -rotate-45" aria-label="Pinned" />
          )}
          <span className="truncate">{wsName}</span>
          {branch && (
            <span className="flex items-center gap-0.5 truncate min-w-0">
              <GitBranch size={8} className="opacity-60 flex-shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          )}
        </div>
        {snippet && <SearchSnippet snippet={snippet} />}
      </div>

      <SessionRowMenu
        sessionId={session.id}
        workspaceId={session.workspaceId ?? null}
        isUnread={status.isUnread || status.isPending}
        isPinned={isArchived ? undefined : isPinned}
        label={label}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onOpenLauncher={onOpenLauncher}
        className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
}

/**
 * A chat's name in history and search: one-per-chat, so prefer the chat's own
 * label (sibling chats on one execution stay distinguishable), falling back
 * to the execution title for a brand-new chat whose label hasn't been
 * derived yet.
 */
export function sessionDisplayLabel(session: RailSession): string {
  return session.label ?? session.execution?.label ?? 'Untitled';
}

/**
 * The instant a history row is ranked by, which is also the one it displays,
 * so a session that sorts to Today never reads "3 weeks ago" next to its own
 * position.
 */
export function sessionRankedAt(session: RailSession): string | null {
  return session.lastActivityAt ?? session.lastOutcomeEventAt ?? session.startedAt;
}

/**
 * Transcript snippet line for search results. Splits on the highlight
 * sentinels and wraps matched terms so the reason this row matched is obvious
 * at a glance. Two-line clamp keeps rows scannable.
 */
export function SearchSnippet({ snippet }: { snippet: string }) {
  const segments = splitHighlight(snippet);
  return (
    <p className="mt-0.5 text-[9.5px] leading-snug text-muted-foreground/75 line-clamp-2">
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <mark
            key={i}
            className="rounded-[2px] bg-primary/20 px-0.5 text-foreground/90"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

function initialsFor(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '·';
  const words = cleaned.split(/\s+/);
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

/**
 * An agent's picture: its cover, else its emoji, else its initials. `sm` is
 * for one-line chips and menu items (chat search's agent filter). The default
 * sits a pixel low to line up with a two-line row's title.
 */
export function WorkspaceAvatar({
  wsImage,
  wsEmoji,
  wsName,
  size = 'md',
}: {
  wsImage: string | null;
  wsEmoji: string | null;
  wsName: string;
  size?: 'sm' | 'md';
}) {
  const sm = size === 'sm';
  return (
    <span
      className={cn(
        'relative flex items-center justify-center flex-shrink-0',
        sm ? 'w-4 h-4' : 'w-5 h-5 mt-px',
      )}
    >
      {wsImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wsImage} alt="" className={cn('object-cover', sm ? 'w-4 h-4 rounded-sm' : 'w-5 h-5 rounded')} />
      ) : wsEmoji ? (
        <span className={cn('leading-none', sm ? 'text-[12px]' : 'text-base')}>{wsEmoji}</span>
      ) : (
        <span
          aria-hidden
          className={cn(
            'flex items-center justify-center font-bold tracking-wide bg-muted text-muted-foreground',
            sm ? 'w-4 h-4 rounded-sm text-[7px]' : 'w-5 h-5 rounded text-[9px]',
          )}
        >
          {initialsFor(wsName)}
        </span>
      )}
    </span>
  );
}
