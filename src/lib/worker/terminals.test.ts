/**
 * A worker's terminals (P3.5): shells only where this computer may open
 * them, only for the placement it holds, output posted in batches that carry
 * their offsets, a dropped batch left to the home's resync rather than
 * queued, and the shells stopped when the placement moves on.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TerminalOutputBatch } from '@/lib/workers/protocol';
import { WorkerTerminals } from './terminals';

let dir: string;
let released: Array<[string, number]>;
let newest: number | null;
let batches: TerminalOutputBatch[];
let failPosts: boolean;
let terminals: WorkerTerminals;

const execution = (generation = 2) => ({ kind: 'execution' as const, executionId: 'e1', generation });

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-worker-terminals-')));
  released = [];
  newest = 2;
  batches = [];
  failPosts = false;
  terminals = new WorkerTerminals({
    journal: {
      preparedWorktree: (id) => (id === 'e1' ? dir : null),
      released: (id, generation) => released.some(([e, g]) => e === id && generation <= g),
      highestGeneration: (id) => (id === 'e1' ? newest : null),
    },
    agentFolder: (agentId) => (agentId === 'a1' ? dir : null),
    post: async (batch) => {
      if (failPosts) throw new Error('home unreachable');
      batches.push(batch);
    },
    flushMs: 5,
  });
});

afterEach(async () => {
  await terminals.closeAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

const output = () => batches.flatMap((b) => b.chunks).map((c) => c.data).join('');

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe("a worker's terminals", () => {
  it('opens a shell in the worktree it prepared, and posts its output with offsets', async () => {
    const created = await terminals.handle({ op: 'create', scope: execution(), cols: 80, rows: 24 });
    expect(created).toMatchObject({ status: 201, body: { cwd: dir } });
    const id = (created.body as { id: string }).id;
    expect(await terminals.handle({ op: 'input', scope: execution(), terminalId: id, data: 'echo ok-$((40+2))\r' })).toMatchObject({ status: 200 });
    await until(() => output().includes('ok-42'), 'the output');
    const chunks = batches.flatMap((b) => b.chunks);
    // Each chunk ends where the next begins.
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].offset - chunks[i].data.length).toBe(chunks[i - 1].offset);
    const replay = await terminals.handle({ op: 'replay', scope: execution(), terminalId: id, since: chunks[0].offset });
    expect(replay).toMatchObject({ status: 200, body: { offset: chunks.at(-1)!.offset } });
  });

  it('answers only for the placement it holds, and stops its shells when that moves on', async () => {
    const id = ((await terminals.handle({ op: 'create', scope: execution(), cols: 80, rows: 24 })).body as { id: string }).id;
    newest = 3;
    expect(await terminals.handle({ op: 'input', scope: execution(2), terminalId: id, data: 'x' })).toMatchObject({ status: 409, body: { error: 'moved' } });
    // A later placement here doesn't reach the earlier one's shell.
    expect(await terminals.handle({ op: 'get', scope: execution(3), terminalId: id })).toMatchObject({ status: 404 });
    expect(await terminals.handle({ op: 'list', scope: execution(3) })).toMatchObject({ status: 200, body: [] });
    expect(await terminals.releaseExecution('e1')).toBe(1);
    released.push(['e1', 3]);
    expect(await terminals.handle({ op: 'create', scope: execution(3), cols: 80, rows: 24 })).toMatchObject({ status: 409, body: { error: 'moved' } });
  });

  it("refuses a folder it doesn't have", async () => {
    expect(await terminals.handle({ op: 'create', scope: { kind: 'agent', agentId: 'other' }, cols: 80, rows: 24 }))
      .toMatchObject({ status: 409, body: { error: 'not_set_up' } });
    expect(await terminals.handle({ op: 'create', scope: { kind: 'execution', executionId: 'e9', generation: 1 }, cols: 80, rows: 24 }))
      .toMatchObject({ status: 409, body: { error: 'not_prepared' } });
    expect(await terminals.handle({ op: 'create', scope: { kind: 'agent', agentId: 'a1' }, cols: 80, rows: 24 }))
      .toMatchObject({ status: 201, body: { cwd: dir } });
  });

  it("drops a batch the home didn't take, and the next one shows the gap", async () => {
    const id = ((await terminals.handle({ op: 'create', scope: execution(), cols: 80, rows: 24 })).body as { id: string }).id;
    await until(() => batches.length > 0, 'the prompt');
    const before = batches.flatMap((b) => b.chunks).at(-1)!.offset;
    failPosts = true;
    await terminals.handle({ op: 'input', scope: execution(), terminalId: id, data: 'echo lost-$((1+1))\r' });
    await new Promise((r) => setTimeout(r, 400));
    failPosts = false;
    const kept = batches.length;
    await terminals.handle({ op: 'input', scope: execution(), terminalId: id, data: 'echo next-$((2+1))\r' });
    await until(() => output().includes('next-3'), 'the next output');
    const next = batches.slice(kept).flatMap((b) => b.chunks)[0];
    expect(next.offset - next.data.length).toBeGreaterThan(before);
    expect(output()).not.toContain('lost-2');
  });
});
