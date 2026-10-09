/**
 * The latest account rate limits each harness reported, for the top bar's
 * rate limits pill.
 *
 * Limits belong to the harness account, not to a chat: every Claude Code chat
 * on this home draws from the same windows. So the runner hands every
 * `rate_limits` event from any chat here (`local-runner.ts`), and this keeps
 * one merged snapshot per harness. Nothing is polled. When someone hovers
 * the pill and a harness's limits are more than a minute old, Ri reads them
 * fresh outside any chat (`readHarnessRateLimits`, agentex's sessionless
 * `readRateLimits`: no prompt, no conversation history), at most once a
 * minute per harness. Until it returns, the pill shows the older numbers.
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
import { getProvider, type RateLimitBucket, type RateLimitUpdate } from '@agentex/agent';
import { getAppRoot, getConfigDir } from '@/lib/config/paths';
import { processState } from '@/lib/process-state';
import { HARNESS_IDS, HARNESS_REGISTRY, KNOWN_HARNESS_IDS, type HarnessId } from './registry';
import { runtimeContextForHarness } from './runtime';

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

const current = () => processState('harness.rate-limits', () => ({
  loaded: false,
  store: {} as Store,
  /** When each harness was last read outside a chat, successful or not. */
  readAt: {} as Partial<Record<HarnessId, number>>,
  /** The read in flight per harness, so a second hover waits on it instead of starting another. */
  reading: {} as Partial<Record<HarnessId, Promise<void>>>,
}));

/** A harness is read again only after this long, so hovering costs at most one read a minute. */
export const RATE_LIMIT_READ_AFTER_MS = 60_000;
const READ_TIMEOUT_MS = 15_000;

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

/** The enabled harnesses whose account limits can be read outside a chat (Claude Code and Codex today). */
function readableHarnesses(): HarnessId[] {
  return HARNESS_IDS.filter((id) => typeof getProvider(HARNESS_REGISTRY[id].agentexProviderId).readRateLimits === 'function');
}

function due(id: HarnessId, now: number): boolean {
  const entry = load()[id];
  const observed = entry ? Date.parse(entry.observedAt) : 0;
  return now - observed >= RATE_LIMIT_READ_AFTER_MS && now - (current().readAt[id] ?? 0) >= RATE_LIMIT_READ_AFTER_MS;
}

/** Whether hovering now should read any harness's limits. */
export function rateLimitsNeedRead(now = Date.now()): boolean {
  return readableHarnesses().some((id) => due(id, now));
}

async function readOne(id: HarnessId): Promise<void> {
  const ctx = await runtimeContextForHarness(id, { cwd: getAppRoot() });
  const observation = await getProvider(HARNESS_REGISTRY[id].agentexProviderId).readRateLimits!({
    cwd: ctx.cwd, env: ctx.env, config: ctx.config, timeoutMs: READ_TIMEOUT_MS,
  });
  // Unsupported (an API key, say) or unavailable leaves the last numbers as they were.
  if (observation.value) recordRateLimits(id, observation.value);
}

/**
 * Read every due harness's limits outside a chat, then return them all. A
 * harness read in the last minute, or that a chat reported on in the last
 * minute, is skipped. A read already in flight is joined, not repeated.
 */
export async function readHarnessRateLimits(now = Date.now()): Promise<HarnessRateLimits[]> {
  const state = current();
  await Promise.all(readableHarnesses().map((id) => {
    if (state.reading[id]) return state.reading[id];
    if (!due(id, now)) return undefined;
    state.readAt[id] = now;
    const reading = readOne(id)
      .catch((err) => console.warn(`[rate-limits] could not read ${id} rate limits:`, err))
      .finally(() => { delete state.reading[id]; });
    state.reading[id] = reading;
    return reading;
  }));
  return getHarnessRateLimits();
}
