import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor } from '@ri/app-kit/data';
import { emailDomain, normalizeEmail } from '@ri/app-kit/sources';
import { z } from 'zod/v4';
import { iso, newId, type Ctx } from './context.js';
import { touch } from './scope.js';
import { domainOf } from './text.js';

export type ExclusionDecision = 'auto' | 'excluded' | 'included' | 'suppressed';
type Row = { id: string; kind: 'sender' | 'domain'; normalized: string; decision: ExclusionDecision; reason: string; seen_count: number; last_seen_at: string | null; revision: number; updated_at: string };

/**
 * Sender rules before any AI: a user's Exclude or Include persists across
 * syncs, a suppressed identifier is never rediscovered, and bulk senders are
 * counted so the owner can include one explicitly.
 */
export function senderDecision(ctx: Ctx, address: string): ExclusionDecision | null {
  const normalized = normalizeEmail(address);
  const sender = ctx.db.get<Row>("SELECT * FROM exclusions WHERE kind = 'sender' AND normalized = ?", normalized);
  if (sender && sender.decision !== 'auto') return sender.decision;
  const domain = emailDomain(normalized);
  const byDomain = domain ? ctx.db.get<Row>("SELECT * FROM exclusions WHERE kind = 'domain' AND normalized = ?", domain) : undefined;
  if (byDomain && byDomain.decision !== 'auto') return byDomain.decision;
  return sender ? 'auto' : null;
}
export const isBlocked = (decision: ExclusionDecision | null) => decision === 'excluded' || decision === 'suppressed';

/** Count a bulk or automated sender that was left out, without storing its mail. */
export function noteAutoExclusion(ctx: Ctx, address: string, reason: string, sourceKey: string) {
  const normalized = normalizeEmail(address), time = iso(ctx);
  ctx.db.run(
    `INSERT INTO exclusions (id, created_at, updated_at, revision, kind, normalized, decision, reason, seen_count, last_seen_at, source_key) VALUES (?, ?, ?, 1, 'sender', ?, 'auto', ?, 1, ?, ?)
     ON CONFLICT(kind, normalized) DO UPDATE SET seen_count = exclusions.seen_count + 1, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at,
       reason = CASE WHEN exclusions.decision = 'auto' THEN excluded.reason ELSE exclusions.reason END`,
    newId(), time, time, normalized, reason.slice(0, 120), time, sourceKey,
  );
}

export function saveExclusion(ctx: Ctx, input: { value: string; kind: 'sender' | 'domain'; decision: 'excluded' | 'included' | 'suppressed' | 'clear' }) {
  const normalized = input.kind === 'sender' ? normalizeEmail(input.value) : domainOf(input.value);
  if (!normalized || (input.kind === 'sender' && !/^[^\s@]+@[^\s@]+$/.test(normalized))) throw new AppError('invalid_input', input.kind === 'sender' ? 'Enter an email address' : 'Enter a domain such as newsletter.example');
  const time = iso(ctx);
  if (input.decision === 'clear') {
    ctx.db.run("UPDATE exclusions SET decision = 'auto', reason = 'Cleared by you', revision = revision + 1, updated_at = ? WHERE kind = ? AND normalized = ?", time, input.kind, normalized);
  } else {
    const reason = input.decision === 'excluded' ? 'Excluded by you' : input.decision === 'included' ? 'Included by you' : 'Rediscovery suppressed by you';
    ctx.db.run(
      `INSERT INTO exclusions (id, created_at, updated_at, revision, kind, normalized, decision, reason, seen_count, last_seen_at, source_key) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 0, NULL, NULL)
       ON CONFLICT(kind, normalized) DO UPDATE SET decision = excluded.decision, reason = excluded.reason, revision = exclusions.revision + 1, updated_at = excluded.updated_at`,
      newId(), time, time, input.kind, normalized, input.decision, reason,
    );
  }
  touch(ctx);
  return ctx.db.get<Row>('SELECT * FROM exclusions WHERE kind = ? AND normalized = ?', input.kind, normalized)!;
}

const cursorSchema = z.object({ k: z.string(), id: z.string() }).strict();
export function listExclusions(ctx: Ctx, input: { decision?: ExclusionDecision; cursor?: string; limit: number }) {
  const cursor = decodeCursor(cursorSchema, input.cursor);
  const rows = ctx.db.all<Row & { k: string }>(
    `SELECT *, COALESCE(last_seen_at, updated_at) || id AS k FROM exclusions WHERE 1 ${input.decision ? 'AND decision = ?' : ''} ${cursor ? 'AND (COALESCE(last_seen_at, updated_at) || id) < ?' : ''} ORDER BY k DESC LIMIT ?`,
    ...(input.decision ? [input.decision] : []), ...(cursor ? [cursor.k] : []), input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items: items.map((row) => ({ id: row.id, kind: row.kind, value: row.normalized, decision: row.decision, reason: row.reason, seenCount: Number(row.seen_count), lastSeenAt: row.last_seen_at })),
    nextCursor: rows.length > input.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null,
  };
}
export function exclusionCounts(ctx: Ctx) {
  const counts = { auto: 0, excluded: 0, included: 0, suppressed: 0 };
  for (const row of ctx.db.all<{ decision: ExclusionDecision; count: number }>('SELECT decision, COUNT(*) AS count FROM exclusions GROUP BY decision')) counts[row.decision] = Number(row.count);
  return counts;
}
