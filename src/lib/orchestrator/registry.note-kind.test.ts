/**
 * Decisions through the agent surface (docs/homes-spec.md §9.7, P8.1): an
 * agent records one with create_note, finds them with list_notes and search,
 * and can't send a kind the app doesn't know.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ capabilities: { concurrentSend: true } }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
// Keyword search only: no query is embedded and no note is sent anywhere.
vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
  generateEmbedding: vi.fn(async () => { throw new Error('no embeddings in this test'); }),
}));

const TEST_DB = path.join(os.tmpdir(), `ri-registry-note-kind-test-${process.pid}.db`);

function removeDb() {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
}

beforeEach(async () => {
  removeDb();
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
});

afterAll(removeDb);

const local = { remote: false } as const;

async function run(action: string, input: Record<string, unknown>) {
  const { runAction } = await import('./dispatch');
  return runAction(action, input, local);
}

async function result<T>(action: string, input: Record<string, unknown>): Promise<T> {
  const out = await run(action, input);
  if (!out.ok) throw new Error(`${action} failed: ${JSON.stringify(out.error)}`);
  return out.result as T;
}

type Note = { id: string; kind: string; title: string | null };

describe('decisions through the agent surface', () => {
  it('records a decision, keeps notes ordinary by default, and lists either kind', async () => {
    const decision = await result<Note>('create_note', { title: 'Use the billing provider', body: 'Chosen for its invoices.', kind: 'decision' });
    const plain = await result<Note>('create_note', { title: 'Launch plan', body: 'Invoices go out Friday.' });
    expect(decision.kind).toBe('decision');
    expect(plain.kind).toBe('note');

    expect((await result<Note[]>('list_notes', { kind: 'decision' })).map((n) => n.id)).toEqual([decision.id]);
    expect((await result<Note[]>('list_notes', { decisionsOnly: true })).map((n) => n.id)).toEqual([decision.id]);
    expect((await result<Note[]>('list_notes', { kind: 'note' })).map((n) => n.id)).toEqual([plain.id]);
    expect((await result<Note[]>('get_note', { id: decision.id }) as unknown as Note).kind).toBe('decision');
  });

  it('changes a kind with update_note and keeps it through edits that leave it out', async () => {
    const note = await result<Note>('create_note', { title: 'Pricing', body: 'Per seat or per team.' });
    expect((await result<Note>('update_note', { id: note.id, kind: 'decision' })).kind).toBe('decision');
    expect((await result<Note>('update_note', { id: note.id, title: 'Pricing is per seat' })).kind).toBe('decision');
  });

  it('searches decisions only when asked, and says what each hit is', async () => {
    const decision = await result<Note>('create_note', { title: 'Use the billing provider', body: 'Chosen for its invoices.', kind: 'decision' });
    const plain = await result<Note>('create_note', { title: 'Launch plan', body: 'Invoices go out Friday.' });
    const task = await result<{ id: string }>('create_task', { title: 'Send the invoices' });

    const everything = await result<Array<{ id: string; type: string; kind?: string }>>('search', { query: 'invoices' });
    expect(everything.map((hit) => hit.id).sort()).toEqual([decision.id, plain.id, task.id].sort());
    expect(everything.find((hit) => hit.id === decision.id)?.kind).toBe('decision');
    expect(everything.find((hit) => hit.id === plain.id)?.kind).toBe('note');

    const decisions = await result<Array<{ id: string; type: string }>>('search', { query: 'invoices', kind: 'decision' });
    expect(decisions).toEqual([expect.objectContaining({ id: decision.id, type: 'note' })]);
  });

  it.each([
    ['create_note', { body: 'x', kind: 'policy' }],
    ['update_note', { id: 'any', kind: 'policy' }],
    ['update_note', { id: 'any', kind: null }],
    ['list_notes', { kind: 'policy' }],
    ['list_notes', { decisionsOnly: true, kind: 'note' }],
    ['search', { query: 'x', kind: 'policy' }],
  ])('refuses %s with %j as invalid params', async (action, input) => {
    expect(await run(action, input)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });
});
