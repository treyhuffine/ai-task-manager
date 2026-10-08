"use client";

import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Inbox, Activity, History, Check, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTasks, useTaskAttention } from '@/hooks/use-tasks';
import { useProposedDecisions, useTriagePasses, useMarkPassSeen } from '@/hooks/use-stream';
import { useDashboard } from '@/contexts/dashboard-context';
import { summarizeDeckChanges } from '@/lib/deck/change-summary';
import { HeartbeatChip, useHeartbeatDeckSignal } from '@/components/heartbeat/heartbeat-chip';
import { CurrentWorkSection } from './current-work-section';
import { DeckStack } from './deck-stack';
import { DeckVersionList, type DeckVersionSummary } from './deck-versions';
import type { DeckItem, DeckChangeView } from '@/types/dashboard';
import { Tip } from '@/components/ui/tip';

interface DeckTodayProps {
  items: DeckItem[];
  framing?: string;
  /** This deck version's change log — summarized as quiet header meta. */
  changes: DeckChangeView[];
  /** Today's deck versions — the revert escape hatch behind "Versions". */
  versions: DeckVersionSummary[];
  currentDeckId?: string;
  onRevert: (deckId: string) => void;
  /** Tasks completed from the deck this session, for the "done" chip. */
  completedItems: DeckItem[];
  onComplete: (id: string) => void;
  onStart: (id: string) => void;
  onNotToday: (id: string) => void;
  onFocus?: (id: string) => void;
  onReorder: (items: DeckItem[]) => void;
  onSubtaskComplete: (itemId: string, subtaskId: string) => void;
  onSubtaskDefer: (itemId: string, subtaskId: string) => void;
  onSubtaskFocus?: (itemId: string, subtaskId: string) => void;
}

/**
 * The deck's Today section: everything under the DEADLINES band.
 *
 * It uses the band's section grammar (an uppercase label, quiet inline meta, a
 * rule) so nothing floats loose between sections. Below the header:
 *
 *   - the deck's framing as a one-line muted glimpse that expands on click, the
 *     same treatment as each card's reasoning;
 *   - one status row of chips, each a tap away and each shown only when it has
 *     something to say: work in progress (and what's waiting for review), what
 *     needs triage (or a triage digest you haven't seen), what you finished
 *     today, and the heartbeat when it needs you;
 *   - the ranked stack, flat and whole. Work is parallel in the agent world, so
 *     no task is singled out and nothing is collapsed.
 *
 * Adding a task is the add bar pinned at the top of the deck, not part of this
 * section. Urgent hard deadlines are the always-on DeadlineBand above it.
 */
export function DeckToday({
  items,
  framing,
  changes,
  versions,
  currentDeckId,
  onRevert,
  completedItems,
  onComplete,
  onStart,
  onNotToday,
  onFocus,
  onReorder,
  onSubtaskComplete,
  onSubtaskDefer,
  onSubtaskFocus,
}: DeckTodayProps) {
  const [open, setOpen] = useState<'work' | 'done' | null>(null);
  const [framingOpen, setFramingOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const toggle = (which: 'work' | 'done') => setOpen((o) => (o === which ? null : which));

  // Status counts. These queries share their keys with CurrentWorkSection and
  // the stream surfaces, so React Query serves them from cache.
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
  const { data: passes } = useTriagePasses(3);
  const markSeen = useMarkPassSeen();
  // A triage pass that ran while you were away and left a digest you haven't
  // opened. Only worth a chip when nothing is waiting for a decision.
  const unseenDigest =
    triageCount === 0
      ? (passes ?? []).find(
          (p) => p.status === 'completed' && !p.digestSeenAt && (p.decisions.length > 0 || p.summary),
        )
      : undefined;

  const heartbeatSignal = useHeartbeatDeckSignal();
  const doneCount = completedItems.length;

  const { setPanelTab, focusedPanel } = useDashboard();
  const openStream = () => setPanelTab(focusedPanel, 'stream');

  // Header meta: what changed since the last deck, in the band's quiet voice.
  const changeLine = useMemo(() => {
    const { parts, fromCalendar } = summarizeDeckChanges(changes);
    return (fromCalendar ? ['adjusted for calendar', ...parts] : parts).join(' · ');
  }, [changes]);
  const hasHistory = versions.length > 1;

  const hasStatus = inProgressCount > 0 || triageCount > 0 || !!unseenDigest || doneCount > 0 || !!heartbeatSignal;

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
        <Tip label={framingOpen ? 'Collapse' : 'Show full note'}>
          <button
            type="button"
            onClick={() => setFramingOpen((v) => !v)}
            className={cn(
              'mb-2.5 block w-full px-1 text-left text-xs leading-relaxed text-muted-foreground/70 transition-colors hover:text-muted-foreground',
              !framingOpen && 'line-clamp-1',
            )}
          >
            {framing}
          </button>
        </Tip>
      )}

      {/* ── Status row: each chip a tap away, each shown only when it has
          something to say ── */}
      {hasStatus && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {inProgressCount > 0 && (
            <StatusChip active={open === 'work'} onClick={() => toggle('work')} icon={<Activity size={12} />}>
              <span className="text-violet-600 dark:text-violet-400">{inProgressCount}</span> in progress
              {reviewCount > 0 && <span className="text-muted-foreground"> · {reviewCount} to review</span>}
            </StatusChip>
          )}
          {triageCount > 0 && (
            <StatusChip onClick={openStream} icon={<Inbox size={12} />}>
              {triageCount} to triage
            </StatusChip>
          )}
          {unseenDigest && (
            <Tip label={unseenDigest.summary ?? 'Your captures were triaged while you were away.'}>
              <StatusChip
                onClick={() => {
                  markSeen.mutate(unseenDigest.id);
                  openStream();
                }}
                icon={<ListChecks size={12} />}
              >
                Triaged while you were away
              </StatusChip>
            </Tip>
          )}
          {doneCount > 0 && (
            <StatusChip active={open === 'done'} onClick={() => toggle('done')} icon={<Check size={12} />}>
              {doneCount} done
            </StatusChip>
          )}
          <HeartbeatChip />
        </div>
      )}

      {/* What's in progress, revealed from its chip. */}
      {open === 'work' && inProgressCount > 0 && (
        <div className="mb-3">
          <CurrentWorkSection />
        </div>
      )}

      {/* What you finished from the deck today, revealed from its chip. */}
      {open === 'done' && doneCount > 0 && (
        <ul className="mb-3 space-y-1 rounded-md border border-border/60 px-3 py-2">
          {completedItems.map((item) => (
            <li key={item.id} className="truncate text-xs text-muted-foreground/60 line-through">
              {item.parentTitle && <>{item.parentTitle} · </>}
              {item.title}
            </li>
          ))}
        </ul>
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
            Add a task at the top to start today&apos;s deck.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * A chip in the Today status row. Forwards the rest of its props and its ref
 * to the button, so it works as a `Tip` trigger.
 */
function StatusChip({
  children,
  icon,
  active,
  className,
  ...rest
}: ComponentProps<'button'> & { icon: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
        active
          ? 'border-border bg-muted text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span>{children}</span>
    </button>
  );
}
