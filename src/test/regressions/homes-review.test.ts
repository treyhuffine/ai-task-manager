import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity, resetHomeIdentityCache, resolveHomeIdentity } from '@/lib/home/identity';
import { setHomeFolder } from '@/lib/setups/home-context';
import * as q from '@/lib/db/queries';
import { proxy } from '@/proxy';
import { checkResolvedPaths } from '@/lib/config/dev-isolation';

/**
 * Regressions for the independent review of homes P0/P1 at 46a2b02
 * (eleven findings, each first reproduced by the reviewer's probe), plus one
 * the fixes turned up: detaching an agent twice unregistered a folder another
 * agent still used.
 *
 * Adapted when the home's records became the only place an agent's folders
 * are kept (docs/homes-spec.md §4.1): 4, 6 and 7 check the same outcomes in
 * the records. 8 (another home's setup file) is retired: there are no files.
 */

const confirmAnswer = vi.hoisted(() => ({ value: false as boolean | symbol }));
vi.mock('@clack/prompts', () => ({
  confirm: vi.fn(async () => confirmAnswer.value),
  isCancel: (v: unknown) => typeof v === 'symbol',
  log: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
  outro: vi.fn(),
  password: vi.fn(),
}));

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-review-regressions-' });
  resetHomeIdentityCache();
  ensureHomeIdentity();
});
afterEach(async () => {
  resetHomeIdentityCache();
  vi.unstubAllGlobals();
  await home.cleanup();
});

