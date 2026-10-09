import type { FinancePlan } from './contracts';
export function financeBudgetDiff(before: FinancePlan, after: FinancePlan) {
  const flatten = (plan: FinancePlan) => {
    const values = new Map<
      string,
      { label: string; value: string | number | null; money: boolean }
    >();
    const visit = (value: unknown, path: string[], labels: string[]) => {
      if (Array.isArray(value)) {
        for (const row of value)
          visit(
            row,
            [...path, row.id],
            [...labels, row.name ?? row.merchant ?? row.id],
          );
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value))
          if (key !== 'id')
            visit(
              v,
              [...path, key],
              [...labels, key.replace(/Minor$/, '').replace(/([A-Z])/g, ' $1')],
            );
        return;
      }
      values.set(path.join('.'), {
        label: labels.join(' / '),
        value:
          value == null
            ? null
            : typeof value === 'number'
              ? value
              : String(value),
        money: path.at(-1)?.endsWith('Minor') ?? false,
      });
    };
    visit(plan, [], []);
    return values;
  };
  const old = flatten(before),
    next = flatten(after);
  return [...new Set([...old.keys(), ...next.keys()])].flatMap((key) => {
    const a = old.get(key),
      b = next.get(key);
    return a?.value === b?.value
      ? []
      : [
          {
            field: key,
            label: (b ?? a)!.label,
            before: a?.value ?? null,
            after: b?.value ?? null,
            money: (b ?? a)!.money,
            currency: after.currency,
          },
        ];
  });
}
