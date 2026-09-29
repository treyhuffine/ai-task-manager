/** First `x.y.z` in a CLI's version output, or null when there is none. */
export function parseSemver(s: string): string | null {
  const m = s.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

/** Compare dotted numeric versions (`x.y.z`). Returns -1 / 0 / 1. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
