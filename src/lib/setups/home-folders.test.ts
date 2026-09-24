import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { createTwoComputerLayout, type TwoComputerLayout } from '@/test/fixtures/git';
import { readSetupFile, SETUP_FILE } from './local-file';

/**
 * On the home's own computer, every folder choice made in the app lands in
 * the folder's setup file, and `workspaces.cwd` follows what the file says
 * (docs/homes-spec.md §4.2, §10.1).
 */

let home: TestHome;
let layout: TwoComputerLayout;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-home-folders-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  layout = createTwoComputerLayout();
});

afterEach(async () => {
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  layout.cleanup();
  await home.cleanup();
});

function json(url: string, method: string, body: unknown) {
  return new NextRequest(`http://127.0.0.1${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function createAgent(name: string, cwd: string) {
  const { POST } = await import('@/app/api/workspaces/route');
  const res = await POST(json('/api/workspaces', 'POST', { name, cwd }));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; cwd: string };
}

function agentsIn(dir: string): Record<string, { references: Record<string, unknown> }> {
  const read = readSetupFile(dir);
  if (read.state !== 'ok') throw new Error(`${dir}: ${read.state}`);
  return read.file.agents;
}

describe('agent folders chosen in the app', () => {
  it('writes the setup file when an agent is created, and reports it ready', async () => {
    const agent = await createAgent('App', layout.mini.app);
    expect(Object.keys(agentsIn(layout.mini.app))).toEqual([agent.id]);
    const q = await import('@/lib/db/queries');
    const [setup] = q.listAgentSetups({ workspaceId: agent.id });
    expect(setup).toMatchObject({ sourcePath: layout.mini.app, status: 'ready' });
  });

  it("moves the setup file when the agent's folder changes", async () => {
    const agent = await createAgent('App', layout.mini.app);
    const { PATCH } = await import('@/app/api/workspaces/[id]/route');
    const res = await PATCH(json(`/api/workspaces/${agent.id}`, 'PATCH', { cwd: layout.mini.agentex }), {
      params: Promise.resolve({ id: agent.id }),
    });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(layout.mini.app, SETUP_FILE))).toBe(false);
    expect(Object.keys(agentsIn(layout.mini.agentex))).toEqual([agent.id]);
    const q = await import('@/lib/db/queries');
    expect(q.listAgentSetups({ workspaceId: agent.id })).toEqual([
      expect.objectContaining({ sourcePath: layout.mini.agentex, status: 'ready' }),
    ]);
  });

  it('follows the setup file when the folder is relinked outside the app', async () => {
    const agent = await createAgent('App', layout.mini.app);
    const renamed = path.join(path.dirname(layout.mini.app), 'renamed-app');
    fs.renameSync(layout.mini.app, renamed);
    const { inProcessSetupLink } = await import('./home-context');
    const { relink } = await import('./service');
    await relink(inProcessSetupLink(), { agent: agent.id, folder: renamed });
    const q = await import('@/lib/db/queries');
    expect(q.getWorkspace(agent.id)?.cwd).toBe(renamed);
  });
});

describe('references chosen in the app', () => {
  it("maps a new reference into the home computer's setup files", async () => {
    const agent = await createAgent('App', layout.mini.app);
    const { POST } = await import('@/app/api/reference-folders/route');
    const res = await POST(json('/api/reference-folders', 'POST', { alias: 'agentex', path: layout.mini.agentex }));
    expect(res.status).toBe(201);
    expect(agentsIn(layout.mini.app)[agent.id]!.references).toEqual({ agentex: layout.mini.agentex });
    const q = await import('@/lib/db/queries');
    expect(q.listAgentSetups({ workspaceId: agent.id })[0]).toMatchObject({ status: 'ready' });
  });

  it('carries a changed path to mappings that followed it, and leaves a custom one alone', async () => {
    const a = await createAgent('A', layout.mini.app);
    const b = await createAgent('B', layout.macbook.app);
    const q = await import('@/lib/db/queries');
    const ref = q.createReferenceFolder({ alias: 'agentex', path: layout.mini.agentex });
    const { applyReferenceToHomeSetups, inProcessSetupLink } = await import('./home-context');
    await applyReferenceToHomeSetups(ref);
    // B maps it its own way on this computer.
    const { setReference } = await import('./service');
    await setReference(inProcessSetupLink(), { agent: b.id, alias: 'agentex', value: layout.macbook.agentex });

    const { PATCH } = await import('@/app/api/reference-folders/[id]/route');
    await PATCH(json(`/api/reference-folders/${ref.id}`, 'PATCH', { path: layout.macbook.agentex + '/..' }), {
      params: Promise.resolve({ id: ref.id }),
    });
    const moved = q.getReferenceFolder(ref.id)!.path;
    expect(agentsIn(layout.mini.app)[a.id]!.references.agentex).toBe(moved);
    expect(agentsIn(layout.macbook.app)[b.id]!.references.agentex).toBe(layout.macbook.agentex);
  });

  it("leaves an agent whose own reference hides the global one", async () => {
    const a = await createAgent('A', layout.mini.app);
    const q = await import('@/lib/db/queries');
    q.createReferenceFolder({ alias: 'docs', workspaceId: a.id, path: layout.mini.agentex });
    const { applyReferenceToHomeSetups } = await import('./home-context');
    await applyReferenceToHomeSetups(q.listReferenceFoldersForWorkspace(a.id).find((r) => r.alias === 'docs')!);
    const global = q.createReferenceFolder({ alias: 'docs', path: layout.macbook.agentex });
    await applyReferenceToHomeSetups(global);
    expect(agentsIn(layout.mini.app)[a.id]!.references.docs).toBe(layout.mini.agentex);
  });
});

describe('adopting existing folders', () => {
  it('moves agents made before setups into setup files, and leaves cwd as it was', async () => {
    const q = await import('@/lib/db/queries');
    const old = q.createWorkspace({
      name: 'Old',
      cwd: layout.mini.app,
      isGit: true,
      filesToCopy: [],
      collapsed: false,
      skipLiveConfirm: false,
      browserEnabled: false,
    });
    q.createReferenceFolder({ alias: 'agentex', path: layout.mini.agentex });
    const { planHomeAdoption, adoptHomeSetups } = await import('./home-context');
    const plan = planHomeAdoption();
    expect(plan.steps).toEqual([expect.objectContaining({ kind: 'create', dir: layout.mini.app, agents: [old.id] })]);
    const { reports } = await adoptHomeSetups(plan);
    expect(reports).toEqual([expect.objectContaining({ agentId: old.id, status: 'ready' })]);
    expect(agentsIn(layout.mini.app)[old.id]!.references).toEqual({ agentex: layout.mini.agentex });
    expect(q.getWorkspace(old.id)?.cwd).toBe(layout.mini.app);
    expect(planHomeAdoption().steps).toEqual([]);
  });
});
