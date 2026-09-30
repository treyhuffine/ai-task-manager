/**
 * Regressions from the targeted review of 1d76d11: the reviewer's probes of
 * moving an agent's folder. Five reproduced a move that could lose or
 * duplicate a setup; the last confirmed validation runs first.
 *
 * Adapted when the home's records became the only place an agent's folders
 * are kept (docs/homes-spec.md §4.1): the two about a refused change check
 * the records. The four about moving setup files between folders are
 * retired: there are no files to move.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { setHomeFolder } from '@/lib/setups/home-context';
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
  it('keeps the folder and its linked folder choices after a real database constraint failure', async () => {
    const source = folder('source');
    const dest = folder('dest');
    const ws = workspace('App', source);
    const other = workspace('Other', folder('other'));
    const docs = q.createReferenceFolder({ alias: 'docs', path: folder('default-docs') });
    await setHomeFolder(ws.id, source);
    const host = ensureHomeIdentity().device.id;
    q.setFolderLink(host, docs.id, null);
    const response = await patch(ws.id, { cwd: dest, slug: other.slug });
    expect(response.status).toBe(400);
    expect(q.getWorkspace(ws.id)!.cwd).toBe(source);
    expect(q.getWorkspaceSetup(ws.id, host)).toMatchObject({ sourcePath: source });
    expect(q.getFolderLink(host, docs.id)?.path).toBeNull();
  });

  it('rejects an invalid patch before modifying any folder', async () => {
    const source = folder('source');
    const dest = folder('dest');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    const response = await patch(ws.id, { cwd: dest, purpose: 123 });
    expect(response.status).toBe(400);
    expect(q.listWorkspaceSetups({ workspaceId: ws.id })).toEqual([expect.objectContaining({ sourcePath: source })]);
  });
});
