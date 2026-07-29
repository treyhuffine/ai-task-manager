import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

// The first test in the file pays for the schema migration on a cold database,
// which can exceed the 5s default when suites run in parallel.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Query-layer behavior for reference folders (docs/reference-folders-spec.md
 * §12). Runs against a real SQLite file so the partial unique indexes, the
 * CHECK constraint, and the FK cascades are all genuinely exercised rather
 * than mocked — those are the parts most likely to be silently wrong.
 */
describe('reference folder queries', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-refs-'));
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function setup() {
    const q = await import('@/lib/db/queries');
    const frontend = q.createWorkspace({
      name: 'Frontend',
      cwd: path.join(tmpDir, 'frontend'),
      isGit: false,
      status: 'active',
    });
    const backend = q.createWorkspace({
      name: 'Backend',
      cwd: path.join(tmpDir, 'backend'),
      isGit: false,
      status: 'active',
    });
    return { q, frontend, backend };
  }

  it('creates a bare-path reference and normalizes the alias', async () => {
    const { q, frontend } = await setup();
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: '  BackEnd  ',
      path: '/tmp/api',
      description: '  Go API server.  ',
    });
    expect(row.alias).toBe('backend');
    expect(row.description).toBe('Go API server.');
    expect(row.targetWorkspaceId).toBeNull();
    expect(row.status).toBe('active');
  });

  it('rejects an alias that would be ambiguous after @', async () => {
    const { q, frontend } = await setup();
    for (const alias of ['-leading', 'has space', 'UPPER CASE!', '']) {
      expect(() =>
        q.createReferenceFolder({ workspaceId: frontend.id, alias, path: '/tmp/api' }),
      ).toThrow(/Invalid alias|needs either/);
    }
  });

  it('requires exactly one target', async () => {
    const { q, frontend, backend } = await setup();
    expect(() =>
      q.createReferenceFolder({ workspaceId: frontend.id, alias: 'both', path: '/tmp/api', targetWorkspaceId: backend.id }),
    ).toThrow(/not both/);
    expect(() => q.createReferenceFolder({ workspaceId: frontend.id, alias: 'neither' })).toThrow(
      /needs either/,
    );
  });

  it('enforces exactly-one-target at the database level too', async () => {
    const { q, frontend, backend } = await setup();
    const { getDb } = await import('@/lib/db');
    const { referenceFolders } = await import('@/lib/db/schema');
    // Bypass the query layer entirely — this is the CHECK constraint's job.
    expect(() =>
      getDb()
        .insert(referenceFolders)
        .values({
          id: 'raw-both',
          workspaceId: frontend.id,
          alias: 'raw-both',
          path: '/tmp/api',
          targetWorkspaceId: backend.id,
        })
        .run(),
    ).toThrow(/CHECK constraint failed/i);
    expect(() =>
      getDb()
        .insert(referenceFolders)
        .values({ id: 'raw-neither', workspaceId: frontend.id, alias: 'raw-neither' })
        .run(),
    ).toThrow(/CHECK constraint failed/i);
    expect(q.listReferenceFolders({ workspaceId: frontend.id })).toHaveLength(0);
  });

  it('rejects a workspace referencing itself', async () => {
    const { q, frontend } = await setup();
    expect(() =>
      q.createReferenceFolder({
        workspaceId: frontend.id,
        alias: 'self',
        targetWorkspaceId: frontend.id,
      }),
    ).toThrow(/cannot reference itself/);
  });

  it('rejects a target workspace that does not exist', async () => {
    const { q, frontend } = await setup();
    expect(() =>
      q.createReferenceFolder({
        workspaceId: frontend.id,
        alias: 'ghost',
        targetWorkspaceId: 'no-such-workspace',
      }),
    ).toThrow(/Target workspace not found/);
  });

  it('scopes alias uniqueness: same alias allowed globally and per workspace', async () => {
    const { q, frontend, backend } = await setup();
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'shared', path: '/tmp/a' });
    // Different workspace, same alias — fine.
    expect(() =>
      q.createReferenceFolder({ workspaceId: backend.id, alias: 'shared', path: '/tmp/b' }),
    ).not.toThrow();
    // Global scope, same alias — also fine, workspace wins at read time.
    expect(() =>
      q.createReferenceFolder({ workspaceId: null, alias: 'shared', path: '/tmp/c' }),
    ).not.toThrow();
    // Same alias in the same workspace — conflict, not a duplicate row.
    expect(() =>
      q.createReferenceFolder({ workspaceId: frontend.id, alias: 'shared', path: '/tmp/d' }),
    ).toThrow(/already exists/);
    // Same alias globally twice — conflict too. A plain UNIQUE(workspace_id,
    // alias) would let this through, since SQLite treats NULLs as distinct.
    expect(() =>
      q.createReferenceFolder({ workspaceId: null, alias: 'shared', path: '/tmp/e' }),
    ).toThrow(/already exists/);
  });

  it('frees the alias on archive', async () => {
    const { q, frontend } = await setup();
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'recycled',
      path: '/tmp/a',
    });
    q.archiveReferenceFolder(row.id);
    expect(() =>
      q.createReferenceFolder({ workspaceId: frontend.id, alias: 'recycled', path: '/tmp/b' }),
    ).not.toThrow();
    expect(q.listReferenceFolders({ workspaceId: frontend.id })).toHaveLength(1);
    expect(q.listReferenceFolders({ workspaceId: frontend.id, status: 'archived' })).toHaveLength(1);
  });

  it('merges global rows into a workspace view, workspace winning on collision', async () => {
    const { q, frontend } = await setup();
    q.createReferenceFolder({ workspaceId: null, alias: 'design', path: '/tmp/global-design' });
    q.createReferenceFolder({ workspaceId: null, alias: 'docs', path: '/tmp/global-docs' });
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'design', path: '/tmp/own-design' });

    const merged = q.listReferenceFoldersForWorkspace(frontend.id);
    expect(merged).toHaveLength(2);
    const design = merged.find((r) => r.alias === 'design');
    expect(design?.path).toBe('/tmp/own-design');
    expect(design?.workspaceId).toBe(frontend.id);
    expect(merged.find((r) => r.alias === 'docs')?.path).toBe('/tmp/global-docs');
  });

  it('lists only global rows when there is no workspace', async () => {
    const { q, frontend } = await setup();
    q.createReferenceFolder({ workspaceId: null, alias: 'docs', path: '/tmp/global-docs' });
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'own', path: '/tmp/own' });
    const globals = q.listReferenceFoldersForWorkspace(null);
    expect(globals.map((r) => r.alias)).toEqual(['docs']);
  });

  it('cascades when the owning workspace is deleted', async () => {
    const { q, frontend } = await setup();
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'owned', path: '/tmp/a' });
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    getDb().delete(workspaces).where(eq(workspaces.id, frontend.id)).run();
    expect(q.listReferenceFolders({ workspaceId: frontend.id })).toHaveLength(0);
  });

  it('cascades when the target workspace is deleted', async () => {
    const { q, frontend, backend } = await setup();
    q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'backend',
      targetWorkspaceId: backend.id,
    });
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    getDb().delete(workspaces).where(eq(workspaces.id, backend.id)).run();
    // A reference to a workspace that no longer exists has nothing to point
    // at and no path to fall back to, so the row goes with it.
    expect(q.listReferenceFolders({ workspaceId: frontend.id })).toHaveLength(0);
  });

  it('validates the merged row on update, not just the incoming patch', async () => {
    const { q, frontend, backend } = await setup();
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'backend',
      path: '/tmp/api',
    });
    // Adding a workspace target without clearing the path would leave both set.
    expect(() => q.updateReferenceFolder(row.id, { targetWorkspaceId: backend.id })).toThrow(
      /not both/,
    );
    // Swapping both at once is the supported move.
    const updated = q.updateReferenceFolder(row.id, {
      path: null,
      targetWorkspaceId: backend.id,
    });
    expect(updated?.targetWorkspaceId).toBe(backend.id);
    expect(updated?.path).toBeNull();
  });

  it('rejects an update that collides with another alias in the same scope', async () => {
    const { q, frontend } = await setup();
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'one', path: '/tmp/a' });
    const second = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'two',
      path: '/tmp/b',
    });
    expect(() => q.updateReferenceFolder(second.id, { alias: 'one' })).toThrow(/already exists/);
    // Renaming to its own alias is a no-op, not a self-conflict.
    expect(() => q.updateReferenceFolder(second.id, { alias: 'two' })).not.toThrow();
  });

  it('returns null when updating a row that does not exist', async () => {
    const { q } = await setup();
    expect(q.updateReferenceFolder('nope', { alias: 'x' })).toBeNull();
    expect(q.archiveReferenceFolder('nope')).toBeNull();
  });

  it('expands ~ to an absolute path, like every other fs surface does', async () => {
    const { q, frontend } = await setup();
    const os = await import('node:os');
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'home',
      path: '~/code/api',
    });
    // Stored raw, `path.resolve` would have produced `<server cwd>/~/code/api`
    // and the reference would render as missing for a folder that exists.
    expect(row.path).toBe(path.join(os.homedir(), 'code/api'));
  });

  it('makes a relative path absolute so it does not follow the server cwd', async () => {
    const { q, frontend } = await setup();
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'rel',
      path: 'some/where',
    });
    expect(path.isAbsolute(row.path!)).toBe(true);
  });

  it('normalizes the path on update too', async () => {
    const { q, frontend } = await setup();
    const os = await import('node:os');
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'home',
      path: '/tmp/a',
    });
    const updated = q.updateReferenceFolder(row.id, { path: '~/elsewhere' });
    expect(updated?.path).toBe(path.join(os.homedir(), 'elsewhere'));
  });

  it('ignores caller-supplied fields it owns, so a request body cannot rewrite the row', async () => {
    const { q, frontend } = await setup();
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'safe',
      path: '/tmp/a',
    });
    // Exactly the shape an over-eager (or hostile) PATCH body would take.
    // Before the whitelist this rewrote the primary key and archived the row.
    const updated = q.updateReferenceFolder(row.id, {
      alias: 'safe',
      id: 'HIJACKED',
      createdAt: '1999-01-01',
      updatedAt: '1999-01-01',
      status: 'archived',
      archivedAt: '1999-01-01',
    } as never);

    expect(updated?.id).toBe(row.id);
    expect(updated?.createdAt).toBe(row.createdAt);
    expect(updated?.status).toBe('active');
    expect(updated?.archivedAt).toBeNull();
    expect(q.listReferenceFolders({ workspaceId: frontend.id })).toHaveLength(1);
  });

  it('ignores caller-supplied status on create', async () => {
    const { q, frontend } = await setup();
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'sneaky',
      path: '/tmp/a',
      status: 'archived',
      archivedAt: '1999-01-01',
    } as never);
    expect(row.status).toBe('active');
    expect(row.archivedAt).toBeNull();
  });

  it('still honours an explicit id, which is what makes create retry-safe', async () => {
    const { q, frontend } = await setup();
    const row = q.createReferenceFolder({
      id: 'chosen-id',
      workspaceId: frontend.id,
      alias: 'pinned',
      path: '/tmp/a',
    });
    expect(row.id).toBe('chosen-id');
  });

  it('finds who points at a workspace, with the owner name attached', async () => {
    const { q, frontend, backend } = await setup();
    const mobile = q.createWorkspace({
      name: 'Mobile',
      cwd: path.join(tmpDir, 'mobile'),
      isGit: false,
      status: 'active',
    });
    q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'backend',
      targetWorkspaceId: backend.id,
    });
    q.createReferenceFolder({
      workspaceId: mobile.id,
      alias: 'api',
      targetWorkspaceId: backend.id,
    });
    // A bare-path reference to the same folder is NOT a backlink — nothing
    // ties it to the workspace row.
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'other', path: '/tmp/elsewhere' });

    const backlinks = q.listReferenceFoldersTargeting(backend.id);
    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((b) => b.ownerName).sort()).toEqual(['Frontend', 'Mobile']);
    expect(q.listReferenceFoldersTargeting(frontend.id)).toHaveLength(0);
  });

  it('reports a global backlink with a null owner name', async () => {
    const { q, backend } = await setup();
    q.createReferenceFolder({
      workspaceId: null,
      alias: 'shared-api',
      targetWorkspaceId: backend.id,
    });
    const [backlink] = q.listReferenceFoldersTargeting(backend.id);
    expect(backlink.ownerName).toBeNull();
    expect(backlink.reference.workspaceId).toBeNull();
  });

  it('drops a backlink once it is archived', async () => {
    const { q, frontend, backend } = await setup();
    const row = q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'backend',
      targetWorkspaceId: backend.id,
    });
    expect(q.listReferenceFoldersTargeting(backend.id)).toHaveLength(1);
    q.archiveReferenceFolder(row.id);
    expect(q.listReferenceFoldersTargeting(backend.id)).toHaveLength(0);
  });

  it('supports a mutual pair, which is what "add the reverse" creates', async () => {
    const { q, frontend, backend } = await setup();
    q.createReferenceFolder({
      workspaceId: frontend.id,
      alias: 'backend',
      targetWorkspaceId: backend.id,
    });
    q.createReferenceFolder({
      workspaceId: backend.id,
      alias: 'frontend',
      targetWorkspaceId: frontend.id,
    });
    expect(q.listReferenceFoldersTargeting(backend.id)).toHaveLength(1);
    expect(q.listReferenceFoldersTargeting(frontend.id)).toHaveLength(1);
    // Each side still sees exactly one outbound reference — mutual is two
    // one-way rows, not a special kind.
    expect(q.listReferenceFoldersForWorkspace(frontend.id)).toHaveLength(1);
    expect(q.listReferenceFoldersForWorkspace(backend.id)).toHaveLength(1);
  });

  it('orders by position then creation time', async () => {
    const { q, frontend } = await setup();
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'c', path: '/tmp/c', position: 2 });
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'a', path: '/tmp/a', position: 0 });
    q.createReferenceFolder({ workspaceId: frontend.id, alias: 'b', path: '/tmp/b', position: 1 });
    expect(q.listReferenceFolders({ workspaceId: frontend.id }).map((r) => r.alias)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
