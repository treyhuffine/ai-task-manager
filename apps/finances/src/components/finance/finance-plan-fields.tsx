'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FinancePlan } from '@/lib/finance/contracts';
import type { FinanceAccountRecord } from '@/db/types';
import { parseMoney, currencyDigits, formatMoney } from '@/lib/finance/money';
export function FinancePlanFields({
  plan,
  onChange,
  accounts,
}: {
  plan: FinancePlan;
  onChange: (p: FinancePlan) => void;
  accounts: FinanceAccountRecord[];
}) {
  const units = 10 ** currencyDigits(plan.currency);
  const amount = (label: string, value: number, set: (n: number) => void) => (
    <label className="text-xs">
      {label} ({plan.currency})
      <Input
        type="number"
        min="0"
        step={1 / units}
        value={value / units}
        onChange={(e) => {
          try {
            set(parseMoney(e.target.value || '0', plan.currency));
          } catch {}
        }}
      />
    </label>
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <h3 className="text-sm font-medium sm:col-span-2">
          Remaining variable spending forecast
        </h3>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Enter expected spending for the rest of this period beyond the posted,
          pending and known bills. Forecast changes do not silently change your
          adopted limits.
        </p>
        {plan.categories.map((c, i) =>
          amount(c.name, c.variableForecastMinor, (n) => {
            const categories = [...plan.categories];
            categories[i] = { ...c, variableForecastMinor: n };
            onChange({ ...plan, categories });
          }),
        )}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Known upcoming bills</h3>
        {plan.obligations.map((o, i) => (
          <div
            key={o.id}
            className="grid gap-2 rounded-lg bg-muted/25 p-3 sm:grid-cols-3"
          >
            <label className="text-xs">
              Merchant
              <Input
                value={o.merchant ?? ''}
                onChange={(e) =>
                  onChange({
                    ...plan,
                    obligations: plan.obligations.map((row, n) =>
                      n === i ? { ...row, merchant: e.target.value } : row,
                    ),
                  })
                }
              />
            </label>
            {amount('Amount', o.amountMinor, (n) =>
              onChange({
                ...plan,
                obligations: plan.obligations.map((row, j) =>
                  j === i ? { ...row, amountMinor: n } : row,
                ),
              }),
            )}
            <label className="text-xs">
              Due date
              <Input
                type="date"
                value={o.dueOn}
                onChange={(e) =>
                  onChange({
                    ...plan,
                    obligations: plan.obligations.map((row, n) =>
                      n === i ? { ...row, dueOn: e.target.value } : row,
                    ),
                  })
                }
              />
            </label>
            <label className="text-xs">
              Category
              <select
                className="block w-full rounded border border-border bg-background p-2"
                value={o.category}
                onChange={(e) =>
                  onChange({
                    ...plan,
                    obligations: plan.obligations.map((row, n) =>
                      n === i ? { ...row, category: e.target.value } : row,
                    ),
                  })
                }
              >
                {plan.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Movement
              <select
                className="block w-full rounded border border-border bg-background p-2"
                value={o.kind}
                onChange={(e) =>
                  onChange({
                    ...plan,
                    obligations: plan.obligations.map((row, n) =>
                      n === i
                        ? {
                            ...row,
                            kind: e.target.value as typeof row.kind,
                            reserveId: undefined,
                          }
                        : row,
                    ),
                  })
                }
              >
                <option value="purchase">Purchase or bill</option>
                <option value="card_payment">Card payment</option>
              </select>
            </label>
            {o.kind === 'purchase' && (
              <label className="text-xs">
                Fund from reserve
                <select
                  className="block w-full rounded border border-border bg-background p-2"
                  value={o.reserveId ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...plan,
                      obligations: plan.obligations.map((row, j) =>
                        j === i
                          ? { ...row, reserveId: e.target.value || undefined }
                          : row,
                      ),
                    })
                  }
                >
                  <option value="">No reserve funding</option>
                  {plan.reserves.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-xs">
              Account
              <select
                className="block w-full rounded border border-border bg-background p-2"
                value={o.accountId ?? ''}
                onChange={(e) =>
                  onChange({
                    ...plan,
                    obligations: plan.obligations.map((row, n) =>
                      n === i
                        ? { ...row, accountId: e.target.value || undefined }
                        : row,
                    ),
                  })
                }
              >
                <option value="">Choose account</option>
                {accounts
                  .filter(
                    (a) => o.kind !== 'card_payment' || a.kind === 'credit',
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...plan,
                  obligations: plan.obligations.filter((_, j) => j !== i),
                })
              }
            >
              Remove bill from plan
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onChange({
              ...plan,
              obligations: [
                ...plan.obligations,
                {
                  id: crypto.randomUUID(),
                  category: plan.categories[0].id,
                  amountMinor: 0,
                  dueOn: plan.startOn,
                  kind: 'purchase',
                  source: 'manual',
                  merchant: '',
                },
              ],
            })
          }
        >
          Add an upcoming bill
        </Button>
      </div>
      {(['goals', 'reserves'] as const).map((group) => (
        <div key={group} className="space-y-3">
          <h3 className="text-sm font-medium">
            {group === 'goals'
              ? 'Savings goals'
              : 'Reserves for irregular expenses'}
          </h3>
          <p className="text-xs text-muted-foreground">
            Contributions are budget allocations. They do not count as purchases
            or income.
          </p>
          {plan[group].map((row, i) => (
            <div
              key={row.id}
              className="grid gap-2 rounded-lg bg-muted/25 p-3 sm:grid-cols-3"
            >
              <label className="text-xs">
                Name
                <Input
                  value={row.name}
                  onChange={(e) =>
                    onChange({
                      ...plan,
                      [group]: plan[group].map((r, j) =>
                        j === i ? { ...r, name: e.target.value } : r,
                      ),
                    })
                  }
                />
              </label>
              {amount('Target', row.targetMinor, (n) =>
                onChange({
                  ...plan,
                  [group]: plan[group].map((r, j) =>
                    j === i ? { ...r, targetMinor: n } : r,
                  ),
                }),
              )}
              {amount('This period contribution', row.contributionMinor, (n) =>
                onChange({
                  ...plan,
                  [group]: plan[group].map((r, j) =>
                    j === i ? { ...r, contributionMinor: n } : r,
                  ),
                }),
              )}
              {amount('Already earmarked', row.heldMinor ?? 0, (n) =>
                onChange({
                  ...plan,
                  [group]: plan[group].map((r, j) =>
                    j === i ? { ...r, heldMinor: n } : r,
                  ),
                }),
              )}
              {group === 'goals' && (
                <label className="text-xs">
                  Goal deadline
                  <Input
                    type="date"
                    value={plan.goals[i].dueOn ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...plan,
                        goals: plan.goals.map((g, j) =>
                          j === i ? { ...g, dueOn: e.target.value || null } : g,
                        ),
                      })
                    }
                  />
                </label>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...plan,
                    [group]: plan[group].filter((_, j) => j !== i),
                    ...(group === 'reserves'
                      ? {
                          obligations: plan.obligations.map((o) =>
                            o.reserveId === row.id
                              ? { ...o, reserveId: undefined }
                              : o,
                          ),
                        }
                      : {}),
                  })
                }
              >
                Remove {group === 'goals' ? 'goal' : 'reserve'}
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...plan,
                [group]: [
                  ...plan[group],
                  {
                    id: crypto.randomUUID(),
                    name: group === 'goals' ? 'New goal' : 'Irregular expense',
                    targetMinor: 0,
                    contributionMinor: 0,
                    heldMinor: 0,
                    ...(group === 'goals' ? { dueOn: null } : {}),
                  },
                ],
              })
            }
          >
            Add {group === 'goals' ? 'savings goal' : 'expense reserve'}
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Expected income: {formatMoney(plan.incomeMinor, plan.currency)}. Review
        the draft amounts and assumptions before saving.
      </p>
    </div>
  );
}
