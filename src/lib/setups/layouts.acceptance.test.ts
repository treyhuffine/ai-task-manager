import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { createTwoComputerLayout, git, type TwoComputerLayout } from '@/test/fixtures/git';
import { readSetupFile, SETUP_FILE, writeSetupFile } from './local-file';
import {
  attach,
  planRestore,
  relink,
  restore,
  setReference,
  syncSetups,
  type SetupHomeLink,
} from './service';

/**
 * P1.7 acceptance (docs/homes-spec.md §4): the Ri agent with agentex beside
 * it, on a MacBook at ~/dynamism/ri and on a Mac Mini at ~/ai-task-manager,
 * with every problem the spec names, in isolated fixtures only. One home,
 * two computers, one agent.
 */

interface Computer {
  name: string;
  link: SetupHomeLink;
  configDir: string;
  app: string;
  agentex: string;
  agentexRelative: string;
}

let home: TestHome;
let layout: TwoComputerLayout;
let mono: TwoComputerLayout;
let agentId: string;
let macbook: Computer;
let mini: Computer;

async function on<T>(computer: Computer, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.RI_CONFIG_DIR;
  process.env.RI_CONFIG_DIR = computer.configDir;
  try {
    return await fn();
  } finally {
    process.env.RI_CONFIG_DIR = saved;
  }
}

async function indexFor(computerName: string) {
  const q = await import('@/lib/db/queries');
  return q.listAgentSetups({ workspaceId: agentId }).find((s) => s.computerName === computerName) ?? null;
}

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-layouts-' });
  layout = createTwoComputerLayout();
  mono = createTwoComputerLayout({ monorepoSubdir: 'apps/ri' });
  const q = await import('@/lib/db/queries');
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const host = identity.ensureHomeIdentity().computer;
  q.updateComputer(host.id, { name: 'Mac Mini' });
  identity.resetHomeIdentityCache();
  agentId = q.createWorkspace({
    name: 'Ri',
    cwd: layout.mini.app,
    isGit: true,
    filesToCopy: [],
    collapsed: false,
    skipLiveConfirm: false,
    browserEnabled: false,
  }).id;
  q.createReferenceFolder({ alias: 'agentex', path: layout.mini.agentex, description: 'The harness library' });

  const { inProcessSetupLink, buildSetupContext } = await import('./home-context');
  mini = {
    name: 'Mac Mini',
    link: inProcessSetupLink(),
    configDir: home.configDir,
    app: layout.mini.app,
    agentex: layout.mini.agentex,
    agentexRelative: layout.mini.agentexRelative,
  };
  const key = q.createApiKey({ name: 'MacBook', deviceType: 'computer' }).key;
  const laptop = q.registerComputerForApiKey({ apiKeyId: key.id, name: 'MacBook' }).computer;
  macbook = {
    name: 'MacBook',
    link: {
      context: async () => buildSetupContext(q.getComputer(laptop.id)!),
      report: async (reports, complete) => q.recordAgentSetupReports(laptop.id, reports, { complete }),
    },
    configDir: layout.macbook.computer.configDir,
    app: layout.macbook.app,
    agentex: layout.macbook.agentex,
    agentexRelative: layout.macbook.agentexRelative,
  };
});

afterEach(async () => {
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  layout.cleanup();
  mono.cleanup();
  await home.cleanup();
});

const setUp = (c: Computer) =>
  on(c, () => attach(c.link, { agent: agentId, folder: c.app, references: { agentex: c.agentexRelative } }));

describe('one Ri agent, two layouts', () => {
  it('resolves each computer to its own folders, from its own file, with nothing committed', async () => {
    const [m, b] = [await setUp(mini), await setUp(macbook)];
    expect(m.references[0]).toMatchObject({ value: '../code/agentex', path: mini.agentex, exists: true });
    expect(b.references[0]).toMatchObject({ value: '../agentex', path: macbook.agentex, exists: true });
    expect((await indexFor('Mac Mini'))?.status).toBe('ready');
    expect((await indexFor('MacBook'))?.status).toBe('ready');
    for (const c of [mini, macbook]) {
      const read = readSetupFile(c.app);
      expect(read.state === 'ok' && Object.keys(read.file)).toEqual(['version', 'homeId', 'agents']);
      expect(git(c.app, 'status', '--porcelain')).toBe('');
    }
  });

  it('works for an agent in a monorepo subfolder, keeping the repository layout', async () => {
    const monoMini: Computer = { ...mini, app: mono.mini.app, agentex: mono.mini.agentex, agentexRelative: mono.mini.agentexRelative };
    const report = await on(monoMini, () =>
      attach(monoMini.link, { agent: agentId, folder: monoMini.app, references: { agentex: monoMini.agentexRelative } }),
    );
    expect(report).toMatchObject({ status: 'ready', sourcePath: mono.mini.app });
    expect(report.references[0]!.path).toBe(mono.mini.agentex);
    expect(fs.existsSync(path.join(mono.mini.app, SETUP_FILE))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(path.dirname(mono.mini.app)), SETUP_FILE))).toBe(false);
    expect(git(mono.mini.app, 'status', '--porcelain')).toBe('');
  });
});

