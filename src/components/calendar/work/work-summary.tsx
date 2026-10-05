"use client";

import { useState } from 'react';
import { Check, Copy, FileText, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSaveWorkReport } from '@/hooks/use-work';
import {
  formatDuration,
  formatHours,
  leverageLine,
  personHoursLine,
  speedLine,
  textureLine,
  wordsLine,
} from '@/lib/work/equivalents';
import type { WorkRange } from '@/lib/work/types';
import { cn } from '@/lib/utils';

/**
 * The top of the calendar with work on: what the range adds up to, in the
 * plain equivalents (docs/work-view.md). Outcomes first, then your time and
 * the agents', then texture. Today gets its own figure while it's on screen,
 * and the report is one click away.
 */
export function WorkSummary({ range, today, stale = false }: { range: WorkRange | undefined; today: string; stale?: boolean }) {
  if (!range) {
    return (
      <div className="flex min-h-12 items-center gap-2 px-1 pb-3 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        Adding up the work. The first time reads all your history, which takes a few seconds.
      </div>
    );
  }
  const t = range.totals;
  const headline = personHoursLine(t, range.days);
  const leverage = leverageLine(t);
  const texture = [textureLine(t, { weekday: range.days > 1 }), wordsLine(t), speedLine(t)].filter(Boolean);
  const todayDay = range.days > 1 ? range.dayList.find((d) => d.date === today) : undefined;

  if (!headline && !leverage) {
    return <p className="px-1 pb-3 text-xs text-muted-foreground">No work yet in this range.</p>;
  }

  return (
    // While the next range loads, the last one's numbers stay, dimmed.
    <div className={cn('flex items-start gap-4 px-1 pb-3 transition-opacity', stale && 'opacity-40')} aria-busy={stale}>
      <div className="min-w-0 flex-1 space-y-0.5">
        {headline && <p className="text-sm font-medium text-foreground">{headline}</p>}
        {leverage && <p className="text-xs text-foreground/80">{leverage}</p>}
        {texture.map((line) => (
          <p key={line} className="text-[11px] text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
      {todayDay && todayDay.stats.agentMinutes >= 1 && (
        <div className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-right" title="Today so far, live">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Today</p>
          <p className="text-sm font-medium tabular-nums">{formatHours(todayDay.stats.personHours)} person-hours</p>
          <p className="text-[10px] tabular-nums text-muted-foreground">
            you {formatDuration(todayDay.stats.handsOnMinutes)} · agents {formatDuration(todayDay.stats.agentMinutes)}
          </p>
        </div>
      )}
      <ReportButton range={range} />
    </div>
  );
}

function ReportButton({ range }: { range: WorkRange }) {
  const save = useSaveWorkReport();
  const { openNote } = useDashboard();
  const [copied, setCopied] = useState(false);
  const text = range.report.join('\n');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <FileText size={13} />
          Report
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="space-y-1.5 px-3 py-2.5">
          {range.report.map((line) => (
            <p key={line} className="text-xs leading-relaxed">
              {line}
            </p>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1.5 border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { start: range.start, days: range.days },
                { onSuccess: (note) => openNote(note.id) },
              )
            }
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            Save as note
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
