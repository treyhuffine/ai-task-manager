import type Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prepared = new WeakSet<Database.Database>();

export function assertTestDatabasePath(databasePath: string): void {
  if (!process.env.VITEST) throw new Error('Pending fixture schema requires Vitest.');
  if (databasePath === ':memory:') return;
  // Resolve existing ancestors as well as the file, so a new fixture is safe
  // before bootstrap and a symlink out of the temporary tree is rejected.
  let existing = path.resolve(databasePath);
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('Cannot resolve test database path.');
    existing = parent;
  }
  const canonicalPath = path.join(fs.realpathSync(existing), ...missing);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), canonicalPath);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Pending fixture schema requires a database inside the OS temporary directory.');
  }
}

/**
 * During schema work, Vitest fixtures need the pending handoff tables and
 * nullable preferences before their final migration is generated. Apply these
 * only after normal release bootstrap and only inside throwaway databases.
 * Production boot never imports this, and the release journal stays untouched.
 */
export function applyPendingTestSchema(sqlite: Database.Database): void {
  if (prepared.has(sqlite)) return;
  assertTestDatabasePath(sqlite.name);

  sqlite.transaction(() => {
    sqlite.exec(fs.readFileSync(new URL('./work-result-schema.sql', import.meta.url), 'utf8'));
    for (const [table, column, type] of [
      ['user_state', 'work_result_guidance', 'TEXT'],
      ['workspaces', 'work_result_guidance', 'TEXT'],
      ['workspaces', 'review_before_handoff', 'INTEGER'],
      ['workspaces', 'review_defaults', 'TEXT'],
    ]) {
      const columns = sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === column)) {
        sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`);
      }
    }
  })();
  prepared.add(sqlite);
}
