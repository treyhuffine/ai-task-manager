import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getDb, getRawDb } from '@/lib/db';
import { hydrateRow } from '@/lib/db/hydrate';
import { tasks, notes, stream } from '@/lib/db/schema';
import { computeContentHash, buildEmbeddingText } from './embed';

const BATCH_SIZE = 50;

interface EmbedItem {
  entityType: 'task' | 'note' | 'stream';
  entityId: string;
  text: string;
  hash: string;
}

async function backfill() {
  // Two handles:
  //   - `db` (Drizzle) for the user tables: column-casing translation
  //     produces camelCase records, which `buildEmbeddingText` expects.
  //     Raw `SELECT *` would return snake_case keys and silently produce
  //     empty text for stream rows (no `rawText`), crashing on `.trim()`.
  //   - `rawDb` (better-sqlite3) for the `embeddings` + `embeddings_vec`
  //     tables, which live outside the Drizzle schema (defined in
  //     EXTRA_SQL).
  const db = getDb();
  const rawDb = getRawDb();

  // Rebuild stream_fts content for existing rows — FTS triggers run on
  // the snake_case column names from EXTRA_SQL.
  console.log('Rebuilding stream_fts...');
  try {
    rawDb.exec("INSERT INTO stream_fts(stream_fts) VALUES('rebuild')");
  } catch {
    console.log('stream_fts rebuild skipped (may already be current)');
  }

  // Gather all items to embed
  const items: EmbedItem[] = [];

  const allTasks = db.select().from(tasks).all().map((r) => hydrateRow(r));
  for (const t of allTasks) {
    const text = buildEmbeddingText('task', t);
    if (!text.trim()) continue;
    items.push({ entityType: 'task', entityId: t.id, text, hash: computeContentHash(text) });
  }

  const allNotes = db.select().from(notes).all().map((r) => hydrateRow(r));
  for (const n of allNotes) {
    const text = buildEmbeddingText('note', n);
    if (!text.trim()) continue;
    items.push({ entityType: 'note', entityId: n.id, text, hash: computeContentHash(text) });
  }

  const allStream = db.select().from(stream).all().map((r) => hydrateRow(r));
  for (const s of allStream) {
    const text = buildEmbeddingText('stream', s);
    if (!text.trim()) continue;
    items.push({ entityType: 'stream', entityId: s.id, text, hash: computeContentHash(text) });
  }

  console.log(`Found ${items.length} items to consider (${allTasks.length} tasks, ${allNotes.length} notes, ${allStream.length} stream)`);

  // Filter out items that already have a matching hash
  const toEmbed = items.filter((item) => {
    const existing = rawDb
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

    const insertOrUpdate = rawDb.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const vector = result.embeddings[j];

        const existing = rawDb
          .prepare('SELECT id FROM embeddings WHERE entity_type = ? AND entity_id = ?')
          .get(item.entityType, item.entityId) as { id: number } | undefined;

        if (existing) {
          rawDb.prepare(
            "UPDATE embeddings SET content_hash = ?, text_content = ?, created_at = datetime('now') WHERE id = ?",
          ).run(item.hash, item.text, existing.id);
          // vec0 doesn't support UPDATE — delete + re-insert
          rawDb.prepare('DELETE FROM embeddings_vec WHERE rowid = ?').run(BigInt(existing.id));
          rawDb.prepare('INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)').run(
            BigInt(existing.id),
            new Float32Array(vector),
          );
        } else {
          const info = rawDb
            .prepare(
              'INSERT INTO embeddings (entity_type, entity_id, content_hash, text_content) VALUES (?, ?, ?, ?)',
            )
            .run(item.entityType, item.entityId, item.hash, item.text);
          rawDb.prepare('INSERT INTO embeddings_vec (rowid, embedding) VALUES (?, ?)').run(
            BigInt(info.lastInsertRowid),
            new Float32Array(vector),
          );
        }
      }
    });

    insertOrUpdate();
  }

  const count = (rawDb.prepare('SELECT COUNT(*) as n FROM embeddings').get() as { n: number }).n;
  console.log(`Done — ${count} total embeddings in database.`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
