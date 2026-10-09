/**
 * A database built by running every migration matches what `schema.ts`
 * declares: every table and column, its NOT NULL, and every foreign key with
 * its ON DELETE rule.
 *
 * `drizzle-kit generate` only compares `schema.ts` with its own snapshot, not
 * with the SQL it wrote, and its SQLite `ALTER TABLE ... ADD` drops a
 * reference's ON DELETE (drizzle-kit 0.31 and the 1.0 beta). Older migrations
 * restored theirs by hand. Newer ones declare no delete rule on a column added
 * to an existing table, so the generated SQL is right as written. This is the
 * check that the SQL every Home actually runs, however it was written, lands
 * on the schema.
 */

import { is } from 'drizzle-orm';
import { toSnakeCase } from 'drizzle-orm/casing';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as schema from './schema';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

/** A column's name in the database: the app's db uses `casing: 'snake_case'` for names taken from keys. */
const columnName = (column: { name: string; keyAsName: boolean }) => (column.keyAsName ? toSnakeCase(column.name) : column.name);

let home: TestHome;
beforeAll(async () => {
  home = await createTestHome({ prefix: 'ri-schema-conformance-' });
}, 120_000);
afterAll(async () => {
  await home.cleanup();
});

it('builds, migration by migration, exactly the schema schema.ts declares', async () => {
  const { getRawDb } = await import('@/lib/db');
  const sqlite = getRawDb();
  const problems: string[] = [];
  const tables = Object.values(schema as Record<string, unknown>).filter((value): value is SQLiteTable => is(value, SQLiteTable));
  expect(tables.length).toBeGreaterThan(40);

  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = sqlite.pragma(`table_info("${config.name}")`) as Array<{ name: string; notnull: number; pk: number }>;
    if (columns.length === 0) {
      problems.push(`${config.name}: no such table`);
      continue;
    }
    for (const column of config.columns) {
      const name = columnName(column);
      const built = columns.find((c) => c.name === name);
      if (!built) problems.push(`${config.name}.${name}: missing`);
      else if (!built.pk && !!built.notnull !== column.notNull) problems.push(`${config.name}.${name}: NOT NULL is ${!!built.notnull}, schema says ${column.notNull}`);
    }
    for (const built of columns) {
      if (!config.columns.some((c) => columnName(c) === built.name)) problems.push(`${config.name}.${built.name}: not in schema.ts`);
    }

    const keys = sqlite.pragma(`foreign_key_list("${config.name}")`) as Array<{ table: string; from: string; on_delete: string }>;
    const declared = config.foreignKeys.map((key) => {
      const reference = key.reference();
      return {
        from: reference.columns.map(columnName).join(','),
        to: getTableConfig(reference.foreignTable).name,
        onDelete: (key.onDelete ?? 'no action').toUpperCase(),
      };
    });
    for (const key of declared) {
      const built = keys.find((k) => k.from === key.from);
      if (!built) problems.push(`${config.name}.${key.from}: no foreign key to ${key.to}`);
      else if (built.table !== key.to || built.on_delete.toUpperCase() !== key.onDelete) {
        problems.push(`${config.name}.${key.from}: references ${built.table} ON DELETE ${built.on_delete}, schema says ${key.to} ON DELETE ${key.onDelete}`);
      }
    }
    for (const built of keys) {
      if (!declared.some((key) => key.from === built.from)) problems.push(`${config.name}.${built.from}: foreign key not in schema.ts`);
    }
  }
  expect(problems).toEqual([]);
});
