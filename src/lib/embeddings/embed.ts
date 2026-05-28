import { createHash } from 'crypto';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getRawDb } from '@/lib/db';
import type { TaskRecord, NoteRecord, StreamRecord } from '@/db/types';

export function computeContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function buildEmbeddingText(
  entityType: 'task' | 'note' | 'stream',
  entity: TaskRecord | NoteRecord | StreamRecord,
): string {
  const labeled = (pairs: [string, string | null | undefined][]) =>
    pairs
      .filter((p): p is [string, string] => Boolean(p[1]))
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n');

  switch (entityType) {
    case 'task': {
      const t = entity as TaskRecord;
      return labeled([
        ['Title', t.title],
        ['Description', t.description],
        ['Outcome', t.outcome],
        ['Body', t.body],
        ['Context', t.userContext],
      ]);
    }
    case 'note': {
      const n = entity as NoteRecord;
      return labeled([
        ['Title', n.title],
        ['Body', n.body],
      ]);
    }
    case 'stream': {
      const s = entity as StreamRecord;
      return s.rawText;
    }
  }
}

// ~4 chars per token, stay well under 8192 token limit
const MAX_CHARS = 28_000;

function truncate(text: string): string {
  return text.length <= MAX_CHARS ? text : text.slice(0, MAX_CHARS);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const result = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: truncate(text),
  });
  return result.embedding;
}

export async function upsertEmbedding(
  entityType: 'task' | 'note' | 'stream',
  entityId: string,
  textContent: string,
): Promise<void> {
  if (!textContent.trim()) return;
  // Silently skip when the user hasn't configured OpenAI. Embeddings are a
  // nice-to-have (they power hybrid search, not core CRUD), and we don't
  // want save paths to fail or log noisy rejections just because the key
  // isn't set. Hybrid search already handles the missing-embedding case by
  // falling back to FTS.
  if (!process.env.OPENAI_API_KEY) return;

  const db = getRawDb();
  const hash = computeContentHash(textContent);

  // Check if existing row has same hash — skip if unchanged
  const existing = db
    .prepare('SELECT id, content_hash FROM embeddings WHERE entity_type = ? AND entity_id = ?')
    .get(entityType, entityId) as { id: number; content_hash: string } | undefined;

  if (existing && existing.content_hash === hash) {
    return;
  }

  const vector = await generateEmbedding(textContent);
  const embedding = new Float32Array(vector);

  if (existing) {
    db.prepare(
      'UPDATE embeddings SET content_hash = ?, text_content = ?, created_at = datetime(\'now\') WHERE id = ?',
    ).run(hash, textContent, existing.id);
    // vec0 doesn't support UPDATE — delete + re-insert
    db.prepare('DELETE FROM embeddings_vec WHERE rowid = ?').run(BigInt(existing.id));
    db.prepare('INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)').run(
      BigInt(existing.id),
      embedding,
    );
  } else {
    const info = db
      .prepare(
        'INSERT INTO embeddings (entity_type, entity_id, content_hash, text_content) VALUES (?, ?, ?, ?)',
      )
      .run(entityType, entityId, hash, textContent);
    db.prepare('INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)').run(
      BigInt(info.lastInsertRowid),
      embedding,
    );
  }
}

export function deleteEmbedding(
  entityType: 'task' | 'note' | 'stream',
  entityId: string,
): void {
  const db = getRawDb();
  const existing = db
    .prepare('SELECT id FROM embeddings WHERE entity_type = ? AND entity_id = ?')
    .get(entityType, entityId) as { id: number } | undefined;

  if (!existing) return;

  db.prepare('DELETE FROM embeddings_vec WHERE rowid = ?').run(BigInt(existing.id));
  db.prepare('DELETE FROM embeddings WHERE id = ?').run(existing.id);
}
