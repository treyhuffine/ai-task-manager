/** Small text helpers shared by the domain. No I/O. */

/** A case- and accent-insensitive sort key that keeps Unicode letters. */
export function sortKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** A human name typed or imported: collapse whitespace, bound length. */
export function cleanName(value: string | null | undefined, max = 200): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export function cleanText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/** Lower-case letters and digits only, for comparing passages and claims. */
export function fingerprintText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Word-set Jaccard similarity of two fingerprints. */
export function similarity(a: string, b: string): number {
  const left = new Set(fingerprintText(a).split(' ').filter(Boolean));
  const right = new Set(fingerprintText(b).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Organization names compared for candidate matching only. Never proof of identity. */
export function organizationKey(name: string): string {
  return fingerprintText(name)
    .replace(/\b(inc|incorporated|llc|ltd|limited|gmbh|corp|corporation|co|company|plc|sa|ag|bv|pty)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function personNameKey(name: string): string {
  return fingerprintText(name);
}

export const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** A website or domain reduced to its host, or null when it is not one. */
export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const host = trimmed.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
