import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * The in-app terminal must never spawn in a git workspace's source
 * checkout when the per-execution worktree is missing — the PTY's cwd is
 * frozen for its lifetime, so a wrong cwd sticks. When the worktree isn't
 * usable the route returns 409 (and never calls `createTerminal`) instead
 * of silently handing the user a shell in the main repo.
 */

const getChatSessionWithExecution = vi.fn();
const getWorkspace = vi.fn();
const createTerminal = vi.fn();
const listTerminals = vi.fn(() => []);

vi.mock('@/lib/db/queries', () => ({
  getChatSessionWithExecution: (id: string) =>
    (getChatSessionWithExecution as unknown as (id: string) => unknown)(id),
  getWorkspace: (id: string) => (getWorkspace as unknown as (id: string) => unknown)(id),
}));
vi.mock('@/lib/terminal/pty-manager', () => ({
  createTerminal: (input: unknown) => (createTerminal as unknown as (input: unknown) => unknown)(input),
  listTerminals: (id: string) => (listTerminals as unknown as (id: string) => unknown)(id),
  TerminalSpawnError: class TerminalSpawnError extends Error {},
}));

import { POST } from './route';

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-route-'));
const worktreeDir = path.join(tmpBase, 'worktree-abc');
const sourceCheckout = path.join(tmpBase, 'main-repo');
const missingWorktree = path.join(tmpBase, 'pruned');
fs.mkdirSync(worktreeDir, { recursive: true });
fs.mkdirSync(sourceCheckout, { recursive: true });

afterAll(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

beforeEach(() => {
  getChatSessionWithExecution.mockReset();
  getWorkspace.mockReset();
  createTerminal.mockReset();
  createTerminal.mockReturnValue({
    id: 't1',
    sessionId: 's1',
    cwd: 'unused',
    shell: '/bin/zsh',
    cols: 80,
    rows: 24,
    exited: false,
    exitCode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

function call(id = 's1') {
  const req = { json: async () => ({ cols: 80, rows: 24 }) } as never;
  return POST(req, { params: Promise.resolve({ id }) });
}

describe('POST /api/sessions/:id/terminals — cwd resolution', () => {
  it('git workspace, worktree exists → spawns in the worktree', async () => {
    getChatSessionWithExecution.mockReturnValue({ worktreePath: worktreeDir, workspaceId: 'ws1' });
    getWorkspace.mockReturnValue({ id: 'ws1', cwd: sourceCheckout, isGit: true });

    const res = await call();
    expect(res.status).toBe(201);
    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktreeDir }));
  });

  it('git workspace, worktree MISSING → 409, never spawns in the source checkout', async () => {
    getChatSessionWithExecution.mockReturnValue({ worktreePath: missingWorktree, workspaceId: 'ws1' });
    getWorkspace.mockReturnValue({ id: 'ws1', cwd: sourceCheckout, isGit: true });

    const res = await call();
    expect(res.status).toBe(409);
    expect(createTerminal).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/Worktree directory does not exist/);
  });

  it('git workspace, worktree not provisioned yet (null) → 409, no spawn', async () => {
    getChatSessionWithExecution.mockReturnValue({ worktreePath: null, workspaceId: 'ws1' });
    getWorkspace.mockReturnValue({ id: 'ws1', cwd: sourceCheckout, isGit: true });

    const res = await call();
    expect(res.status).toBe(409);
    expect(createTerminal).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/still being set up/);
  });

  it('non-git workspace → spawns in the workspace cwd', async () => {
    getChatSessionWithExecution.mockReturnValue({ worktreePath: null, workspaceId: 'ws2' });
    getWorkspace.mockReturnValue({ id: 'ws2', cwd: sourceCheckout, isGit: false });

    const res = await call();
    expect(res.status).toBe(201);
    expect(createTerminal).toHaveBeenCalledWith(expect.objectContaining({ cwd: sourceCheckout }));
  });

  it('unknown session → 404', async () => {
    getChatSessionWithExecution.mockReturnValue(undefined);
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(createTerminal).not.toHaveBeenCalled();
  });
});
