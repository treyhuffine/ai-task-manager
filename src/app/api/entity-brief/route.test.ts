import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetDb } from '@/lib/db';
import { createNote, createTask, updateNote } from '@/lib/db/queries';

const runHarnessJson = vi.fn();
vi.mock('@/lib/harness/one-shot', () => ({
  runHarnessJson: (...args: unknown[]) => runHarnessJson(...args),
  resolveBackgroundHarness: () => 'claude',
  backgroundModelFor: () => 'opus',
}));

/**
 * The brief route against a real throwaway DB: entities are read through
 * queries.ts and hashed from stored content, the harness call is mocked.
 */

const TEST_DB = path.join(os.tmpdir(), `ri-entity-brief-test-${process.pid}.db`);
let workDir: string;
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

function wipe() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  wipe();
  process.env.RI_DB_PATH = TEST_DB;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-brief-route-'));
  process.env.RI_WORK_DIR = workDir;
  resetDb();
  runHarnessJson.mockReset();
  runHarnessJson.mockResolvedValue({
    summary: 'A long note about the trial.',
    points: ['One point'],
    open: [],
    suggestions: ['Tidy the headings'],
  });
});

afterAll(() => {
  wipe();
  delete process.env.RI_WORK_DIR;
});

const LONG = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} of a fairly long document body.`).join('\n\n');

async function get(qs: string) {
  const { GET } = await import('./route');
  return GET(new Request(`http://test/api/entity-brief?${qs}`));
}

async function post(body: unknown) {
  const { POST } = await import('./route');
  return POST(new Request('http://test/api/entity-brief', { method: 'POST', body: JSON.stringify(body) }));
}

describe('/api/entity-brief', () => {
  it('rejects bad params and unknown entities', async () => {
    expect((await get('entityType=area&entityId=x')).status).toBe(400);
    expect((await get('entityType=note&entityId=nope')).status).toBe(404);
    expect((await post({ entityType: 'task', entityId: 'nope' })).status).toBe(404);
  });

  it('GET is inline for a short note and never calls the harness', async () => {
    const note = createNote({ body: 'Short thought', status: 'active' });
    const res = await get(`entityType=note&entityId=${note.id}`);
    const { state } = await res.json();
    expect(state.status).toBe('inline');
    expect(runHarnessJson).not.toHaveBeenCalled();
  });

  it('GET reports missing, POST generates, GET then reports fresh, an edit makes it stale', async () => {
    const note = createNote({ title: 'Trial', body: LONG, status: 'active' });

    let { state } = await (await get(`entityType=note&entityId=${note.id}`)).json();
    expect(state.status).toBe('missing');

    ({ state } = await (await post({ entityType: 'note', entityId: note.id })).json());
    expect(state.status).toBe('fresh');
    expect(state.brief.summary).toBe('A long note about the trial.');
    expect(runHarnessJson).toHaveBeenCalledTimes(1);

    ({ state } = await (await get(`entityType=note&entityId=${note.id}`)).json());
    expect(state.status).toBe('fresh');

    updateNote(note.id, { body: LONG + '\n\nAnother paragraph.' }, { source: 'human' });
    ({ state } = await (await get(`entityType=note&entityId=${note.id}`)).json());
    expect(state.status).toBe('stale');
    expect(state.brief.summary).toBe('A long note about the trial.');
  });

  it('POST on a fresh brief is a no-op for the harness', async () => {
    const task = createTask({ title: 'Big task', rawInput: 'Big task', body: LONG, status: 'todo' });
    await post({ entityType: 'task', entityId: task.id });
    await post({ entityType: 'task', entityId: task.id });
    expect(runHarnessJson).toHaveBeenCalledTimes(1);
  });

  it('POST surfaces a harness failure as 502 with the message', async () => {
    runHarnessJson.mockRejectedValue(new Error('[entity-brief] claude one-shot failed: no output'));
    const note = createNote({ title: 'Trial', body: LONG, status: 'active' });
    const res = await post({ entityType: 'note', entityId: note.id });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('brief_failed');
    expect(body.message).toContain('no output');
  });
});
