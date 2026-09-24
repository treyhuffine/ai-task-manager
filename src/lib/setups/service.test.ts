import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { createTwoComputerLayout, git, type TwoComputerLayout } from '@/test/fixtures/git';
import { SETUP_FILE, SetupFileConflictError, readSetupFile } from './local-file';
import {
  attach,
  detach,
  planRestore,
  relink,
  restore,
  setReference,
  SetupError,
  syncSetups,
  type SetupHomeLink,
} from './service';

/**
 * One agent, two computers, one home (docs/homes-spec.md §4). The home's own
 * computer sets up through the database directly. The "MacBook" registers
 * under its key and keeps its own registry of setup files, as a connected
 * computer does. Both report to the same index, and neither ever writes the
 * other's paths.
 */

let home: TestHome;
let layout: TwoComputerLayout;
let agentId: string;
let homeLink: SetupHomeLink;
let macbookLink: SetupHomeLink;
let homeConfig: string;
let macbookComputerId: string;

/** Run `fn` with the MacBook's private config, where its setup registry lives. */
async function asMacbook<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.RI_CONFIG_DIR;
  process.env.RI_CONFIG_DIR = layout.macbook.computer.configDir;
  try {
    return await fn();
  } finally {
    process.env.RI_CONFIG_DIR = saved;
  }
}

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-setups-' });
  homeConfig = home.configDir;
  layout = createTwoComputerLayout();
  const q = await import('@/lib/db/queries');
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const ws = q.createWorkspace({
    name: 'Ri',
    cwd: layout.mini.app,
    isGit: true,
    filesToCopy: [],
    collapsed: false,
    skipLiveConfirm: false,
    browserEnabled: false,
  });
  agentId = ws.id;
  q.createReferenceFolder({ alias: 'agentex', path: layout.mini.agentex });

  const { inProcessSetupLink, buildSetupContext } = await import('./home-context');
  homeLink = inProcessSetupLink();
  const key = q.createApiKey({ name: 'MacBook', deviceType: 'computer' }).key;
  const { computer } = q.registerComputerForApiKey({ apiKeyId: key.id, name: 'MacBook', platform: 'darwin' });
  macbookComputerId = computer.id;
  macbookLink = {
    async context() {
      return buildSetupContext(q.getComputer(macbookComputerId)!);
    },
    async report(reports, complete) {
      return q.recordAgentSetupReports(macbookComputerId, reports, { complete });
    },
  };
});

afterEach(async () => {
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  layout.cleanup();
  await home.cleanup();
});

async function setups() {
  const q = await import('@/lib/db/queries');
  return q.listAgentSetups({ workspaceId: agentId });
}

describe('one agent set up on two computers', () => {
  it('records each layout against its own computer, without either touching the other', async () => {
    const mini = await attach(homeLink, { agent: 'Ri', folder: layout.mini.app, references: { agentex: '../code/agentex' } });
    const macbook = await asMacbook(() =>
      attach(macbookLink, { agent: agentId, folder: layout.macbook.app, references: { agentex: '../agentex' } }),
    );
    expect(mini).toMatchObject({ status: 'ready', sourcePath: layout.mini.app });
    expect(macbook).toMatchObject({ status: 'ready', sourcePath: layout.macbook.app });

    const rows = await setups();
    expect(rows).toHaveLength(2);
    const byComputer = Object.fromEntries(rows.map((r) => [r.computerId === macbookComputerId ? 'macbook' : 'mini', r]));
    expect(byComputer.mini!.references[0]).toMatchObject({ alias: 'agentex', value: '../code/agentex', path: layout.mini.agentex });
    expect(byComputer.macbook!.references[0]).toMatchObject({ value: '../agentex', path: layout.macbook.agentex });

    // Each computer's registry names only its own folder.
    const homeRegistry = JSON.parse(fs.readFileSync(path.join(homeConfig, 'setups.json'), 'utf8'));
    const macRegistry = JSON.parse(fs.readFileSync(path.join(layout.macbook.computer.configDir, 'setups.json'), 'utf8'));
    expect(homeRegistry.locations.map((l: { dir: string }) => l.dir)).toEqual([layout.mini.app]);
    expect(macRegistry.locations.map((l: { dir: string }) => l.dir)).toEqual([layout.macbook.app]);

    // And the setup files never enter Git.
    expect(git(layout.mini.app, 'status', '--porcelain')).toBe('');
    expect(git(layout.macbook.app, 'status', '--porcelain')).toBe('');
  });

  it('blocks until every reference is chosen or left out', async () => {
    const report = await attach(homeLink, { agent: agentId, folder: layout.mini.app });
    expect(report.status).toBe('missing_reference');
    const fixed = await setReference(homeLink, { agent: agentId, alias: 'agentex', value: null });
    expect(fixed.status).toBe('ready');
  });

  it('refuses a second folder for the same agent on one computer', async () => {
    await attach(homeLink, { agent: agentId, folder: layout.mini.app, references: { agentex: null } });
    await expect(attach(homeLink, { agent: agentId, folder: layout.mini.agentex })).rejects.toThrow(SetupError);
  });

  it("refuses an edit made against an older revision, keeping the hand edit", async () => {
    await attach(homeLink, { agent: agentId, folder: layout.mini.app, references: { agentex: '../code/agentex' } });
    const before = readSetupFile(layout.mini.app);
    if (before.state !== 'ok') throw new Error('expected a setup file');
    const handEdited = before.file;
    handEdited.agents[agentId]!.references.agentex = layout.mini.agentex;
    fs.writeFileSync(path.join(layout.mini.app, SETUP_FILE), JSON.stringify(handEdited, null, 2));
    await expect(
      setReference(homeLink, { agent: agentId, alias: 'agentex', value: null, expectedRevision: before.revision }),
    ).rejects.toThrow(SetupFileConflictError);
    const after = readSetupFile(layout.mini.app);
    expect(after.state === 'ok' && after.file.agents[agentId]!.references.agentex).toBe(layout.mini.agentex);
  });
});

