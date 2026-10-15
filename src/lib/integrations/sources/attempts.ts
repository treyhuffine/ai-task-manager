/**
 * Connection attempts for managed sources (docs/connector-service-spec.md §8). One attempt is one
 * browser consent: it records who asked, through which source, for which application and remote
 * account, where the browser returns, and when it expires. It is bound to the remote account id
 * the source assigned when the link was created, so completion can be checked against exactly
 * that account, and it can complete only once.
 *
 * Attempts are a file under the integrations dir rather than memory, so the callback, the
 * polling fallback and a restarted server all finish the same attempt.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getIntegrationsDir } from '../storage';
import { APPLICATION_IDS } from './types';

export const ATTEMPTS_FILE = 'managed-attempts.json';
/** The local bound when the source's own expiry is later or missing. */
export const ATTEMPT_MAX_AGE_MS = 30 * 60_000;
/** Settled attempts are kept this long so a replayed callback lands on the same result. */
const SETTLED_RETENTION_MS = 24 * 60 * 60_000;

const attemptSchema = z.object({
  id: z.string().regex(/^att_[a-f0-9]{32}$/),
  ownerId: z.string(),
  sourceId: z.string(),
  remoteUserId: z.string(),
  applicationId: z.enum(APPLICATION_IDS),
  toolkitSlug: z.string(),
  remoteAuthConfigId: z.string(),
  remoteAccountId: z.string(),
  /** The consent link, kept so a repeated Connect (or a restart) reuses it instead of starting another. */
  redirectUrl: z.string().url().optional(),
  purpose: z.enum(['connect', 'reconnect']),
  /** Reconnect only: the local connection this consent repairs. */
  connectionId: z.string().optional(),
  label: z.string().max(80).optional(),
  /** Same-origin path the browser returns to. */
  returnTo: z.string().optional(),
  /** The origin the browser came from (a phone viewing the home, or the host). */
  origin: z.string().optional(),
  /** A chat's connection request card this attempt answers. */
  requestEventId: z.string().optional(),
  /** Ask for Calendar view and deck use when the account is saved. */
  calendarUse: z.boolean().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.enum(['pending', 'completed', 'failed', 'expired', 'cancelled']),
  connectionIdResult: z.string().optional(),
  /** The verified identity (or label) of the account this attempt connected, for every later read. */
  accountResult: z.string().max(300).optional(),
  error: z.string().optional(),
  settledAt: z.number().optional(),
}).strict();
export type ConnectAttempt = z.infer<typeof attemptSchema>;

const documentSchema = z.object({ version: z.literal(1), attempts: z.array(attemptSchema) }).strict();

function file(dir: string): string {
  return path.join(dir, ATTEMPTS_FILE);
}

function read(dir: string): ConnectAttempt[] {
  try {
    const parsed = documentSchema.safeParse(JSON.parse(fs.readFileSync(file(dir), 'utf8')));
    return parsed.success ? parsed.data.attempts : [];
  } catch {
    return [];
  }
}

function update<T>(dir: string, change: (attempts: ConnectAttempt[]) => { attempts: ConnectAttempt[]; result: T }): T {
  const target = file(dir);
  return withFileLock(target, () => {
    const now = Date.now();
    // Expire and prune on every write, so the file stays small and stale attempts can't settle.
    const current = read(dir).flatMap(attempt => {
      if (attempt.status === 'pending' && attempt.expiresAt <= now) return [{ ...attempt, status: 'expired' as const, settledAt: now }];
      if (attempt.status !== 'pending' && (attempt.settledAt ?? attempt.createdAt) + SETTLED_RETENTION_MS < now) return [];
      return [attempt];
    });
    const { attempts, result } = change(current);
    atomicWriteFile(target, `${JSON.stringify({ version: 1, attempts }, null, 2)}\n`);
    return result;
  });
}

export function newAttemptId(): string {
  return `att_${randomBytes(16).toString('hex')}`;
}

