/**
 * An agent's folders on each of the person's devices, from the Setup tab
 * (docs/homes-spec.md §4.1-4.2): any screen changes any device's, a
 * device that isn't running Ri takes a whole path and checks it when it's
 * back, and the home is never removed from.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import type { AgentFoldersOn } from '@/lib/setups/folders';

const recycled = vi.hoisted(() => ({ agents: [] as string[], linked: [] as Array<string | null> }));
vi.mock('@/lib/executor/adapter', async (original) => ({
  ...(await original<typeof import('@/lib/executor/adapter')>()),
  recycleWorkspaceSessions: async (id: string) => void recycled.agents.push(id),
  recycleForReferenceFolderChange: async (id: string | null) => void recycled.linked.push(id),
}));

let home: TestHome;
let agentId: string;
let hostId: string;
let laptopId: string;
let docsHere: string;

beforeEach(async () => {
  recycled.agents = [];
  recycled.linked = [];
  home = await createTestHome({ prefix: 'ri-folders-route-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().device.id;
  const q = await import('@/lib/db/queries');
  const project = path.join(home.root, 'ri');
  docsHere = path.join(home.root, 'docs');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(docsHere, { recursive: true });
  agentId = q.createWorkspace({ name: 'Ri', cwd: project, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  await (await import('@/lib/setups/home-context')).setHomeFolder(agentId, project);
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'MacBook', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).device.id;
});

afterEach(async () => {
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

type Answer = { status: number; body: { devices?: AgentFoldersOn[]; error?: string; message?: string } };

async function answer(response: Response): Promise<Answer> {
  return { status: response.status, body: await response.json() };
}

const on = (a: Answer, deviceId: string) => a.body.devices!.find((c) => c.deviceId === deviceId)!;

async function view(): Promise<Answer> {
  const { GET } = await import('./route');
  return answer(await GET(new NextRequest(`http://home/api/workspaces/${agentId}/folders`), { params: Promise.resolve({ id: agentId }) }));
}

async function setProject(deviceId: string, folder: string): Promise<Answer> {
  const { PUT } = await import('./[deviceId]/route');
  return answer(
    await PUT(new NextRequest(`http://home/x`, { method: 'PUT', body: JSON.stringify({ folder }) }), {
      params: Promise.resolve({ id: agentId, deviceId }),
    }),
  );
}

async function setLinked(deviceId: string, referenceFolderId: string, folder: string | null): Promise<Answer> {
  const { PUT } = await import('./[deviceId]/linked/[referenceFolderId]/route');
  return answer(
    await PUT(new NextRequest(`http://home/x`, { method: 'PUT', body: JSON.stringify({ folder }) }), {
      params: Promise.resolve({ id: agentId, deviceId, referenceFolderId }),
    }),
  );
}

async function addLinked(body: Record<string, unknown>): Promise<Answer> {
  const { POST } = await import('./route');
  return answer(await POST(new NextRequest(`http://home/x`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: agentId }) }));
}

async function removeFrom(deviceId: string): Promise<Answer> {
  const { DELETE } = await import('./[deviceId]/route');
  return answer(await DELETE(new NextRequest(`http://home/x`, { method: 'DELETE' }), { params: Promise.resolve({ id: agentId, deviceId }) }));
}

describe('the view', () => {
  it('lists the home first, ready, and a device the agent is not on yet', async () => {
    const got = await view();
    expect(got.body.devices!.map((c) => [c.name, c.isHome, c.setup?.status ?? null, c.connected])).toEqual([
      [expect.any(String), true, 'ready', true],
      ['MacBook', false, null, false],
    ]);
  });
});

describe('the project folder on a device', () => {
  it('takes a whole path for a device that is not running Ri, not checked until it is back', async () => {
    const got = await setProject(laptopId, '/Users/trey/ri');
    expect(got.status).toBe(200);
    expect(on(got, laptopId).setup).toMatchObject({ folder: '/Users/trey/ri', status: 'unchecked', found: null });
    // Nothing on the home restarts for a change on the MacBook.
    expect(recycled.agents).toEqual([]);
  });

  it('asks for a whole path when the device can not say where its home folder is', async () => {
    const got = await setProject(laptopId, '~/ri');
    expect(got).toMatchObject({ status: 400, body: { error: 'not_there' } });
    expect(got.body.message).toContain('Type the whole path');
  });

  it("checks the home's own disk, and restarts the agent's live sessions into a new home folder", async () => {
    const missing = await setProject(hostId, path.join(home.root, 'nowhere'));
    expect(missing).toMatchObject({ status: 400, body: { error: 'not_there' } });
    const moved = path.join(home.root, 'moved');
    fs.mkdirSync(moved);
    const got = await setProject(hostId, moved);
    expect(on(got, hostId).setup).toMatchObject({ folder: moved, status: 'ready', found: true });
    const q = await import('@/lib/db/queries');
    expect(q.getWorkspace(agentId)!.cwd).toBe(moved);
    expect(recycled.agents).toEqual([agentId]);
  });
});

describe('linked folders', () => {
  it('adds one where it is on the home, which the MacBook then needs to choose, or go without', async () => {
    const added = await addLinked({ alias: 'docs', description: 'The docs', forEveryAgent: false, deviceId: hostId, folder: docsHere });
    expect(added.status).toBe(201);
    const docs = on(added, hostId).linked.find((l) => l.alias === 'docs')!;
    expect(docs).toMatchObject({ path: docsHere, state: 'found', forEveryAgent: false, description: 'The docs', readOnly: false });

    await setProject(laptopId, '/Users/trey/ri');
    const laptop = on(await view(), laptopId);
    expect(laptop.linked[0]).toMatchObject({ alias: 'docs', state: 'unchosen', path: null });

    const without = await setLinked(laptopId, docs.referenceFolderId, null);
    expect(on(without, laptopId).linked[0]).toMatchObject({ state: 'omitted' });
    // The agent's live sessions learn about the change.
    expect(recycled.linked).toContain(agentId);
  });

  it('adds one read only when asked, and every device sees it so', async () => {
    const added = await addLinked({ alias: 'docs', description: null, forEveryAgent: false, readOnly: true, deviceId: hostId, folder: docsHere });
    expect(added.status).toBe(201);
    expect(on(added, hostId).linked.find((l) => l.alias === 'docs')).toMatchObject({ readOnly: true });
    await setProject(laptopId, '/Users/trey/ri');
    expect(on(await view(), laptopId).linked[0]).toMatchObject({ alias: 'docs', readOnly: true });
  });

  it('leaves nothing behind when the folder it is added with is not there', async () => {
    const got = await addLinked({ alias: 'ghost', description: null, forEveryAgent: true, deviceId: hostId, folder: path.join(home.root, 'nope') });
    expect(got).toMatchObject({ status: 400, body: { error: 'not_there' } });
    const q = await import('@/lib/db/queries');
    expect(q.listReferenceFoldersForWorkspace(agentId).map((r) => r.alias)).not.toContain('ghost');
  });

  it("refuses to place another agent: it's that agent's own folder on each device", async () => {
    const q = await import('@/lib/db/queries');
    const other = q.createWorkspace({ name: 'Docs', cwd: docsHere, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
    const ref = q.createReferenceFolder({ workspaceId: agentId, alias: 'docs-agent', targetWorkspaceId: other });
    const got = await setLinked(laptopId, ref.id, '/Users/trey/docs');
    expect(got).toMatchObject({ status: 400, body: { error: 'invalid_params' } });
  });
});

describe('removing it from a device', () => {
  it('never removes it from the home, where it lives', async () => {
    const got = await removeFrom(hostId);
    expect(got.status).toBe(400);
    expect(got.body.message).toContain('Change it instead, or archive the agent');
  });

  it('takes it off the MacBook, and new work there starts on the home again', async () => {
    const q = await import('@/lib/db/queries');
    await setProject(laptopId, '/Users/trey/ri');
    q.updateWorkspace(agentId, { defaultDeviceId: laptopId });
    const got = await removeFrom(laptopId);
    expect(got.status).toBe(200);
    expect(on(got, laptopId).setup).toBeNull();
    expect(q.getWorkspace(agentId)!.defaultDeviceId).toBeNull();
  });
});

describe("a device's folders, for choosing one", () => {
  async function list(deviceId: string, at?: string) {
    const { GET } = await import('@/app/api/devices/[id]/folders/route');
    const url = `http://home/api/devices/${deviceId}/folders${at ? `?path=${encodeURIComponent(at)}` : ''}`;
    return answer(await GET(new NextRequest(url), { params: Promise.resolve({ id: deviceId }) }));
  }

  it("lists the home's own, and says a device that is not running Ri can't be browsed", async () => {
    const base = fs.mkdtempSync(path.join(os.homedir(), '.ri-folders-route-'));
    try {
      fs.mkdirSync(path.join(base, 'one'));
      const here = (await list(hostId, base)) as unknown as { status: number; body: { folders: Array<{ name: string }> } };
      expect(here.status).toBe(200);
      expect(here.body.folders.map((f) => f.name)).toEqual(['one']);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
    const away = await list(laptopId);
    expect(away).toMatchObject({ status: 409, body: { error: 'unavailable' } });
    expect(away.body.message).toContain("MacBook isn't running Ri right now");
  });
});
