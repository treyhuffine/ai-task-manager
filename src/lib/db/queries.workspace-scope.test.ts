import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * An agent's scope fields (docs/agents-view-spec.md Phase 3). The UI calls a
 * workspace an agent. `purpose` and `instructions` are free text the user
 * edits, and `instructions` reach every session the agent starts, so the query
 * layer is where they get normalized and bounded for every caller at once.
 */

const TEST_DB = path.join(os.tmpdir(), `ri-ws-scope-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.RI_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  return import('@/lib/db/queries');
}

const BASE = {
  name: 'ri',
  cwd: '/tmp/ri-scope',
  isGit: false,
  filesToCopy: [],
  status: 'active' as const,
};

describe('workspace purpose and instructions', () => {
  it('stores both, trimmed, and reads them back', async () => {
    const q = await setup();
    const ws = q.createWorkspace({
      ...BASE,
      purpose: '  Build and ship Ri.  ',
      instructions: '\n- Run pnpm ts before committing.\n- Deliver on main.\n',
    });
    expect(ws.purpose).toBe('Build and ship Ri.');
    expect(ws.instructions).toBe('- Run pnpm ts before committing.\n- Deliver on main.');
    expect(q.getWorkspace(ws.id)).toMatchObject({
      purpose: 'Build and ship Ri.',
      instructions: '- Run pnpm ts before committing.\n- Deliver on main.',
    });
  });

  it('defaults both to null when omitted', async () => {
    const q = await setup();
    const ws = q.createWorkspace(BASE);
    expect(ws.purpose).toBeNull();
    expect(ws.instructions).toBeNull();
  });

  it('treats blank text as none', async () => {
    const q = await setup();
    const ws = q.createWorkspace({ ...BASE, purpose: '   ', instructions: '\n\t' });
    expect(ws.purpose).toBeNull();
    expect(ws.instructions).toBeNull();
  });

  it('updates one field without touching the other, and clears with null or blank', async () => {
    const q = await setup();
    const ws = q.createWorkspace({ ...BASE, purpose: 'Ship Ri', instructions: 'Be terse.' });

    const afterPurpose = q.updateWorkspace(ws.id, { purpose: 'Ship Ri, fast' })!;
    expect(afterPurpose).toMatchObject({ purpose: 'Ship Ri, fast', instructions: 'Be terse.' });

    const afterUnrelated = q.updateWorkspace(ws.id, { name: 'ri-app' })!;
    expect(afterUnrelated).toMatchObject({ purpose: 'Ship Ri, fast', instructions: 'Be terse.' });

    expect(q.updateWorkspace(ws.id, { instructions: null })!.instructions).toBeNull();
    expect(q.updateWorkspace(ws.id, { purpose: '  ' })!.purpose).toBeNull();
  });

  it('enforces the caps on create and update with a readable invalid_params error', async () => {
    const q = await setup();
    expect(q.WORKSPACE_PURPOSE_MAX).toBe(500);
    expect(q.WORKSPACE_INSTRUCTIONS_MAX).toBe(20_000);

    // Exactly at the cap is fine, one over is not.
    const ws = q.createWorkspace({ ...BASE, purpose: 'p'.repeat(500), instructions: 'i'.repeat(20_000) });
    expect(ws.purpose).toHaveLength(500);

    let err: unknown;
    try {
      q.createWorkspace({ ...BASE, name: 'too-long', purpose: 'p'.repeat(501) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(q.WorkspaceFieldError);
    expect((err as InstanceType<typeof q.WorkspaceFieldError>).code).toBe('invalid_params');
    expect((err as Error).message).toBe('Purpose is 501 characters. The limit is 500.');

    expect(() => q.updateWorkspace(ws.id, { instructions: 'i'.repeat(20_001) })).toThrow(
      'Instructions is 20,001 characters. The limit is 20,000.',
    );
    // A rejected update writes nothing.
    expect(q.getWorkspace(ws.id)!.instructions).toHaveLength(20_000);
  });

  it('measures the cap after trimming, so padding never trips it', async () => {
    const q = await setup();
    const ws = q.createWorkspace({ ...BASE, purpose: `   ${'p'.repeat(500)}   ` });
    expect(ws.purpose).toHaveLength(500);
  });

  it('rejects non-text values from untyped callers', async () => {
    const q = await setup();
    expect(() => q.createWorkspace({ ...BASE, purpose: 42 as unknown as string })).toThrow(
      'Purpose must be text.',
    );
  });
});
