"use client";

import { useState } from 'react';
import { minutePct, type MinuteWindow } from '@/lib/calendar/layout';
import { formatDuration } from '@/lib/work/equivalents';
import { BIN_MINUTES, sittingWindows, type RibbonBin } from '@/lib/work/ribbon';
import type { WorkDay } from '@/lib/work/types';
import { minuteLabel, seriesColor, type WorkLayer } from './work-style';

/**
 * A day's work as a ribbon beside its meetings in the week grid
 * (docs/work-view.md, "The ribbon"). Each 15-minute window is a row of
 * segments in the agents' colors, its width how many chats were working at
 * once, on a scale shared by the whole week. A thin line on the left is you,
 * hands-on. Hover a window for who was working, click to open the day.
 */
export function WorkRibbon({
  day,
  layer,
  bounds,
  onOpenDay,
}: {
  day: WorkDay;
  layer: WorkLayer;
  bounds: MinuteWindow;
  onOpenDay: () => void;
}) {
  const bins = layer.bins.get(day.date) ?? [];
  const sittings = sittingWindows(day);
  const [hover, setHover] = useState<RibbonBin | null>(null);
  if (bins.length === 0 && sittings.length === 0) return null;

  const binPct = (BIN_MINUTES / (bounds.endMinute - bounds.startMinute)) * 100;
  const label = `Work on ${day.date}: agents ran ${formatDuration(day.stats.agentMinutes)}${
    day.stats.peak ? `, up to ${day.stats.peak.count} at once` : ''
  }. Open the day for details.`;

  return (
    <div className="absolute inset-y-0 right-0 w-[34%]" role="group" aria-label={label}>
      {sittings.map((w) => (
        <div
          key={`you-${w.startMinute}`}
          aria-hidden
          className="absolute left-0 w-[3px] rounded-full bg-foreground/60"
          style={{ top: `${minutePct(w.startMinute, bounds)}%`, height: `${minutePct(w.endMinute, bounds) - minutePct(w.startMinute, bounds)}%` }}
        />
      ))}
      {bins.map((bin) => (
        <button
          key={bin.startMinute}
          type="button"
          tabIndex={-1}
          aria-hidden
          onPointerEnter={() => setHover(bin)}
          onPointerLeave={() => setHover((h) => (h === bin ? null : h))}
          onClick={onOpenDay}
          className="absolute left-[6px] right-0 flex cursor-pointer gap-[2px] hover:brightness-110"
          style={{ top: `${minutePct(bin.startMinute, bounds)}%`, height: `calc(${binPct}% - 2px)` }}
        >
          {bin.byAgent.map((seg, i) => (
            <span
              key={seg.agentId ?? 'ri'}
              className={i === bin.byAgent.length - 1 ? 'h-full rounded-r-[3px]' : 'h-full'}
              style={{
                flex: `0 1 ${(seg.count / layer.scale) * 100}%`,
                backgroundColor: seriesColor(layer.agents.get(seg.agentId)?.color ?? 0),
              }}
            />
          ))}
        </button>
      ))}
      {hover && <RibbonReadout bin={hover} day={day} layer={layer} bounds={bounds} sittings={sittings} />}
    </div>
  );
}

/** Who was working in a window: the count leads, each agent keyed by a line in its color. */
function RibbonReadout({
  bin,
  day,
  layer,
  bounds,
  sittings,
}: {
  bin: RibbonBin;
  day: WorkDay;
  layer: WorkLayer;
  bounds: MinuteWindow;
  sittings: MinuteWindow[];
}) {
  const end = bin.startMinute + BIN_MINUTES;
  const handsOn = sittings.some((w) => w.startMinute < end && w.endMinute > bin.startMinute);
  const dayStart = new Date(`${day.date}T00:00:00`).getTime();
  const commits = [...day.spans.flatMap((s) => s.commits), ...day.looseCommits].filter((c) => {
    const m = (Date.parse(c.at) - dayStart) / 60_000;
    return m >= bin.startMinute && m < end;
  }).length;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute right-full z-30 mr-2 w-52 rounded-md border border-border bg-popover px-2.5 py-2 shadow-lg"
      style={{ top: `${minutePct(bin.startMinute, bounds)}%` }}
    >
      <p className="text-[10px] text-muted-foreground">
        {minuteLabel(bin.startMinute)} to {minuteLabel(end)}
      </p>
      <p className="text-xs">
        <span className="font-semibold text-foreground">{bin.total}</span>{' '}
        <span className="text-muted-foreground">{bin.total === 1 ? 'chat working' : 'chats working'}</span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {bin.byAgent.map((seg) => {
          const agent = layer.agents.get(seg.agentId);
          return (
            <li key={seg.agentId ?? 'ri'} className="flex items-center gap-1.5 text-[11px]">
              <span className="h-[2px] w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seriesColor(agent?.color ?? 0) }} aria-hidden />
              <span className="font-medium text-foreground">{seg.count}</span>
              <span className="truncate text-muted-foreground">{agent?.name ?? 'Ri'}</span>
            </li>
          );
        })}
      </ul>
      {(handsOn || commits > 0) && (
        <p className="mt-1 border-t border-border/60 pt-1 text-[10px] text-muted-foreground">
          {[handsOn && 'You were hands-on', commits > 0 && `${commits} ${commits === 1 ? 'commit' : 'commits'}`].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
