"use client";

import { Loader2 } from 'lucide-react';
import { formatDuration, formatHours, formatSpan, formatTimes, leverageChain, workTiles, type LeverageChain } from '@/lib/work/equivalents';
import type { WorkRange } from '@/lib/work/types';
import { cn } from '@/lib/utils';
import { agentStyle } from './work-style';
import { Tip } from '@/components/ui/tip';

/**
 * The numbers at the top of the calendar with agent work on (docs/work-view.md,
 * "The numbers"), the same on every tab: the leverage as a chain (your time,
 * the agent time it set going, the human time for the same work), then tiles that
 * read as sentences. With `legend`, a row keying the ribbon's colors. The
 * sentences live in the Report tab, so the numbers stay scannable. While the
 * next range loads, the last one's numbers hold, dimmed.
 */
export function WorkStats({ range, stale = false, legend = false }: { range: WorkRange | undefined; stale?: boolean; legend?: boolean }) {
  if (!range) {
    return (
      <div className="flex min-h-16 items-center gap-2 px-1 pb-3 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        Adding up the work. The first time reads all your history, which takes a few seconds.
      </div>
    );
  }
  const chain = leverageChain(range.totals);
  const tiles = workTiles(range.totals, range.days, { weekday: range.days > 1 });
  if (!chain && tiles.length === 0) {
    return <p className="px-1 pb-3 text-xs text-muted-foreground">No agent work yet in this range.</p>;
  }

  return (
    <div className={cn('space-y-2.5 px-1 pb-3 transition-opacity', stale && 'opacity-40')} aria-busy={stale}>
      <div className="flex flex-wrap items-stretch gap-2">
        {chain && <ChainCard chain={chain} />}
        {tiles.length > 0 && (
          <dl className="contents">
            {tiles.map((t) => (
              <div key={t.key} className="min-w-[8.5rem] flex-1 basis-[9rem] rounded-lg border border-border/70 px-3 py-2">
                <dt className="text-[11px] text-muted-foreground">{t.label}</dt>
                <dd className={cn('font-semibold leading-tight text-foreground', t.value.length > 12 ? 'text-base' : 'text-xl')}>{t.value}</dd>
                {t.context.map((line) => (
                  <dd key={line} className="text-[11px] leading-snug text-muted-foreground">
                    {line}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        )}
      </div>
      {legend && <AgentLegend range={range} />}
    </div>
  );
}

/**
 * Your time → agent time → human time for the same work. What it says: this
 * much of your time set your agents working this long, and doing all of it
 * by hand would take a person this long. The multiplier on each arrow is that
 * step, and the two together are how far your time went.
 */
function ChainCard({ chain }: { chain: LeverageChain }) {
  const toAgents = chain.agentsPerHour
    ? `Your agents worked about ${formatHours(chain.agentsPerHour)} hours for every hour of yours.`
    : undefined;
  const toPerson = chain.personPerAgentHour
    ? `Each hour of agent time did about ${formatHours(chain.personPerAgentHour)} hours of human work.`
    : undefined;
  return (
    <dl
      aria-label="Your leverage"
      className="flex min-w-[min(100%,30rem)] grow-[3] basis-[32rem] items-start gap-3 rounded-lg border border-border/70 px-3 py-2"
    >
      <ChainStep
        label="Your time"
        value={formatSpan(chain.handsOnMinutes)}
        title={`${formatDuration(chain.handsOnMinutes)} in chats with your agents: prompting, answering and reviewing.`}
        context="prompting and reviewing"
      />
      <ChainArrow times={chain.agentsPerHour} title={toAgents} />
      <ChainStep
        label="Agent time"
        value={formatSpan(chain.agentMinutes)}
        title={`${formatDuration(chain.agentMinutes)} of your agents working, added up across every chat. Two agents working side by side for an hour count as two hours.`}
        context={chain.whileAwayMinutes >= 30 ? `${formatSpan(chain.whileAwayMinutes)} while you were away` : undefined}
      />
      <ChainArrow times={chain.personPerAgentHour} title={toPerson} />
      <ChainStep
        label="Human time for the same work"
        value={`${formatHours(chain.personHours)}h`}
        title="Roughly how long a skilled person would take to do all of this by hand. An estimate, to give a sense of scale."
        context={chain.leverage ? `${formatTimes(chain.leverage)} your time` : undefined}
        hero
      />
    </dl>
  );
}

function ChainStep({ label, value, context, title, hero = false }: { label: string; value: string; context?: string; title: string; hero?: boolean }) {
  return (
    <Tip label={title}>
      <div className="shrink-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className={cn('font-semibold leading-tight text-foreground', hero ? 'text-2xl' : 'text-xl')}>{value}</dd>
        {context && <dd className="text-[11px] leading-snug text-muted-foreground">{context}</dd>}
      </div>
    </Tip>
  );
}

/** A connector across the gap between two steps, that step's multiplier over it. */
function ChainArrow({ times, title }: { times: number | null; title: string | undefined }) {
  return (
    <Tip label={title}>
      <div className="flex min-w-10 flex-1 flex-col pt-3.5" aria-hidden={!times}>
        <span className="h-4 text-center text-[11px] font-medium leading-4 text-muted-foreground">{times ? formatTimes(times) : ''}</span>
        <span className="relative mt-[3px] h-px bg-muted-foreground/40" aria-hidden>
          <span className="absolute -right-px top-1/2 size-[7px] -translate-y-1/2 rotate-45 border-t border-r border-muted-foreground/60" />
        </span>
        {title && <span className="sr-only">{title}</span>}
      </div>
    </Tip>
  );
}

/**
 * Keys the ribbon's colors: one entry per named color, every agent past the
 * palette under one "Other" (hover for the names), as the ribbon draws them,
 * and the thin line that is you.
 */
function AgentLegend({ range }: { range: WorkRange }) {
  const working = range.agents.filter((a) => a.agentMinutes >= 1);
  if (working.length === 0) return null;
  const shown = working.filter((a) => a.color !== 0);
  const others = working.filter((a) => a.color === 0);
  const otherMinutes = others.reduce((sum, a) => sum + a.agentMinutes, 0);
  return (
    <ul aria-label="Agents" className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {shown.map((a) => (
        <li key={a.id ?? 'ri'} className="flex items-center gap-1.5 text-[11px]">
          <span className="size-2 shrink-0 rounded-[2px]" style={agentStyle(a.color).dot} aria-hidden />
          <span className="text-foreground/90">{a.name}</span>
          <span className="text-muted-foreground">{formatDuration(a.agentMinutes)}</span>
        </li>
      ))}
      {others.length > 0 && (
        <Tip label={others.map((a) => a.name).join(', ')}>
          <li className="flex items-center gap-1.5 text-[11px]">
            <span className="size-2 shrink-0 rounded-[2px]" style={agentStyle(0).dot} aria-hidden />
            <span className="text-foreground/90">Other</span>
            <span className="text-muted-foreground">{formatDuration(otherMinutes)}</span>
          </li>
        </Tip>
      )}
      <li className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="h-2.5 w-[3px] shrink-0 rounded-full bg-foreground/60" aria-hidden />
        Your time
      </li>
    </ul>
  );
}
