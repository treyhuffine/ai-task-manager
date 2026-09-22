"use client";

import { useMemo, useState } from 'react';
import { Target, Play, Check, X, ChevronRight, Inbox, Activity } from 'lucide-react';
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
 * The dense layout surveys everything at once, which reads as a console rather
 * than a place to work. This inverts it: one hero (the top-ranked next action)
 * with a Focus entry point above the fold, and everything else — what's in
 * progress, what needs triage, and the rest of the ranked stack — folded into a
 * compact ribbon and a collapsed section, one tap away. Urgent hard deadlines
 * are unaffected: they render in the always-on DeadlineBand above this view.
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
  const hero = items[0];
  const rest = useMemo(() => items.slice(1), [items]);

  const [restOpen, setRestOpen] = useState(false);
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

  // When only the rest of the stack, in-progress work, or nothing at all
  // remains, the reordering of items[0] as "hero" still holds.
  const hasHero = !!hero;

  return (
    <div className="px-4 py-3">
      {framing && (
        <p className="mb-3 text-xs italic leading-relaxed text-muted-foreground">{framing}</p>
      )}

      {/* ── Hero: the one thing to do now ── */}
      {hasHero ? (
        <HeroCard
          item={hero}
          onFocus={onFocus}
          onStart={onStart}
          onComplete={onComplete}
          onNotToday={onNotToday}
        />
      ) : (
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">Nothing queued right now</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Add a task below, or open the rest of your day.
          </p>
        </div>
      )}

      {/* ── Quick add ── */}
      <div className="mt-3">
        <DeckAddComposer variant="persistent" onTaskCreated={onTaskCreated} />
      </div>

      {/* ── Ribbon: status, one tap away ── */}
      {(inProgressCount > 0 || triageCount > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
        <div className="mt-3">
          <CurrentWorkSection />
        </div>
      )}

      {/* ── The rest of the ranked stack, collapsed by default ── */}
      {rest.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setRestOpen((o) => !o)}
            className="flex w-full items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight size={12} className={cn('transition-transform', restOpen && 'rotate-90')} />
            The rest of today
            <span className="font-medium normal-case tracking-normal text-muted-foreground/70">
              {rest.length}
            </span>
            <div className="ml-1 h-px flex-1 bg-border" />
          </button>
          {restOpen && (
            <div className="mt-2">
              <DeckStack
                items={rest}
                onComplete={onComplete}
                onStart={onStart}
                onNotToday={onNotToday}
                onFocus={onFocus}
                onReorder={(next) => onReorder([hero, ...next])}
                onSubtaskComplete={onSubtaskComplete}
                onSubtaskDefer={onSubtaskDefer}
                onSubtaskFocus={onSubtaskFocus}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────

function HeroCard({
  item,
  onFocus,
  onStart,
  onComplete,
  onNotToday,
}: {
  item: DeckItem;
  onFocus?: (id: string) => void;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onNotToday: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 shadow-sm">
      {(item.parentTitle || item.areaName) && (
        <p className="mb-1 truncate text-[11px] text-muted-foreground">
          {item.parentTitle && <span>{item.parentTitle}</span>}
          {item.parentTitle && item.areaName && <span> · </span>}
          {item.areaName && <span>{item.areaName}</span>}
        </p>
      )}
      <h2 className="text-lg font-semibold leading-snug text-foreground">{item.title}</h2>

      {(item.energy || item.effort || item.hardDeadline) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {item.hardDeadline && <HeroPill tone="deadline">Due {relativeDay(item.hardDeadline)}</HeroPill>}
          {item.energy && <HeroPill>{item.energy === 'deep' ? 'Deep' : 'Light'}</HeroPill>}
          {item.effort && <HeroPill>{item.effort}</HeroPill>}
        </div>
      )}

      {item.rationale && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{item.rationale}</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => onFocus?.(item.id)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Target size={15} />
          Focus
        </button>
        <button
          onClick={() => onStart(item.id)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Play size={14} />
          Start
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <HeroIcon title="Complete" onClick={() => onComplete(item.id)} className="hover:text-emerald-600 dark:hover:text-emerald-400">
            <Check size={16} />
          </HeroIcon>
          <HeroIcon title="Not today" onClick={() => onNotToday(item.id)}>
            <X size={16} />
          </HeroIcon>
        </div>
      </div>
    </div>
  );
}

function HeroPill({ children, tone }: { children: React.ReactNode; tone?: 'deadline' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'deadline'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function HeroIcon({
  title,
  onClick,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted',
        className,
      )}
    >
      {children}
    </button>
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

/** Short relative day for the hero deadline pill. */
function relativeDay(iso: string): string {
  const now = new Date();
  const d = new Date(iso);
  const days = Math.round((d.setHours(0, 0, 0, 0) - now.setHours(0, 0, 0, 0)) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}
