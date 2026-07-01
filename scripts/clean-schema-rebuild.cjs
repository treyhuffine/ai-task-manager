// One-time: rebuild an existing DB (any prior migration state) onto the current
// clean/squashed schema, preserving ALL data. Maps schedules->triggers,
// runs.schedule_id->trigger_id, runs.trigger->trigger_kind, and backfills
// created_at/updated_at. FTS auto-repopulates via triggers during the copy;
// embeddings_vec vectors are copied through the virtual table (NO re-embedding).
//
// Run from the repo root: node scripts/clean-schema-rebuild.cjs <oldDbPath> <newDbPath>
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
const fs = require('fs');

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) { console.error('usage: clean-schema-rebuild.cjs <old> <new>'); process.exit(1); }

// Pull EXTRA_SQL (fts/vec/embeddings/triggers/seed) straight from app source so it never drifts.
const idxSrc = fs.readFileSync('src/lib/db/index.ts', 'utf8');
const m = idxSrc.match(/const EXTRA_SQL = `([\s\S]*?)`;/);
if (!m) { console.error('could not extract EXTRA_SQL from src/lib/db/index.ts'); process.exit(1); }
const EXTRA_SQL = m[1];

for (const f of [newPath, newPath + '-wal', newPath + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);

const db = new Database(newPath);
sqliteVec.load(db);
db.pragma('journal_mode = WAL');
migrate(drizzle(db), { migrationsFolder: 'drizzle' }); // single 0000 (records it as applied)
db.exec(EXTRA_SQL);                                     // fts + triggers + embeddings + embeddings_vec + user_state seed
db.exec(`ATTACH DATABASE ${JSON.stringify(oldPath)} AS src`);
db.pragma('foreign_keys = OFF');

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const oldTables = new Set(db.prepare("SELECT name FROM src.sqlite_master WHERE type='table'").all().map((t) => t.name));
const mainTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' AND name NOT LIKE '%_fts%' AND name NOT LIKE 'embeddings_vec%'")
  .all().map((t) => t.name);

console.log('=== rebuild ' + newPath + ' (from ' + oldPath + ') ===');
let warn = 0;
for (const t of mainTables) {
  let src = t;
  if (t === 'triggers' && !oldTables.has('triggers') && oldTables.has('schedules')) src = 'schedules';
  if (!oldTables.has(src)) { console.log('  ' + t + ': (no source) skipped'); continue; }
  const newCols = db.prepare('PRAGMA table_info(' + q(t) + ')').all().map((c) => c.name);
  const oldSet = new Set(db.prepare('PRAGMA src.table_info(' + q(src) + ')').all().map((c) => c.name));
  const exprs = newCols.map((c) => {
    if (oldSet.has(c)) return q(c);
    if (c === 'trigger_kind' && oldSet.has('trigger')) return q('trigger');
    if (c === 'trigger_id' && oldSet.has('schedule_id') && !oldSet.has('trigger_id')) return q('schedule_id');
    if (c === 'created_at') return "(datetime('now'))";
    if (c === 'updated_at') return oldSet.has('created_at') ? q('created_at') : "(datetime('now'))";
    return 'NULL';
  });
  const verb = t === 'user_state' ? 'INSERT OR REPLACE INTO' : 'INSERT INTO';
  db.prepare(verb + ' main.' + q(t) + ' (' + newCols.map(q).join(',') + ') SELECT ' + exprs.join(',') + ' FROM src.' + q(src)).run();
  const nc = db.prepare('SELECT count(*) c FROM main.' + q(t)).get().c;
  const sc = db.prepare('SELECT count(*) c FROM src.' + q(src)).get().c;
  if (nc !== sc) warn++;
  console.log('  ' + t + (src !== t ? ' (<- ' + src + ')' : '') + ': ' + nc + (nc === sc ? ' ✓' : ' (src=' + sc + ' ⚠)'));
}

let vecN = 0, vecS = 0;
if (oldTables.has('embeddings_vec')) {
  db.prepare('INSERT INTO main.embeddings_vec(rowid, embedding) SELECT rowid, embedding FROM src.embeddings_vec').run();
  vecN = db.prepare('SELECT count(*) c FROM main.embeddings_vec').get().c;
  vecS = db.prepare('SELECT count(*) c FROM src.embeddings_vec').get().c;
}
db.pragma('foreign_keys = ON');
const fk = db.prepare('PRAGMA foreign_key_check').all();
db.exec('DETACH DATABASE src');
db.close();

console.log('  embeddings_vec vectors: ' + vecN + '/' + vecS + (vecN === vecS ? ' ✓' : ' ⚠'));
console.log('  FK violations: ' + fk.length + (fk.length ? ' ⚠ ' + JSON.stringify(fk.slice(0, 3)) : ' ✓'));
console.log(warn || fk.length || vecN !== vecS ? '  RESULT: review warnings above' : '  RESULT: clean ✓');
