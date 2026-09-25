/**
 * Regressions from the targeted review of 1d76d11: the reviewer's probes of
 * moving an agent's folder, kept as written. Five reproduced a move that
 * could lose or duplicate a setup; the last confirmed validation runs first.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { readSetupFile } from '@/lib/setups/local-file';
import { inProcessSetupLink, setHomeFolder } from '@/lib/setups/home-context';
import { attach, setReference, syncSetups } from '@/lib/setups/service';
import * as q from '@/lib/db/queries';

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-targeted-move-' });
  resetHomeIdentityCache();
  ensureHomeIdentity();
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetHomeIdentityCache();
  await home.cleanup();
});
function folder(name: string) {
  const p = path.join(home.root, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}
function workspace(name: string, cwd: string) {
  return q.createWorkspace({ name, cwd, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
}
async function patch(id: string, body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/workspaces/[id]/route');
  return PATCH(new NextRequest(`http://localhost:42999/api/workspaces/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}
function failRegistryRename(nth: number) {
  let count = 0;
  const rename = fs.renameSync.bind(fs);
  return vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === path.join(home.configDir, 'setups.json') && ++count === nth) {
      throw Object.assign(new Error('simulated one-shot registry I/O failure'), { code: 'EIO' });
    }
    return rename(from, to);
  });
}

describe('targeted move failure probes', () => {
  it('preserves the only setup if old-file removal succeeds but unregistering fails', async () => {
    const source = folder('source');
    const dest = folder('dest');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    const before = readSetupFile(source);
    const fail = failRegistryRename(2); // register destination succeeds, unregister source fails
    await expect(attach(inProcessSetupLink(), { agent: ws.id, folder: dest, replace: true })).rejects.toThrow();
    fail.mockRestore();
    expect({ source: readSetupFile(source), destinationState: readSetupFile(dest).state }).toEqual({
      source: before, destinationState: 'missing',
    });
  });

  it('rolls the destination back when its registration fails', async () => {
    const source = folder('source');
    const dest = folder('dest');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    const fail = failRegistryRename(1);
    await expect(attach(inProcessSetupLink(), { agent: ws.id, folder: dest, replace: true })).rejects.toThrow();
    fail.mockRestore();
    expect(readSetupFile(source).state).toBe('ok');
    expect(readSetupFile(dest).state).toBe('missing');
  });

  it('preserves the previous state when reporting the move to home fails', async () => {
    const source = folder('source');
    const dest = folder('dest');
    const ws = workspace('App', source);
    const real = inProcessSetupLink();
    await setHomeFolder(ws.id, source);
    const before = readSetupFile(source);
    await expect(attach({ context: real.context, report: async () => { throw new Error('home unavailable'); } },
      { agent: ws.id, folder: dest, replace: true })).rejects.toThrow(/home unavailable/);
    expect(readSetupFile(source)).toEqual(before);
    expect(readSetupFile(dest).state).toBe('missing');
    expect(q.getWorkspace(ws.id)!.cwd).toBe(source);
  });

  it('does not remove a setup when the new spelling aliases its current folder', async () => {
    const source = folder('source');
    const alias = path.join(home.root, 'alias');
    fs.symlinkSync(source, alias);
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    await attach(inProcessSetupLink(), { agent: ws.id, folder: alias, replace: true });
    expect(readSetupFile(source).state).toBe('ok');
    await syncSetups(inProcessSetupLink());
    expect(q.listAgentSetups({ workspaceId: ws.id })[0]!.status).toBe('ready');
  });

  it('restores custom local reference mappings after a real database constraint failure', async () => {
    const source = folder('source');
    const dest = folder('dest');
    const ws = workspace('App', source);
    const other = workspace('Other', folder('other'));
    q.createReferenceFolder({ alias: 'docs', path: folder('default-docs') });
    await setHomeFolder(ws.id, source);
    await setReference(inProcessSetupLink(), { agent: ws.id, alias: 'docs', value: null });
    const before = readSetupFile(source);
    const response = await patch(ws.id, { cwd: dest, slug: other.slug });
    expect(response.status).toBe(400);
    expect(q.getWorkspace(ws.id)!.cwd).toBe(source);
    expect(readSetupFile(dest).state).toBe('missing');
    expect(readSetupFile(source)).toEqual(before);
  });

  it('rejects an invalid patch before modifying any folder', async () => {
    const source = folder('source');
    const dest = folder('dest');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    const before = readSetupFile(source);
    const response = await patch(ws.id, { cwd: dest, purpose: 123 });
    expect(response.status).toBe(400);
    expect(readSetupFile(source)).toEqual(before);
    expect(readSetupFile(dest).state).toBe('missing');
  });
});
