import { getRawDb } from '@/lib/db';
import * as q from '@/lib/db/queries';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildEmbeddingText, computeContentHash, persistEmbeddingIfCurrent, upsertEmbedding } from './embed';

const mocks = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock('ai', () => ({ embed: mocks.embed }));

let home: TestHome;
beforeEach(async () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  mocks.embed.mockReset();
  home = await createTestHome({ prefix: 'ri-embedding-writes-' });
});
afterEach(async () => {
  await home.cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function vector(dimension: number) {
  const result = Array<number>(1536).fill(0);
  result[dimension] = 1;
  return result;
}
function deferred() {
  let resolve!: (value: { embedding: number[] }) => void;
  const promise = new Promise<{ embedding: number[] }>(done => { resolve = done; });
  return { promise, resolve };
}
function embedding(id: string) {
  return getRawDb().prepare('SELECT id, content_hash, text_content FROM embeddings WHERE entity_id = ?')
    .get(id) as { id: number; content_hash: string; text_content: string } | undefined;
}
function storedVector(id: number) {
  const row = getRawDb().prepare('SELECT embedding FROM embeddings_vec WHERE rowid = ?').get(BigInt(id)) as { embedding: Buffer };
  return Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
}

it('commits concurrent first writes without duplicate metadata or orphaned vectors', async () => {
  const task = q.createTask({ title: 'Concurrent', rawInput: 'Concurrent' });
  const text = buildEmbeddingText('task', task);
  const first = deferred(), second = deferred();
  mocks.embed.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubEnv('OPENAI_API_KEY', 'test');
  const a = upsertEmbedding('task', task.id, text), b = upsertEmbedding('task', task.id, text);
  second.resolve({ embedding: vector(1) });
  await b;
  const rowid = embedding(task.id)!.id;
  first.resolve({ embedding: vector(0) });
  await a;
  expect(embedding(task.id)).toMatchObject({ id: rowid, content_hash: computeContentHash(text) });
  expect(getRawDb().prepare('SELECT COUNT(*) FROM embeddings').pluck().get()).toBe(1);
  expect(getRawDb().prepare('SELECT COUNT(*) FROM embeddings_vec').pluck().get()).toBe(1);
});

it('cannot overwrite a newer edit when an older provider response finishes last', async () => {
  const task = q.createTask({ title: 'Original', rawInput: 'Original' });
  const older = deferred(), newer = deferred();
  mocks.embed.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  vi.stubEnv('OPENAI_API_KEY', 'test');
  const pending = upsertEmbedding('task', task.id, buildEmbeddingText('task', task));
  vi.stubEnv('OPENAI_API_KEY', '');
  const updated = q.updateTask(task.id, { title: 'Newest' }, { source: 'human' })!;
  vi.stubEnv('OPENAI_API_KEY', 'test');
  const latest = upsertEmbedding('task', task.id, buildEmbeddingText('task', updated));
  newer.resolve({ embedding: vector(1) });
  await latest;
  older.resolve({ embedding: vector(0) });
  await pending;
  const row = embedding(task.id)!;
  expect(row.text_content).toBe(buildEmbeddingText('task', updated));
  expect(storedVector(row.id)).toEqual(vector(1));
});

it('does not resurrect an embedding after its entity was deleted', async () => {
  const task = q.createTask({ title: 'Deleted', rawInput: 'Deleted' });
  const generation = deferred();
  mocks.embed.mockReturnValueOnce(generation.promise);
  vi.stubEnv('OPENAI_API_KEY', 'test');
  const pending = upsertEmbedding('task', task.id, buildEmbeddingText('task', task));
  q.deleteTask(task.id);
  generation.resolve({ embedding: vector(0) });
  await pending;
  expect(embedding(task.id)).toBeUndefined();
  expect(getRawDb().prepare('SELECT COUNT(*) FROM embeddings_vec').pluck().get()).toBe(0);
});

it('rolls back metadata and vector replacement together on a storage failure', () => {
  const task = q.createTask({ title: 'Before', rawInput: 'Before' });
  const db = getRawDb();
  const text = buildEmbeddingText('task', task);
  persistEmbeddingIfCurrent(db, 'task', task.id, text, vector(0));
  const before = embedding(task.id)!;
  const updated = q.updateTask(task.id, { title: 'After' }, { source: 'human' })!;
  expect(() => persistEmbeddingIfCurrent(db, 'task', task.id, buildEmbeddingText('task', updated), [1, 0])).toThrow();
  expect(embedding(task.id)).toEqual(before);
  expect(storedVector(before.id)).toEqual(vector(0));
});

it('reports optional provider failures without rejecting a successful entity save', async () => {
  const task = q.createTask({ title: 'Saved', rawInput: 'Saved' });
  mocks.embed.mockRejectedValue(new Error('Provider unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('OPENAI_API_KEY', 'test');
  await expect(upsertEmbedding('task', task.id, buildEmbeddingText('task', task))).resolves.toBeUndefined();
  expect(q.getTask(task.id)?.title).toBe('Saved');
  expect(log).toHaveBeenCalledOnce();
  expect(embedding(task.id)).toBeUndefined();
});

it('skips provider calls for missing credentials and unchanged content', async () => {
  const task = q.createTask({ title: 'Same', rawInput: 'Same' });
  const text = buildEmbeddingText('task', task);
  await upsertEmbedding('task', task.id, text);
  expect(mocks.embed).not.toHaveBeenCalled();
  persistEmbeddingIfCurrent(getRawDb(), 'task', task.id, text, vector(0));
  vi.stubEnv('OPENAI_API_KEY', 'test');
  await upsertEmbedding('task', task.id, text);
  expect(mocks.embed).not.toHaveBeenCalled();
});

it('uses the same current-content check for note and stream projections', () => {
  const note = q.createNote({ title: 'Note', body: 'Current body' });
  const item = q.createStream({ rawText: 'Current stream' });
  persistEmbeddingIfCurrent(getRawDb(), 'note', note.id, buildEmbeddingText('note', note), vector(0));
  persistEmbeddingIfCurrent(getRawDb(), 'stream', item.id, buildEmbeddingText('stream', item), vector(1));
  expect(embedding(note.id)?.text_content).toBe('Title: Note\nBody: Current body');
  expect(embedding(item.id)?.text_content).toBe('Current stream');
  persistEmbeddingIfCurrent(getRawDb(), 'stream', item.id, 'Stale stream', vector(0));
  expect(storedVector(embedding(item.id)!.id)).toEqual(vector(1));
});

it('clears an empty document projection even without provider credentials', async () => {
  const note = q.createNote({ body: 'Current body' });
  persistEmbeddingIfCurrent(getRawDb(), 'note', note.id, buildEmbeddingText('note', note), vector(0));
  q.updateNote(note.id, { body: '' }, { source: 'human' });
  await upsertEmbedding('note', note.id, '');
  expect(embedding(note.id)).toBeUndefined();
  expect(getRawDb().prepare('SELECT COUNT(*) FROM embeddings_vec').pluck().get()).toBe(0);
});
