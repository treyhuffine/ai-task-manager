import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverInstallation } from './discover-installation';
import type { InstallationInspection } from './installation';

let directory: string;
let currentRoot: string;
let candidateRoot: string;

beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-discovery-')));
  currentRoot = path.join(directory, 'desktop');
  candidateRoot = path.join(directory, 'existing');
  fs.mkdirSync(currentRoot, { mode: 0o700 });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

function installation(kind: 'home' | 'viewer' = 'home') {
  fs.mkdirSync(candidateRoot, { mode: 0o700 });
  fs.mkdirSync(path.join(candidateRoot, '.config'), { mode: 0o700 });
  if (kind === 'home') {
    fs.mkdirSync(path.join(candidateRoot, '.work'), { mode: 0o700 });
    // A sentinel, deliberately not SQLite. Discovery must not open it.
    fs.writeFileSync(path.join(candidateRoot, 'data.db'), 'existing database stays untouched', { mode: 0o600 });
  } else {
    fs.writeFileSync(path.join(candidateRoot, '.config/connection.json'), '{"homeId":"remote-home"}', { mode: 0o600 });
  }
}

function inspection(phase = 'running', canUse = true): InstallationInspection {
  return {
    identity: { root: candidateRoot, database: path.join(candidateRoot, 'data.db'), config: path.join(candidateRoot, '.config'), work: path.join(candidateRoot, '.work') },
    phase, canUse, pendingMigrations: 0, appliedMigrations: 0,
  };
}

