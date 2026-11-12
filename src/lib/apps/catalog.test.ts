import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as q from '@/lib/db/queries';
import { treeChecksum } from './catalog-checksum';
import type { CatalogEntry } from './catalog-entries';

vi.setConfig({ testTimeout: 60_000 });

// The kit's install and switch are the builder's (and the kit's) to test. Here they only record what they were asked.
const installed: string[] = [];
const switched: Array<{ sourceId: string; commit: string }> = [];
vi.mock('./builder', async (original) => {
  const actual = await original<typeof import('./builder')>();
  return {
    ...actual,
    installApp: vi.fn(async (sourceId: string) => { installed.push(sourceId); return { id: 'job', sourceId, kind: 'install', state: 'running', steps: [], startedAt: '' }; }),
    switchTo: vi.fn((source: { id: string }, commit: string) => { switched.push({ sourceId: source.id, commit }); return { id: 'job', sourceId: source.id, kind: 'change', state: 'running', steps: [], startedAt: '' }; }),
  };
});

const { addCatalogApp, listCatalogApps, mergeRequest, updateCatalogApp } = await import('./catalog');
const { recordCatalogVersion, setAppBuildSettings } = await import('./builder');

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Kit', '-c', 'user.email=kit@x', ...args], { cwd, encoding: 'utf8' }).trim();

let upstream: string;
let apps: string;
let catalogFile: string;

function commitUpstream(file: string, text: string, tag?: string) {
  fs.writeFileSync(path.join(upstream, file), text);
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-q', '-m', `Write ${file}`);
  if (tag) git(upstream, 'tag', tag);
  return git(upstream, 'rev-parse', 'HEAD');
}

async function publish(version: string, overrides: Partial<CatalogEntry> = {}) {
  const entry: CatalogEntry = {
    id: 'tide-log', name: 'Tide Log', description: 'Tides you saw.', reaches: ['Your calendar, to suggest times'],
    git: upstream, version, checksum: await treeChecksum(upstream, version), ...overrides,
  };
  fs.writeFileSync(catalogFile, JSON.stringify({ apps: [entry] }));
  return entry;
}

beforeEach(() => {
  installed.length = 0;
  switched.length = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-catalog-'));
  upstream = path.join(root, 'upstream');
  apps = path.join(root, 'apps');
  catalogFile = path.join(root, 'catalog.json');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  commitUpstream('README.md', 'Tide Log\n', 'v1.0.0');
  vi.stubEnv('RI_APP_CATALOG', catalogFile);
  setAppBuildSettings({ appsDir: apps });
});

afterEach(() => {
  vi.unstubAllEnvs();
  setAppBuildSettings({ appsDir: null });
  for (const source of q.listAppSources()) q.deleteAppSource(source.id);
});

describe('adding an app from the catalog', () => {
  it('clones the pinned version as the person\'s own repository, with its source as upstream, then installs and connects it', async () => {
    const pinned = git(upstream, 'rev-parse', 'v1.0.0');
    commitUpstream('later.txt', 'not pinned\n');
    await publish('v1.0.0');
    expect(listCatalogApps().apps[0]).toMatchObject({ id: 'tide-log', sourceId: null, updateAvailable: false });

    const { source } = await addCatalogApp('tide-log');
    const folder = path.join(apps, 'tide-log');
    expect(source).toMatchObject({ folder, gitUrl: upstream, createdByRi: true, catalogId: 'tide-log', catalogVersion: 'v1.0.0', catalogCommit: pinned });
    expect(git(folder, 'rev-parse', 'HEAD')).toBe(pinned);
    expect(fs.existsSync(path.join(folder, 'later.txt'))).toBe(false);
    expect(git(folder, 'remote')).toBe('upstream');
    expect(git(folder, 'status', '--porcelain')).toBe('');
    expect(installed).toEqual([source.id]);
    expect(listCatalogApps().apps[0]).toMatchObject({ sourceId: source.id, installedVersion: 'v1.0.0', updateAvailable: false });
    await expect(addCatalogApp('tide-log')).rejects.toThrow(/already added/);
  });

  it('pins a commit as well as a tag', async () => {
    const commit = commitUpstream('notes.md', 'untagged\n');
    await publish(commit);
    const { source } = await addCatalogApp('tide-log');
    expect(git(source.folder!, 'rev-parse', 'HEAD')).toBe(commit);
  });

  it('refuses a version whose files don\'t match the catalog, and leaves nothing behind', async () => {
    await publish('v1.0.0', { checksum: `sha256-${'0'.repeat(64)}` });
    await expect(addCatalogApp('tide-log')).rejects.toThrow(/doesn’t match/);
    expect(fs.existsSync(path.join(apps, 'tide-log'))).toBe(false);
    expect(q.listAppSources()).toEqual([]);
    expect(installed).toEqual([]);
  });

  it('says so when it can\'t get the app', async () => {
    await publish('v1.0.0', { git: path.join(apps, 'nowhere') });
    await expect(addCatalogApp('tide-log')).rejects.toThrow(/couldn’t get Tide Log/);
    expect(fs.existsSync(path.join(apps, 'tide-log'))).toBe(false);
  });
});

