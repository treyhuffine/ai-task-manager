/**
 * Opening a folder in an app on a worker's computer (P3.5): only a folder
 * this computer holds, only inside it (symlinks included), only a known
 * app, and nothing for a placement that moved on. The opener is stubbed:
 * nothing launches.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openHere } from './open-here';

let worktree: string;
let agentDir: string;
let outside: string;
const open = vi.fn(async () => ({ ok: true }));
let newest: number;

const options = () => ({
  journal: {
    preparedWorktree: (id: string) => (id === 'e1' ? worktree : null),
    released: (_id: string, generation: number) => generation < 1,
    highestGeneration: (id: string) => (id === 'e1' ? newest : null),
  },
  agentFolder: (id: string) => (id === 'a1' ? agentDir : null),
  open,
});
const execution = (generation = 2) => ({ kind: 'execution' as const, executionId: 'e1', generation });

beforeEach(() => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-open-here-')));
  worktree = path.join(root, 'worktree');
  agentDir = path.join(root, 'agent');
  outside = path.join(root, 'outside');
  for (const d of [worktree, agentDir, outside]) fs.mkdirSync(d);
  fs.mkdirSync(path.join(worktree, 'src'));
  fs.writeFileSync(path.join(worktree, 'src', 'app.ts'), '');
  fs.writeFileSync(path.join(outside, 'secret.txt'), '');
  fs.symlinkSync(outside, path.join(worktree, 'escape'));
  open.mockClear();
  newest = 2;
});

afterEach(() => fs.rmSync(path.dirname(worktree), { recursive: true, force: true }));

describe('opening a folder here', () => {
  it('opens a file inside the worktree it prepared, with the worktree as the project', async () => {
    expect(await openHere({ op: 'open', folder: execution(), path: 'src/app.ts', target: 'vscode', line: 3 }, options()))
      .toEqual({ status: 200, body: { ok: true } });
    expect(open).toHaveBeenCalledWith('vscode', path.join(worktree, 'src', 'app.ts'), { line: 3, column: undefined, reveal: undefined, projectDir: worktree });
    await openHere({ op: 'open', folder: { kind: 'agent', agentId: 'a1' }, path: null, target: 'finder' }, options());
    expect(open).toHaveBeenLastCalledWith('finder', agentDir, expect.objectContaining({ projectDir: agentDir }));
  });

  it('refuses anything outside the folder, a command, and a placement that moved on', async () => {
    for (const p of ['../outside/secret.txt', path.join(outside, 'secret.txt'), 'escape/secret.txt', 'missing.txt']) {
      expect(await openHere({ op: 'open', folder: execution(), path: p, target: 'vscode' }, options())).toMatchObject({ status: 400 });
    }
    expect(await openHere({ op: 'open', folder: execution(), path: null, target: 'custom' as never }, options())).toMatchObject({ status: 400 });
    newest = 3;
    expect(await openHere({ op: 'open', folder: execution(2), path: null, target: 'finder' }, options())).toMatchObject({ status: 409, body: { error: 'moved' } });
    expect(await openHere({ op: 'open', folder: { kind: 'agent', agentId: 'other' }, path: null, target: 'finder' }, options())).toMatchObject({ status: 409, body: { error: 'not_set_up' } });
    expect(open).not.toHaveBeenCalled();
  });
});
