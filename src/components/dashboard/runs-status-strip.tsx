'use client';

/**
 * Right-aligned TopHud strip with the ambient run/budget indicators:
 *   - Active runs    (queued + running)
 *   - Today's spend
 *   - Budget % (only shown when a budget is set AND spend ≥ 50%)
 *
 * Per docs/async-agents-v1.md §4.8. Polls /api/runs/stats every 5s via
 * `useRunsStats`. Click handlers route to the appropriate surface:
 *   - Active runs → /schedules (deferred until #20)
 *   - Spend → opens the spend page (deferred — CLI hint for now)
 *   - Budget → /schedules (so user can pause if needed)
 */

import { Activity, DollarSign, AlertTriangle } from 'lucide-react';
import { useRunsStats } from '@/hooks/use-runs-stats';
import { cn } from '@/lib/utils';

export function RunsStatusStrip() {
  const { data } = useRunsStats();
  if (!data) return null;

  const showBudget =
    data.budgetFraction != null && data.budgetFraction >= 0.5;
  const budgetClass =
    data.budgetState === 'block'
      ? 'text-destructive border-destructive/40 bg-destructive/10'
      : data.budgetState === 'warn'
        ? 'text-amber-600 border-amber-500/40 bg-amber-500/10 dark:text-amber-400'
        : 'text-muted-foreground border-border';

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <button
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground"
        title={`${data.activeRuns} run(s) in flight`}
        type="button"
      >
        <Activity size={11} />
        <span className="tabular-nums">{data.activeRuns}</span>
      </button>

      <div className="h-3 w-px bg-border" />

      <span
        className="flex items-center gap-1 text-muted-foreground tabular-nums"
        title={`Today: $${data.todaySpend.toFixed(4)} · Month: $${data.monthSpend.toFixed(4)}`}
      >
        <DollarSign size={11} />
        {formatUsd(data.todaySpend)}
      </span>

      {showBudget && (
        <>
          <div className="h-3 w-px bg-border" />
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md border tabular-nums',
              budgetClass,
            )}
            title={
              data.budget != null
                ? `${(data.budgetFraction! * 100).toFixed(0)}% of $${data.budget.toFixed(2)} monthly budget`
                : 'Budget'
            }
          >
            {data.budgetState !== 'ok' && <AlertTriangle size={11} />}
            <span>{Math.round((data.budgetFraction ?? 0) * 100)}%</span>
          </button>
        </>
      )}
    </div>
  );
}

function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}