describe('updating an app from the catalog', () => {
  it('switches an app the person never changed straight to the new version, and records it once that\'s running', async () => {
    await publish('v1.0.0');
    const { source } = await addCatalogApp('tide-log');
    const next = commitUpstream('tides.md', 'High at noon\n', 'v1.1.0');
    await publish('v1.1.0');
    expect(listCatalogApps().apps[0]).toMatchObject({ installedVersion: 'v1.0.0', updateAvailable: true });

    const update = await updateCatalogApp(source.id);
    expect(update).toMatchObject({ mode: 'switch', version: 'v1.1.0' });
    expect(switched).toEqual([{ sourceId: source.id, commit: next }]);
    // The switch (the kit's change, then settling the folder) records the version.
    expect(await recordCatalogVersion(q.getAppSource(source.id)!, next)).toBe(true);
    expect(q.getAppSource(source.id)).toMatchObject({ catalogVersion: 'v1.1.0', catalogCommit: next });
    expect(await updateCatalogApp(source.id)).toEqual({ mode: 'current', version: 'v1.1.0' });
  });

  it('has the builder merge the update first when the person changed the app, and records it once the merge is running', async () => {
    await publish('v1.0.0');
    const { source } = await addCatalogApp('tide-log');
    // The person's own change, already applied.
    fs.writeFileSync(path.join(source.folder!, 'mine.md'), 'My tides\n');
    git(source.folder!, 'add', '-A');
    git(source.folder!, 'commit', '-q', '-m', 'My change');
    const next = commitUpstream('tides.md', 'High at noon\n', 'v1.1.0');
    await publish('v1.1.0');

    const update = await updateCatalogApp(source.id);
    expect(update.mode).toBe('merge');
    if (update.mode !== 'merge') return;
    expect(switched).toEqual([]);
    expect(update.commit).toBe(next);
    expect(update.message).toContain(`git merge ${next}`);
    expect(update.message).not.toMatch(/—|;/);
    const work = update.source.changeFolder!;
    expect(fs.existsSync(work)).toBe(true);
    expect(q.getAppSource(source.id)?.catalogVersion).toBe('v1.0.0');

    // The builder merges in the working copy. Applying it switches to the merge, which includes the update.
    git(work, 'merge', '-q', '--no-edit', next);
    const merged = git(work, 'rev-parse', 'HEAD');
    expect(await recordCatalogVersion(q.getAppSource(source.id)!, merged)).toBe(true);
    expect(q.getAppSource(source.id)).toMatchObject({ catalogVersion: 'v1.1.0', catalogCommit: next });
  });

  it('records an update the running app already includes, without switching again', async () => {
    await publish('v1.0.0');
    const { source } = await addCatalogApp('tide-log');
    const next = commitUpstream('tides.md', 'High at noon\n', 'v1.1.0');
    git(source.folder!, 'fetch', '-q', 'upstream', 'v1.1.0');
    git(source.folder!, 'merge', '-q', '--ff-only', next);
    await publish('v1.1.0');
    expect(await updateCatalogApp(source.id)).toEqual({ mode: 'current', version: 'v1.1.0' });
    expect(switched).toEqual([]);
    expect(q.getAppSource(source.id)?.catalogVersion).toBe('v1.1.0');
  });

  it('never uses an update whose files don\'t match the catalog', async () => {
    await publish('v1.0.0');
    const { source } = await addCatalogApp('tide-log');
    commitUpstream('tides.md', 'High at noon\n', 'v1.1.0');
    await publish('v1.1.0', { checksum: `sha256-${'1'.repeat(64)}` });
    await expect(updateCatalogApp(source.id)).rejects.toThrow(/doesn’t match/);
    expect(switched).toEqual([]);
    expect(q.getAppSource(source.id)?.changeFolder).toBeNull();
  });

  it('asks in plain words', () => {
    expect(mergeRequest({ name: 'Tide Log', version: 'v2' }, 'abc', 'v1')).not.toMatch(/—|;/);
  });
});
