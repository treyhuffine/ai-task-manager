/**
 * The letters an agent shows when it has no image or emoji of its own: the
 * first letter of each of its first two words. Agent names usually come from
 * their folder, so hyphens and underscores split words the way spaces do,
 * which keeps `insiderfinance-tradedata` (IT) apart from
 * `insiderfinance-fmp-rebuild` (IF).
 */
export function agentInitials(name: string): string {
  const letters = name
    .split(/[\s_-]+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((letter): letter is string => !!letter);
  if (letters.length === 0) return '·';
  return letters.slice(0, 2).join('').toUpperCase();
}
