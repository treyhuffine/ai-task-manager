/**
 * The installation's shared release store (docs/always-on-spec.md sections
 * 3.2 and 7.5). Every Home on this computer runs a release from
 * `<runtime base>/releases/<id>`, staged once. Each Home keeps its own folder
 * beside it (`<runtime base>/<home id>/`) with its pointers, update journal,
 * launcher and activation record. Releases staged before the store existed
 * stay in their Home's folder (`<home>/releases/<id>`) until nothing uses them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getRuntimeBaseDir, getRuntimeInstallDir, serviceIdentity } from './paths';
import { untraced } from '@/lib/utils/untraced';
import { verifyRuntime, type RuntimeManifest } from './runtime-manifest';

export const RELEASE_ID = /^[a-f0-9]{64}$/;
const HOME_ID = /^[a-f0-9]{24}$/;
const STALE_STAGE_MS = 60 * 60_000;

export function storeDirectory(base = getRuntimeBaseDir()) {
  return path.join(/* turbopackIgnore: true */ base, 'releases');
}

/** Where a release's files are. The shared store first, then the folder of a
 * Home that staged it before the store existed. */
export function releaseDirectory(id: string, homeDirectory?: string, base = getRuntimeBaseDir()) {
  if (!RELEASE_ID.test(id)) throw new Error('Invalid release id');
  const shared = path.join(/* turbopackIgnore: true */ storeDirectory(base), id);
  if (!homeDirectory || fs.existsSync(/* turbopackIgnore: true */ shared)) return shared;
  const legacy = path.join(/* turbopackIgnore: true */ homeDirectory, 'releases', id);
  return fs.existsSync(/* turbopackIgnore: true */ legacy) ? legacy : shared;
}

/** One lock for the whole installation: staging, switching a Home's pointer
 * and deleting a release. A waiter that can't get it within 5 s gets
 * SQLITE_BUSY, so callers that can wait (pruning) simply try again later. */
export function withStoreLock<T>(operation: () => T, base = getRuntimeBaseDir()): T {
  fs.mkdirSync(/* turbopackIgnore: true */ base, { recursive: true, mode: 0o700 });
  return withFileLock(path.join(/* turbopackIgnore: true */ base, 'store'), operation);
}

function readId(file: string): string | null {
  try {
    const id = fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8').trim();
    return RELEASE_ID.test(id) ? id : null;
  } catch { return null; }
}

/** The release staged most recently: what `ri` runs for installation commands. */
export function latestRelease(base = getRuntimeBaseDir()): string | null {
  const id = readId(path.join(/* turbopackIgnore: true */ storeDirectory(base), 'latest'));
  return id && fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ storeDirectory(base), id)) ? id : null;
}

/** Stored files by content, for hard-linking. Only an identical file with the
 * same executable bit can be shared, since the link shares its mode too. */
function storedFiles(store: string, except: string) {
  const known = new Map<string, string>();
  if (!fs.existsSync(/* turbopackIgnore: true */ store)) return known;
  for (const entry of fs.readdirSync(/* turbopackIgnore: true */ store)) {
    if (!RELEASE_ID.test(entry) || entry === except) continue;
    const directory = path.join(/* turbopackIgnore: true */ store, entry);
    let manifest: RuntimeManifest;
    try { manifest = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'runtime-manifest.json'), 'utf8')); }
    catch { continue; }
    for (const file of manifest.files) {
      if (!file.sha256) continue;
      const key = `${file.sha256}:${file.executable}`;
      if (!known.has(key)) known.set(key, path.join(/* turbopackIgnore: true */ directory, file.name));
    }
  }
  return known;
}