export type NewAttempt = Omit<ConnectAttempt, 'status' | 'createdAt' | 'expiresAt' | 'connectionIdResult' | 'accountResult' | 'error' | 'settledAt'> & {
  /** The source's link expiry. The attempt never outlives it. */
  linkExpiresAt: string;
};

export function createAttempt(input: NewAttempt, dir = getIntegrationsDir()): ConnectAttempt {
  const now = Date.now();
  const vendorExpiry = Date.parse(input.linkExpiresAt);
  const expiresAt = Math.min(now + ATTEMPT_MAX_AGE_MS, Number.isFinite(vendorExpiry) ? vendorExpiry : now + ATTEMPT_MAX_AGE_MS);
  const rest: Omit<NewAttempt, 'linkExpiresAt'> & { linkExpiresAt?: string } = { ...input };
  delete rest.linkExpiresAt;
  const attempt: ConnectAttempt = { ...rest, status: 'pending', createdAt: now, expiresAt };
  attemptSchema.parse(attempt);
  return update(dir, attempts => ({ attempts: [...attempts, attempt], result: attempt }));
}

export function getAttempt(id: string, dir = getIntegrationsDir()): ConnectAttempt | null {
  const attempt = read(dir).find(candidate => candidate.id === id) ?? null;
  if (attempt?.status === 'pending' && attempt.expiresAt <= Date.now()) return { ...attempt, status: 'expired' };
  return attempt;
}

/** A still-pending attempt for the same target, to reuse instead of starting another consent. */
export function findPendingAttempt(match: { sourceId: string; applicationId: string; purpose: ConnectAttempt['purpose']; connectionId?: string; requestEventId?: string }, dir = getIntegrationsDir()): ConnectAttempt | null {
  const now = Date.now();
  return read(dir).find(attempt => attempt.status === 'pending' && attempt.expiresAt > now
    && attempt.sourceId === match.sourceId && attempt.applicationId === match.applicationId && attempt.purpose === match.purpose
    && attempt.connectionId === match.connectionId && attempt.requestEventId === match.requestEventId) ?? null;
}

export type SettleResult =
  | { kind: 'settled'; attempt: ConnectAttempt }
  /** Already settled: a replay returns the first outcome and changes nothing. */
  | { kind: 'already'; attempt: ConnectAttempt }
  | { kind: 'missing' };

/**
 * Settle a pending attempt exactly once. Settling an attempt that is already settled returns its
 * first result, so a replayed callback or a racing poll can't create a second account or grant.
 */
export function settleAttempt(id: string, outcome: { status: 'completed'; connectionId: string; account?: string } | { status: 'failed' | 'cancelled'; error: string }, dir = getIntegrationsDir()): SettleResult {
  return update(dir, attempts => {
    const index = attempts.findIndex(attempt => attempt.id === id);
    if (index < 0) return { attempts, result: { kind: 'missing' } as SettleResult };
    const attempt = attempts[index]!;
    if (attempt.status !== 'pending') return { attempts, result: { kind: 'already', attempt } as SettleResult };
    const settled: ConnectAttempt = outcome.status === 'completed'
      ? { ...attempt, status: 'completed', connectionIdResult: outcome.connectionId, ...(outcome.account ? { accountResult: outcome.account.slice(0, 300) } : {}), settledAt: Date.now() }
      : { ...attempt, status: outcome.status, error: outcome.error.slice(0, 300), settledAt: Date.now() };
    const next = [...attempts];
    next[index] = settled;
    return { attempts: next, result: { kind: 'settled', attempt: settled } as SettleResult };
  });
}

/** Attempts still waiting for consent, for restart recovery and polling. */
export function pendingAttempts(dir = getIntegrationsDir()): ConnectAttempt[] {
  const now = Date.now();
  return read(dir).filter(attempt => attempt.status === 'pending' && attempt.expiresAt > now);
}
