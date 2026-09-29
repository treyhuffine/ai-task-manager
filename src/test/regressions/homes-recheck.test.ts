/**
 * Regressions from the re-check of the P0/P1 review fixes at 8ad4a01: six
 * cases the reviewer's probes reproduced, kept as written, plus the ones
 * the fixes added.
 *
 * Adapted when the home's records became the only place an agent's folders
 * are kept (docs/homes-spec.md §4.1): the omitted, shadowed and PATCH cases
 * check the same outcomes in the records. The three about clearing, reading
 * and reaching setup files are retired: there are no files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { setHomeFolder } from '@/lib/setups/home-context';
import * as q from '@/lib/db/queries';
import { checkResolvedPaths } from '@/lib/config/dev-isolation';

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-homes-recheck-' });
  resetHomeIdentityCache();
  ensureHomeIdentity();
});
afterEach(async () => {
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
/** An agent's linked folders on the home, as the records resolve them. */
function refs(agentId: string): Record<string, string | null> {
  const host = ensureHomeIdentity().computer.id;
  return Object.fromEntries(q.getAgentSetup(agentId, host)!.references.map((r) => [r.alias, r.form === 'omitted' ? null : r.path]));
}

describe('setup failure and authority checks beyond the original probes', () => {
  it('refuses a dangling database symlink into a protected root', () => {
    const isolated = folder('isolated');
    const protectedRoot = folder('protected');
    const dbPath = path.join(isolated, 'data.db');
    fs.symlinkSync(path.join(protectedRoot, 'not-yet-created.db'), dbPath);
    const problems = checkResolvedPaths({
      appRoot: isolated, dbPath,
      configDir: path.join(isolated, '.config'),
      workDir: path.join(isolated, '.work'),
      attachmentsDir: path.join(isolated, 'attachments'),
    }, isolated, [protectedRoot]);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('keeps an intentionally omitted reference on a description-only edit', async () => {
    const source = folder('app');
    const ws = workspace('App', source);
    const ref = q.createReferenceFolder({ alias: 'docs', path: folder('docs') });
    await setHomeFolder(ws.id, source);
    q.setFolderLink(ensureHomeIdentity().computer.id, ref.id, null);
    q.updateReferenceFolder(ref.id, { description: 'Updated description' });
    expect(refs(ws.id).docs).toBeNull();
  });

  it('does not steal a workspace override when the shadowed global alias is renamed', async () => {
    const source = folder('app');
    const ws = workspace('App', source);
    const globalPath = folder('global-docs');
    const ownPath = folder('own-docs');
    const global = q.createReferenceFolder({ alias: 'docs', path: globalPath });
    q.createReferenceFolder({ alias: 'docs', path: ownPath, workspaceId: ws.id });
    await setHomeFolder(ws.id, source);
    expect(refs(ws.id)).toEqual({ docs: ownPath });
    q.updateReferenceFolder(global.id, { alias: 'guides' });
    expect(refs(ws.id)).toEqual({ docs: ownPath, guides: globalPath });
  });

  it('does not move folders when another PATCH field fails validation', async () => {
    const source = folder('app');
    const target = folder('new-app');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    const { PATCH } = await import('@/app/api/workspaces/[id]/route');
    const response = await PATCH(new NextRequest(`http://localhost:42999/api/workspaces/${ws.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: target, purpose: 123 }),
    }), { params: Promise.resolve({ id: ws.id }) });
    expect(response.status).toBe(400);
    expect(q.getWorkspace(ws.id)!.cwd).toBe(source);
    expect(q.listAgentSetups({ workspaceId: ws.id })).toEqual([expect.objectContaining({ sourcePath: source })]);
  });

});