function copyDirectories(source: string, destination: string) {
  for (const entry of fs.readdirSync(/* turbopackIgnore: true */ source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(/* turbopackIgnore: true */ destination, entry.name);
    fs.mkdirSync(/* turbopackIgnore: true */ target, { recursive: true, mode: 0o755 });
    copyDirectories(path.join(/* turbopackIgnore: true */ source, entry.name), target);
  }
}

function copyRelease(resources: string, destination: string, manifest: RuntimeManifest, known: Map<string, string>, move: boolean) {
  // Directories first, so an empty one the server expects is there too.
  for (const top of ['node', 'server']) {
    const source = path.join(/* turbopackIgnore: true */ resources, top);
    const target = path.join(/* turbopackIgnore: true */ destination, top);
    fs.mkdirSync(/* turbopackIgnore: true */ target, { recursive: true, mode: 0o755 });
    copyDirectories(source, target);
  }
  for (const file of manifest.files) {
    const target = path.join(/* turbopackIgnore: true */ destination, file.name);
    fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(target), { recursive: true, mode: 0o755 });
    if (file.link !== undefined) { fs.symlinkSync(/* turbopackIgnore: true */ file.link, target); continue; }
    const existing = known.get(`${file.sha256}:${file.executable}`);
    if (existing) {
      try { fs.linkSync(/* turbopackIgnore: true */ existing, target); continue; }
      catch { /* another filesystem or a link limit: copy instead */ }
    }
    const source = path.join(/* turbopackIgnore: true */ resources, file.name);
    let moved = false;
    if (move) {
      try { fs.renameSync(/* turbopackIgnore: true */ source, target); moved = true; }
      catch { /* another disk: copy instead */ }
    }
    if (!moved) fs.copyFileSync(/* turbopackIgnore: true */ source, target, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(/* turbopackIgnore: true */ target, file.executable ? 0o755 : 0o644);
  }
  fs.copyFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ resources, 'runtime-manifest.json'), path.join(/* turbopackIgnore: true */ destination, 'runtime-manifest.json'));
}

/** Next's cache is writable state, so it lives outside the unchanging release.
 * One per release: it holds only build-derived data (Ri uses no image or data
 * cache), so Homes on the same release can share it. */
function linkReleaseCache(base: string, id: string, directory: string) {
  const cache = path.join(/* turbopackIgnore: true */ base, 'cache', id);
  fs.mkdirSync(/* turbopackIgnore: true */ cache, { recursive: true, mode: 0o700 });
  const link = path.join(/* turbopackIgnore: true */ directory, 'server/.next-desktop/cache');
  if (fs.existsSync(/* turbopackIgnore: true */ path.dirname(link)) && !fs.existsSync(/* turbopackIgnore: true */ link)) fs.symlinkSync(cache, link);
}

/** Stage a verified runtime into the shared store, once. Files identical to
 * one already stored are hard-linked, so a release that changes only code
 * costs only its changed files. Never changes which release a Home runs.
 * `move` takes the files out of `resources` instead of copying them, for a
 * build's own output (source-build.ts), so it costs no second copy. */
export function stageRelease(resources: string, base = getRuntimeBaseDir(), options: { move?: boolean } = {}): RuntimeManifest {
  const manifest = verifyRuntime(resources);
  const store = storeDirectory(base);
  fs.mkdirSync(/* turbopackIgnore: true */ store, { recursive: true, mode: 0o700 });
  return withStoreLock(() => {
    const destination = path.join(/* turbopackIgnore: true */ store, manifest.id);
    if (fs.existsSync(/* turbopackIgnore: true */ destination)) verifyRuntime(destination);
    else {
      const temporary = path.join(/* turbopackIgnore: true */ store, `.stage-${randomUUID()}`);
      fs.mkdirSync(/* turbopackIgnore: true */ temporary, { mode: 0o700 });
      try {
        copyRelease(resources, temporary, manifest, storedFiles(store, manifest.id), !!options.move);
        verifyRuntime(temporary);
        fs.renameSync(/* turbopackIgnore: true */ temporary, destination);
      } finally { fs.rmSync(/* turbopackIgnore: true */ temporary, { recursive: true, force: true }); }
    }
    linkReleaseCache(base, manifest.id, destination);
    atomicWriteFile(path.join(/* turbopackIgnore: true */ store, 'latest'), `${manifest.id}\n`);
    return manifest;
  }, base);
}

export interface HomeRecord { version: 1; identity: ReturnType<typeof serviceIdentity> }

/** Each Home's folder says which data root it belongs to, so the installation
 * can list its Homes without being told (section 3.4). */
export function writeHomeRecord(directory = getRuntimeInstallDir(), identity = serviceIdentity()) {
  fs.mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o700 });
  const record: HomeRecord = { version: 1, identity };
  const file = path.join(/* turbopackIgnore: true */ directory, 'home.json');
  const next = JSON.stringify(record);
  try { if (fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8') === next) return; } catch { /* first write */ }
  atomicWriteFile(file, next);
}

export interface InstalledHome {
  id: string;
  directory: string;
  identity: HomeRecord['identity'] | null;
  active: string | null;
  previous: string | null;
  /** A release waiting to activate: downloaded, offered or mid-switch. */
  pending: string | null;
  activation: { candidate: string | null; previous: string | null };
}

const PENDING_PHASES = new Set(['ready', 'waiting', 'draining', 'checkpointing', 'validating', 'committed', 'recovery-required']);

function pendingRelease(directory: string): string | null {
  try {
    const record = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'update.json'), 'utf8')) as { phase?: string; release?: { runtime?: { id?: string } } };
    const id = record.release?.runtime?.id;
    return record.phase && PENDING_PHASES.has(record.phase) && typeof id === 'string' && RELEASE_ID.test(id) ? id : null;
  } catch { return null; }
}

