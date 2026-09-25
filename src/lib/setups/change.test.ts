import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { SetupChange } from './change';
import { readSetupFile, SETUP_FILE, type SetupFile } from './local-file';
import { getLocation, isRegistered, listRegisteredLocations, registerLocation } from './registry';
import type { SetupHomeLink } from './service';

/**
 * A setup change succeeds as a whole or is put back as a whole
 * (docs/homes-spec.md §4.2): exact bytes, exact registrations, and a report
 * to the home that matches what's on disk.
 */

let home: TestHome;
let homeId: string;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-setup-change-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
});
afterEach(async () => {
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
});

function folder(name: string) {
  const p = path.join(home.root, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function setupFor(agentId: string, references: SetupFile['agents'][string]['references'] = {}): SetupFile {
  return { version: 1, homeId, agents: { [agentId]: { references } } };
}

function revision(dir: string): string {
  const read = readSetupFile(dir);
  if (read.state === 'missing') throw new Error(`no setup file in ${dir}`);
  return read.revision;
}

function bytes(dir: string): string | null {
  const file = path.join(dir, SETUP_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function workspace(name: string, cwd: string) {
  return import('@/lib/db/queries').then((q) =>
    q.createWorkspace({ name, cwd, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }),
  );
}

/** The home's own link, with reports that can be made to fail. */
async function flakyLink(): Promise<SetupHomeLink & { failReports: number[]; reports: number }> {
  const { inProcessSetupLink } = await import('./home-context');
  const real = inProcessSetupLink();
  const link = {
    failReports: [] as number[],
    reports: 0,
    context: () => real.context(),
    async report(...args: Parameters<SetupHomeLink['report']>) {
      link.reports += 1;
      if (link.failReports.includes(link.reports)) throw new Error('home unavailable');
      return real.report(...args);
    },
  };
  return link;
}

describe('SetupChange.undo', () => {
  it('puts back the exact bytes and registrations it replaced', () => {
    const from = folder('from');
    const to = folder('to');
    // Hand-formatted, so re-rendering it would change its revision.
    const handWritten = `{"version":1,"homeId":"${homeId}","agents":{"a":{"references":{"docs":null}}}}`;
    fs.writeFileSync(path.join(from, SETUP_FILE), handWritten);
    const registered = registerLocation(from);

    const change = new SetupChange();
    change.write(to, setupFor('a'), null);
    change.register(to);
    change.remove(from, revision(from));
    change.unregister(from);
    expect(bytes(from)).toBeNull();

    expect(change.undo()).toEqual([]);
    expect(bytes(from)).toBe(handWritten);
    expect(getLocation(from)).toEqual(registered);
    expect(bytes(to)).toBeNull();
    expect(isRegistered(to)).toBe(false);
  });

  it('leaves a file someone changed since, names it, and still puts the rest back', () => {
    const from = folder('from');
    const to = folder('to');
    const original = bytes(from);
    const change = new SetupChange();
    change.write(from, setupFor('a'), null);
    change.write(to, setupFor('a'), null);
    fs.writeFileSync(path.join(to, SETUP_FILE), '{"edited": "by hand"}\n');

    const problems = change.undo();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`${path.join(to, SETUP_FILE)} changed since`));
    expect(bytes(to)).toBe('{"edited": "by hand"}\n');
    expect(bytes(from)).toBe(original);
  });

  it('restores the folder an agent came from before clearing the one it was going to', () => {
    const from = folder('from');
    const to = folder('to');
    fs.writeFileSync(path.join(from, SETUP_FILE), `${JSON.stringify(setupFor('a'), null, 2)}\n`);
    registerLocation(from);
    const before = bytes(from);

    const change = new SetupChange();
    change.write(to, setupFor('a'), null);
    change.register(to);
    change.remove(from, revision(from));
    change.unregister(from);

    // The new folder can't be cleared: undo must still have restored the old one.
    fs.chmodSync(to, 0o500);
    try {
      const problems = change.undo();
      expect(problems.join('\n')).toMatch(new RegExp(path.join(to, SETUP_FILE)));
    } finally {
      fs.chmodSync(to, 0o700);
    }
    expect(bytes(from)).toBe(before);
    expect(isRegistered(from)).toBe(true);
    // Set up twice, which the resolver reports, rather than nowhere.
    expect(readSetupFile(to).state).toBe('ok');
  });
});

describe('a folder under two names', () => {
  it('is registered once', () => {
    const real = folder('real');
    const alias = path.join(home.root, 'alias');
    fs.symlinkSync(real, alias);
    registerLocation(real);
    registerLocation(alias);
    expect(listRegisteredLocations().map((l) => l.dir)).toEqual([real]);
    expect(isRegistered(alias)).toBe(true);
  });

  it('can hold a second agent through the other name without reporting a duplicate', async () => {
    const real = folder('real');
    const alias = path.join(home.root, 'alias');
    fs.symlinkSync(real, alias);
    const a = await workspace('A', real);
    const b = await workspace('B', alias);
    const { attach } = await import('./service');
    const link = await flakyLink();
    await attach(link, { agent: a.id, folder: real });
    const report = await attach(link, { agent: b.id, folder: alias });
    expect(report.status).toBe('ready');
    const q = await import('@/lib/db/queries');
    expect(q.listAgentSetups({}).map((s) => s.status)).toEqual(['ready', 'ready']);
    expect(listRegisteredLocations()).toHaveLength(1);
  });

  it('relinks to the other name as a change of spelling only', async () => {
    const real = folder('real');
    const alias = path.join(home.root, 'alias');
    fs.symlinkSync(real, alias);
    const a = await workspace('A', real);
    const { attach, relink } = await import('./service');
    const link = await flakyLink();
    await attach(link, { agent: a.id, folder: real });
    const before = bytes(real);
    const report = await relink(link, { agent: a.id, folder: alias });
    expect(report).toMatchObject({ status: 'ready', sourcePath: alias });
    expect(bytes(real)).toBe(before);
    expect(listRegisteredLocations().map((l) => l.dir)).toEqual([alias]);
  });
});

describe('when the home cannot take the report', () => {
  /** Everything a setup change can touch, to compare before and after. */
  function snapshot(dirs: string[]) {
    return { files: dirs.map((d) => [d, bytes(d)]), registry: listRegisteredLocations() };
  }

  it('undoes every kind of setup change', async () => {
    const { attach, setReference, relink, planRestore, restore, detach } = await import('./service');
    const q = await import('@/lib/db/queries');
    const source = folder('source');
    const renamed = path.join(home.root, 'renamed');
    const a = await workspace('A', source);
    q.createReferenceFolder({ alias: 'docs', path: folder('docs') });
    const link = await flakyLink();
    const failNext = () => link.failReports.push(link.reports + 1);
    const undone = /couldn't be reported to .* so it was undone\. Nothing changed on this computer\./;

    // attach, into a folder with nothing yet
    let before = snapshot([source]);
    failNext();
    await expect(attach(link, { agent: a.id, folder: source })).rejects.toThrow(undone);
    expect(snapshot([source])).toEqual(before);

    await attach(link, { agent: a.id, folder: source, references: { docs: '../docs' } });

    // setReference
    before = snapshot([source]);
    failNext();
    await expect(setReference(link, { agent: a.id, alias: 'docs', value: null })).rejects.toThrow(undone);
    expect(snapshot([source])).toEqual(before);

    // relink, after the folder was renamed
    fs.renameSync(source, renamed);
    before = snapshot([renamed]);
    failNext();
    await expect(relink(link, { agent: a.id, folder: renamed })).rejects.toThrow(undone);
    expect(snapshot([renamed])).toEqual(before);
    fs.renameSync(renamed, source);

    // restore, after the file was deleted
    fs.rmSync(path.join(source, SETUP_FILE));
    const plan = await planRestore(link, { agent: a.id });
    before = snapshot([source]);
    failNext();
    await expect(restore(link, plan)).rejects.toThrow(undone);
    expect(snapshot([source])).toEqual(before);
    await restore(link, plan);

    // detach
    before = snapshot([source]);
    failNext();
    await expect(detach(link, { agent: a.id })).rejects.toThrow(undone);
    expect(snapshot([source])).toEqual(before);
    expect(q.listAgentSetups({ workspaceId: a.id })[0]!.status).toBe('ready');
  });
});

describe("the caller's last step", () => {
  class SaveFailed extends Error {}

  it('undoes the move exactly and hands back its own error', async () => {
    const { setHomeFolder } = await import('./home-context');
    const { setReference } = await import('./service');
    const q = await import('@/lib/db/queries');
    const source = folder('source');
    const dest = folder('dest');
    const a = await workspace('A', source);
    q.createReferenceFolder({ alias: 'docs', path: folder('docs') });
    await setHomeFolder(a.id, source);
    const link = await flakyLink();
    await setReference(link, { agent: a.id, alias: 'docs', value: null });
    const before = { source: bytes(source), registry: listRegisteredLocations() };

    await expect(
      setHomeFolder(a.id, dest, {
        finish: () => {
          throw new SaveFailed('the database said no');
        },
      }),
    ).rejects.toBeInstanceOf(SaveFailed);
    expect({ source: bytes(source), registry: listRegisteredLocations() }).toEqual(before);
    expect(bytes(dest)).toBeNull();
    // The home was told the agent is back where it was.
    expect(q.getWorkspace(a.id)!.cwd).toBe(source);
    expect(q.listAgentSetups({ workspaceId: a.id })[0]).toMatchObject({ sourcePath: source, status: 'ready' });
  });

  it('says so when the home could not be told about the undo', async () => {
    const { attach } = await import('./service');
    const source = folder('source');
    const dest = folder('dest');
    const a = await workspace('A', source);
    const link = await flakyLink();
    await attach(link, { agent: a.id, folder: source });
    // The move's report goes through, then the report of the undo fails.
    link.failReports.push(link.reports + 2);
    await expect(
      attach(link, {
        agent: a.id,
        folder: dest,
        replace: true,
        finish: () => {
          throw new SaveFailed('the database said no');
        },
      }),
    ).rejects.toThrow(/was undone after the database said no, but .* couldn't be told/);
    expect(readSetupFile(source).state).toBe('ok');
    expect(bytes(dest)).toBeNull();
  });
});
