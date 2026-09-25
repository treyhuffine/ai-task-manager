/**
 * Regressions from the re-check of the P0/P1 review fixes at 8ad4a01: six
 * cases the reviewer's probes reproduced, kept as written, plus the ones
 * the fixes added.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { readSetupFile, SETUP_FILE } from '@/lib/setups/local-file';
import { applyReferenceToHomeSetups, inProcessSetupLink, setHomeFolder } from '@/lib/setups/home-context';
import { setReference, syncSetups } from '@/lib/setups/service';
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
function refs(dir: string, agentId: string) {
  const read = readSetupFile(dir);
  if (read.state !== 'ok') throw new Error('Missing setup');
  return read.file.agents[agentId]!.references;
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
    await setReference(inProcessSetupLink(), { agent: ws.id, alias: 'docs', value: null });
    const after = q.updateReferenceFolder(ref.id, { description: 'Updated description' })!;
    await applyReferenceToHomeSetups(after, ref);
    expect(refs(source, ws.id).docs).toBeNull();
  });

  it('does not steal a workspace override when the shadowed global alias is renamed', async () => {
    const source = folder('app');
    const ws = workspace('App', source);
    const globalPath = folder('global-docs');
    const ownPath = folder('own-docs');
    const global = q.createReferenceFolder({ alias: 'docs', path: globalPath });
    q.createReferenceFolder({ alias: 'docs', path: ownPath, workspaceId: ws.id });
    await setHomeFolder(ws.id, source);
    expect(refs(source, ws.id)).toEqual({ docs: ownPath });
    const renamed = q.updateReferenceFolder(global.id, { alias: 'guides' })!;
    await applyReferenceToHomeSetups(renamed, global);
    expect(refs(source, ws.id)).toEqual({ docs: ownPath, guides: globalPath });
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
    expect(readSetupFile(source).state).toBe('ok');
    expect(readSetupFile(target).state).toBe('missing');
  });

  it('does not leave duplicate setups when clearing the old folder fails', async () => {
    const source = folder('app');
    const target = folder('new-app');
    const ws = workspace('App', source);
    await setHomeFolder(ws.id, source);
    fs.chmodSync(source, 0o500);
    try {
      await expect(setHomeFolder(ws.id, target)).rejects.toThrow();
    } finally {
      fs.chmodSync(source, 0o700);
    }
    expect(readSetupFile(source).state).toBe('ok');
    expect(readSetupFile(target).state).toBe('missing');
    await syncSetups(inProcessSetupLink());
    expect(q.listAgentSetups({ workspaceId: ws.id })[0]!.status).toBe('ready');
  });

  it('reports unreadable reference setup files as failures', async () => {
    const source = folder('app');
    const ws = workspace('App', source);
    const ref = q.createReferenceFolder({ alias: 'docs', path: folder('docs') });
    await setHomeFolder(ws.id, source);
    fs.writeFileSync(path.join(source, SETUP_FILE), '{ invalid json');
    const renamed = q.updateReferenceFolder(ref.id, { alias: 'guides' })!;
    const result = await applyReferenceToHomeSetups(renamed, ref);
    expect(result.failed).toHaveLength(1);
  });

  it('keeps a reference change applying where it does apply, and says which folders it could not reach', async () => {
    const a = folder('a');
    const b = folder('b');
    const wa = workspace('A', a);
    const wb = workspace('B', b);
    const ref = q.createReferenceFolder({ alias: 'docs', path: folder('docs') });
    await setHomeFolder(wa.id, a);
    await setHomeFolder(wb.id, b);
    fs.rmSync(path.join(b, SETUP_FILE));
    const moved = q.updateReferenceFolder(ref.id, { path: folder('docs-2') })!;
    const result = await applyReferenceToHomeSetups(moved, ref);
    expect(result.updated).toEqual([a]);
    expect(result.failed).toEqual([expect.objectContaining({ dir: b, error: expect.stringMatching(/no setup file/) })]);
    expect(refs(a, wa.id).docs).toBe(moved.path);
  });

});
