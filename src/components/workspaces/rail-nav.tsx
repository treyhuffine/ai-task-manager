'use client';

import { RailRows, type RailPlace } from '@/components/home/home-navigation';
export type { RailPlace } from '@/components/home/home-navigation';
import { Calendar, Clock, Plus, Search, SquareKanban } from 'lucide-react';
import { useAppPlaces } from '@/components/local-apps/use-app-places';
import { usePrefetchDayShape } from '@/hooks/use-day-shape';
import { useRunsStats } from '@/hooks/use-runs-stats';
import { openCalendarModal, useCalendarModal } from '@/lib/client/calendar-modal';
import { mondayOf } from '@/lib/calendar/dates';
import { todayLocalDate } from '@/lib/deck/date';
import { openBoard, useTaskBoardOpen } from '@/lib/client/task-board';
import { openLauncher } from './launcher/launcher-store';
import { openChatSearch } from './chat-search-store';




export { RailIconButton } from './rail-icon-button';

/**
 * The rail's rows above the list, as one grammar, so the wide rail and the
 * collapsed strip show the same things in the same order:
 *
 *   - **Verbs**: New chat (the launcher with no agent picked) and Search
 *     chats (every transcript, in a modal). First under the home row and
 *     fixed there, the way New chat and Search sit at the top of a chat
 *     app's sidebar.
 *   - **Places**: Apps (`use-app-places.tsx`), Board, Calendar, then
 *     Schedules and Triggers. They scroll away with the list. Each opens
 *     full screen or in a dialog over whatever is on screen. A place with a
 *     `flyout` (Apps) opens its list beside the rail instead, on hover or
 *     click, with a chevron that says so.
 *
 * The header keeps its own CREATE (tasks, notes, quick capture) and ⌘K search
 * for now. Merging each pair into one is an open question.
 */


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
      label: 'Board',
      title: 'Board',
      icon: SquareKanban,
      onClick: () => openBoard(),
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
  return <><RailRows places={RAIL_VERBS} label="Start" expanded={false}/><StripDivider/><RailRows places={places} label="Places" expanded={false}/></>;
}

export function StripDivider() {
  return <div aria-hidden className="my-1 h-px w-5 flex-shrink-0 bg-border/60" />;
}
