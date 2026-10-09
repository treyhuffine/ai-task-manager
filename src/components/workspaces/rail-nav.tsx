'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Calendar, ChevronRight, Clock, Plus, Search, SquareKanban, type LucideIcon } from 'lucide-react';
import { useAppPlaces } from '@/components/local-apps/use-app-places';
import { usePrefetchDayShape } from '@/hooks/use-day-shape';
import { useRunsStats } from '@/hooks/use-runs-stats';
import { openCalendarModal, useCalendarModal } from '@/lib/client/calendar-modal';
import { mondayOf } from '@/lib/calendar/dates';
import { todayLocalDate } from '@/lib/deck/date';
import { openTaskBoard, useTaskBoardOpen } from '@/lib/client/task-board';
import { cn } from '@/lib/utils';
import { openLauncher } from './launcher/launcher-store';
import { openChatSearch } from './chat-search-store';
import { RailIconButton } from './rail-icon-button';
import { RailFlyout, StripFlyout } from './rail-flyout';

export { RailIconButton } from './rail-icon-button';

/**
 * The rail's rows above the list, as one grammar, so the wide rail and the
 * collapsed strip show the same things in the same order:
 *
 *   - **Verbs**: New chat (the launcher with no agent picked) and Search
 *     chats (every transcript, in a modal). First under the home row and
 *     fixed there, the way New chat and Search sit at the top of a chat
 *     app's sidebar.
 *   - **Places**: Apps (`use-app-places.tsx`), Task Board, Calendar, then
 *     Schedules and Triggers. They scroll away with the list. Each opens
 *     full screen or in a dialog over whatever is on screen. A place with a
 *     `flyout` (Apps) opens its list beside the rail instead, on hover or
 *     click, with a chevron that says so.
 *
 * The header keeps its own CREATE (tasks, notes, quick capture) and ⌘K search
 * for now. Merging each pair into one is an open question.
 */

export interface RailPlace {
  id: string;
  label: string;
  /** Tooltip in the collapsed strip, where only the icon shows. The wide
   *  rail's row shows `label` and needs none. */
  title: string;
  /** Its glyph: a Lucide icon, or `mark` for something drawn (an app's tile). */
  icon?: LucideIcon;
  mark?: ReactNode;
  /** Under the row above it (an app under Apps). Inset in the wide rail. */
  depth?: 0 | 1;
  onClick: () => void;
  /** The pointer or focus reached it: warm what it opens. */
  onIntent?: () => void;
  /** Showing now: its board, calendar or dialog is open. */
  active: boolean;
  /** Live count beside the label in the wide rail, a dot on the icon in the strip. */
  count?: number;
  /** What the count means: work in flight (blue) or something waiting on you (amber). */
  tone?: 'live' | 'attention';
  /** Resting on the row peeks this beside the rail (Apps), in both rails. A click still goes where `onClick` goes. */
  flyout?: { label: string; content: ReactNode; anchor?: 'rail' | 'trigger' };
}

export function useRailPlaces({
  schedulesOpen,
  onOpenSchedules,
}: {
  schedulesOpen: boolean;
  onOpenSchedules: () => void;
}): RailPlace[] {
  const boardOpen = useTaskBoardOpen();
  const calendarOpen = useCalendarModal().open;
  const prefetchCalendar = usePrefetchDayShape();
  const { data: runs } = useRunsStats();
  const activeRuns = runs?.activeRuns ?? 0;
  const running = activeRuns > 0 ? `${activeRuns} run${activeRuns === 1 ? '' : 's'} active` : null;
  const apps = useAppPlaces();

  return [
    ...apps,
    {
      id: 'board',
      label: 'Task Board',
      title: 'Task Board',
      icon: SquareKanban,
      onClick: openTaskBoard,
      active: boardOpen,
    },
    {
      id: 'calendar',
      label: 'Calendar',
      title: 'Calendar',
      icon: Calendar,
      onClick: () => openCalendarModal(),
      // The week, so the calendar opens with its events, not a skeleton.
      onIntent: () => prefetchCalendar(mondayOf(todayLocalDate()), 7),
      active: calendarOpen,
    },
    {
      id: 'schedules',
      label: 'Schedules and Triggers',
      title: running ? `Schedules and Triggers: ${running}` : 'Schedules and Triggers',
      icon: Clock,
      onClick: onOpenSchedules,
      active: schedulesOpen,
      count: activeRuns > 0 ? activeRuns : undefined,
    },
  ];
}