/** Every Home this installation has a folder for, with the releases it uses. */
export function listHomes(base = getRuntimeBaseDir()): InstalledHome[] {
  if (!fs.existsSync(/* turbopackIgnore: true */ base)) return [];
  const homes: InstalledHome[] = [];
  for (const entry of fs.readdirSync(/* turbopackIgnore: true */ base).sort()) {
    if (!HOME_ID.test(entry)) continue;
    const directory = path.join(/* turbopackIgnore: true */ base, entry);
    if (!fs.statSync(/* turbopackIgnore: true */ directory).isDirectory()) continue;
    let identity: InstalledHome['identity'] = null;
    try {
      const record = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'home.json'), 'utf8')) as HomeRecord;
      if (record.version === 1 && typeof record.identity?.root === 'string') identity = record.identity;
    } catch { /* a Home folder from before records: its releases still count */ }
    homes.push({
      id: entry, directory, identity,
      active: readId(path.join(/* turbopackIgnore: true */ directory, 'active-release')),
      previous: readId(path.join(/* turbopackIgnore: true */ directory, 'previous-release')),
      pending: pendingRelease(directory),
      activation: {
        candidate: readId(path.join(/* turbopackIgnore: true */ directory, 'activation/candidate')),
        previous: readId(path.join(/* turbopackIgnore: true */ directory, 'activation/previous')),
      },
    });
  }
  return homes;
}

/** Command lines of every running process. A chat's own `ri` pins absolute
 * paths into its server's release (src/lib/executor/session-cli.ts), so a
 * release can be in use after its Home has moved on. */
export function runningCommandLines(): string[] {
  try {
    return execFileSync(untraced('ps'), ['-A', '-ww', '-o', 'command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
  } catch { return []; }
}

export interface PruneOptions { base?: string; running?: () => string[]; now?: number }

/** Delete every release nothing uses: no Home runs it, would roll back to it or
 * is waiting to activate it, no process runs from it, and it isn't the newest. */
export function pruneReleases(options: PruneOptions = {}): string[] {
  const base = options.base ?? getRuntimeBaseDir();
  const store = storeDirectory(base);
  if (!fs.existsSync(/* turbopackIgnore: true */ base)) return [];
  return withStoreLock(() => {
    const homes = listHomes(base);
    const keep = new Set<string>();
    for (const home of homes) {
      for (const id of [home.active, home.previous, home.pending, home.activation.candidate, home.activation.previous]) if (id) keep.add(id);
    }
    const latest = latestRelease(base);
    if (latest) keep.add(latest);
    const lines = (options.running ?? runningCommandLines)();
    const used = (directory: string) => lines.some(line => line.includes(`${directory}${path.sep}`));
    const removed: string[] = [];
    const now = options.now ?? Date.now();
    if (fs.existsSync(/* turbopackIgnore: true */ store)) {
      for (const entry of fs.readdirSync(/* turbopackIgnore: true */ store)) {
        const directory = path.join(/* turbopackIgnore: true */ store, entry);
        if (entry.startsWith('.stage-')) {
          // A staging a crash left behind. A live one holds the store lock.
          if (now - fs.statSync(/* turbopackIgnore: true */ directory).mtimeMs > STALE_STAGE_MS) fs.rmSync(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
          continue;
        }
        if (!RELEASE_ID.test(entry) || keep.has(entry) || used(directory)) continue;
        fs.rmSync(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
        fs.rmSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ base, 'cache', entry), { recursive: true, force: true });
        removed.push(entry);
      }
    }
    for (const home of homes) {
      const legacy = path.join(/* turbopackIgnore: true */ home.directory, 'releases');
      if (!fs.existsSync(/* turbopackIgnore: true */ legacy)) continue;
      for (const entry of fs.readdirSync(/* turbopackIgnore: true */ legacy)) {
        const directory = path.join(/* turbopackIgnore: true */ legacy, entry);
        if (!RELEASE_ID.test(entry) || keep.has(entry) || used(directory)) continue;
        fs.rmSync(/* turbopackIgnore: true */ directory, { recursive: true, force: true });
        fs.rmSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ home.directory, 'cache', entry), { recursive: true, force: true });
        removed.push(entry);
      }
    }
    return removed;
  }, base);
}
