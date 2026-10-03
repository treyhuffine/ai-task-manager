'use client';

import { Clock, Plug } from 'lucide-react';
import { openSettings } from '@/components/settings/settings-store';
import { CONNECTOR_ICONS } from '@/components/connectors/connector-icon-data';
import { useRunsStats } from '@/hooks/use-runs-stats';
import { cn } from '@/lib/utils';

// The bottom of the rail: what you set up rather than visit. Schedules and
// triggers (when agents work without you asking) and connecting apps (where
// they can act). Both are occasional, so they sit below the work instead of
// above it, where Schedules used to be a full-width primary button.
//
// Connect apps opens Settings → Plugins on its Connectors tab (Gmail, Notion,
// Linear, ... and remote MCP servers). The skinny rail keeps only the
// schedules clock, whose dot says runs are going. Connect apps needs its words.
//
// Replaces the old ⌘K/⌘J hint labels + theme toggle that used to live here:
// the shortcuts stay global, and theme still toggles from the command palette
// and Settings → General, so nothing is stranded by dropping them.

/** Apps in the stack: live connectors with a brand mark, drawn as app icons. */
const APPS = ['linear', 'notion', 'gmail'] as const;

/** Where each tile goes on hover and focus: the stack fans out. */
const FAN = [
  'group-hover:-translate-x-1.5 group-hover:-rotate-12 group-focus-visible:-translate-x-1.5 group-focus-visible:-rotate-12',
  'group-hover:-translate-y-1 group-focus-visible:-translate-y-1',
  'group-hover:translate-x-1.5 group-hover:rotate-12 group-focus-visible:translate-x-1.5 group-focus-visible:rotate-12',
];

function AppTile({ id, className }: { id: (typeof APPS)[number]; className?: string }) {
  const icon = CONNECTOR_ICONS[id];
  return (
    <span
      className={cn(
        'relative flex size-5 items-center justify-center rounded-[6px] bg-white shadow-sm ring-2 ring-background',
        'transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" width={12} height={12} fill={`#${icon.hex}`} aria-hidden>
        <path d={icon.path} />
      </svg>
    </span>
  );
}

export function RailFooter({
  collapsed,
  onOpenSchedules,
}: {
  collapsed: boolean;
  onOpenSchedules: () => void;
}) {
  if (collapsed) {
    return (
      <footer className="flex flex-shrink-0 justify-center border-t border-border/40 py-1.5">
        <SchedulesButton collapsed onClick={onOpenSchedules} />
      </footer>
    );
  }
  return (
    <footer className="flex flex-shrink-0 flex-col gap-1 px-2 py-2 border-t border-border/40">
      <SchedulesButton collapsed={false} onClick={onOpenSchedules} />
      <button
        type="button"
        onClick={() => openSettings('plugins', { anchor: 'connectors' })}
        aria-label="Connect apps"
        title="Connect apps like Gmail, Notion and Linear"
        className="group w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
      >
        <Plug size={13} className="flex-shrink-0 text-primary" />
        <span>Connect apps</span>
        <span aria-hidden className="ml-auto flex items-center -space-x-1.5 pr-1">
          {APPS.map((id, i) => (
            <AppTile key={id} id={id} className={FAN[i]} />
          ))}
        </span>
      </button>
    </footer>
  );
}

/**
 * Opens Schedules and Triggers. Carries the live run count so work running
 * on a schedule is visible from anywhere: a number in the wide rail, a dot
 * on the clock in the skinny one.
 */
function SchedulesButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const { data } = useRunsStats();
  const activeRuns = data?.activeRuns ?? 0;
  const running = activeRuns > 0 ? `${activeRuns} run${activeRuns === 1 ? '' : 's'} active` : null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={running ? `Open Schedules and Triggers: ${running}` : 'Open Schedules and Triggers'}
        title={running ? `Schedules and Triggers: ${running}` : 'Schedules and Triggers'}
        className="relative p-1.5 rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Clock size={14} />
        {running && (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-blue-500" aria-hidden />
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={running ? `Schedules and Triggers: ${running}` : 'Schedules and Triggers'}
      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
    >
      <Clock size={13} className="flex-shrink-0" />
      <span>Schedules and Triggers</span>
      {running && (
        <span
          className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] tabular-nums"
          aria-label={running}
        >
          <span className="size-1.5 rounded-full bg-blue-500" aria-hidden />
          {activeRuns}
        </span>
      )}
    </button>
  );
}
