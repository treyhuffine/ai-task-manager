import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { uuidv7 } from 'uuidv7';
import type { DB } from '@/lib/db';
import { entityLinks, entityProjectionState } from '@/lib/db/schema';

const TEST_DB = path.join(os.tmpdir(), `flow-entity-links-test-${process.pid}.db`);

interface EdgeRow {
  id: string;
  createdAt: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
}

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeEach(() => {
  cleanup();
  process.env.FLOW_DB_PATH = TEST_DB;
  process.env.FLOW_MIRROR_DISABLED = '1';
});

afterAll(cleanup);

async function setup() {
  const dbmod = await import('@/lib/db');
  dbmod.resetDb();
  dbmod.getDb();
  const queries = await import('@/lib/db/queries');
  return { ...dbmod, queries };
}

function allEdges(db: DB): EdgeRow[] {
  return db.select().from(entityLinks).all();
}

/** `type:id` target keys for one source, sorted. */
function outgoingKeys(edges: EdgeRow[], sourceType: string, sourceId: string): string[] {
  return edges
    .filter((r) => r.sourceType === sourceType && r.sourceId === sourceId)
    .map((r) => `${r.targetType}:${r.targetId}`)
    .sort();
}

describe('entity links derivation', () => {
  it('derives an edge from a task body marker and surfaces it as a backlink', async () => {
    const { queries, getDb } = await setup();
    const note = queries.createNote({ body: 'target note' });
    const task = queries.createTask({ title: 'linker', body: `see [[note:${note.id}]]` });

    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${note.id}`]);

    const backlinks = queries.listBacklinks('note', note.id);
    expect(backlinks).toEqual([{ sourceType: 'task', sourceId: task.id, title: 'linker' }]);
  });

  it('parses both task description and body', async () => {
    const { queries, getDb } = await setup();
    const a = queries.createNote({ body: 'a' });
    const b = queries.createNote({ body: 'b' });
    const task = queries.createTask({
      title: 't',
      description: `desc [[note:${a.id}]]`,
      body: `body [[note:${b.id}]]`,
    });
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual(
      [`note:${a.id}`, `note:${b.id}`].sort(),
    );
  });

  it('dedupes repeated markers into one edge', async () => {
    const { queries, getDb } = await setup();
    const n = queries.createNote({ body: 'n' });
    const task = queries.createTask({
      title: 't',
      body: `[[note:${n.id}]] and again [[note:${n.id}]]`,
    });
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${n.id}`]);
  });

  it('ignores markers inside inline code and fenced code blocks', async () => {
    const { queries, getDb } = await setup();
    const real = queries.createNote({ body: 'real' });
    const fenced = queries.createNote({ body: 'fenced' });
    const inline = queries.createNote({ body: 'inline' });
    const body = [
      `link [[note:${real.id}]]`,
      '```',
      `example [[note:${fenced.id}]]`,
      '```',
      `and \`[[note:${inline.id}]]\` inline`,
    ].join('\n');
    const task = queries.createTask({ title: 't', body });
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${real.id}`]);
  });

  it('reconciles edges on update (adds and prunes)', async () => {
    const { queries, getDb } = await setup();
    const a = queries.createNote({ body: 'a' });
    const b = queries.createNote({ body: 'b' });
    const task = queries.createTask({ title: 't', body: `[[note:${a.id}]]` });
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${a.id}`]);

    queries.updateTask(task.id, { body: `[[note:${b.id}]]` });
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${b.id}`]);
  });

  it('keeps stable edge ids under retry (upsert-and-prune)', async () => {
    const { queries, getDb } = await setup();
    const n = queries.createNote({ body: 'n' });
    const task = queries.createTask({ title: 't', body: `[[note:${n.id}]]` });
    const before = allEdges(getDb()).find((r) => r.sourceId === task.id);
    queries.updateTask(task.id, { body: `[[note:${n.id}]]` });
    const after = allEdges(getDb()).find((r) => r.sourceId === task.id);
    expect(before).toBeDefined();
    expect(after!.id).toBe(before!.id);
    expect(after!.createdAt).toBe(before!.createdAt);
  });

  it('removes outgoing edges when the source is deleted (delete trigger)', async () => {
    const { queries, getDb } = await setup();
    const n = queries.createNote({ body: 'n' });
    const task = queries.createTask({ title: 't', body: `[[note:${n.id}]]` });
    expect(queries.listBacklinks('note', n.id)).toHaveLength(1);

    queries.deleteTask(task.id);
    expect(allEdges(getDb())).toHaveLength(0);
    expect(queries.listBacklinks('note', n.id)).toHaveLength(0);
  });

  it('keeps a dangling edge when the target is deleted (unresolved link)', async () => {
    const { queries, getDb } = await setup();
    const n = queries.createNote({ body: 'n' });
    const task = queries.createTask({ title: 't', body: `[[note:${n.id}]]` });

    queries.deleteNote(n.id);
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${n.id}`]);
    expect(queries.listOutgoingLinks('task', task.id)).toEqual([
      { targetType: 'note', targetId: n.id, title: null, resolved: false },
    ]);
  });

  it('keeps self-links in the data but filters them from the panel', async () => {
    const { queries, getDb } = await setup();
    const n = queries.createNote({ body: 'placeholder' });
    queries.updateNote(n.id, { body: `self [[note:${n.id}]]` });
    expect(outgoingKeys(allEdges(getDb()), 'note', n.id)).toEqual([`note:${n.id}`]);
    expect(queries.listBacklinks('note', n.id)).toEqual([]);
  });

  it('typed edge keys: same id across types does not alias', async () => {
    const { getDb } = await setup();
    const db = getDb();
    db.insert(entityLinks)
      .values({ id: uuidv7(), sourceType: 'task', sourceId: 'X', targetType: 'note', targetId: 'Y' })
      .run();
    db.insert(entityLinks)
      .values({ id: uuidv7(), sourceType: 'note', sourceId: 'X', targetType: 'note', targetId: 'Y' })
      .onConflictDoNothing()
      .run();
    expect(allEdges(db).filter((r) => r.sourceId === 'X')).toHaveLength(2);
  });
});

