'use client';

/**
 * Budget warning pill — TopHud's only spend signal. Silent until
 * `warn` (≥75%) or `block` (≥100%); at that point it's actionable and
 * urgent. Below 75% the indicator stays hidden because nothing about
 * spending requires the user's attention.
 *
 * Click opens the settings modal on the Models section, where the budget
 * control + the spending breakdown live (under "Usage & budget").
 */

import { AlertTriangle } from 'lucide-react';
import { useRunsStats } from '@/hooks/use-runs-stats';
import { openSettings } from '@/components/settings/settings-store';
import { cn } from '@/lib/utils';

export function BudgetWarningPill() {
  const { data } = useRunsStats();
  if (!data) return null;
  if (data.budgetState === 'ok') return null;

  const pct = Math.round((data.budgetFraction ?? 0) * 100);
  const tone =
    data.budgetState === 'block'
      ? 'text-destructive border-destructive/40 bg-destructive/10'
      : 'text-amber-600 border-amber-500/40 bg-amber-500/10 dark:text-amber-400';
  const message =
    data.budgetState === 'block'
      ? `Budget exceeded. Triggers auto-paused`
      : `Budget ${pct}% used`;

  return (
    <button
      type="button"
      onClick={() => openSettings('models')}
      title={
        data.budget != null
          ? `${pct}% of $${data.budget.toFixed(2)} monthly budget`
          : undefined
      }
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium',
        tone,
      )}
    >
      <AlertTriangle size={11} />
      <span>{message}</span>
    </button>
  );
}
