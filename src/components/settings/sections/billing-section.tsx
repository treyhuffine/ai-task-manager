'use client';

import { useEffect, useState } from 'react';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { useRunsStats } from '@/hooks/use-runs-stats';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

/**
 * Spend so far (today + this month, from the same `/api/runs/stats` the TopHud
 * budget pill reads) plus an optional monthly USD cap persisted to
 * `user_state.monthlyBudgetUsd`.
 */
export function BillingSection() {
  const { data: userState } = useUserState();
  const update = useUpdateUserState();

  return (
    <div className="space-y-3">
      <SpendingSummary />
      <BudgetField value={userState?.monthlyBudgetUsd ?? null} onSave={(v) => update.mutate({ monthlyBudgetUsd: v })} />
    </div>
  );
}

function BudgetField({ value, onSave }: { value: number | null; onSave: (next: number | null) => void }) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');
  useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);
  const unlimited = value == null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Monthly budget</p>
        {unlimited && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Unlimited</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/60">
        Set a USD cap and the TopHud warns at 75%, auto-pauses scheduled runs at 100% (manual sends ask first). Default
        is unlimited.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={draft}
          placeholder="Unlimited"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            if (!trimmed) {
              if (value != null) onSave(null);
              return;
            }
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed) || parsed < 0) {
              setDraft(value != null ? String(value) : '');
              return;
            }
            if (parsed !== value) onSave(parsed);
          }}
          className="w-32 rounded-md border border-border bg-card px-2 py-1 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-[11px] text-muted-foreground/60">/ month</span>
      </div>
    </div>
  );
}

function SpendingSummary() {
  const { data } = useRunsStats();
  if (!data) {
    return <SettingsSkeleton rows={1} />;
  }
  const hasBudget = data.budget != null && data.budget > 0;
  const pct = data.budgetFraction != null ? Math.round(data.budgetFraction * 100) : null;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <SpendRow label="Today" value={data.todaySpend} />
      <SpendRow
        label="This month"
        value={data.monthSpend}
        right={
          hasBudget && pct != null ? (
            <span
              className={`text-[11px] tabular-nums ${
                data.budgetState === 'block'
                  ? 'text-destructive'
                  : data.budgetState === 'warn'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
              }`}
            >
              {pct}% of ${data.budget!.toFixed(0)}
            </span>
          ) : null
        }
      />
    </div>
  );
}

function SpendRow({ label, value, right }: { label: string; value: number; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">${value.toFixed(2)}</span>
        {right}
      </div>
    </div>
  );
}
