'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Calendar, Clock, Plus, Search, SquareKanban, type LucideIcon } from 'lucide-react';
import { useOpenCalendar } from '@/components/calendar/use-open-calendar';
import { useRunsStats } from '@/hooks/use-runs-stats';
import { openTaskBoard, useTaskBoardOpen } from '@/lib/client/task-board';
import { cn } from '@/lib/utils';
import { openLauncher } from './launcher/launcher-store';
import { openChatSearch } from './chat-search-store';

/**
 * The rail's places and its two verbs, as one list each, so the wide rail and
 * the collapsed strip show the same buttons in the same order.
 *
 *   - **Places**: Board, Calendar, Schedules and Triggers. Rows under the
 *     home row in the wide rail, which scroll away with the list.
 *   - **Verbs**: Create (a new execution in any agent, the launcher with no
 *     agent picked) and Search (every chat's transcript, in a modal). Two
 *     buttons side by side, sticky with the tabs.
 *
 * The header keeps its own Create (tasks, notes, quick capture) and ⌘K search
 * for now. Merging each pair into one is an open question.
 */

export interface RailPlace {
  id: 'board' | 'calendar' | 'schedules';
  label: string;
  /** Tooltip. */
  title: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Showing now: the board is open, the calendar is on screen at Home. */
  active: boolean;
  /** Live count beside the label in the wide rail, a dot on the icon in the strip. */
  count?: number;
}

export function useRailPlaces({
  schedulesOpen,
  onOpenSchedules,
}: {
  schedulesOpen: boolean;
  onOpenSchedules: () => void;
}): RailPlace[] {
  const boardOpen = useTaskBoardOpen();
  const { openCalendar, calendarShowing } = useOpenCalendar();
  const { data: runs } = useRunsStats();
  const activeRuns = runs?.activeRuns ?? 0;
  const running = activeRuns > 0 ? `${activeRuns} run${activeRuns === 1 ? '' : 's'} active` : null;

  return [
    {
      id: 'board',
      label: 'Board',
      title: 'Open board',
      icon: SquareKanban,
      onClick: openTaskBoard,
      active: boardOpen,
    },
    {
      id: 'calendar',
      label: 'Calendar',
      title: 'Calendar',
      icon: Calendar,
      onClick: openCalendar,
      active: calendarShowing,
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

interface RailVerb {
  id: 'create' | 'search';
  label: string;
  title: string;
  icon: LucideIcon;
  onClick: () => void;
}

export const RAIL_VERBS: readonly RailVerb[] = [
  {
    id: 'create',
    label: 'Create',
    title: 'New execution',
    icon: Plus,
    onClick: () => openLauncher({ workspaceId: null }),
  },
  {
    id: 'search',
    label: 'Search',
    title: 'Search chats',
    icon: Search,
    onClick: openChatSearch,
  },
];

/** The places as full-width rows, for the wide rail. */
export function RailPlaceRows({ places }: { places: readonly RailPlace[] }) {
  return (
    <nav aria-label="Places" className="flex flex-col gap-0.5 px-2 pt-1 pb-1.5">
      {places.map(({ id, label, title, icon: Icon, onClick, active, count }) => (
        <button
          key={id}
          type="button"
          onClick={onClick}
          title={title}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            active
              ? 'bg-muted/60 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
          )}
        >
          <Icon size={14} className="flex-shrink-0" />
          <span className="truncate">{label}</span>
          {count !== undefined && (
            <span
              className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] tabular-nums"
              aria-label={`${count} active`}
            >
              <span className="size-1.5 rounded-full bg-blue-500" aria-hidden />
              {count}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

/**
 * Create and Search, side by side. Create carries a quiet fill and Search a
 * border: they're the rail's two verbs, but the page's own input (the chat
 * composer) stays the loudest thing on screen, so neither takes the brand
 * color.
 */
export function RailVerbButtons() {
  return (
    <div className="grid grid-cols-2 gap-1.5 px-2 pt-1 pb-2">
      {RAIL_VERBS.map(({ id, label, title, icon: Icon, onClick }) => (
        <button
          key={id}
          type="button"
          onClick={onClick}
          title={title}
          className={cn(
            'flex h-7 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            id === 'create'
              ? 'border-border bg-secondary text-foreground hover:bg-accent'
              : 'border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40',
          )}
        >
          <Icon size={13} className="flex-shrink-0" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * An icon button in the collapsed strip (and the wide rail's collapse
 * toggle). The tooltip names it. Extra button props pass through, so it can
 * be a popover trigger.
 */
export function RailIconButton({
  icon: Icon,
  label,
  active = false,
  badge,
  className,
  'aria-label': ariaLabel,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & {
  icon: LucideIcon;
  /** Tooltip. Doubles as the accessible name unless `aria-label` is set. */
  label: string;
  active?: boolean;
  /** Drawn on the icon's top-right corner. */
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      aria-current={active ? 'page' : undefined}
      title={label}
      {...props}
      className={cn(
        'relative flex-shrink-0 p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'bg-muted/60 text-foreground'
          : 'text-muted-foreground/80 hover:text-foreground hover:bg-muted/50',
        className,
      )}
    >
      <Icon size={14} />
      {badge}
    </button>
  );
}

/** The places and verbs as icons, for the collapsed strip. */
export function RailStripActions({ places }: { places: readonly RailPlace[] }) {
  return (
    <>
      {places.map(({ id, title, icon, onClick, active, count }) => (
        <RailIconButton
          key={id}
          icon={icon}
          label={title}
          onClick={onClick}
          active={active}
          badge={
            count !== undefined ? (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-blue-500" aria-hidden />
            ) : undefined
          }
        />
      ))}
      <StripDivider />
      {RAIL_VERBS.map(({ id, title, icon, onClick }) => (
        <RailIconButton key={id} icon={icon} label={title} onClick={onClick} />
      ))}
    </>
  );
}

export function StripDivider() {
  return <div aria-hidden className="my-1 h-px w-5 flex-shrink-0 bg-border/60" />;
}
