"use client";

import { useMemo, useState } from 'react';
import { Inbox, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTasks, useTaskAttention } from '@/hooks/use-tasks';
import { useProposedDecisions } from '@/hooks/use-stream';
import { useDashboard } from '@/contexts/dashboard-context';
import { CurrentWorkSection } from './current-work-section';
import { DeckStack } from './deck-stack';
import { DeckAddComposer } from './deck-add-composer';
import type { DeckItem } from '@/types/dashboard';
import type { TaskRecord } from '@/db/types';

interface DeckFocusedViewProps {
  items: DeckItem[];
  framing?: string;
  onComplete: (id: string) => void;
  onStart: (id: string) => void;
  onNotToday: (id: string) => void;
  onFocus?: (id: string) => void;
  onReorder: (items: DeckItem[]) => void;
  onSubtaskComplete: (itemId: string, subtaskId: string) => void;
  onSubtaskDefer: (itemId: string, subtaskId: string) => void;
  onSubtaskFocus?: (itemId: string, subtaskId: string) => void;
  onTaskCreated: (task: TaskRecord) => void;
}

/**
 * The Deck's "focused" layout (trial, behind Settings > Deck layout).
 *
 * Same ranked stack as classic — flat, nothing singled out, nothing collapsed
 * (work is parallel in the agent world, so there is no one "hero" task). What
 * this layout does is strip the surrounding console: the status that used to
 * occupy full sections (in-progress work, triage) folds into a compact ribbon
 * one tap away, and the quick-add composer sits inline. Urgent hard deadlines
 * are untouched — they render in the always-on DeadlineBand above this view.
 */
export function DeckFocusedView({
  items,
  framing,
  onComplete,
  onStart,
  onNotToday,
  onFocus,
  onReorder,
  onSubtaskComplete,
  onSubtaskDefer,
  onSubtaskFocus,
  onTaskCreated,
}: DeckFocusedViewProps) {
  const [workOpen, setWorkOpen] = useState(false);

  // Ribbon counts. These queries share their keys with CurrentWorkSection and
  // DeckTriagePrompt, so React Query serves them from cache — no extra fetch.
  const { data: inProgress } = useTasks({ status: 'in_progress', orderBy: 'sortKey' });
  const inProgressIds = useMemo(() => (inProgress ?? []).map((t) => t.id), [inProgress]);
  const { data: attention } = useTaskAttention(inProgressIds);
  const reviewCount = useMemo(
    () => inProgressIds.filter((id) => attention?.[id]?.review).length,
    [inProgressIds, attention],
  );
  const inProgressCount = inProgress?.length ?? 0;

  const { data: proposals } = useProposedDecisions();
  const triageCount = proposals?.length ?? 0;

  const { setPanelTab, focusedPanel } = useDashboard();
  const openTriage = () => setPanelTab(focusedPanel, 'stream');

  return (
    <div className="px-4 py-3">
      {framing && (
        <p className="mb-3 text-xs italic leading-relaxed text-muted-foreground">{framing}</p>
      )}

      {/* Quick add — inline, always available. */}
      <div className="mb-3">
        <DeckAddComposer variant="persistent" onTaskCreated={onTaskCreated} />
      </div>

      {/* Ribbon: status folded to a tap, not a section. */}
      {(inProgressCount > 0 || triageCount > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {inProgressCount > 0 && (
            <RibbonChip
              active={workOpen}
              onClick={() => setWorkOpen((o) => !o)}
              icon={<Activity size={12} />}
            >
              <span className="text-violet-600 dark:text-violet-400">{inProgressCount}</span> in progress
              {reviewCount > 0 && (
                <span className="text-muted-foreground"> · {reviewCount} to review</span>
              )}
            </RibbonChip>
          )}
          {triageCount > 0 && (
            <RibbonChip onClick={openTriage} icon={<Inbox size={12} />}>
              {triageCount} to triage
            </RibbonChip>
          )}
        </div>
      )}

      {/* In-progress work, revealed on demand from the ribbon. */}
      {workOpen && inProgressCount > 0 && (
        <div className="mb-3">
          <CurrentWorkSection />
        </div>
      )}

      {/* The ranked stack — flat and whole. Nothing is the "top" task. */}
      {items.length > 0 ? (
        <DeckStack
          items={items}
          onComplete={onComplete}
          onStart={onStart}
          onNotToday={onNotToday}
          onFocus={onFocus}
          onReorder={onReorder}
          onSubtaskComplete={onSubtaskComplete}
          onSubtaskDefer={onSubtaskDefer}
          onSubtaskFocus={onSubtaskFocus}
        />
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">Nothing queued right now</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Add a task above to start today&apos;s deck.
          </p>
        </div>
      )}
    </div>
  );
}

function RibbonChip({
  children,
  icon,
  onClick,
  active,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
        active
          ? 'border-border bg-muted text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span>{children}</span>
    </button>
  );
}
