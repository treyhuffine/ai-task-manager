import { createHash } from 'crypto';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getRawDb } from '@/lib/db';
import type { TaskRecord, NoteRecord, StreamRecord } from '@/db/types';

type EntityType = 'task' | 'note' | 'stream';
type EmbeddingTask = Pick<TaskRecord, 'title' | 'description' | 'outcome' | 'body' | 'userContext'>;
type EmbeddingNote = Pick<NoteRecord, 'title' | 'body'>;
type EmbeddingStream = Pick<StreamRecord, 'rawText'>;

export function computeContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function buildEmbeddingText(
  entityType: EntityType,
  entity: EmbeddingTask | EmbeddingNote | EmbeddingStream,
): string {
  const labeled = (pairs: [string, string | null | undefined][]) =>
    pairs
      .filter((p): p is [string, string] => Boolean(p[1]))
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n');

  switch (entityType) {
    case 'task': {
      const t = entity as EmbeddingTask;
      return labeled([
        ['Title', t.title],
        ['Description', t.description],
        ['Outcome', t.outcome],
        ['Body', t.body],
        ['Context', t.userContext],
      ]);
    }
    case 'note': {
      const n = entity as EmbeddingNote;
      return labeled([
        ['Title', n.title],
        ['Body', n.body],
      ]);
    }
    case 'stream': {
      const s = entity as EmbeddingStream;
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
  entityType: EntityType,
  entityId: string,
  textContent: string,
): Promise<void> {
  // Silently skip when the user hasn't configured OpenAI. Embeddings are a
  // nice-to-have (they power hybrid search, not core CRUD), and we don't
  // want save paths to fail or log noisy rejections just because the key
  // isn't set. Hybrid search already handles the missing-embedding case by
  // falling back to FTS.
  if (textContent.trim() && !process.env.OPENAI_API_KEY) return;

  try {
    const db = getRawDb();
    if (!textContent.trim()) {
      db.transaction(() => {
        if (currentText(db, entityType, entityId) === textContent) deleteEmbedding(entityType, entityId);
      }).immediate();
      return;
    }
    const hash = computeContentHash(textContent);
    const existing = db
      .prepare('SELECT content_hash FROM embeddings WHERE entity_type = ? AND entity_id = ?')
      .get(entityType, entityId) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) return;

    const vector = await generateEmbedding(textContent);
    persistEmbeddingIfCurrent(db, entityType, entityId, textContent, vector);
  } catch (error) {
    // Query-layer saves intentionally do not await this optional projection.
    // Provider or storage failures must not become unhandled rejections.
    console.error(`[embeddings] Could not update ${entityType} ${entityId}`, error);
  }
}

function currentText(db: ReturnType<typeof getRawDb>, entityType: EntityType, entityId: string): string | undefined {
  switch (entityType) {
    case 'task': {
      const row = db.prepare('SELECT title, description, outcome, body, user_context AS userContext FROM tasks WHERE id = ?')
        .get(entityId) as EmbeddingTask | undefined;
      return row ? buildEmbeddingText('task', row) : undefined;
    }
    case 'note': {
      const row = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(entityId) as EmbeddingNote | undefined;
      return row ? buildEmbeddingText('note', row) : undefined;
    }
    case 'stream': {
      const row = db.prepare('SELECT raw_text AS rawText FROM stream WHERE id = ?').get(entityId) as EmbeddingStream | undefined;
      return row ? buildEmbeddingText('stream', row) : undefined;
    }
  }
}

/** The entity can change or disappear while the provider is generating.
 * Validate its current text under the write lock and commit metadata/vector
 * together. The unique-key upsert also handles concurrent first writes. */
export function persistEmbeddingIfCurrent(
  db: ReturnType<typeof getRawDb>, entityType: EntityType, entityId: string,
  textContent: string, vector: number[],
): void {
  db.transaction(() => {
    if (currentText(db, entityType, entityId) !== textContent) return;
    const row = db.prepare(`
      INSERT INTO embeddings (entity_type, entity_id, content_hash, text_content)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        content_hash = excluded.content_hash, text_content = excluded.text_content,
        created_at = datetime('now')
      RETURNING id
    `).get(entityType, entityId, computeContentHash(textContent), textContent) as { id: number };
    // vec0 does not support UPDATE. The transaction keeps replacement atomic.
    db.prepare('DELETE FROM embeddings_vec WHERE rowid = ?').run(BigInt(row.id));
    db.prepare('INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)').run(BigInt(row.id), new Float32Array(vector));
  }).immediate();
}

export function deleteEmbedding(
  entityType: 'task' | 'note' | 'stream',
  entityId: string,
): void {
  const db = getRawDb();
  db.transaction(() => {
    const existing = db
      .prepare('SELECT id FROM embeddings WHERE entity_type = ? AND entity_id = ?')
      .get(entityType, entityId) as { id: number } | undefined;
    if (!existing) return;
    db.prepare('DELETE FROM embeddings_vec WHERE rowid = ?').run(BigInt(existing.id));
    db.prepare('DELETE FROM embeddings WHERE id = ?').run(existing.id);
  }).immediate();
}
