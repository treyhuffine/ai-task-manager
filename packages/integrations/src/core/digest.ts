/**
 * Canonical hashing for the approval-grant contract (§8). The agent regenerates
 * its tool call on retry; if the grant key were a naive serialization, reordered
 * keys or a re-serialized date would change it and the user would be re-prompted
 * (or the agent would loop). So the digest is computed over a canonical form of
 * the *post-Zod-parse* input: sorted keys, normalized values, stable output.
 */
import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonical);
  const t = typeof value;
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue; // omit undefined for stability
      out[key] = canonical(obj[key]);
    }
    return out;
  }
  if (t === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (t === 'bigint') return (value as bigint).toString();
  if (t === 'string' || t === 'boolean') return value;
  // functions, symbols, undefined → dropped
  return null;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Stable hash of the post-parse input — the grant key (§8). */
export function inputDigest(value: unknown): string {
  return sha256(canonicalStringify(value));
}

/**
 * Best-effort structural fingerprint of a Zod schema. Walks `_def` defensively;
 * a coarse fallback is fine — its only job is to change when the shape changes,
 * and a benign over/under-invalidation of short-lived grants is acceptable.
 */
function fingerprint(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== 'object' || depth > 8) return '?';
  const def = (schema as { _def?: Record<string, unknown> })._def;
  if (!def) return '?';
  const tn = (def.typeName as string) ?? (def.type as string) ?? '?';
  try {
    if (tn === 'ZodObject' || def.shape) {
      const rawShape = typeof def.shape === 'function' ? (def.shape as () => unknown)() : def.shape;
      const shape = (rawShape ?? {}) as Record<string, unknown>;
      const keys = Object.keys(shape).sort();
      return `obj{${keys.map((k) => `${k}:${fingerprint(shape[k], depth + 1)}`).join(',')}}`;
    }
    if (tn === 'ZodArray') return `arr[${fingerprint(def.type ?? def.element, depth + 1)}]`;
    if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodDefault') {
      return `${tn}<${fingerprint(def.innerType, depth + 1)}>`;
    }
    if (tn === 'ZodUnion') {
      const opts = (def.options as unknown[]) ?? [];
      return `union(${opts.map((o) => fingerprint(o, depth + 1)).join('|')})`;
    }
    if (tn === 'ZodEnum') return `enum(${((def.values as unknown[]) ?? []).join(',')})`;
  } catch {
    /* fall through to coarse fingerprint */
  }
  return String(tn);
}

export function schemaFingerprint(schema: unknown): string {
  return fingerprint(schema);
}

/**
 * Runtime-derived action version (§8). Hashes the input-schema shape + risk +
 * mutating so a grant auto-invalidates when any of them change — a grant issued
 * against a low-risk version can never silently approve a now-high-risk one.
 */
export function actionVersion(input: { inputSchema: unknown; risk: string; mutating: boolean }): string {
  return sha256(`${input.risk}:${input.mutating}:${schemaFingerprint(input.inputSchema)}`);
}
