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

const TEST_DB = path.join(os.tmpdir(), `flow-registry-core-test-${process.pid}.db`);

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

describe('orchestrator core actions (areas / deck / search / user state / notes)', () => {
  it('exposes the legacy-chat-parity surface', async () => {
    const { actions } = await import('./registry');
    const names = actions.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining([
      'update_note',
      'list_areas', 'get_area', 'create_area', 'update_area',
      'get_deck', 'update_deck', 'regenerate_deck',
      'search',
      'get_user_state', 'update_user_state',
    ]));
  });

  it('update_note patches fields and archives without a delete action', async () => {
    await resetDb();
    const create = await findAction('create_note');
    const update = await findAction('update_note');
    const created = await create.handler(ctx, { body: 'first draft' } as never) as { id: string };

    const patched = await update.handler(ctx, {
      id: created.id, title: 'Titled now', status: 'archived',
    } as never) as { id: string; title: string | null; status: string; body: string };

    expect(patched.title).toBe('Titled now');
    expect(patched.status).toBe('archived');
    expect(patched.body).toBe('first draft'); // unspecified fields keep their value
  });

  it('update_note throws not_found for unknown ids', async () => {
    await resetDb();
    const update = await findAction('update_note');
    await expect(
      (async () => update.handler(ctx, { id: 'nope', title: 'x' } as never))(),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('areas round-trip: create → list → get → update', async () => {
    await resetDb();
    const create = await findAction('create_area');
    const list = await findAction('list_areas');
    const get = await findAction('get_area');
    const update = await findAction('update_area');

    const area = await create.handler(ctx, { name: 'Health', userContext: 'gym 3x' } as never) as { id: string; name: string };
    expect(area.name).toBe('Health');

    const all = await list.handler(ctx, {} as never) as Array<{ id: string }>;
    expect(all.some((a) => a.id === area.id)).toBe(true);

    const fetched = await get.handler(ctx, { id: area.id } as never) as { userContext: string | null };
    expect(fetched.userContext).toBe('gym 3x');

    const archived = await update.handler(ctx, { id: area.id, status: 'archived' } as never) as { status: string };
    expect(archived.status).toBe('archived');

    // Default list filter is active-only → archived area drops out.
    const activeOnly = await list.handler(ctx, {} as never) as Array<{ id: string }>;
    expect(activeOnly.some((a) => a.id === area.id)).toBe(false);
  });

  it('get_deck reports not_found before any deck exists, then update_deck round-trips', async () => {
    await resetDb();
    const get = await findAction('get_deck');
    await expect(
      (async () => get.handler(ctx, {} as never))(),
    ).rejects.toMatchObject({ code: 'not_found' });

    // Seed a deck row directly (deck creation in prod goes through the AI
    // pipeline — not under test here).
    const { getDb } = await import('@/lib/db');
    const { decks } = await import('@/lib/db/schema');
    const { uuidv7 } = await import('uuidv7');
    const deckId = uuidv7();
    getDb().insert(decks).values({
      id: deckId,
      items: [{ taskId: 't1', rationale: 'r', continuityContext: null, source: 'ai' }],
      alternatives: [{ taskId: 't2', reason: 'later' }],
      framing: null,
    }).run();

    const latest = await get.handler(ctx, {} as never) as { id: string };
    expect(latest.id).toBe(deckId);

    const update = await findAction('update_deck');
    const updated = await update.handler(ctx, {
      id: deckId,
      items: [{ taskId: 't2', rationale: 'promoted', continuityContext: null, source: 'user' }],
      framing: 'light day',
    } as never) as { items: Array<{ taskId: string; source: string }>; framing: string | null };

    expect(updated.items[0].taskId).toBe('t2');
    expect(updated.items[0].source).toBe('user');
    expect(updated.framing).toBe('light day');
  });

  it('search returns hydrated FTS hits without an OpenAI key', async () => {
    await resetDb();
    const prevKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const createTask = await findAction('create_task');
      await createTask.handler(ctx, { title: 'Ship the zeppelin manifest' } as never);

      const search = await findAction('search');
      const hits = await search.handler(ctx, { query: 'zeppelin' } as never) as Array<{ type: string; title?: string }>;
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].type).toBe('task');
      expect(hits[0].title).toBe('Ship the zeppelin manifest');
    } finally {
      if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it('user state: singleton row reads and patches through the actions', async () => {
    await resetDb();
    const get = await findAction('get_user_state');
    const update = await findAction('update_user_state');

    const initial = await get.handler(ctx, {} as never) as { id: number };
    expect(initial?.id).toBe(1); // seeded by db bootstrap

    const updated = await update.handler(ctx, {
      activeEnergy: 'light', availableMinutes: 30, description: 'between meetings',
    } as never) as { activeEnergy: string | null; availableMinutes: number | null; description: string };

    expect(updated.activeEnergy).toBe('light');
    expect(updated.availableMinutes).toBe(30);
    expect(updated.description).toBe('between meetings');
  });
});
