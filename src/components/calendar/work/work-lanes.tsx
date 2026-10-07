"use client";

import { instantWindowOnDate, minutePct, type MinuteWindow } from '@/lib/calendar/layout';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { sittingWindows } from '@/lib/work/ribbon';
import type { WorkAgent, WorkDay, WorkSpan } from '@/lib/work/types';
import { cn } from '@/lib/utils';
import { WorkSpanDetails } from './work-span-details';
import { agentStyle, timeLabel, type WorkLayer } from './work-style';
import { Tip } from '@/components/ui/tip';

/**
 * A day's work in lanes (docs/work-view.md, "Day lanes"): you first, then
 * each agent that worked, in its color, with a dot for every commit. One thin
 * lane of yours beside many of theirs is the leverage, drawn. Click a bar for
 * its chats and commits.
 */
export interface Lane {
  key: string;
  label: string;
  agent: WorkAgent | undefined;
  you: boolean;
  spans: WorkSpan[];
  windows: MinuteWindow[];
}

/** You, then the day's agents in stacking order. */
export function dayLanes(day: WorkDay, layer: WorkLayer): Lane[] {
  const lanes: Lane[] = [];
  const you = sittingWindows(day);
  if (you.length) lanes.push({ key: 'you', label: 'You', agent: undefined, you: true, spans: [], windows: you });
  const byAgent = new Map<string | null, WorkSpan[]>();
  for (const span of day.spans) {
    const list = byAgent.get(span.agentId) ?? [];
    list.push(span);
    byAgent.set(span.agentId, list);
  }
  for (const [agentId, spans] of [...byAgent.entries()].sort((a, b) => layer.order(a[0]) - layer.order(b[0]))) {
    const agent = layer.agents.get(agentId);
    lanes.push({
      key: agentId ?? 'ri',
      label: agent?.name ?? 'Ri',
      agent,
      you: false,
      spans,
      windows: spans.map((s) => instantWindowOnDate(s.start, s.end, day.date)).filter((w): w is MinuteWindow => w !== null),
    });
  }
  return lanes;
}

/** Lane names, above the scrolling track, over the lanes they name. */
export function WorkLaneHeader({ lanes }: { lanes: Lane[] }) {
  return (
    <div className="relative h-6 border-b border-border/60">
      {lanes.map((lane, i) => (
        <Tip key={lane.key} label={lane.label} onlyWhenTextHidden>
          <div
            className="absolute top-1 flex min-w-0 items-center justify-center gap-1 px-0.5"
            style={{ left: `${(i / lanes.length) * 100}%`, width: `${100 / lanes.length}%` }}
          >
            <span
              className={cn('size-2 shrink-0 rounded-[2px]', lane.you && 'w-[3px] rounded-full bg-foreground/60')}
              style={lane.you ? undefined : agentStyle(lane.agent?.color ?? 0).dot}
              aria-hidden
            />
            <span className={cn('truncate text-[10px]', lane.you ? 'font-medium text-foreground' : 'text-muted-foreground')}>{lane.label}</span>
          </div>
        </Tip>
      ))}
    </div>
  );
}

/** The lanes in the day's time track. */
export function WorkLaneTrack({ lanes, day, bounds }: { lanes: Lane[]; day: WorkDay; bounds: MinuteWindow }) {
  const dayStart = new Date(`${day.date}T00:00:00`).getTime();
  const minuteOf = (iso: string) => (Date.parse(iso) - dayStart) / 60_000;
  return (
    <>
      {lanes.map((lane, i) => (
        <div
          key={lane.key}
          className="absolute inset-y-0"
          style={{ left: `${(i / lanes.length) * 100}%`, width: `${100 / lanes.length}%` }}
        >
          {lane.you
            ? lane.windows.map((w) => (
                <Tip key={w.startMinute} label="Your time: you were in the chats">
                  <div
                    className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-foreground/60"
                    style={pos(w, bounds)}
                  />
                </Tip>
              ))
            : lane.spans.map((span, j) => {
                const w = lane.windows[j];
                if (!w) return null;
                return (
                  <Popover key={span.id}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${lane.label}: ${timeLabel(span.start)} to ${timeLabel(span.end)}`}
                        className="absolute left-1/2 min-h-1 w-3.5 -translate-x-1/2 rounded-[4px] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{ ...pos(w, bounds), ...agentStyle(lane.agent?.color ?? 0).bar }}
                      />
                    </PopoverTrigger>
                    <PopoverContent side="left" align="start" className="w-80 p-0">
                      <WorkSpanDetails span={span} agent={lane.agent} />
                    </PopoverContent>
                  </Popover>
                );
              })}
          {lane.spans.flatMap((span) =>
            span.commits.map((c) => (
              <span
                key={c.hash}
                aria-hidden
                className="pointer-events-none absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
                style={{ top: `${minutePct(minuteOf(c.at), bounds)}%` }}
              />
            )),
          )}
        </div>
      ))}
    </>
  );
}

function pos(w: MinuteWindow, bounds: MinuteWindow): React.CSSProperties {
  const top = minutePct(w.startMinute, bounds);
  return { top: `${top}%`, height: `${minutePct(w.endMinute, bounds) - top}%` };
}