describe('entity links read-repair (external writes)', () => {
  it('repairs a raw-SQL body edit before returning backlinks', async () => {
    const { queries, getRawDb } = await setup();
    const target = queries.createTask({ title: 'target' });
    const note = queries.createNote({ body: 'no links yet' });
    expect(queries.listBacklinks('task', target.id)).toHaveLength(0);

    getRawDb()
      .prepare('UPDATE notes SET body = ? WHERE id = ?')
      .run(`now links [[task:${target.id}]]`, note.id);

    expect(queries.listBacklinks('task', target.id)).toEqual([
      { sourceType: 'note', sourceId: note.id, title: null },
    ]);
  });

  it('removes edges when a source is deleted via raw SQL (delete trigger)', async () => {
    const { queries, getDb, getRawDb } = await setup();
    const n = queries.createNote({ body: 'n' });
    const task = queries.createTask({ title: 't', body: `[[note:${n.id}]]` });
    expect(allEdges(getDb())).toHaveLength(1);

    getRawDb().prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    expect(allEdges(getDb())).toHaveLength(0);
  });
});

describe('rebuildAllEntityLinks', () => {
  it('reconciles from scratch and prunes orphaned source rows', async () => {
    const { queries, getDb, getRawDb } = await setup();
    const n = queries.createNote({ body: 'n' });
    const task = queries.createTask({ title: 't', body: `[[note:${n.id}]]` });

    getRawDb().prepare('DELETE FROM entity_links').run();
    getRawDb()
      .prepare(
        "INSERT INTO entity_links (id, source_type, source_id, target_type, target_id) VALUES (?, 'task', 'ghost', 'note', ?)",
      )
      .run(uuidv7(), n.id);

    const result = queries.rebuildAllEntityLinks();
    expect(result.pruned).toBe(1);
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${n.id}`]);
    expect(allEdges(getDb()).filter((r) => r.sourceId === 'ghost')).toHaveLength(0);
  });

  it('recreates projection rows for untracked (legacy) sources', async () => {
    const { queries, getDb, getRawDb } = await setup();
    const n = queries.createNote({ body: 'target' });
    const task = queries.createTask({ title: 'linker', body: `[[note:${n.id}]]` });
    // Simulate legacy data: index + projection wiped, sources remain.
    getRawDb().prepare('DELETE FROM entity_links').run();
    getRawDb().prepare('DELETE FROM entity_projection_state').run();

    queries.rebuildAllEntityLinks();
    expect(getDb().select().from(entityProjectionState).all()).toHaveLength(2);
    expect(queries.listBacklinks('note', n.id)).toEqual([
      { sourceType: 'task', sourceId: task.id, title: 'linker' },
    ]);
  });
});

describe('entity links backfill on reopen', () => {
  it('restores legacy links when a DB has sources but no projection rows', async () => {
    const { queries, getDb, getRawDb, resetDb } = await setup();
    const n = queries.createNote({ body: 'target' });
    const task = queries.createTask({ title: 'linker', body: `[[note:${n.id}]]` });
    getRawDb().prepare('DELETE FROM entity_links').run();
    getRawDb().prepare('DELETE FROM entity_projection_state').run();

    // Reopen the connection → ensureEntityLinksBackfill runs for untracked sources.
    resetDb();
    getDb();

    expect(queries.listBacklinks('note', n.id)).toEqual([
      { sourceType: 'task', sourceId: task.id, title: 'linker' },
    ]);
    expect(getDb().select().from(entityProjectionState).all()).toHaveLength(2);
  });
});

describe('backfill + read-repair prune stale edges (legacy drift)', () => {
  it('prunes an edge the current body no longer declares', async () => {
    const { queries, getDb, getRawDb, resetDb } = await setup();
    const a = queries.createNote({ body: 'a' });
    const b = queries.createNote({ body: 'b' });
    const task = queries.createTask({ title: 't', body: `[[note:${a.id}]]` });

    // Drift the body via raw SQL (no reconcile), then wipe the projection row so
    // the task looks like a legacy/untracked source with a now-stale edge to a.
    getRawDb().prepare('UPDATE tasks SET body = ? WHERE id = ?').run(`[[note:${b.id}]]`, task.id);
    getRawDb().prepare('DELETE FROM entity_projection_state').run();
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${a.id}`]); // stale

    // Reopen (lazy backfill marks it pending, writes no edges), then read →
    // exact upsert-and-prune reconciliation replaces the stale edge.
    resetDb();
    getDb();
    queries.listBacklinks('note', b.id);
    expect(outgoingKeys(allEdges(getDb()), 'task', task.id)).toEqual([`note:${b.id}`]);
  });
});

