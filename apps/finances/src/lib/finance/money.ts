/** Financial amounts are exact integer minor units. Never round an input float. */
export function exactAmount(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new RangeError('Financial amount must be an exact safe integer');
  return value;
}
export function sumMoney(values: Iterable<number>): number {
  let sum = BigInt(0);
  for (const value of values) sum += BigInt(exactAmount(value));
  return exactAmount(Number(sum));
}
export function currencyDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  return (
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function parseMoney(text: string, currency: string): number {
  const clean = text.trim().replace(/[$,\s]/g, '');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!match) throw new Error('Invalid monetary amount');
  const digits = currencyDigits(currency);
  if ((match[3]?.length ?? 0) > digits)
    throw new Error('Too many currency decimal places');
  const n =
    BigInt(match[2]) * BigInt(10) ** BigInt(digits) +
    BigInt((match[3] ?? '').padEnd(digits, '0') || '0');
  return exactAmount(Number(match[1] ? -n : n));
}
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    exactAmount(minor) / 10 ** currencyDigits(currency),
  );
}
/** Largest remainder allocation, stable ties, and conservation of every minor unit. */
export function allocateMoney(total: number, weights: number[]): number[] {
  exactAmount(total);
  if (!weights.length || weights.some((w) => !Number.isSafeInteger(w) || w < 0))
    throw new Error('Invalid allocation weights');
  const denominator = weights.reduce((s, w) => s + BigInt(w), BigInt(0));
  if (!denominator) throw new Error('Allocation needs positive weight');
  const magnitude = BigInt(Math.abs(total));
  const parts = weights.map((w, i) => ({
    i,
    value: (magnitude * BigInt(w)) / denominator,
    remainder: (magnitude * BigInt(w)) % denominator,
  }));
  let remaining = magnitude - parts.reduce((s, p) => s + p.value, BigInt(0));
  for (const p of [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (remaining === BigInt(0)) break;
    p.value++;
    remaining--;
  }
  return parts.map((p) => exactAmount(Number(p.value) * (total < 0 ? -1 : 1)));
}
