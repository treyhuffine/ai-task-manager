'use client';

import type { ReactNode } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { BACKGROUND_DOT, BACKGROUND_LABEL, UNREAD_WITH_BACKGROUND_DOT } from './activity-style';
import { Tip } from '@/components/ui/tip';

/** What a chat is doing, as the rail's rows draw it. */
export interface ChatStatus {
  /** A turn is running. */
  isStreaming: boolean;
  /** Blocked on the user: a permission prompt or a question. */
  isPending: boolean;
  /** Something new since it was last looked at. */
  isUnread: boolean;
  /** The turn is over but something it started is still running. */
  isBackground: boolean;
}

/**
 * A rail session's status, read the same way by every row (the agent tree,
 * Pinned, Needs you, Recent). Archived work has none: nothing runs and nothing
 * waits there.
 *
 * Unread uses the shared rule (`isSessionUnread`), so "Mark as unread" and a
 * fresh outcome both count. A session streaming right now isn't flagged
 * unread: you're watching it happen.
 */
export function useChatStatus(session: Parameters<typeof isSessionUnread>[0] & { id: string; status: string }): ChatStatus {
  const { streamingSessionIds, pendingInputSessionIds, backgroundSessionIds } = useDashboard();
  if (session.status !== 'active') {
    return { isStreaming: false, isPending: false, isUnread: false, isBackground: false };
  }
  const isStreaming = streamingSessionIds.has(session.id);
  return {
    isStreaming,
    isPending: pendingInputSessionIds.has(session.id),
    isUnread: !isStreaming && isSessionUnread(session),
    isBackground: !isStreaming && backgroundSessionIds.has(session.id),
  };
}

/** Anything to show: the dot draws nothing (or `idle`) otherwise. */
export function hasChatStatus({ isStreaming, isPending, isUnread, isBackground }: ChatStatus): boolean {
  return isStreaming || isPending || isUnread || isBackground;
}

/**
 * The status dot, so a vertical scan picks out hot rows by color before
 * reading any text. One per state, never alike:
 *
 *   - needs input: amber, pulsing. Wins over working: the agent is alive but
 *     blocked on you, so green would lie.
 *   - working: green, pulsing.
 *   - unread: amber (with a sky ring when background work also runs).
 *   - background: a sky ring, never pulsing (activity-style.ts).
 *
 * Idle draws `idle` (the tree's branch glyph) or nothing.
 */
export function StatusPip({ isStreaming, isPending, isUnread, isBackground, idle = null }: ChatStatus & { idle?: ReactNode }) {
  if (isPending) {
    return (
      <Tip label="Needs input">
        <span
          aria-label="needs input"
          className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0"
        />
      </Tip>
    );
  }
  if (isStreaming) {
    return (
      <Tip label="Working">
        <span
          aria-label="working"
          className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"
        />
      </Tip>
    );
  }
  if (isUnread) {
    return (
      <Tip label={isBackground ? `Unread · ${BACKGROUND_LABEL}` : 'Unread'}>
        <span
          aria-label={isBackground ? `unread, ${BACKGROUND_LABEL.toLowerCase()}` : 'unread'}
          className={cn('w-2 h-2 flex-shrink-0', isBackground ? UNREAD_WITH_BACKGROUND_DOT : 'rounded-full bg-amber-500')}
        />
      </Tip>
    );
  }
  if (isBackground) {
    return (
      <Tip label={BACKGROUND_LABEL}>
        <span
          aria-label={BACKGROUND_LABEL.toLowerCase()}
          className={cn('w-2 h-2 flex-shrink-0', BACKGROUND_DOT)}
        />
      </Tip>
    );
  }
  return <>{idle}</>;
}
