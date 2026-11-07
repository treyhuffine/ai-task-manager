/**
 * `ri update` (docs/always-on-spec.md sections 4.1, 7 and 8): get the newest
 * release once, then switch every Home on this computer to it. A checkout
 * origin builds main. A published origin downloads from the feed. Each Home
 * switches through its own controller, which waits for its running chats
 * unless asked to update now.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_ROOT_ENV, CONFIG_DIR_ENV, DB_PATH_ENV, WORK_DIR_ENV } from '@/lib/config/paths';
import { storeDirectory, RELEASE_ID, type InstalledHome } from './store';
import type { Origin } from './origin';
import { releaseCommit, type buildRelease, type selectCommit } from './source-build';
import type { installCommandLauncher } from './runtime';
import type { ServiceStatus } from './client';
import type { UpdateRecord } from './update';

type Identity = NonNullable<InstalledHome['identity']>;
export type HomeStatus = Omit<ServiceStatus, 'update'> & { update?: UpdateRecord & { configured?: boolean; busy?: boolean } };
export interface HomeClient {
  status(): Promise<HomeStatus | null>;
  request<T>(route: string, method?: string, timeoutMs?: number, body?: unknown): Promise<T>;
}
export interface UpdateRunDeps {
  homes(): InstalledHome[];
  client(identity: Identity): HomeClient;
  origin(): Origin;
  select: typeof selectCommit;
  build: typeof buildRelease;
  launcher(): ReturnType<typeof installCommandLauncher>;
  say(line: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}
export interface UpdateRunOptions { now?: boolean; waitMs?: number }
export type HomeOutcome =
  | { root: string; result: 'updated' | 'current' | 'not-running' | 'pending' | 'not-moved' }
  | { root: string; result: 'waiting'; reason: string }
  | { root: string; result: 'failed' | 'reverted'; reason: string };

/** `~/ri` rather than /Users/name/ri, the way people write it. */
export function displayRoot(root: string) {
  const home = os.homedir();
  return root === home ? '~' : root.startsWith(`${home}${path.sep}`) ? `~${root.slice(home.length)}` : root;
}

/** Run with this Home's paths, so `servicePaths()` reaches its controller. */
export async function withHomeIdentity<T>(identity: Identity, operation: () => Promise<T>): Promise<T> {
  const keys = [APP_ROOT_ENV, DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV] as const;
  const saved = keys.map(key => process.env[key]);
  Object.assign(process.env, { [APP_ROOT_ENV]: identity.root, [DB_PATH_ENV]: identity.database, [CONFIG_DIR_ENV]: identity.config, [WORK_DIR_ENV]: identity.work });
  try { return await operation(); }
  finally { keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); }
}

/** A release this computer already built from `commit`, if there is one. */
export function stagedReleaseForCommit(commit: string): { id: string; version: string } | null {
  const store = storeDirectory();
  if (!fs.existsSync(/* turbopackIgnore: true */ store)) return null;
  for (const id of fs.readdirSync(/* turbopackIgnore: true */ store)) {
    if (!RELEASE_ID.test(id)) continue;
    const repo = path.join(/* turbopackIgnore: true */ store, id, 'server');
    if (releaseCommit(repo) !== commit) continue;
    try { return { id, version: JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ repo, 'package.json'), 'utf8')).version }; }
    catch { continue; }
  }
  return null;
}

interface Target { id: string; label: string; local?: { commit?: string; checkout?: string } }

/** Wait for the Home's controller to hand over to `id` and come back up. */
async function waitForSwitch(client: HomeClient, before: HomeStatus, id: string, deps: UpdateRunDeps, waitMs: number): Promise<HomeOutcome['result'] | { result: 'waiting' | 'failed' | 'reverted'; reason: string }> {
  const deadline = deps.now() + waitMs;
  while (deps.now() < deadline) {
    await deps.sleep(1000);
    let status: HomeStatus | null = null;
    try { status = await client.status(); } catch { /* mid-handover */ }
    if (!status) continue;
    const update = status.update;
    if (status.runId === before.runId) {
      // Busy means it's acting on the update right now, not waiting on anything.
      if (update?.phase === 'waiting' && update.reason && !update.busy) return { result: 'waiting', reason: update.reason };
      if (update?.phase === 'failed' || update?.phase === 'recovery-required') return { result: 'failed', reason: update.error ?? 'The update failed' };
      continue;
    }
    if (status.phase === 'failed') return { result: 'failed', reason: status.error ?? 'The Home failed to start' };
    if (status.phase !== 'running') continue;
    if (status.release?.release.build === id) return 'updated';
    // The launcher put the previous release back.
    return { result: 'reverted', reason: update?.error ?? "The new version didn't start, so the Home went back to the one it ran before." };
  }
  return 'pending';
}

