"use client";

import { MessageSquare, Bot, Plus, Layers3, MoreHorizontal } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useNeedsReviewSessions } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import type { MobileTab } from '@/types/dashboard';

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

  // Three signals worth surfacing on the Agents tab:
  //   - pending    → an execution is blocked on a user response
  //   - working    → at least one execution is mid-turn
  //   - to review  → executions with output the user hasn't seen yet
  // Priority pending > working > review matches the header pill and
  // session row pip: an agent waiting on you outranks an agent
  // working, which outranks output you haven't read yet.
  const pendingCount = pendingInputSessionIds.size;
  // Don't double-count: a streaming session that's also pending shows
  // under "pending," not "working."
  const workingCount = Array.from(streamingSessionIds).filter(
    (id) => !pendingInputSessionIds.has(id),
  ).length;
  const reviewCount = (needsReview ?? []).filter(
    (s) => pendingInputSessionIds.has(s.id) || !streamingSessionIds.has(s.id),
  ).length;
  const badgeKind: 'pending' | 'working' | 'review' | null =
    pendingCount > 0 ? 'pending' : workingCount > 0 ? 'working' : reviewCount > 0 ? 'review' : null;
  const badgeCount =
    badgeKind === 'pending' ? pendingCount : badgeKind === 'working' ? workingCount : reviewCount;

  return (
    <nav className="flex-shrink-0 border-t border-border bg-background flex items-end justify-around px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] select-none">
      {TABS.map((tab) => {
        const isCreate = tab.id === 'create';
        const isActive = !isCreate && mobileTab === tab.id;

        if (isCreate) {
          return (
            <button
              key={tab.id}
              onClick={() => setMobileCreateOpen(true)}
              className="flex items-center justify-center -mt-3 w-12 h-12 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95 transition-transform"
            >
              <Plus size={22} strokeWidth={2.5} />
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            onClick={() => {
              setMobileTab(tab.id);
              // Tapping Agents always returns to the workspaces list.
              // Without this, if an execution is active the layout keeps
              // showing it (mobileTab is already 'agents'), making the tap
              // feel inert.
              if (tab.id === 'agents') {
                setActiveView('command');
              }
            }}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] transition-colors relative',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <div className="relative">
              <tab.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              {tab.id === 'agents' && badgeKind && (
                <div
                  className={cn(
                    'absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full text-[7px] font-bold text-white flex items-center justify-center ring-2 ring-background',
                    badgeKind === 'working'
                      ? 'bg-emerald-500 animate-pulse'
                      : badgeKind === 'pending'
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-amber-500',
                  )}
                >
                  {badgeCount}
                </div>
              )}
            </div>
            <span className={cn(
              'text-[9px] font-medium',
              isActive && 'font-bold'
            )}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