describe('bounded desktop installation discovery', () => {
  it('returns no candidate without creating any missing folders or database', async () => {
    const inspect = vi.fn();
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
    expect(fs.existsSync(candidateRoot)).toBe(false);
    expect(fs.readdirSync(currentRoot)).toEqual([]);
  });

  it('ignores an empty folder and unrelated installations outside the given candidate', async () => {
    installation();
    const empty = path.join(directory, 'empty');
    fs.mkdirSync(empty, { mode: 0o700 });
    const inspect = vi.fn();
    expect(await discoverInstallation({ currentRoot, candidateRoot: empty, inspect })).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
    expect(fs.readdirSync(empty)).toEqual([]);
  });

  it('never probes the active root, including a canonical alias', async () => {
    installation();
    const alias = path.join(directory, 'alias');
    fs.symlinkSync(candidateRoot, alias, 'dir');
    const inspect = vi.fn();
    const lstat = vi.spyOn(fs, 'lstatSync');
    expect(await discoverInstallation({ currentRoot: candidateRoot, candidateRoot, inspect })).toBeNull();
    expect(await discoverInstallation({ currentRoot: alias, candidateRoot, inspect })).toBeNull();
    expect(await discoverInstallation({ currentRoot: candidateRoot, candidateRoot: alias, inspect })).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it.each(['running', 'stopped'])('offers a verified managed Home in phase %s without changing its files or environment', async phase => {
    installation();
    const before = fs.readFileSync(path.join(candidateRoot, 'data.db'));
    const env = { ...process.env };
    const inspect = vi.fn().mockResolvedValue(inspection(phase));
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toEqual({ root: candidateRoot, canUse: true, phase });
    expect(inspect).toHaveBeenCalledExactlyOnceWith({ root: candidateRoot });
    expect(fs.readFileSync(path.join(candidateRoot, 'data.db'))).toEqual(before);
    expect(fs.readdirSync(candidateRoot).sort()).toEqual(['.config', '.work', 'data.db']);
    expect(fs.readdirSync(currentRoot)).toEqual([]);
    expect(process.env).toEqual(env);
  });

  it.each(['viewer', 'worker'])('offers an existing %s connection without creating local data or work folders', async phase => {
    installation('viewer');
    const before = fs.readFileSync(path.join(candidateRoot, '.config/connection.json'));
    const inspect = vi.fn().mockResolvedValue(inspection(phase));
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toEqual({ root: candidateRoot, canUse: true, phase });
    expect(fs.readdirSync(candidateRoot)).toEqual(['.config']);
    expect(fs.readFileSync(path.join(candidateRoot, '.config/connection.json'))).toEqual(before);
    expect(fs.existsSync(path.join(candidateRoot, 'data.db'))).toBe(false);
    expect(fs.existsSync(path.join(candidateRoot, '.work'))).toBe(false);
  });

  it('preserves an inspection refusal and its actionable reason', async () => {
    installation();
    const reason = 'Start this installation with its existing CLI service before connecting.';
    const inspect = vi.fn().mockResolvedValue({ ...inspection('stopped', false), reason });
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toEqual({ root: candidateRoot, canUse: false, phase: 'stopped', reason });
  });

  it('returns safe copy for a corrupt installation without leaking inspection output', async () => {
    installation();
    const inspect = vi.fn().mockRejectedValue(new Error('SQLITE_CORRUPT\nprivate token=secret\n at inspector.ts:99'));
    const result = await discoverInstallation({ currentRoot, candidateRoot, inspect });
    expect(result).toEqual({ root: candidateRoot, canUse: false, reason: 'This Ri could not be verified. Open Advanced to review the installation.' });
    expect(fs.readFileSync(path.join(candidateRoot, 'data.db'), 'utf8')).toBe('existing database stays untouched');
  });

  it('explains an unsupported foreground launcher without changing service state', async () => {
    installation();
    const inspect = vi.fn().mockRejectedValue(new Error('An older foreground launcher is using this installation. Stop it before connecting the desktop app.'));
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toEqual({ root: candidateRoot, canUse: false, reason: 'This Ri is open in another launcher. Open Advanced to review the connection.' });
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('handles an inaccessible candidate without trying to inspect it', async () => {
    installation();
    const realpath = fs.realpathSync;
    vi.spyOn(fs, 'realpathSync').mockImplementation(((file: fs.PathLike) => {
      if (String(file) === candidateRoot) throw Object.assign(new Error('private filesystem detail'), { code: 'EACCES' });
      return realpath(file);
    }) as typeof fs.realpathSync);
    const inspect = vi.fn();
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toEqual({ root: candidateRoot, canUse: false, reason: 'This Ri is not accessible to your account. Open Advanced to choose an accessible installation.' });
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each(['root', 'database', 'config', 'ancestor'])('refuses another account\'s %s before inspection', async location => {
    installation();
    const target = { root: candidateRoot, database: path.join(candidateRoot, 'data.db'), config: path.join(candidateRoot, '.config'), ancestor: directory }[location]!;
    const uid = process.getuid?.() ?? 1000;
    vi.spyOn(process, 'getuid').mockReturnValue(uid);
    const stat = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation(((file: fs.PathLike) => {
      const result = stat(file);
      return String(file) === target ? Object.assign(Object.create(result), { uid: uid + 1 }) : result;
    }) as typeof fs.statSync);
    const inspect = vi.fn();
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toMatchObject({ root: candidateRoot, canUse: false, reason: expect.stringContaining('another account') });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses an installation writable by other accounts', async () => {
    installation();
    fs.chmodSync(path.join(candidateRoot, 'data.db'), 0o666);
    const inspect = vi.fn();
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toMatchObject({ canUse: false, reason: expect.stringContaining('another account') });
    expect(inspect).not.toHaveBeenCalled();
  });

  it('does not inspect a database symlink that escapes the discovered root', async () => {
    installation();
    const database = path.join(candidateRoot, 'data.db');
    const outside = path.join(directory, 'outside.db');
    fs.renameSync(database, outside);
    fs.symlinkSync(outside, database);
    const inspect = vi.fn();
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toMatchObject({ canUse: false });
    expect(inspect).not.toHaveBeenCalled();
    expect(fs.readFileSync(outside, 'utf8')).toBe('existing database stays untouched');
  });

  it('does not inspect connection config symlinked outside the discovered root', async () => {
    installation('viewer');
    const config = path.join(candidateRoot, '.config');
    const outside = path.join(directory, 'outside-config');
    fs.renameSync(config, outside);
    fs.symlinkSync(outside, config, 'dir');
    const inspect = vi.fn();
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toMatchObject({ canUse: false });
    expect(inspect).not.toHaveBeenCalled();
    expect(fs.readdirSync(candidateRoot)).toEqual(['.config']);
  });

  it('does not adopt a different root returned by the inspector', async () => {
    installation();
    const wrong = inspection();
    wrong.identity.root = currentRoot;
    const inspect = vi.fn().mockResolvedValue(wrong);
    expect(await discoverInstallation({ currentRoot, candidateRoot, inspect })).toMatchObject({ root: candidateRoot, canUse: false });
  });
});