describe('listEntityLinksFor (combined single-transaction read)', () => {
  it('returns backlinks and outgoing from one repair', async () => {
    const { queries } = await setup();
    const hub = queries.createNote({ body: 'hub', title: 'Hub' });
    const linker = queries.createTask({ title: 'linker', body: `[[note:${hub.id}]]` });
    const target = queries.createNote({ body: 'target', title: 'Target' });
    queries.updateNote(hub.id, { body: `hub links [[note:${target.id}]]` });

    const result = queries.listEntityLinksFor('note', hub.id);
    expect(result.backlinks).toEqual([
      { sourceType: 'task', sourceId: linker.id, title: 'linker' },
    ]);
    expect(result.outgoing).toEqual([
      { targetType: 'note', targetId: target.id, title: 'Target', resolved: true },
    ]);
  });
});

describe('resolveEntityTitles (read-only)', () => {
  it('resolves titles/status without bumping last_viewed_at', async () => {
    const { queries, getRawDb } = await setup();
    const t = queries.createTask({ title: 'My Task' });
    const n = queries.createNote({ body: 'body', title: 'My Note' });
    const before = getRawDb()
      .prepare('SELECT last_viewed_at AS v FROM tasks WHERE id = ?')
      .get(t.id) as { v: string | null };

    const titles = queries.resolveEntityTitles([
      { type: 'task', id: t.id },
      { type: 'note', id: n.id },
      { type: 'note', id: 'missing' },
    ]);
    expect(titles).toEqual([
      { type: 'task', id: t.id, title: 'My Task', status: 'active' },
      { type: 'note', id: n.id, title: 'My Note', status: 'active' },
    ]);

    const after = getRawDb()
      .prepare('SELECT last_viewed_at AS v FROM tasks WHERE id = ?')
      .get(t.id) as { v: string | null };
    expect(after.v).toBe(before.v);
  });
});
