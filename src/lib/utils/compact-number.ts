/**
 * Compact count for tight UI slots (rail diff stats, badges). Small
 * numbers stay exact; large ones fold to one decimal ("1.2k", "48k",
 * "1.2m") so a runaway value can't eat the space next to it. Output
 * width is effectively bounded regardless of magnitude.
 */
const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatCompactCount(n: number): string {
  if (n < 1000) return String(n);
  return compact.format(n).toLowerCase();
}
