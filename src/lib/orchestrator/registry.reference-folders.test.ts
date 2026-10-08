import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The linked (reference) folder actions' read-only switch
 * (docs/reference-folders-spec.md §7): create and update carry it, and a
 * remote caller may set it but never take it off, since that would be an
 * agent granting itself writes the person ruled out. The database is real.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-registry-refs-'));
const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH, config: process.env.RI_CONFIG_DIR };
process.env.RI_ROOT = ROOT;
process.env.RI_CONFIG_DIR = path.join(ROOT, '.config');
fs.mkdirSync(process.env.RI_CONFIG_DIR, { recursive: true });

// The create action checks the home's folders after writing. Nothing to check here.
vi.mock('@/lib/setups/folders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups/folders')>()),
  checkHomeFolders: async () => {},
}));

const TEST_DB = path.join(ROOT, 'data.db');

afterAll(() => {
  for (const [key, value] of [['RI_ROOT', saved.root], ['RI_DB_PATH', saved.db], ['RI_CONFIG_DIR', saved.config]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
});

async function run(name: string, input: Record<string, unknown>, ctx: Record<string, unknown> = { remote: true }) {
  const { runAction } = await import('./dispatch');
  return runAction(name, input, ctx as never);
}

async function seed() {
  const q = await import('@/lib/db/queries');
  const app = q.createWorkspace({ name: 'app', cwd: path.join(ROOT, 'app'), isGit: false, filesToCopy: [], status: 'active' });
  const data = q.createWorkspace({ name: 'data', cwd: path.join(ROOT, 'data'), isGit: false, filesToCopy: [], status: 'active' });
  return { q, app, data };
}

describe('read only on linked folder actions', () => {
  it('creates an editable link by default, and a read-only one when asked', async () => {
    const { app, data } = await seed();
    const plain = await run('create_reference_folder', { alias: 'data', workspaceId: app.id, targetWorkspaceId: data.id });
    expect(plain).toMatchObject({ ok: true, result: { alias: 'data', readOnly: null } });

    const guarded = await run('create_reference_folder', {
      alias: 'data-ro',
      workspaceId: app.id,
      targetWorkspaceId: data.id,
      readOnly: true,
    });
    expect(guarded).toMatchObject({ ok: true, result: { readOnly: true } });
  });

  it('lists the switch with each folder', async () => {
    const { q, app, data } = await seed();
    q.createReferenceFolder({ workspaceId: app.id, alias: 'data', targetWorkspaceId: data.id, readOnly: true });
    const listed = await run('list_reference_folders', { workspaceId: app.id });
    expect(listed).toMatchObject({ ok: true, result: [{ alias: 'data', readOnly: true }] });
  });

  it('lets a remote caller make a link read only', async () => {
    const { q, app, data } = await seed();
    const ref = q.createReferenceFolder({ workspaceId: app.id, alias: 'data', targetWorkspaceId: data.id });
    const envelope = await run('update_reference_folder', { id: ref.id, readOnly: true }, { remote: true });
    expect(envelope).toMatchObject({ ok: true, result: { readOnly: true } });
  });

  it('refuses a remote caller taking read only off, and changes nothing', async () => {
    const { q, app, data } = await seed();
    const ref = q.createReferenceFolder({ workspaceId: app.id, alias: 'data', targetWorkspaceId: data.id, readOnly: true });
    for (const ctx of [{ remote: true }, {}]) {
      const envelope = await run('update_reference_folder', { id: ref.id, readOnly: false, description: 'x' }, ctx);
      expect(envelope).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    }
    expect(q.getReferenceFolder(ref.id)).toMatchObject({ readOnly: true, description: null });
  });

  it('lets a remote caller edit a read-only link without touching the switch', async () => {
    const { q, app, data } = await seed();
    const ref = q.createReferenceFolder({ workspaceId: app.id, alias: 'data', targetWorkspaceId: data.id, readOnly: true });
    const envelope = await run('update_reference_folder', { id: ref.id, description: 'Market data' }, { remote: true });
    expect(envelope).toMatchObject({ ok: true, result: { readOnly: true, description: 'Market data' } });
  });

  it('lets the trusted local CLI take read only off', async () => {
    const { q, app, data } = await seed();
    const ref = q.createReferenceFolder({ workspaceId: app.id, alias: 'data', targetWorkspaceId: data.id, readOnly: true });
    const envelope = await run('update_reference_folder', { id: ref.id, readOnly: false }, { remote: false });
    expect(envelope).toMatchObject({ ok: true, result: { readOnly: false } });
  });
});
