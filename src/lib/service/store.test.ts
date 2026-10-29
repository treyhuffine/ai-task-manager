import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeRuntimeFixture } from './runtime-fixture';
import { latestRelease, listHomes, pruneReleases, releaseDirectory, stageRelease, storeDirectory } from './store';
import { installedRuntime, stageRuntime, verifyRuntime } from './runtime';
import { getRuntimeBaseDir, getRuntimeInstallDir } from './paths';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-store-test-'));
  vi.stubEnv('RI_ROOT', path.join(root, 'home-a'));
  vi.stubEnv('RI_INSTALL_ROOT', path.join(root, 'installed'));
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function release(name: string, version: string, extra: Record<string, string> = {}) {
  const directory = path.join(root, 'resources', name);
  writeRuntimeFixture(directory, { version, files: { 'server/node_modules/big/index.js': 'shared library bytes', ...extra } });
  return directory;
}
const inode = (file: string) => fs.statSync(file).ino;

it('stores each release once and hard-links files identical to an earlier release', () => {
  const first = stageRelease(release('one', '0.1.0'));
  const second = stageRelease(release('two', '0.2.0', { 'server/dist/app.js': 'changed code' }));
  const shared = (id: string) => path.join(storeDirectory(), id, 'server/node_modules/big/index.js');
  expect(inode(shared(first.id))).toBe(inode(shared(second.id)));
  // Changed files are not shared, and both releases still verify on their own.
  expect(inode(path.join(storeDirectory(), first.id, 'server/package.json'))).not.toBe(inode(path.join(storeDirectory(), second.id, 'server/package.json')));
  expect(verifyRuntime(path.join(storeDirectory(), first.id)).id).toBe(first.id);
  expect(verifyRuntime(path.join(storeDirectory(), second.id)).id).toBe(second.id);
  expect(latestRelease()).toBe(second.id);
});

it('shares one store between Homes, each with its own pointer and record', () => {
  const staged = stageRuntime(release('one', '0.1.0'));
  const homeA = getRuntimeInstallDir();
  vi.stubEnv('RI_ROOT', path.join(root, 'home-b'));
  const other = stageRuntime(release('one', '0.1.0'));
  expect(getRuntimeInstallDir()).not.toBe(homeA);
  expect(other.directory).toBe(staged.directory);
  expect(staged.directory.startsWith(storeDirectory())).toBe(true);
  const homes = listHomes();
  expect(homes.map(home => home.identity?.root).sort()).toEqual([fs.realpathSync(root) + '/home-a', fs.realpathSync(root) + '/home-b'].sort());
  expect(homes.every(home => home.active === staged.id)).toBe(true);
});

it('still finds a release a Home staged in its own folder before the store existed', () => {
  const resources = release('legacy', '0.1.0');
  const manifest = writeRuntimeFixture(resources, { version: '0.1.0' });
  const install = getRuntimeInstallDir();
  fs.mkdirSync(path.join(install, 'releases'), { recursive: true });
  fs.cpSync(resources, path.join(install, 'releases', manifest.id), { recursive: true });
  fs.writeFileSync(path.join(install, 'active-release'), `${manifest.id}\n`);
  expect(releaseDirectory(manifest.id, install)).toBe(path.join(install, 'releases', manifest.id));
  expect(installedRuntime()?.repo).toBe(path.join(install, 'releases', manifest.id, 'server'));
});

it('deletes only releases nothing uses', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) => stageRelease(release(name, `0.${index + 1}.0`)).id);
  const [active, previous, pending, running, unused, newest] = ids;
  const install = getRuntimeInstallDir();
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(install, 'active-release'), `${active}\n`);
  fs.writeFileSync(path.join(install, 'previous-release'), `${previous}\n`);
  fs.writeFileSync(path.join(install, 'update.json'), JSON.stringify({ format: 1, phase: 'waiting', release: { runtime: { id: pending } }, changedAt: new Date().toISOString() }));
  const stale = path.join(storeDirectory(), '.stage-crashed');
  fs.mkdirSync(stale);
  fs.utimesSync(stale, new Date(Date.now() - 2 * 60 * 60_000), new Date(Date.now() - 2 * 60 * 60_000));
  const removed = pruneReleases({ running: () => [`${path.join(storeDirectory(), running)}/node/bin/node ri agent list_tasks`] });
  expect(removed).toEqual([unused]);
  expect(latestRelease()).toBe(newest);
  for (const id of [active, previous, pending, running, newest]) expect(fs.existsSync(path.join(storeDirectory(), id))).toBe(true);
  expect(fs.existsSync(stale)).toBe(false);
  expect(fs.existsSync(path.join(getRuntimeBaseDir(), 'cache', unused))).toBe(false);
});

it('keeps the release an activation names until the launcher is done with it', () => {
  const [kept, candidate, gone] = ['a', 'b', 'c'].map((name, index) => stageRelease(release(name, `0.${index + 1}.0`)).id);
  stageRelease(release('a', '0.1.0'));
  const install = getRuntimeInstallDir();
  fs.mkdirSync(path.join(install, 'activation'), { recursive: true });
  fs.writeFileSync(path.join(install, 'active-release'), `${kept}\n`);
  fs.writeFileSync(path.join(install, 'activation/candidate'), `${candidate}\n`);
  expect(pruneReleases({ running: () => [] })).toEqual([gone]);
});
