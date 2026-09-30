import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { API_KEY_ID_HEADER, CALLER_LOCATION_HEADER } from '@/lib/auth/request-key';

/**
 * A connected device's CLI runs actions on its home through this route,
 * with provenance from credentials only (docs/homes-spec.md §5.3, §6).
 */

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-actions-route-' });
});

afterEach(async () => {
  await home.cleanup();
});

function post(name: string, body: unknown, headers: Record<string, string>) {
  return new NextRequest(`http://127.0.0.1/api/orchestrator/actions/${name}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const fromLaptop = { [API_KEY_ID_HEADER]: 'key-laptop', [CALLER_LOCATION_HEADER]: 'elsewhere' };
const fromHome = { [API_KEY_ID_HEADER]: 'key-host', [CALLER_LOCATION_HEADER]: 'home' };

async function call(name: string, body: unknown, headers: Record<string, string>) {
  const { POST } = await import('./route');
  const res = await POST(post(name, body, headers), { params: Promise.resolve({ name }) });
  return {
    status: res.status,
    body: (await res.json()) as {
      ok: boolean;
      result?: { id: string; title: string };
      error?: { code: string; message: string };
    },
  };
}

describe('POST /api/orchestrator/actions/:name', () => {
  it('runs the action on the home and returns the CLI envelope', async () => {
    const { status, body } = await call('create_task', { title: 'Buy milk' }, fromLaptop);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result?.title).toBe('Buy milk');
    const { listTasks } = await import('@/lib/db/queries');
    expect(listTasks({}).map((t) => t.title)).toContain('Buy milk');
  });

  it('returns validation and unknown-action failures in the same envelope', async () => {
    expect((await call('create_task', {}, fromLaptop)).body.error?.code).toBe('invalid_params');
    expect((await call('no_such_action', {}, fromLaptop)).body.error?.code).toBe('unknown_action');
    const bad = await call('create_task', '{not json', fromLaptop);
    expect(bad.status).toBe(400);
  });

  it('attributes a lifecycle change to the calling session, from its signed credential only', async () => {
    const q = await import('@/lib/db/queries');
    const { sessionCredential } = await import('@/lib/orchestrator/session-credential');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    const task = q.createTask({ title: 'Ship it' });

    const started = await call('transition_task', { id: task.id, command: 'start' }, {
      ...fromLaptop,
      'x-ri-session': sessionCredential(chat.id)!,
    });
    expect(started.body.ok).toBe(true);
    const { getRawDb } = await import('@/lib/db');
    const change = getRawDb()
      .prepare('SELECT actor_session_id, actor_source FROM task_status_changes WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(task.id) as { actor_session_id: string | null; actor_source: string };
    expect(change).toEqual({ actor_session_id: chat.id, actor_source: 'ai' });

    // A forged credential names no one.
    const forged = await call('get_task', { id: task.id }, { ...fromLaptop, 'x-ri-session': `${chat.id}.forged` });
    expect(forged.body.ok).toBe(true);
  });

  it("refuses a folder path from another device, which would name a folder on the home's disk", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-actions-folder-'));
    try {
      const fromElsewhere = await call('create_workspace', { name: 'app', cwd: folder }, fromLaptop);
      expect(fromElsewhere.body.ok).toBe(false);
      expect(fromElsewhere.body.error?.code).toBe('unsupported');
      expect(fromElsewhere.body.error?.message).toMatch(/another device/);

      const onHome = await call('create_workspace', { name: 'app', cwd: folder }, fromHome);
      expect(onHome.body.ok).toBe(true);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('devices and setups over the route', () => {
  it("records a device's details and folders on its key's device, and only there", async () => {
    const q = await import('@/lib/db/queries');
    const laptop = q.pairDevice({ name: 'MacBook', kind: 'computer' });
    const asLaptop = { [API_KEY_ID_HEADER]: laptop.key.id, [CALLER_LOCATION_HEADER]: 'elsewhere' };

    const registered = await call('register_device', { name: 'AI-MacBook', platform: 'darwin' }, asLaptop);
    expect(registered.body.result).toMatchObject({ device: { id: laptop.device.id, name: 'MacBook', platform: 'darwin' }, created: false });

    const ws = q.createWorkspace({
      name: 'Ri',
      cwd: home.root,
      isGit: false,
      filesToCopy: [],
      collapsed: false,
      skipLiveConfirm: false,
      browserEnabled: false,
    });
    // The laptop isn't connected here, so its folder is taken as it is, and checked when it is.
    const stored = await call('set_workspace_folder', { agent: ws.id, folder: '/Users/trey/dynamism/ri' }, asLaptop);
    expect(stored.body.ok).toBe(true);

    await call('rename_device', { name: 'Trey’s MacBook' }, asLaptop);
    await call('rename_device', { name: 'MacBook' }, asLaptop);
    const listed = await call('list_workspace_setups', { workspaceId: ws.id }, fromHome);
    const rows = listed.body.result as unknown as Array<{ deviceName: string; sourcePath: string }>;
    expect(rows).toEqual([expect.objectContaining({ deviceName: 'MacBook', sourcePath: '/Users/trey/dynamism/ri' })]);

    // Another device's key records on its own device, never the MacBook's.
    const phone = q.pairDevice({ name: 'Phone', kind: 'phone' });
    const asPhone = { [API_KEY_ID_HEADER]: phone.key.id, [CALLER_LOCATION_HEADER]: 'elsewhere' };
    await call('set_workspace_folder', { agent: ws.id, folder: '/Users/trey/elsewhere' }, asPhone);
    expect(q.getWorkspaceSetup(ws.id, laptop.device.id)?.sourcePath).toBe('/Users/trey/dynamism/ri');
    expect(q.getWorkspaceSetup(ws.id, phone.device.id)?.sourcePath).toBe('/Users/trey/elsewhere');

    // A key the home never gave a device can't record folders at all.
    const orphan = q.createApiKey({ name: 'Orphan', deviceId: null, role: 'sign_in' }).key;
    const asOrphan = { [API_KEY_ID_HEADER]: orphan.id, [CALLER_LOCATION_HEADER]: 'elsewhere' };
    const refused = await call('set_workspace_folder', { agent: ws.id, folder: '/tmp/x' }, asOrphan);
    expect(refused.body.error?.code).toBe('conflict');
  });

  it('keeps the same device when it pairs again with a new key, and never binds to the home itself', async () => {
    const q = await import('@/lib/db/queries');
    const as = (id: string) => ({ [API_KEY_ID_HEADER]: id, [CALLER_LOCATION_HEADER]: 'elsewhere' });
    const first = q.pairDevice({ name: 'MacBook', kind: 'computer' }).key;
    const made = await call('register_device', { name: 'MacBook' }, as(first.id));
    const deviceId = (made.body.result as unknown as { device: { id: string } }).device.id;

    // Paired again: the new pairing made a device of its own, which the key
    // leaves for the device it was, and which then goes.
    const second = q.pairDevice({ name: 'MacBook again', kind: 'computer' });
    const again = await call('register_device', { name: 'MacBook', deviceId }, as(second.key.id));
    expect((again.body.result as unknown as { device: { id: string }; created: boolean })).toMatchObject({
      device: { id: deviceId },
      created: false,
    });
    expect(q.getApiKey(second.key.id)?.deviceId).toBe(deviceId);
    expect(q.getDevice(second.device.id)?.status).toBe('revoked');
    expect(q.listDevices().map((d) => d.name)).toEqual(['MacBook']);

    const { ensureHomeIdentity, resetHomeIdentityCache } = await import('@/lib/home/identity');
    resetHomeIdentityCache();
    const hostId = ensureHomeIdentity().device.id;
    const third = q.pairDevice({ name: 'Sneaky', kind: 'computer' }).key;
    const sneaky = await call('register_device', { name: 'Sneaky', deviceId: hostId }, as(third.id));
    expect((sneaky.body.result as unknown as { device: { id: string } }).device.id).not.toBe(hostId);
    resetHomeIdentityCache();
  });

  it("gives the home's own callers the host device", async () => {
    const { ensureHomeIdentity, resetHomeIdentityCache } = await import('@/lib/home/identity');
    resetHomeIdentityCache();
    const host = ensureHomeIdentity().device;
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'Home agent', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const set = await call('set_workspace_folder', { agent: ws.id, folder: home.root }, fromHome);
    expect((set.body.result as unknown as { deviceId: string }).deviceId).toBe(host.id);
    resetHomeIdentityCache();
  });
});
