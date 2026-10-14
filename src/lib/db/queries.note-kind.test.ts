/**
 * A note's kind (docs/homes-spec.md §9.7, P8.1). A note is an ordinary note
 * unless someone says it's a decision, a note from before kinds reads as an
 * ordinary note, and a change of kind is part of the note's history like any
 * other edit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { APP_SHORT_ID } from '@/constants/app';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
}));
vi.setConfig({ testTimeout: 30_000 });

describe('note kind', () => {
  let tmpDir: string;
  const prefix = APP_SHORT_ID.toUpperCase();
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-note-kind-'));
    vi.stubEnv(`${prefix}_ROOT`, tmpDir);
    vi.stubEnv(`${prefix}_DB_PATH`, path.join(tmpDir, 'data.db'));
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '1');
    vi.resetModules();
  });
  afterEach(async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function load() {
    const q = await import('@/lib/db/queries');
    const { getDb, getRawDb } = await import('@/lib/db');
    const schema = await import('@/lib/db/schema');
    /** A note written before kinds existed: the column is empty. */
    const legacy = (title: string) => {
      const note = q.createNote({ title, body: '' });
      getDb().update(schema.notes).set({ kind: null }).where(eq(schema.notes.id, note.id)).run();
      return note.id;
    };
    return { q, getDb, getRawDb, schema, legacy };
  }

  it('makes an ordinary note unless asked for a decision, and stores the kind it was given', async () => {
    const { q, getDb, schema } = await load();
    const plain = q.createNote({ title: 'Launch plan', body: '' });
    const decision = q.createNote({ title: 'Use the billing provider', body: '', kind: 'decision' });
    expect(plain.kind).toBe('note');
    expect(decision.kind).toBe('decision');
    // The creator writes the kind: nothing is left for the database to decide.
    const stored = getDb().select({ id: schema.notes.id, kind: schema.notes.kind }).from(schema.notes).all();
    expect(Object.fromEntries(stored.map((row) => [row.id, row.kind]))).toEqual({ [plain.id]: 'note', [decision.id]: 'decision' });
  });

  it('never reads a kind from a title', async () => {
    const { q } = await load();
    const titled = q.createNote({ title: 'Decision: use the billing provider', body: '' });
    expect(titled.kind).toBe('note');
    expect(q.listNotes({ kind: 'decision' })).toEqual([]);
  });

  it('reads a note from before kinds as an ordinary note, everywhere it is read', async () => {
    const { q, legacy } = await load();
    const id = legacy('Old thought');
    expect(q.getNote(id)?.kind).toBe('note');
    expect(q.listNotes().find((note) => note.id === id)?.kind).toBe('note');
    expect(q.listNotes({ kind: 'note' }).map((note) => note.id)).toEqual([id]);
    expect(q.listNotes({ kind: 'decision' })).toEqual([]);
  });

  it('filters by kind, with decisionsOnly kept as another way to ask for decisions', async () => {
    const { q, legacy } = await load();
    const old = legacy('Old');
    const plain = q.createNote({ title: 'Plain', body: '' });
    const decided = q.createNote({ title: 'Decided', body: '', kind: 'decision' });
    const ids = (list: Array<{ id: string }>) => list.map((note) => note.id).sort();

    expect(ids(q.listNotes({ kind: 'decision' }))).toEqual([decided.id]);
    expect(ids(q.listNotes({ decisionsOnly: true }))).toEqual([decided.id]);
    expect(ids(q.listNotes({ decisionsOnly: true, kind: 'decision' }))).toEqual([decided.id]);
    expect(ids(q.listNotes({ kind: 'note' }))).toEqual([old, plain.id].sort());
    expect(ids(q.listNotes())).toEqual([old, plain.id, decided.id].sort());
    // Asking for decisions and ordinary notes at once is a mistake, not an empty list.
    expect(() => q.listNotes({ decisionsOnly: true, kind: 'note' })).toThrow(q.NoteKindError);
  });

  it('keeps the kind through edits that leave it out, and refuses to clear or invent one', async () => {
    const { q } = await load();
    const note = q.createNote({ title: 'Use the billing provider', body: 'Because invoices.', kind: 'decision' });
    const renamed = q.updateNote(note.id, { title: 'Use Billing Co' }, { source: 'human' })!;
    expect(renamed.kind).toBe('decision');
    const edited = q.updateNote(note.id, { body: 'Because invoices and refunds.' }, { source: 'human' })!;
    expect(edited.kind).toBe('decision');

    expect(() => q.updateNote(note.id, { kind: null } as never, { source: 'human' })).toThrow(q.NoteKindError);
    expect(() => q.updateNote(note.id, { kind: 'policy' } as never, { source: 'human' })).toThrow(q.NoteKindError);
    expect(() => q.createNote({ title: 'x', body: '', kind: 'policy' } as never)).toThrow(q.NoteKindError);
    expect(q.getNote(note.id)?.kind).toBe('decision');
  });

  it('records a change of kind as a version, with who made it, and leaves the body revision alone', async () => {
    const { q, getDb, schema } = await load();
    const now = new Date().toISOString();
    getDb().insert(schema.members).values({ id: 'maya', name: 'Maya', role: 'member', status: 'active', createdAt: now, updatedAt: now }).run();
    const note = q.createNote({ title: 'Use the billing provider', body: 'Because invoices.' });
    const before = q.getNote(note.id)!;

    const marked = q.updateNote(note.id, { kind: 'decision' }, { source: 'ai', actorMemberId: 'maya' })!;
    expect(marked.kind).toBe('decision');
    expect(marked.bodyRevision).toBe(before.bodyRevision);

    const versions = q.listEntityVersions('note', note.id);
    const change = versions.find((version) => version.snapshot.kind === 'decision')!;
    expect(change).toMatchObject({ source: 'ai', actorMemberId: 'maya' });
    // The baseline it can go back to says the note was ordinary.
    expect(versions.some((version) => version.snapshot.kind === 'note')).toBe(true);
  });

  it('restores the kind a version recorded, and keeps the current one when the version predates kinds', async () => {
    const { q, getDb, schema } = await load();
    const note = q.createNote({ title: 'Old title', body: '' });
    q.updateNote(note.id, { title: 'New title', kind: 'decision' }, { source: 'human' });
    const versions = q.listEntityVersions('note', note.id);
    const baseline = versions.find((version) => version.snapshot.title === 'Old title')!;
    expect(baseline.snapshot.kind).toBe('note');

    // A version that recorded a kind brings it back.
    expect(q.revertEntityTo(baseline.id)!.record).toMatchObject({ title: 'Old title', kind: 'note' });

    // One written before kinds says nothing about it, so the kind stays.
    q.updateNote(note.id, { title: 'Newest title', kind: 'decision' }, { source: 'human' });
    const legacy = { ...baseline.snapshot };
    delete legacy.kind;
    getDb().update(schema.entityVersions).set({ snapshot: legacy }).where(eq(schema.entityVersions.id, baseline.id)).run();
    expect(q.revertEntityTo(baseline.id)!.record).toMatchObject({ title: 'Old title', kind: 'decision' });
  });

  it('lists decisions through the kind index', async () => {
    const { q, getRawDb } = await load();
    q.createNote({ title: 'Decided', body: '', kind: 'decision' });
    const db = getRawDb();
    for (const filter of [{ kind: 'decision' as const }, { kind: 'decision' as const, status: 'active' as const }]) {
      const prepare = vi.spyOn(db, 'prepare');
      q.listNotes(filter);
      const sql = prepare.mock.calls.map(([s]) => s).find((s) => s.includes('from "notes"'));
      prepare.mockRestore();
      expect(sql).toBeDefined();
      // listNotes binds the status when asked for, then the kind, the limit, and an offset only when one is set.
      expect(sql).toMatch(filter.status ? /"status" = \? and .*"kind" = \?/ : /"kind" = \?/);
      const params: unknown[] = [...(filter.status ? [filter.status] : []), 'decision', 10000];
      if (/\boffset \?/.test(sql!)) params.push(0);
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
        .map((row) => row.detail);
      expect(plan.some((detail) => detail.startsWith('SEARCH notes USING INDEX idx_notes_kind_status'))).toBe(true);
    }
  });
});
