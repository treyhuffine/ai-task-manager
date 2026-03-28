import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getRawDb } from '@/lib/db';
import { computeContentHash, buildEmbeddingText } from './embed';
import type { TaskRecord, NoteRecord, StreamRecord } from '@/db/types';

const BATCH_SIZE = 50;

interface EmbedItem {
  entityType: 'task' | 'note' | 'stream';
  entityId: string;
  text: string;
  hash: string;
}

async function backfill() {
  const db = getRawDb();

  // Rebuild stream_fts content for existing rows
  console.log('Rebuilding stream_fts...');
  try {
    db.exec("INSERT INTO stream_fts(stream_fts) VALUES('rebuild')");
  } catch {
    console.log('stream_fts rebuild skipped (may already be current)');
  }

  // Gather all items to embed
  const items: EmbedItem[] = [];

  const allTasks = db.prepare('SELECT * FROM tasks').all() as TaskRecord[];
  for (const t of allTasks) {
    const text = buildEmbeddingText('task', t);
    if (!text.trim()) continue;
    items.push({ entityType: 'task', entityId: t.id, text, hash: computeContentHash(text) });
  }

  const allNotes = db.prepare('SELECT * FROM notes').all() as NoteRecord[];
  for (const n of allNotes) {
    const text = buildEmbeddingText('note', n);
    if (!text.trim()) continue;
    items.push({ entityType: 'note', entityId: n.id, text, hash: computeContentHash(text) });
  }

  const allStream = db.prepare('SELECT * FROM stream').all() as StreamRecord[];
  for (const s of allStream) {
    const text = buildEmbeddingText('stream', s);
    if (!text.trim()) continue;
    items.push({ entityType: 'stream', entityId: s.id, text, hash: computeContentHash(text) });
  }

  console.log(`Found ${items.length} items to consider (${allTasks.length} tasks, ${allNotes.length} notes, ${allStream.length} stream)`);

  // Filter out items that already have a matching hash
  const toEmbed = items.filter((item) => {
    const existing = db
      .prepare('SELECT content_hash FROM embeddings WHERE entity_type = ? AND entity_id = ?')
      .get(item.entityType, item.entityId) as { content_hash: string } | undefined;
    return !existing || existing.content_hash !== item.hash;
  });

  console.log(`${toEmbed.length} items need embedding (${items.length - toEmbed.length} skipped — unchanged)`);

  if (toEmbed.length === 0) {
    console.log('Done — nothing to embed.');
    return;
  }

  // Process in batches
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    console.log(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toEmbed.length / BATCH_SIZE)} (${batch.length} items)...`);

    const result = await embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: batch.map((b) => b.text.length > 28_000 ? b.text.slice(0, 28_000) : b.text),
    });

    const insertOrUpdate = db.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const vector = result.embeddings[j];
        const vectorBuf = Buffer.from(new Float32Array(vector).buffer);

        const existing = db
          .prepare('SELECT id FROM embeddings WHERE entity_type = ? AND entity_id = ?')
          .get(item.entityType, item.entityId) as { id: number } | undefined;

        if (existing) {
          db.prepare(
            "UPDATE embeddings SET content_hash = ?, text_content = ?, created_at = datetime('now') WHERE id = ?",
          ).run(item.hash, item.text, existing.id);
          // vec0 doesn't support UPDATE — delete + re-insert
          db.prepare('DELETE FROM embeddings_vec WHERE rowid = ?').run(BigInt(existing.id));
          db.prepare('INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)').run(
            BigInt(existing.id),
            new Float32Array(vector),
          );
        } else {
          const info = db
            .prepare(
              'INSERT INTO embeddings (entity_type, entity_id, content_hash, text_content) VALUES (?, ?, ?, ?)',
            )
            .run(item.entityType, item.entityId, item.hash, item.text);
          db.prepare('INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)').run(
            BigInt(info.lastInsertRowid),
            new Float32Array(vector),
          );
        }
      }
    });

    insertOrUpdate();
  }

  const count = (db.prepare('SELECT COUNT(*) as n FROM embeddings').get() as { n: number }).n;
  console.log(`Done — ${count} total embeddings in database.`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
