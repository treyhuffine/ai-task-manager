/**
 * Secret confinement as a primitive (§8). Secrets are *registered* (exact-match)
 * the moment they enter memory; `redact()` deep-scrubs any value bound for a log,
 * error, audit preview, tool I/O, or the UI. Exact-match beats regex: it only
 * misses a secret it was never told about, and we always know our own bytes.
 */
import type { Redactor } from './types';

// Don't register trivially short values — they'd scrub innocuous substrings.
const MIN_SECRET_LEN = 6;

function scrubString(s: string, secrets: Map<string, string>): string {
  let out = s;
  for (const [secret, replacement] of secrets) {
    if (out.includes(secret)) out = out.split(secret).join(replacement);
  }
  return out;
}

function deepRedact(value: unknown, secrets: Map<string, string>, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, secrets, seen));
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[scrubString(k, secrets)] = deepRedact(v, secrets, seen);
  }
  return out;
}

export function createRedactor(): Redactor {
  const secrets = new Map<string, string>();
  return {
    register(value, label) {
      if (typeof value !== 'string' || value.length < MIN_SECRET_LEN) return;
      secrets.set(value, label ? `[redacted:${label}]` : '[redacted]');
    },
    redact<T>(value: T): T {
      if (secrets.size === 0) return value;
      return deepRedact(value, secrets, new WeakSet()) as T;
    },
  };
}

/** A no-op redactor for contexts where confinement is handled elsewhere (tests). */
export function noopRedactor(): Redactor {
  return { register() {}, redact: (v) => v };
}
