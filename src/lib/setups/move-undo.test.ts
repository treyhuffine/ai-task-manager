import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

/**
 * Moving an agent writes the new folder, then clears the old one. If clearing
 * fails after the pre-check passed (a disk error, a concurrent edit), the new
 * folder must be put back exactly as it was, so the agent keeps one setup.
 */

const failWritesIn = vi.hoisted(() => ({ dir: null as string | null }));
vi.mock('./local-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./local-file')>();
  return {
    ...actual,
    writeSetupFile: (dir: string, file: import('./local-file').SetupFile, rev: string | null) => {
      if (failWritesIn.dir && path.resolve(dir) === failWritesIn.dir) throw new Error('disk full');
      return actual.writeSetupFile(dir, file, rev);
    },
  };
});

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-move-undo-' });
  const { resetHomeIdentityCache, ensureHomeIdentity } = await import('@/lib/home/identity');
  resetHomeIdentityCache();
  ensureHomeIdentity();
});
afterEach(async () => {
  failWritesIn.dir = null;
  const { resetHomeIdentityCache } = await import('@/lib/home/identity');
  resetHomeIdentityCache();
  await home.cleanup();
});

function folder(name: string) {
  const p = path.join(home.root, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe('a move whose old folder fails to clear', () => {
  it('puts the new folder back and keeps the old setup as it was', async () => {
    const q = await import('@/lib/db/queries');
    const { readSetupFile } = await import('./local-file');
    const { inProcessSetupLink } = await import('./home-context');
    const { attach, syncSetups } = await import('./service');
    const { listRegisteredLocations } = await import('./registry');
    const shared = folder('shared');
    const target = folder('target');
    const make = (name: string) =>
      q.createWorkspace({ name, cwd: shared, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const a = make('A');
    const b = make('B');
    const link = inProcessSetupLink();
    await attach(link, { agent: a.id, folder: shared });
    await attach(link, { agent: b.id, folder: shared });
    const before = readSetupFile(shared);

    // Clearing A from the shared folder means rewriting its file, which fails.
    failWritesIn.dir = shared;
    await expect(attach(link, { agent: a.id, folder: target, replace: true })).rejects.toThrow(/put back as it was/);
    failWritesIn.dir = null;

    expect(readSetupFile(target).state).toBe('missing');
    expect(readSetupFile(shared)).toEqual(before);
    expect(listRegisteredLocations().map((l) => l.dir)).toEqual([shared]);
    await syncSetups(link);
    expect(q.listAgentSetups({ workspaceId: a.id })).toEqual([expect.objectContaining({ sourcePath: shared, status: 'ready' })]);
  });
});