function folder(name: string) {
  const dir = path.join(home.root, 'projects', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function workspace(name: string, cwd: string) {
  return q.createWorkspace({ name, cwd, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
}
function request(url: string, method: string, body: unknown, token?: string) {
  return new NextRequest(`http://127.0.0.1${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe('1. only the home’s own key counts as the home machine', () => {
  it('a paired device cannot label itself the home', async () => {
    const { device, token } = q.pairDevice({ name: 'Laptop', kind: 'computer' });
    const { PATCH } = await import('@/app/api/devices/[id]/route');
    const res = await PATCH(request(`/api/devices/${device.id}`, 'PATCH', { kind: 'host' }, token.plaintext), {
      params: Promise.resolve({ id: device.id }),
    });
    expect(res.status).toBe(400);
    const next = proxy(request('/api/orchestrator/actions/register_device', 'POST', {}, token.plaintext));
    expect(forwarded(next, 'x-ri-caller-location')).toBe('elsewhere');
  });

  it('a key on the home’s device that is not the home’s own key is still elsewhere', () => {
    const { token } = q.addDeviceKey(ensureHomeIdentity().device.id);
    const next = proxy(request('/api/tasks', 'GET', undefined, token.plaintext));
    expect(forwarded(next, 'x-ri-caller-location')).toBe('elsewhere');
  });

  it('the home’s own key is home', async () => {
    const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
    const info = ensureLocalToken();
    const next = proxy(request('/api/tasks', 'GET', undefined, info.plaintext));
    expect(forwarded(next, 'x-ri-caller-location')).toBe('home');
  });

  it('pairing refuses the host label', async () => {
    const { POST } = await import('@/app/api/devices/route');
    const res = await POST(request('/api/devices', 'POST', { name: 'Sneaky', kind: 'host' }));
    expect(res.status).toBe(400);
  });
});

describe('2. an unclaimed restored home serves nothing that can start work', () => {
  it('blocks webhook and callback routes', () => {
    fs.rmSync(path.join(home.configDir, 'machine.json'));
    resetHomeIdentityCache();
    expect(resolveHomeIdentity().state).toBe('needs_claim');
    for (const p of ['/api/webhooks/triggers/saved-public-id', '/api/connectors/callback']) {
      expect(proxy(request(p, 'POST', {})).status, p).toBe(503);
    }
    expect(proxy(request('/api/health', 'GET', undefined)).headers.get('x-middleware-next')).toBe('1');
  });
});

describe('3. the dev launcher follows symlinks', () => {
  it('refuses a work dir linked into a protected root', () => {
    const other = folder('protected-root');
    const isolated = folder('isolated-root');
    fs.symlinkSync(other, path.join(isolated, '.work'));
    const problems = checkResolvedPaths(
      {
        appRoot: isolated,
        dbPath: path.join(isolated, 'data.db'),
        configDir: path.join(isolated, '.config'),
        workDir: path.join(isolated, '.work'),
        attachmentsDir: path.join(isolated, 'attachments'),
      },
      isolated,
      [other],
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('4. a failed folder change keeps the previous setup', () => {
  it('refuses a folder that does not exist and changes nothing', async () => {
    const source = folder('source');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    const missing = path.join(home.root, 'does-not-exist');
    const { PATCH } = await import('@/app/api/workspaces/[id]/route');
    const res = await PATCH(request(`/api/workspaces/${ws.id}`, 'PATCH', { cwd: missing }), { params: Promise.resolve({ id: ws.id }) });
    expect(res.status).toBe(400);
    expect(q.getWorkspace(ws.id)?.cwd).toBe(source);
    expect(q.listWorkspaceSetups({ workspaceId: ws.id })[0]).toMatchObject({ sourcePath: source, status: 'ready' });
  });

  it('refuses to create an agent in a folder that does not exist', async () => {
    const { POST } = await import('@/app/api/workspaces/route');
    const res = await POST(request('/api/workspaces', 'POST', { name: 'Ghost', cwd: path.join(home.root, 'nowhere') }));
    expect(res.status).toBe(400);
    expect(q.listWorkspaces({ status: 'active' }).map((w) => w.name)).not.toContain('Ghost');
  });

  it('moves a setup, new folder first', async () => {
    const a = folder('a');
    const b = folder('b');
    const ws = workspace('App', a);
    await setHomeFolder(ws.id, a);
    const { PATCH } = await import('@/app/api/workspaces/[id]/route');
    const res = await PATCH(request(`/api/workspaces/${ws.id}`, 'PATCH', { cwd: b }), { params: Promise.resolve({ id: ws.id }) });
    expect(res.status).toBe(200);
    expect(q.listWorkspaceSetups({ workspaceId: ws.id })).toEqual([expect.objectContaining({ sourcePath: b, status: 'ready' })]);
    expect(q.getWorkspace(ws.id)?.cwd).toBe(b);
  });
});

describe('5. answering No leaves the home in place', () => {
  it('rejects a bad link before touching anything', async () => {
    const { runConnect } = await import('@/cli/commands/connect');
    const before = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const { resetDb } = await import('@/lib/db');
      resetDb();
      expect(await runConnect('not-a-pairing-link', { open: false })).toBe(false);
      expect(fs.existsSync(home.dbPath)).toBe(true);
    } finally {
      if (before) Object.defineProperty(process.stdin, 'isTTY', before);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('keeps an empty home when the answer is No, even with a good link', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'home-elsewhere', kind: 'personal', name: 'Other Ri', host: { id: 'c', name: 'Mac Mini', platform: 'darwin' } }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const before = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const { resetDb } = await import('@/lib/db');
      resetDb();
      const { runConnect } = await import('@/cli/commands/connect');
      confirmAnswer.value = false;
      expect(await runConnect(`${url}/#token=ri_live_k`, { open: false })).toBe(false);
      expect(fs.existsSync(home.dbPath)).toBe(true);
      expect(fs.existsSync(path.join(home.configDir, 'connection.json'))).toBe(false);
    } finally {
      if (before) Object.defineProperty(process.stdin, 'isTTY', before);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('6. detaching one agent from a shared folder', () => {
  it('removes that agent and leaves the other, even when taken off twice', async () => {
    const source = folder('shared');
    const a = workspace('A', source);
    const b = workspace('B', source);
    await setHomeFolder(a.id, source);
    await setHomeFolder(b.id, source);
    const host = ensureHomeIdentity().device.id;
    expect(q.removeWorkspaceSetup(a.id, host)).toBe(true);
    expect(q.removeWorkspaceSetup(a.id, host)).toBe(false);
    expect(q.listWorkspaceSetups({ workspaceId: a.id })).toEqual([]);
    expect(q.listWorkspaceSetups({ workspaceId: b.id })).toEqual([expect.objectContaining({ sourcePath: source })]);
  });
});

describe('7. renaming a reference', () => {
  it("keeps this device's own value under the new name", async () => {
    const source = folder('app');
    const referenceDir = folder('reference');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    const { POST } = await import('@/app/api/reference-folders/route');
    const made = await POST(request('/api/reference-folders', 'POST', { alias: 'docs', path: referenceDir }));
    const ref = (await made.json()) as { id: string };
    const host = ensureHomeIdentity().device.id;
    const local = folder('local-reference');
    q.setFolderLink(host, ref.id, local);
    const { PATCH } = await import('@/app/api/reference-folders/[id]/route');
    await PATCH(request(`/api/reference-folders/${ref.id}`, 'PATCH', { alias: 'guides' }), { params: Promise.resolve({ id: ref.id }) });
    expect(q.getFolderLink(host, ref.id)?.path).toBe(local);
    expect(q.getWorkspaceSetup(ws.id, host)!.references).toEqual([expect.objectContaining({ alias: 'guides', path: local })]);
  });
});

describe('9. a gateway error while the home is down', () => {
  it('is not reported as reachable', async () => {
    const { ApiClient } = await import('@/lib/api/client');
    const { _resetConnectivity, getConnectivity } = await import('@/lib/api/connectivity');
    _resetConnectivity();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Home offline', { status: 502 })));
    try {
      const api = new ApiClient({ getToken: () => null });
      await expect(api.get('/tasks')).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getConnectivity().reachable).toBe(false);
    } finally {
      _resetConnectivity();
    }
  });
});

describe('10. a full copy of the folder, machine.json included', () => {
  it('needs claiming', async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    const copy = fs.mkdtempSync(path.join(path.dirname(home.root), 'ri-review-copy-'));
    const saved = ['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR'].map((k) => [k, process.env[k]] as const);
    try {
      fs.cpSync(home.root, copy, { recursive: true });
      process.env.RI_ROOT = copy;
      process.env.RI_DB_PATH = path.join(copy, 'data.db');
      process.env.RI_CONFIG_DIR = path.join(copy, '.config');
      process.env.RI_WORK_DIR = path.join(copy, '.work');
      resetHomeIdentityCache();
      expect(resolveHomeIdentity().state).toBe('needs_claim');
    } finally {
      resetDb();
      resetHomeIdentityCache();
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });
});

describe('11. the database refuses a folder that is also connected elsewhere', () => {
  it('throws when opening', async () => {
    const { resetDb, getDb } = await import('@/lib/db');
    const { writeConnection } = await import('@/lib/connection/config');
    resetDb();
    writeConnection({
      homeId: 'other-home',
      homeName: 'Other',
      homeUrl: 'https://invalid.example',
      homeHostName: 'Other',
      credential: 'test',
      connectedAt: '2026-09-24',
    });
    expect(() => getDb()).toThrow(/holds both a Ri database/);
    fs.rmSync(path.join(home.configDir, 'connection.json'));
  });
});
