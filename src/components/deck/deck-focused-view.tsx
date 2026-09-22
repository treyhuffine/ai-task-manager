"use client";

import { useMemo, useState } from 'react';
import { Inbox, Activity, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTasks, useTaskAttention } from '@/hooks/use-tasks';
import { useProposedDecisions } from '@/hooks/use-stream';
import { useDashboard } from '@/contexts/dashboard-context';
import { summarizeDeckChanges } from '@/lib/deck/change-summary';
import { CurrentWorkSection } from './current-work-section';
import { DeckStack } from './deck-stack';
import { DeckAddBar } from './deck-add-bar';
import { DeckVersionList, type DeckVersionSummary } from './deck-change-brief';
import type { DeckItem, DeckChangeView } from '@/types/dashboard';
import type { TaskRecord } from '@/db/types';
import type { TaskListDTO } from '@/lib/api/dto/entity-list';

interface DeckFocusedViewProps {
  items: DeckItem[];
  framing?: string;
  /** This deck version's change log — summarized as quiet header meta. */
  changes: DeckChangeView[];
  /** Today's deck versions — the revert escape hatch behind "Versions". */
  versions: DeckVersionSummary[];
  currentDeckId?: string;
  onRevert: (deckId: string) => void;
  onComplete: (id: string) => void;
  onStart: (id: string) => void;
  onNotToday: (id: string) => void;
  onFocus?: (id: string) => void;
  onReorder: (items: DeckItem[]) => void;
  onSubtaskComplete: (itemId: string, subtaskId: string) => void;
  onSubtaskDefer: (itemId: string, subtaskId: string) => void;
  onSubtaskFocus?: (itemId: string, subtaskId: string) => void;
  onTaskCreated: (task: TaskRecord) => void;
  /** Task ids already on the deck — excluded from the add bar's match list. */
  excludeIds: Set<string>;
  /** Pull an existing task onto the deck (from the add bar's match list). */
  onAddExisting: (task: TaskListDTO) => void;
}

/**
 * The Deck's "focused" layout (trial, behind Settings > Deck layout).
 *
 * Same ranked stack as classic — flat, nothing singled out, nothing collapsed
 * (work is parallel in the agent world, so there is no one "hero" task). What
 * this layout does is give the deck body the same section grammar as the
 * DEADLINES band above it — a labeled "Today" header with a rule — so nothing
 * floats loose between sections:
 *
 *   - the change log ("5 carried over · 1 new") is quiet header meta, with the
 *     revert escape hatch behind a small "Versions" toggle, not its own banner;
 *   - the deck's framing is a one-line muted glimpse that expands on click, the
 *     same treatment as each item's rationale, not a paragraph of italic prose;
 *   - status (in progress, triage) folds into a compact ribbon one tap away.
 *
 * Urgent hard deadlines are untouched — the always-on DeadlineBand above.
 */
export function DeckFocusedView({
  items,
  framing,
  changes,
  versions,
  currentDeckId,
  onRevert,
  onComplete,
  onStart,
  onNotToday,
  onFocus,
  onReorder,
  onSubtaskComplete,
  onSubtaskDefer,
  onSubtaskFocus,
  onTaskCreated,
  excludeIds,
  onAddExisting,
}: DeckFocusedViewProps) {
  const [workOpen, setWorkOpen] = useState(false);
  const [framingOpen, setFramingOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  // Candidates for the add bar's "pull existing" path. Shares the active-tasks
  // query key with the container, so it comes from cache.
  const { data: activeTasks } = useTasks({ status: 'active', limit: 300 });

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

  // Header meta: what changed since the last deck, in the band's quiet voice.
  const changeLine = useMemo(() => {
    const { parts, fromCalendar } = summarizeDeckChanges(changes);
    return (fromCalendar ? ['adjusted for calendar', ...parts] : parts).join(' · ');
  }, [changes]);
  const hasHistory = versions.length > 1;

  return (
    <section className="px-4 pt-4 pb-3">
      {/* ── Section header: same grammar as DEADLINES ── */}
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Today</h3>
        {changeLine && <span className="truncate text-[10px] text-muted-foreground/70">{changeLine}</span>}
        <div className="ml-1 h-px min-w-4 flex-1 bg-border" />
        {hasHistory && (
          <button
            type="button"
            onClick={() => setVersionsOpen((o) => !o)}
            className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <History className="h-2.5 w-2.5" />
            {versionsOpen ? 'Hide versions' : 'Versions'}
          </button>
        )}
      </div>

      {versionsOpen && hasHistory && (
        <div className="mb-2 rounded-md border border-border/60 px-2 py-1">
          <DeckVersionList versions={versions} currentDeckId={currentDeckId} onRevert={onRevert} />
        </div>
      )}

      {/* ── Framing: the deck-level "why", as a glimpse ── */}
      {framing && (
        <button
          type="button"
          onClick={() => setFramingOpen((v) => !v)}
          title={framingOpen ? 'Collapse' : 'Show full note'}
          className={cn(
            'mb-2.5 block w-full px-1 text-left text-xs leading-relaxed text-muted-foreground/70 transition-colors hover:text-muted-foreground',
            !framingOpen && 'line-clamp-1',
          )}
        >
          {framing}
        </button>
      )}

      {/* ── Add: create a new task or pull an existing one ── */}
      <div className="mb-3">
        <DeckAddBar
          candidates={activeTasks ?? []}
          excludeIds={excludeIds}
          onTaskCreated={onTaskCreated}
          onAddExisting={onAddExisting}
        />
      </div>

      {/* ── Ribbon: status folded to a tap, not a section ── */}
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

      {/* ── The ranked stack: flat and whole. Nothing is the "top" task. ── */}
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
    </section>
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
