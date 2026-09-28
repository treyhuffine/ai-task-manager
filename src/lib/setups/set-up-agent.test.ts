/**
 * Setting an agent up on a computer from the app (docs/homes-model.md): the
 * home says what the computer needs to know (the agent's remote and where
 * its references sit beside it on the home), the computer copies it down or
 * uses a folder already there, the same setup `ri setup attach` makes, and
 * the home records what it reports. The computer's side runs through the
 * real worker handler, in-process, under its own config folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestComputer, createTestHome, type TestComputer, type TestHome } from '@/test/fixtures/home';
import { createTwoComputerLayout, type TwoComputerLayout } from '@/test/fixtures/git';
import type { CommandJournal } from '@/lib/worker/command-journal';

vi.setConfig({ testTimeout: 30_000 });

const hub = vi.hoisted(() => ({ connected: true, unsupported: false, requests: [] as Array<{ kind: string; payload: unknown }> }));
vi.mock('@/lib/workers/hub', async (original) => {
  const real = await original<typeof import('@/lib/workers/hub')>();
  return {
    ...real,
    requestWorker: async (computerId: string, kind: string, payload: unknown) => {
      hub.requests.push({ kind, payload });
      if (!hub.connected) throw new real.WorkerUnavailableError(computerId);
      if (hub.unsupported) throw new real.WorkerRequestError(`This computer doesn't know the request "${kind}". Update Ri here.`);
      // The laptop's worker, answering with its own setup registry.
      const { executionRequests } = await import('@/lib/worker/handlers');
      const handle = executionRequests({ journal: {} as CommandJournal, homeId: homeId() });
      return withConfig(laptop.configDir, () => handle(kind as never, payload));
    },
  };
});

let home: TestHome;
let layout: TwoComputerLayout;
let laptop: TestComputer;
let agentId: string;
let laptopId: string;

function homeId(): string {
  return (globalThis as { __homeId?: string }).__homeId!;
}

async function withConfig<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.RI_CONFIG_DIR;
  process.env.RI_CONFIG_DIR = dir;
  try {
    return await fn();
  } finally {
    process.env.RI_CONFIG_DIR = saved;
  }
}

beforeEach(async () => {
  hub.connected = true;
  hub.unsupported = false;
  hub.requests = [];
  home = await createTestHome({ prefix: 'ri-set-up-agent-' });
  layout = createTwoComputerLayout();
  laptop = createTestComputer('laptop');
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  (globalThis as { __homeId?: string }).__homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  agentId = q.createWorkspace({ name: 'Ri', cwd: layout.mini.app, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  q.createReferenceFolder({ alias: 'agentex', path: layout.mini.agentex, description: 'The agent library' });
  // On the home, the Mini: Ri with agentex beside it at ../code/agentex.
  const { inProcessSetupLink } = await import('./home-context');
  const { attach } = await import('./service');
  await attach(inProcessSetupLink(), { agent: agentId, folder: layout.mini.app, references: { agentex: '../code/agentex' } });
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'Laptop', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' }).computer.id;
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  laptop.cleanup();
  layout.cleanup();
  await home.cleanup();
});

describe('what it would do', () => {
  it('copies from the Git remote of its folder on the home, with its references coming along beside it', async () => {
    const { planSetup } = await import('./set-up-agent');
    const { getAppRoot } = await import('@/lib/config/paths');
    const plan = await planSetup(agentId, laptopId);
    expect(plan).toMatchObject({
      agentName: 'Ri',
      computerName: 'Laptop',
      remote: layout.appRemote,
      defaultFolder: path.join(getAppRoot(), 'projects', 'ri'),
      existing: null,
      references: [{ alias: 'agentex', description: 'The agent library', comesAlong: true }],
    });
    const sent = hub.requests[0]!.payload as import('./set-up-here').SetupAgentRequest;
    expect(sent.references).toEqual([
      { alias: 'agentex', description: 'The agent library', relativePath: '../code/agentex', remote: layout.agentexRemote, knownPath: null, agentId: null, omitted: false },
    ]);
  });
});

describe('setting it up', () => {
  it('copies the project and its references down, and the home records it ready there', async () => {
    const { applySetup } = await import('./set-up-agent');
    const target = path.join(laptop.userDir, 'projects', 'ri');
    const result = await applySetup(agentId, laptopId, { how: 'copy', folder: target });
    expect(result).toMatchObject({ folder: target, missing: [], copied: [target, path.join(laptop.userDir, 'projects', 'code', 'agentex')] });
    expect(result.report).toMatchObject({ status: 'ready' });
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(laptop.userDir, 'projects', 'code', 'agentex', 'package.json'))).toBe(true);
    // Registered in the laptop's own registry, not the home's.
    expect(fs.readFileSync(path.join(laptop.configDir, 'setups.json'), 'utf8')).toContain(target);
    const { runOnFor } = await import('./run-on');
    expect(runOnFor(agentId)!.choices.find((c) => c.computerId === laptopId)).toMatchObject({ ready: true, needsSetup: false });
    const q = await import('@/lib/db/queries');
    expect(q.getAgentSetup(agentId, laptopId)).toMatchObject({ sourcePath: target, status: 'ready' });
  });

  it('uses a folder already there, and asks about a reference it can not find or copy', async () => {
    const existing = layout.git.clone(layout.appRemote, path.join(laptop.userDir, 'work', 'ri'));
    const q = await import('@/lib/db/queries');
    // The home's agentex has no remote to copy it from.
    fs.rmSync(path.join(layout.mini.agentex, '.git'), { recursive: true, force: true });
    const { applySetup } = await import('./set-up-agent');
    const first = await applySetup(agentId, laptopId, { how: 'existing', folder: existing });
    expect(first.copied).toEqual([]);
    expect(first.missing).toEqual([{ alias: 'agentex', description: 'The agent library' }]);
    expect(first.report.status).not.toBe('ready');
    // Going without it.
    const second = await applySetup(agentId, laptopId, { how: 'existing', folder: existing, answers: { agentex: null } });
    expect(second.missing).toEqual([]);
    expect(second.report.status).toBe('ready');
    expect(q.getAgentSetup(agentId, laptopId)).toMatchObject({ sourcePath: existing, status: 'ready' });
  });

  it("uses a shared reference another agent already has there, rather than a second copy", async () => {
    const q = await import('@/lib/db/queries');
    const { applySetup } = await import('./set-up-agent');
    await applySetup(agentId, laptopId, { how: 'copy', folder: path.join(laptop.userDir, 'projects', 'ri') });
    const sharedAgentex = path.join(laptop.userDir, 'projects', 'code', 'agentex');
    // A second agent on the home, laid out differently beside agentex.
    const docsRemote = layout.git.remote('docs');
    const docsHome = layout.git.clone(docsRemote, path.join(layout.mini.computer.userDir, 'writing', 'docs'));
    const docsId = q.createWorkspace({ name: 'Docs', cwd: docsHome, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
    const { inProcessSetupLink } = await import('./home-context');
    const { attach } = await import('./service');
    await attach(inProcessSetupLink(), { agent: docsId, folder: docsHome, references: { agentex: layout.mini.agentex } });
    const result = await applySetup(docsId, laptopId, { how: 'copy', folder: path.join(laptop.userDir, 'elsewhere', 'docs') });
    expect(result.report.status).toBe('ready');
    expect(result.copied).toEqual([path.join(laptop.userDir, 'elsewhere', 'docs')]);
    expect(result.report.references[0]).toMatchObject({ alias: 'agentex', path: sharedAgentex });
  });

  it('uses a copy that is already where it would go, rather than copying again', async () => {
    const target = layout.git.clone(layout.appRemote, path.join(laptop.userDir, 'projects', 'ri'));
    fs.writeFileSync(path.join(target, 'mine.txt'), 'kept\n');
    const { applySetup } = await import('./set-up-agent');
    const result = await applySetup(agentId, laptopId, { how: 'copy', folder: target });
    expect(result.copied).not.toContain(target);
    expect(fs.readFileSync(path.join(target, 'mine.txt'), 'utf8')).toBe('kept\n');
  });

  it('refuses to copy over a folder with something else in it, and leaves it alone', async () => {
    const target = path.join(laptop.userDir, 'projects', 'ri');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'notes.txt'), 'mine\n');
    const { applySetup } = await import('./set-up-agent');
    await expect(applySetup(agentId, laptopId, { how: 'copy', folder: target })).rejects.toThrow(/already has something else in it/);
    expect(fs.readdirSync(target)).toEqual(['notes.txt']);
  });

  it('leaves nothing behind when a copy fails', async () => {
    const q = await import('@/lib/db/queries');
    const ws = q.getWorkspace(agentId)!;
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['-C', ws.cwd, 'remote', 'set-url', 'origin', path.join(laptop.root, 'no-such-remote.git')]);
    const target = path.join(laptop.userDir, 'projects', 'ri');
    const { applySetup } = await import('./set-up-agent');
    await expect(applySetup(agentId, laptopId, { how: 'copy', folder: target })).rejects.toThrow(/Couldn't copy/);
    expect(fs.existsSync(target)).toBe(false);
    expect(q.getAgentSetup(agentId, laptopId)).toBeNull();
  });
});

describe('when the computer can not do it', () => {
  it('says the computer is not running Ri', async () => {
    hub.connected = false;
    const { planSetup, SetupUnavailableError } = await import('./set-up-agent');
    await expect(planSetup(agentId, laptopId)).rejects.toBeInstanceOf(SetupUnavailableError);
    await expect(planSetup(agentId, laptopId)).rejects.toThrow("Laptop isn't running Ri right now. Start it there, then try again.");
  });

  it('says an older Ri there needs updating', async () => {
    hub.unsupported = true;
    const { planSetup } = await import('./set-up-agent');
    await expect(planSetup(agentId, laptopId)).rejects.toThrow('Laptop has an older Ri that can\'t set agents up from here. Update Ri on Laptop.');
  });

  it("refuses a request from another home", async () => {
    const { executionRequests } = await import('@/lib/worker/handlers');
    const handle = executionRequests({ journal: {} as CommandJournal, homeId: 'another-home' });
    const { buildSetupContext } = await import('./home-context');
    const q = await import('@/lib/db/queries');
    const answer = (await handle('setup_agent', {
      op: 'plan', context: buildSetupContext(q.getComputer(laptopId)!), agentId, agentName: 'Ri', agentSlug: 'ri',
      remote: null, how: 'copy', folder: null, references: [],
    })) as { status: number };
    expect(answer.status).toBe(409);
  });
});

describe('remotes', () => {
  it('treats the ssh and https spellings of one remote as the same', async () => {
    const { sameRemote } = await import('./set-up-here');
    expect(sameRemote('git@github.com:Trey/ri.git', 'https://github.com/trey/ri')).toBe(true);
    expect(sameRemote('ssh://git@github.com/trey/ri.git', 'git@github.com:trey/ri')).toBe(true);
    expect(sameRemote('git@github.com:trey/ri.git', 'git@github.com:trey/other.git')).toBe(false);
  });
});