describe('what goes wrong, and what the person does about it', () => {
  it('blocks a reference that is missing on one computer only', async () => {
    await setUp(mini);
    await setUp(macbook);
    fs.rmSync(macbook.agentex, { recursive: true, force: true });
    const [b] = await on(macbook, () => syncSetups(macbook.link));
    expect(b).toMatchObject({ status: 'missing_reference', problem: expect.stringMatching(/doesn't exist/) });
    expect((await indexFor('Mac Mini'))?.status).toBe('ready');
    const omitted = await on(macbook, () => setReference(macbook.link, { agent: agentId, alias: 'agentex', value: null }));
    expect(omitted.status).toBe('ready');
  });

  it('reports a malformed file, then recovers once it is fixed', async () => {
    await setUp(macbook);
    const good = fs.readFileSync(path.join(macbook.app, SETUP_FILE), 'utf8');
    fs.writeFileSync(path.join(macbook.app, SETUP_FILE), good.slice(0, 20));
    expect((await on(macbook, () => syncSetups(macbook.link)))[0]).toMatchObject({ status: 'invalid_config' });
    fs.writeFileSync(path.join(macbook.app, SETUP_FILE), good);
    expect((await on(macbook, () => syncSetups(macbook.link)))[0]).toMatchObject({ status: 'ready' });
  });

  it("ignores a file copied from the other computer until this one registers it", async () => {
    await setUp(mini);
    // Someone copies the Mini's file into the MacBook's checkout by hand.
    fs.copyFileSync(path.join(mini.app, SETUP_FILE), path.join(macbook.app, SETUP_FILE));
    expect(await on(macbook, () => syncSetups(macbook.link))).toEqual([]);
    expect(await indexFor('MacBook')).toBeNull();
  });

  it('restores a deleted file from the last report, only after confirming', async () => {
    await setUp(macbook);
    git(macbook.app, 'clean', '-fdxq');
    expect(fs.existsSync(path.join(macbook.app, SETUP_FILE))).toBe(false);
    expect((await on(macbook, () => syncSetups(macbook.link)))[0]).toMatchObject({ status: 'missing_file' });
    const plan = await on(macbook, () => planRestore(macbook.link, { agent: agentId }));
    expect(plan.file.agents[agentId]!.references).toEqual({ agentex: '../agentex' });
    const [restored] = await on(macbook, () => restore(macbook.link, plan));
    expect(restored).toMatchObject({ status: 'ready' });
  });

  it('relinks a renamed folder without asking for anything but its new place', async () => {
    await setUp(macbook);
    const renamed = path.join(path.dirname(macbook.app), 'ri-2');
    fs.renameSync(macbook.app, renamed);
    expect((await on(macbook, () => syncSetups(macbook.link)))[0]).toMatchObject({ status: 'missing_folder' });
    const back = await on(macbook, () => relink(macbook.link, { agent: agentId, folder: renamed }));
    expect(back).toMatchObject({ status: 'ready', sourcePath: renamed });
  });

  it('updates a stale report from the file, which is the authority', async () => {
    await setUp(macbook);
    const before = await indexFor('MacBook');
    // A hand edit the home hasn't seen yet: the index is stale.
    const read = readSetupFile(macbook.app);
    if (read.state !== 'ok') throw new Error('expected a setup file');
    const edited = { ...read.file, agents: { [agentId]: { references: { agentex: macbook.agentex } } } };
    writeSetupFile(macbook.app, edited, read.revision);
    expect((await indexFor('MacBook'))?.configRevision).toBe(before?.configRevision);
    // Any check re-reads the file and replaces what the home had.
    await on(macbook, () => syncSetups(macbook.link));
    const after = await indexFor('MacBook');
    expect(after?.configRevision).not.toBe(before?.configRevision);
    expect(after?.references[0]).toMatchObject({ value: macbook.agentex, path: macbook.agentex });
    // An edit made against the stale revision is refused.
    await expect(
      on(macbook, () =>
        setReference(macbook.link, { agent: agentId, alias: 'agentex', value: null, expectedRevision: before!.configRevision! }),
      ),
    ).rejects.toThrow(/changed since it was read/);
  });
});
