import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { NextRequest } from 'next/server';

vi.setConfig({ testTimeout: 30_000 });

const getReferenceFolder = vi.fn();

vi.mock('@/lib/db/queries', () => ({
  getReferenceFolder: (id: string) => getReferenceFolder(id),
  // `resolve.ts` reaches for these; the tests below only exercise bare-path
  // references, so they never fire.
  getWorkspace: () => undefined,
  listReferenceFoldersForWorkspace: () => [],
}));

import { GET } from './route';

function req(): NextRequest {
  return {} as NextRequest;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ref-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    workspaceId: 'ws-1',
    alias: 'backend',
    path: '/tmp/nope',
    targetWorkspaceId: null,
    description: null,
    position: 0,
    status: 'active',
    archivedAt: null,
    ...overrides,
  };
}

describe('GET /api/reference-folders/:id/tree', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-reftree-route-'));
    getReferenceFolder.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(rel: string, body = 'x\n'): void {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }

  it('404s for an unknown reference folder', async () => {
    getReferenceFolder.mockReturnValue(undefined);
    const res = await GET(req(), params('missing'));
    expect(res.status).toBe(404);
  });

  it('lists a bare non-git folder', async () => {
    write('notes/a.md');
    write('b.txt');
    getReferenceFolder.mockReturnValue(row({ path: tmpDir }));

    const res = await GET(req(), params('ref-1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ path: string }>; truncated: boolean };
    expect(body.entries.map((e) => e.path)).toEqual(['b.txt', 'notes/a.md']);
    expect(body.truncated).toBe(false);
  });

  it('lists a git folder and respects its .gitignore', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: tmpDir, stdio: 'pipe' });
    write('.gitignore', 'ignored.txt\n');
    write('src/main.go');
    write('ignored.txt');
    getReferenceFolder.mockReturnValue(row({ path: tmpDir }));

    const res = await GET(req(), params('ref-1'));
    const body = (await res.json()) as { entries: Array<{ path: string }> };
    const paths = body.entries.map((e) => e.path);
    expect(paths).toContain('src/main.go');
    expect(paths).not.toContain('ignored.txt');
  });

  it('returns an empty list for a broken reference instead of erroring', async () => {
    // The picker asks for this mid-keystroke; an error here would blow up the
    // composer rather than just showing "no matches".
    getReferenceFolder.mockReturnValue(row({ path: path.join(tmpDir, 'gone') }));
    const res = await GET(req(), params('ref-1'));
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toEqual([]);
  });

  it('404s when the row resolves to nothing at all', async () => {
    getReferenceFolder.mockReturnValue(row({ path: null, targetWorkspaceId: 'gone-ws' }));
    const res = await GET(req(), params('ref-1'));
    expect(res.status).toBe(404);
  });
});
