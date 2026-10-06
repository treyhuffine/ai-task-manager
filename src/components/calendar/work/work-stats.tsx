"use client";

import { useState } from 'react';
import { Check, Copy, FileText, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSaveWorkReport } from '@/hooks/use-work';
import { formatDuration, speedLine, textureLine, wordsLine, workTiles } from '@/lib/work/equivalents';
import type { WorkRange } from '@/lib/work/types';
import { cn } from '@/lib/utils';
import { agentStyle } from './work-style';

/**
 * The top of the calendar with work on (docs/work-view.md): the range's
 * headline numbers as stat tiles, a legend that keys the ribbon's colors (each
 * agent with its time), and the report. The sentences live in the report, so
 * the numbers stay scannable. While the next range loads, the last one's
 * numbers hold, dimmed.
 */
export function WorkStats({ range, stale = false }: { range: WorkRange | undefined; stale?: boolean }) {
  if (!range) {
    return (
      <div className="flex min-h-16 items-center gap-2 px-1 pb-3 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        Adding up the work. The first time reads all your history, which takes a few seconds.
      </div>
    );
  }
  const tiles = workTiles(range.totals, range.days, { weekday: range.days > 1 });
  if (tiles.length === 0) {
    return <p className="px-1 pb-3 text-xs text-muted-foreground">No work yet in this range.</p>;
  }
  // The legend keys the colors: one entry per named color, and every agent
  // past the palette under one "Other", as the ribbon draws them.
  const working = range.agents.filter((a) => a.agentMinutes >= 1);
  const shown = working.filter((a) => a.color !== 0);
  const others = working.filter((a) => a.color === 0);
  const otherMinutes = others.reduce((sum, a) => sum + a.agentMinutes, 0);

  return (
    <div className={cn('space-y-2.5 px-1 pb-3 transition-opacity', stale && 'opacity-40')} aria-busy={stale}>
      <div className="flex items-start gap-2">
        <dl className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
          {tiles.map((t, i) => (
            <div key={t.key} className="rounded-lg border border-border/70 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{t.label}</dt>
              <dd className={cn('font-semibold leading-tight text-foreground', i === 0 ? 'text-2xl' : 'text-xl')}>{t.value}</dd>
              {t.context.map((line) => (
                <dd key={line} className="text-[11px] leading-snug text-muted-foreground">
                  {line}
                </dd>
              ))}
            </div>
          ))}
        </dl>
        <ReportButton range={range} />
      </div>
      {working.length > 0 && (
        <ul aria-label="Agents" className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {shown.map((a) => (
            <li key={a.id ?? 'ri'} className="flex items-center gap-1.5 text-[11px]">
              <span className="size-2 shrink-0 rounded-[2px]" style={agentStyle(a.color).dot} aria-hidden />
              <span className="text-foreground/90">{a.name}</span>
              <span className="text-muted-foreground">{formatDuration(a.agentMinutes)}</span>
            </li>
          ))}
          {others.length > 0 && (
            <li className="flex items-center gap-1.5 text-[11px]" title={others.map((a) => a.name).join(', ')}>
              <span className="size-2 shrink-0 rounded-[2px]" style={agentStyle(0).dot} aria-hidden />
              <span className="text-foreground/90">Other</span>
              <span className="text-muted-foreground">{formatDuration(otherMinutes)}</span>
            </li>
          )}
          <li className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2.5 w-[3px] shrink-0 rounded-full bg-foreground/60" aria-hidden />
            You, hands-on
          </li>
        </ul>
      )}
    </div>
  );
}

function ReportButton({ range }: { range: WorkRange }) {
  const save = useSaveWorkReport();
  const { openNote } = useDashboard();
  const [copied, setCopied] = useState(false);
  const extra = [textureLine(range.totals, { weekday: range.days > 1 }), wordsLine(range.totals), speedLine(range.totals)].filter(
    (l): l is string => !!l,
  );
  const text = [...range.report, ...extra].join('\n');

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
      <PopoverContent align="end" className="w-[26rem] p-0">
        <div className="space-y-1.5 px-3 py-2.5">
          {range.report.map((line) => (
            <p key={line} className="text-xs leading-relaxed text-foreground">
              {line}
            </p>
          ))}
        </div>
        {extra.length > 0 && (
          <div className="space-y-1 border-t border-border/60 px-3 py-2.5">
            {extra.map((line) => (
              <p key={line} className="text-[11px] leading-relaxed text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        )}
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
            onClick={() => save.mutate({ start: range.start, days: range.days }, { onSuccess: (note) => openNote(note.id) })}
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