const COUNT_PILL = {
  live: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  attention: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
} as const;

const COUNT_DOT = {
  live: 'bg-blue-500',
  attention: 'bg-amber-500',
} as const;

/** The two verbs, as rows like the places. `active` never: they open something new. */
export const RAIL_VERBS: readonly RailPlace[] = [
  {
    id: 'create',
    label: 'New chat',
    title: 'New chat',
    icon: Plus,
    onClick: () => openLauncher({ workspaceId: null }),
    active: false,
  },
  {
    id: 'search',
    label: 'Search chats',
    title: 'Search chats',
    icon: Search,
    onClick: () => openChatSearch(),
    active: false,
  },
];

/** One row in the wide rail: a glyph, a label, and what's at its right. Spreads its props so a flyout can drive it. */
function RailRow({
  place: { label, icon: Icon, mark, depth, onClick, onIntent, active, count, tone = 'live', flyout },
  pressed = false,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & { place: RailPlace; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      aria-current={active ? 'page' : undefined}
      {...props}
      className={cn(
        'w-full flex items-center gap-2 py-1.5 pr-2 rounded-md text-[12px] font-medium transition-colors',
        depth === 1 ? 'pl-[22px]' : 'pl-2',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active || pressed ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
        className,
      )}
    >
      {mark ?? (Icon && <Icon size={14} className="flex-shrink-0" />)}
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] tabular-nums',
            COUNT_PILL[tone],
          )}
          aria-label={tone === 'attention' ? `${count} waiting on you` : `${count} active`}
        >
          <span className={cn('size-1.5 rounded-full', COUNT_DOT[tone])} aria-hidden />
          {count}
        </span>
      )}
      {flyout && (
        <ChevronRight
          size={13}
          aria-hidden
          className={cn('flex-shrink-0 text-muted-foreground/50', count === undefined && 'ml-auto')}
        />
      )}
    </button>
  );
}

/** Rows for the wide rail: the places, or the verbs. */
export function RailRows({ places, label }: { places: readonly RailPlace[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5 px-2 pt-1 pb-1.5">
      {places.map((place) =>
        place.flyout ? (
          <RailFlyout
            key={place.id}
            contentLabel={place.flyout.label}
            anchor={place.flyout.anchor}
            onClick={place.onClick}
            trigger={({ ref, open }) => <RailRow ref={ref} place={place} pressed={open} onClick={undefined} />}
          >
            {place.flyout.content}
          </RailFlyout>
        ) : (
          <RailRow key={place.id} place={place} />
        ),
      )}
    </nav>
  );
}

/** The places as rows. */
export function RailPlaceRows({ places }: { places: readonly RailPlace[] }) {
  return <RailRows places={places} label="Places" />;
}

/** New chat and Search chats as rows. */
export function RailVerbRows() {
  return <RailRows places={RAIL_VERBS} label="Start" />;
}

/** The verbs and places as icons, for the collapsed strip, in the wide rail's order. */
export function RailStripActions({ places }: { places: readonly RailPlace[] }) {
  return (
    <>
      {RAIL_VERBS.map(({ id, title, icon, onClick }) => (
        <RailIconButton key={id} icon={icon} label={title} onClick={onClick} />
      ))}
      <StripDivider />
      {places.map(({ id, title, icon, mark, onClick, onIntent, active, count, tone = 'live', flyout }) => {
        const badge =
          count !== undefined ? (
            <span
              className={cn('absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background', COUNT_DOT[tone])}
              aria-hidden
            />
          ) : undefined;
        return flyout ? (
          <StripFlyout
            key={id}
            icon={icon}
            mark={mark}
            label={title}
            contentLabel={flyout.label}
            anchor={flyout.anchor}
            onClick={onClick}
            active={active}
            badge={badge}
          >
            {flyout.content}
          </StripFlyout>
        ) : (
          <RailIconButton
            key={id}
            icon={icon}
            mark={mark}
            label={title}
            onClick={onClick}
            onPointerEnter={onIntent}
            onFocus={onIntent}
            active={active}
            badge={badge}
          />
        );
      })}
    </>
  );
}

export function StripDivider() {
  return <div aria-hidden className="my-1 h-px w-5 flex-shrink-0 bg-border/60" />;
}
