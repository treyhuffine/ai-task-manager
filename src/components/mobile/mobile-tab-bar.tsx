"use client";

import { MessageSquare, Bot, Plus, Layers3, MoreHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useNeedsReviewSessions, useRailSessions } from '@/hooks/use-workspaces';
import { useInactivity } from '@/hooks/use-inactivity';
import { executionActivity } from '@/components/workspaces/bucket-config';
import { cn } from '@/lib/utils';
import type { MobileTab } from '@/types/dashboard';
import { HOME_VIEW } from '@/lib/client/active-view';

const TABS: { id: MobileTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'create', label: '', icon: Plus },
  { id: 'deck', label: 'Deck', icon: Layers3 },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function MobileTabBar() {
  const {
    mobileTab,
    setMobileTab,
    setActiveView,
    setMobileCreateOpen,
    streamingSessionIds,
    pendingInputSessionIds,
  } = useDashboard();
  const { data: needsReview } = useNeedsReviewSessions();
  const { data: rail } = useRailSessions();
  // Inactive work is folded out of the lists, so it doesn't badge either.
  const { isInactive } = useInactivity();

  // Three signals worth surfacing on the Agents tab:
  //   - pending    → an execution is blocked on a user response
  //   - working    → at least one execution is mid-turn
  //   - to review  → executions with output the user hasn't seen yet
  // Priority pending > working > review matches the header pill and
  // session row pip: an agent waiting on you outranks an agent
  // working, which outranks output you haven't read yet. Only executions
  // count, as on the desktop pills: the live sets also hold the main chat.
  const { pending: pendingCount, working: workingCount } = useMemo(
    () =>
      executionActivity(
        (rail?.sessions ?? []).filter((s) => !isInactive(s)),
        pendingInputSessionIds,
        streamingSessionIds,
      ),
    [rail?.sessions, pendingInputSessionIds, streamingSessionIds, isInactive],
  );
  const reviewCount = (needsReview ?? []).filter(
    (s) => (pendingInputSessionIds.has(s.id) || !streamingSessionIds.has(s.id)) && !isInactive(s),
  ).length;
  const reviewAttention = rail?.resultReviewAttention ?? [];
  const resultPending = reviewAttention.filter((review) => rail?.pendingSessionIds.includes(review.sessionId)).length;
  const resultWorking = reviewAttention.filter((review) => !rail?.pendingSessionIds.includes(review.sessionId) && (review.status === 'queued' || review.status === 'running')).length;
  const resultFailed = reviewAttention.filter((review) => review.status === 'failed').length;
  const badgeKind: 'pending' | 'working' | 'review' | null =
    pendingCount + resultPending > 0 ? 'pending' : workingCount + resultWorking > 0 ? 'working' : reviewCount + resultFailed > 0 ? 'review' : null;
  const badgeCount =
    badgeKind === 'pending' ? pendingCount + resultPending : badgeKind === 'working' ? workingCount + resultWorking : reviewCount + resultFailed;

  return <HomePhoneBar tabs={TABS.map(tab => ({ ...tab, active: tab.id === mobileTab,
    onClick: () => { if (tab.id === 'create') setMobileCreateOpen(true); else { setMobileTab(tab.id); if (tab.id === 'agents') setActiveView(HOME_VIEW); } },
    ...(tab.id === 'agents' && badgeKind ? { badge: { count: badgeCount, kind: badgeKind } } : {}),
  }))}/>;
}

/** Common phone navigation with destination and creation controls supplied by its Home. */
export function HomePhoneBar({ tabs }: { tabs: { id: string; label: string; ariaLabel?: string; icon: typeof Plus; active?: boolean; onClick: () => void; badge?: { count: number; kind: 'working' | 'pending' | 'review' } }[] }) {
  return <nav aria-label="Home" className="flex shrink-0 select-none items-end justify-around border-t border-border bg-background px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
    {tabs.map(tab => tab.id === 'create' ? <button key={tab.id} aria-label={tab.ariaLabel ?? 'Create'} onClick={tab.onClick} className="-mt-3 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95"><Plus size={22} strokeWidth={2.5}/></button>
      : <button key={tab.id} onClick={tab.onClick} aria-current={tab.active ? 'page' : undefined} className={cn('relative flex min-w-[48px] flex-col items-center gap-0.5 px-2 py-2', tab.active ? 'text-primary' : 'text-muted-foreground')}><div className="relative"><tab.icon size={20} strokeWidth={tab.active ? 2.2 : 1.8}/>{tab.badge && <span className={cn('absolute -right-1.5 -top-1 flex size-3.5 items-center justify-center rounded-full text-[7px] font-bold text-white ring-2 ring-background', tab.badge.kind === 'working' ? 'animate-pulse bg-emerald-500' : 'bg-amber-500')}>{tab.badge.count}</span>}</div><span className={cn('text-[9px] font-medium', tab.active && 'font-bold')}>{tab.label}</span></button>)}
  </nav>;
}