async function switchHome(home: InstalledHome & { identity: Identity }, target: Target, options: UpdateRunOptions, deps: UpdateRunDeps): Promise<HomeOutcome> {
  const root = home.identity.root;
  const client = deps.client(home.identity);
  // One Home that can't switch right now doesn't stop the others.
  try {
    const status = await client.status();
    if (!status) return { root, result: 'not-running' };
    if (status.release?.release.build === target.id) return { root, result: 'current' };
    // Selected but not what's running: a `ri start` that didn't finish. Only `ri start` can.
    if (home.active === target.id) return { root, result: 'not-moved' };
    if (target.local) await client.request('/update', 'POST', 60_000, { action: 'offer', release: target.id, local: target.local });
    await client.request('/update', 'POST', 3000, { action: options.now ? 'apply-now' : 'apply' });
    const outcome = await waitForSwitch(client, status, target.id, deps, options.waitMs ?? 10 * 60_000);
    return typeof outcome === 'string' ? { root, result: outcome } as HomeOutcome : { root, ...outcome };
  } catch (error) {
    return { root, result: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Ask a Home's controller for the newest published release and download it. */
async function publishedTarget(home: InstalledHome & { identity: Identity }, deps: UpdateRunDeps): Promise<Target | null> {
  const client = deps.client(home.identity);
  const status = await client.status();
  if (!status?.update?.configured) return null;
  await client.request('/update', 'POST', 3000, { action: 'check' });
  // Someone asking gets one more try at what failed before they asked.
  let retried = false;
  let moved = -1;
  // Ten minutes without progress. A slow connection is fine, however long it takes.
  for (let tries = 0; tries < 600; tries++) {
    const update = (await client.status())?.update;
    if (update && update.bytes !== moved) { moved = update.bytes ?? -1; tries = 0; }
    if (update && !update.busy) {
      if (update.phase === 'available' || (update.phase === 'failed' && !retried)) {
        retried = update.phase === 'failed' || retried;
        await client.request('/update', 'POST', 3000, { action: 'download' });
        await deps.sleep(1000);
        continue;
      }
      if (update.release && ['ready', 'waiting'].includes(update.phase)) return { id: update.release.runtime.id, label: update.release.version };
      // Not "up to date": the check that was asked for didn't work.
      if ((update.phase === 'idle' || update.phase === 'committed') && update.error) throw new Error(update.error);
      if (update.phase === 'idle' || update.phase === 'committed') return status.release ? { id: status.release.release.build, label: status.release.release.version } : null;
      if (update.phase === 'failed') throw new Error(update.error ?? 'The download failed');
    }
    await deps.sleep(1000);
  }
  throw new Error('The download did not finish in time. Run ri update again to continue.');
}

export async function runUpdate(options: UpdateRunOptions, deps: UpdateRunDeps): Promise<HomeOutcome[]> {
  const origin = deps.origin();
  const known = deps.homes().filter((home): home is InstalledHome & { identity: Identity } => !!home.identity);
  const homes = known.filter(home => home.active);
  // A Home still running from a checkout has no release to switch from. `ri
  // start` moves it, which also keeps its address and copies its database (10.2).
  const outcomes: HomeOutcome[] = known.filter(home => !home.active).map(home => ({ root: home.identity.root, result: 'not-moved' }));
  if (origin.source === 'checkout') {
    const choice = deps.select(origin.checkout!);
    const short = choice.commit.slice(0, 8);
    let target: Target;
    const existing = stagedReleaseForCommit(choice.commit);
    if (existing) target = { id: existing.id, label: `main ${short}`, local: { commit: choice.commit, checkout: origin.checkout } };
    else {
      deps.say(`Building main ${short} from ${displayRoot(origin.checkout!)}. Your Homes keep running while it builds.`);
      const built = await deps.build({ checkout: origin.checkout!, commit: choice.commit, step: step => deps.say(`  ${step}`) });
      target = { id: built.id, label: `main ${short}`, local: { commit: choice.commit, checkout: origin.checkout } };
    }
    const launcher = deps.launcher();
    if (!launcher.installed) deps.say(launcher.reason);
    if (!known.length) { deps.say(`Ri ${target.label} is installed. Run \`ri start\` to create your Home, or to keep one that's running by hand running on it.`); return outcomes; }
    for (const home of homes) outcomes.push(await switchHome(home, target, options, deps));
  } else {
    let configured = false;
    for (const home of homes) {
      let target: Target | null;
      try { target = await publishedTarget(home, deps); }
      catch (error) { configured = true; outcomes.push({ root: home.identity.root, result: 'failed', reason: error instanceof Error ? error.message : String(error) }); continue; }
      if (!target) continue;
      configured = true;
      outcomes.push(await switchHome(home, target, options, deps));
    }
    if (!configured) deps.say('No published releases are set up for this computer yet. To build from a checkout of Ri: ri update --from <folder>');
  }
  for (const outcome of outcomes) {
    const root = displayRoot(outcome.root);
    if (outcome.result === 'updated') deps.say(`${root}: updated.`);
    else if (outcome.result === 'current') deps.say(`${root}: already up to date.`);
    else if (outcome.result === 'not-running') deps.say(`${root}: not running. It moves to the new release the next time you run \`ri update\` after it starts.`);
    else if (outcome.result === 'pending') deps.say(`${root}: still switching. Check with \`ri status\`.`);
    else if (outcome.result === 'not-moved') deps.say(`${root}: hasn't moved to a release yet. To move it to this version and keep it running: ri start --root ${root}`);
    else if (outcome.result === 'waiting') deps.say(`${root}: waiting for ${outcome.reason.replace(/^waiting for /i, '').replace(/\.$/, '')}. It switches when that finishes. To switch now and end them: ri update --now`);
    else if (outcome.result === 'reverted') deps.say(`${root}: ${outcome.reason}`);
    else if (outcome.result === 'failed') deps.say(`${root}: update failed. ${outcome.reason}`);
  }
  return outcomes;
}