describe('recovering a setup', () => {
  it('restores a deleted setup file from the last report, only after the plan is confirmed', async () => {
    await attach(homeLink, { agent: agentId, folder: layout.mini.app, references: { agentex: '../code/agentex' } });
    fs.rmSync(path.join(layout.mini.app, SETUP_FILE)); // git clean -fdx
    const [gone] = await syncSetups(homeLink);
    expect(gone).toMatchObject({ status: 'missing_file' });

    const plan = await planRestore(homeLink, { agent: agentId });
    expect(plan).toMatchObject({ dir: layout.mini.app, agents: [agentId], baseRevision: null });
    expect(plan.file.agents[agentId]!.references).toEqual({ agentex: '../code/agentex' });
    expect(fs.existsSync(path.join(layout.mini.app, SETUP_FILE))).toBe(false); // planning writes nothing

    const [restored] = await restore(homeLink, plan);
    expect(restored).toMatchObject({ status: 'ready' });
  });

  it('never overwrites a file that reappeared after the plan', async () => {
    await attach(homeLink, { agent: agentId, folder: layout.mini.app, references: { agentex: null } });
    fs.rmSync(path.join(layout.mini.app, SETUP_FILE));
    await syncSetups(homeLink);
    const plan = await planRestore(homeLink, { agent: agentId });
    fs.writeFileSync(path.join(layout.mini.app, SETUP_FILE), '{"hand": "made"}');
    await expect(restore(homeLink, plan)).rejects.toThrow(SetupFileConflictError);
    expect(fs.readFileSync(path.join(layout.mini.app, SETUP_FILE), 'utf8')).toBe('{"hand": "made"}');
  });

  it('relinks a renamed folder and keeps the agent', async () => {
    await asMacbook(() => attach(macbookLink, { agent: agentId, folder: layout.macbook.app, references: { agentex: '../agentex' } }));
    const renamed = path.join(path.dirname(layout.macbook.app), 'ri-renamed');
    fs.renameSync(layout.macbook.app, renamed);

    const [gone] = await asMacbook(() => syncSetups(macbookLink));
    expect(gone).toMatchObject({ status: 'missing_folder' });

    const back = await asMacbook(() => relink(macbookLink, { agent: agentId, folder: renamed }));
    expect(back).toMatchObject({ status: 'ready', sourcePath: renamed });
    const macRegistry = JSON.parse(fs.readFileSync(path.join(layout.macbook.computer.configDir, 'setups.json'), 'utf8'));
    expect(macRegistry.locations.map((l: { dir: string }) => l.dir)).toEqual([renamed]);
  });

  it('refuses to relink to a folder that was never set up, which needs attach', async () => {
    await attach(homeLink, { agent: agentId, folder: layout.mini.app, references: { agentex: null } });
    await expect(relink(homeLink, { agent: agentId, folder: layout.mini.agentex })).rejects.toThrow(/attach it instead/);
  });

  it('detaches an agent, leaving the folder and removing it from the index', async () => {
    await attach(homeLink, { agent: agentId, folder: layout.mini.app, references: { agentex: null } });
    await detach(homeLink, { agent: agentId });
    expect(fs.existsSync(path.join(layout.mini.app, SETUP_FILE))).toBe(false);
    expect(fs.existsSync(path.join(layout.mini.app, 'package.json'))).toBe(true);
    expect(await setups()).toEqual([]);
  });
});
