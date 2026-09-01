import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { ensureTmpDir } from '../../src/lib/config/paths';
import { getDb } from '../../src/lib/db';
import { tasks } from '../../src/lib/db/schema';
import type { TriageOutput } from '../../src/lib/triage/llm';

const INPUT_PATH = path.join(ensureTmpDir(), 'retriage.json');

const args = process.argv.slice(2);
const apply = args.includes('--apply');

if (!fs.existsSync(INPUT_PATH)) {
  console.error(`Missing ${INPUT_PATH}. Run \`pnpm db:retriage\` first.`);
  process.exit(1);
}

const triageData: TriageOutput = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
const triagedIds = Object.entries(triageData)
  .sort((a, b) => a[1].position - b[1].position)
  .map(([id]) => id);

if (triagedIds.length === 0) {
  console.log('Empty triage file, nothing to apply.');
  process.exit(0);
}

const db = getDb();

const liveRows = db
  .select({
    id: tasks.id,
    title: tasks.title,
    energy: tasks.energy,
    sortKey: tasks.sortKey,
    status: tasks.status,
  })
  .from(tasks)
  .all();

const liveById = new Map(liveRows.map((r) => [r.id, r]));

const stillActive = triagedIds.filter((id) => {
  const row = liveById.get(id);
  // "Still active" = not terminal (the old `active` covered everything except
  // done/archived; that is now the open set consider|todo|in_progress).
  return row && row.status !== 'done' && row.status !== 'archived';
});
const skipped = triagedIds.length - stillActive.length;

// Generate fresh sort_keys top-down for the active set in triage order.
const newSortKeys = new Map<string, string>();
let prev: string | null = null;
for (const id of stillActive) {
  const key = generateKeyBetween(prev, null);
  newSortKeys.set(id, key);
  prev = key;
}

// Energy: only fill nulls, never overwrite user edits.
const energyUpdates: Array<{ id: string; energy: 'deep' | 'light' }> = [];
for (const id of stillActive) {
  const row = liveById.get(id)!;
  const proposed = triageData[id]?.energy;
  if (!row.energy && proposed) energyUpdates.push({ id, energy: proposed });
}

// Active tasks not in the triage file (created since triage ran).
const triagedSet = new Set(stillActive);
const orphaned = liveRows.filter((r) => r.status !== 'done' && r.status !== 'archived' && !triagedSet.has(r.id));

console.log('--- Plan ---');
console.log(`  Triaged tasks still active: ${stillActive.length}`);
if (skipped > 0) console.log(`  Skipped (no longer active or deleted): ${skipped}`);
if (orphaned.length > 0) {
  console.log(`  Active tasks NOT in triage file (will be left untouched): ${orphaned.length}`);
  for (const r of orphaned.slice(0, 5)) {
    console.log(`    - ${r.title.slice(0, 70)} (sortKey=${r.sortKey ?? 'null'})`);
  }
  if (orphaned.length > 5) console.log(`    ... and ${orphaned.length - 5} more`);
}
console.log(`  sortKey updates: ${stillActive.length}`);
console.log(`  energy fills (null → value): ${energyUpdates.length}`);

console.log('\nTop 10 of new order:');
for (let i = 0; i < Math.min(10, stillActive.length); i++) {
  const id = stillActive[i];
  const row = liveById.get(id)!;
  const oldKey = row.sortKey ?? 'null';
  const newKey = newSortKeys.get(id)!;
  const tier = triageData[id]?.tier;
  console.log(`  ${String(i + 1).padStart(3)}. [${tier}] ${row.title.slice(0, 60)}`);
  console.log(`       ${oldKey} → ${newKey}`);
}

if (!apply) {
  console.log('\n(dry-run) Pass --apply to write changes.');
  process.exit(0);
}

console.log('\nApplying...');
db.transaction((tx) => {
  for (const id of stillActive) {
    tx.update(tasks).set({ sortKey: newSortKeys.get(id)! }).where(eq(tasks.id, id)).run();
  }
  for (const { id, energy } of energyUpdates) {
    tx.update(tasks).set({ energy }).where(eq(tasks.id, id)).run();
  }
});
console.log(`  Updated sortKey on ${stillActive.length} tasks`);
console.log(`  Filled energy on ${energyUpdates.length} tasks`);
console.log('Done.');
