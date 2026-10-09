/**
 * The latest account rate limits each harness reported, for the top bar's
 * rate limits pill.
 *
 * Limits belong to the harness account, not to a chat: every Claude Code chat
 * on this home draws from the same windows. So the runner hands every
 * `rate_limits` event from any chat here (`local-runner.ts`), and this keeps
 * one merged snapshot per harness. Nothing is polled. A limit is as fresh as
 * the last chat that ran on that harness, and the pill says how old it is.
 *
 * Updates merge the way agentex describes them (docs/telemetry.md in
 * @agentex/agent): `replace` is authoritative, `merge` updates only the
 * buckets it carries, an older bucket never overwrites a newer one, and
 * explicit removals and replaced collections drop only what they name. The
 * merged snapshot is kept in `processState` (the runner and the tRPC handler
 * are separate module copies) and written to the config folder, so the pill
 * still has something to show after a restart.
 *
 * Only chats this home runs report here. A chat on a connected device uses
 * that device's harness login, which may be another account.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RateLimitBucket, RateLimitUpdate } from '@agentex/agent';
import { getConfigDir } from '@/lib/config/paths';
import { processState } from '@/lib/process-state';
import { KNOWN_HARNESS_IDS, type HarnessId } from './registry';

/** A bucket as stored and shown: agentex's fields without the provider-native metadata. */
export type StoredRateLimitBucket = Omit<RateLimitBucket, 'metadata' | 'stale'>;

export interface HarnessRateLimits {
  harness: HarnessId;
  /** The newest observation in `buckets`. */
  observedAt: string;
  /** The provider's account id, when it reports one. A change starts over. */
  accountId?: string;
  buckets: StoredRateLimitBucket[];
}

type Store = Partial<Record<HarnessId, HarnessRateLimits>>;

const current = () => processState('harness.rate-limits', () => ({ loaded: false, store: {} as Store }));

function storePath(): string {
  return path.join(getConfigDir(), 'harness-rate-limits.json');
}

function load(): Store {
  const state = current();
  if (state.loaded) return state.store;
  state.loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Store;
    for (const id of KNOWN_HARNESS_IDS) {
      const entry = parsed[id];
      if (entry && Array.isArray(entry.buckets) && typeof entry.observedAt === 'string') state.store[id] = entry;
    }
  } catch { /* Nothing saved yet, or unreadable: start empty. */ }
  return state.store;
}

function save(store: Store): void {
  const file = storePath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, file);
}

function stored(bucket: RateLimitBucket): StoredRateLimitBucket {
  const copy: Partial<RateLimitBucket> = { ...bucket };
  delete copy.metadata;
  delete copy.stale;
  return copy as StoredRateLimitBucket;
}

const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

/** Apply one agentex update to a harness's merged snapshot. Pure. */
export function mergeRateLimits(
  harness: HarnessId,
  previous: HarnessRateLimits | undefined,
  update: RateLimitUpdate,
): HarnessRateLimits {
  const { snapshot } = update;
  const accountChanged = Boolean(previous?.accountId && snapshot.accountId && previous.accountId !== snapshot.accountId);
  const kept = update.mode === 'replace' || accountChanged ? undefined : previous;
  const byId = new Map<string, StoredRateLimitBucket>();
  if (kept) {
    const removed = new Set(update.removedBucketIds ?? []);
    const replaced = new Set(update.replacedCollectionIds ?? []);
    for (const bucket of kept.buckets) {
      const older = Date.parse(bucket.observedAt) <= Date.parse(snapshot.observedAt);
      if (older && (removed.has(bucket.id) || (bucket.collectionId && replaced.has(bucket.collectionId)))) continue;
      byId.set(bucket.id, bucket);
    }
  }
  for (const bucket of snapshot.buckets) {
    const existing = byId.get(bucket.id);
    if (existing && Date.parse(existing.observedAt) > Date.parse(bucket.observedAt)) continue;
    byId.set(bucket.id, stored(bucket));
  }
  const accountId = snapshot.accountId ?? (accountChanged ? undefined : previous?.accountId);
  return {
    harness,
    observedAt: kept ? later(kept.observedAt, snapshot.observedAt) : snapshot.observedAt,
    ...(accountId ? { accountId } : {}),
    buckets: [...byId.values()],
  };
}

/** Record a `rate_limits` event from one of this home's chats. */
export function recordRateLimits(harness: HarnessId, update: RateLimitUpdate): void {
  const store = load();
  store[harness] = mergeRateLimits(harness, store[harness], update);
  try {
    save(store);
  } catch (err) {
    // The pill still reads the in-memory copy. Only a restart loses it.
    console.warn('[rate-limits] could not save harness rate limits:', err);
  }
}

/** Every harness that has reported limits, in registry order. */
export function getHarnessRateLimits(): HarnessRateLimits[] {
  const store = load();
  return KNOWN_HARNESS_IDS.flatMap((id) => (store[id] ? [store[id]] : []));
}
