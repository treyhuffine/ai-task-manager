import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

const TEST_DB = path.join(os.tmpdir(), `flow-registry-stream-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function resetDb() {
  const { getDb, resetDb: reset } = await import('@/lib/db');
  reset();
  getDb();
}

async function findAction(name: string) {
  const m = await import('./registry');
  const a = m.actions.find((x) => x.name === name);
  if (!a) throw new Error(`action ${name} missing`);
  return a;
}

const ctx = { remote: false } as const;

async function capture(rawText: string): Promise<{ id: string }> {
  const create = await findAction('create_stream_item');
  return (await create.handler(ctx, { rawText } as never)) as { id: string };
}

describe('stream triage actions', () => {
  it('exposes the triage surface', async () => {
    const { actions } = await import('./registry');
    const names = actions.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_stream', 'get_stream_item', 'create_stream_item', 'promote_stream', 'dismiss_stream',
      ]),
    );
  });

  it('captures into the inbox and lists pending by default', async () => {
    await resetDb();
    const item = await capture('remember to look at the zeppelin budget');
    const list = await findAction('list_stream');

    const pending = (await list.handler(ctx, {} as never)) as Array<{ id: string; status: string }>;
    expect(pending.some((s) => s.id === item.id)).toBe(true);
    expect(pending.every((s) => s.status === 'pending')).toBe(true);
  });

  it('promotes to a task with a shaped title and stamps the promotion links', async () => {
    await resetDb();
    const item = await capture('need to renew the docking permit before friday\nmore context here');
    const promote = await findAction('promote_stream');

    const result = (await promote.handler(ctx, {
      id: item.id, to: 'task', title: 'Renew the docking permit', effort: 'small',
    } as never)) as {
      stream: { status: string; promotedToType: string; promotedToId: string; promotedAt: string };
      task: { id: string; title: string; body: string };
    };

    expect(result.task.title).toBe('Renew the docking permit');
    expect(result.task.body).toContain('docking permit'); // raw text carried as body
    expect(result.stream.status).toBe('promoted');
    expect(result.stream.promotedToType).toBe('task');
    expect(result.stream.promotedToId).toBe(result.task.id);
    expect(result.stream.promotedAt).toBeTruthy();

    // The created task is real and queryable.
    const getTask = await findAction('get_task');
    const task = await getTask.handler(ctx, { id: result.task.id } as never) as { title: string };
    expect(task.title).toBe('Renew the docking permit');
  });

  it('promotes to a note, defaulting the title-less body to the raw text', async () => {
    await resetDb();
    const item = await capture('interesting essay on harbor logistics: example.com/essay');
    const promote = await findAction('promote_stream');

    const result = (await promote.handler(ctx, { id: item.id, to: 'note' } as never)) as {
      stream: { promotedToType: string };
      note: { id: string; body: string };
    };
    expect(result.stream.promotedToType).toBe('note');
    expect(result.note.body).toContain('harbor logistics');
  });

  it('falls back to a first-line title when none is given for a task', async () => {
    await resetDb();
    const item = await capture('book the slipway\nlong second line that should not be in the title');
    const promote = await findAction('promote_stream');
    const result = (await promote.handler(ctx, { id: item.id, to: 'task' } as never)) as {
      task: { title: string };
    };
    expect(result.task.title).toBe('book the slipway');
  });

  it('refuses double-triage: promoted and dismissed items conflict', async () => {
    await resetDb();
    const promote = await findAction('promote_stream');
    const dismiss = await findAction('dismiss_stream');

    const a = await capture('promote me once');
    await promote.handler(ctx, { id: a.id, to: 'note' } as never);
    await expect(
      (async () => promote.handler(ctx, { id: a.id, to: 'task' } as never))(),
    ).rejects.toMatchObject({ code: 'conflict' });

    const b = await capture('dismiss me once');
    const dismissed = (await dismiss.handler(ctx, { id: b.id } as never)) as {
      status: string; dismissedBy: string;
    };
    expect(dismissed.status).toBe('dismissed');
    expect(dismissed.dismissedBy).toBe('agent'); // attributed to the agent, not the user
    await expect(
      (async () => dismiss.handler(ctx, { id: b.id } as never))(),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('throws not_found for unknown items', async () => {
    await resetDb();
    const get = await findAction('get_stream_item');
    await expect(
      (async () => get.handler(ctx, { id: 'nope' } as never))(),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
