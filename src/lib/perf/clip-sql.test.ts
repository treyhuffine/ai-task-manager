import { describe, expect, it } from 'vitest';
import { clipSql } from './recorder';

describe('clipSql', () => {
  it("folds Drizzle's full column list so the FROM and WHERE survive the clip", () => {
    const columns = Array.from({ length: 22 }, (_, i) => `"column_${i}"`).join(', ');
    const sql = `select ${columns} from "chat_events" where "chat_events"."session_id" = ? and "chat_events"."source" in (?, ?)`;
    expect(clipSql(sql)).toBe('select … from "chat_events" where "chat_events"."session_id" = ? and "chat_events"."source" in (?, ?)');
  });

  it('folds a joined, table-qualified list, and keeps DISTINCT', () => {
    expect(clipSql('select distinct "tasks"."id", "tasks"."title", "areas"."name", "areas"."id" as "area_id" from "tasks" left join "areas" on 1'))
      .toBe('select distinct … from "tasks" left join "areas" on 1');
  });

  it('leaves a short list, and hand-written SQL, as they are', () => {
    expect(clipSql('select "id", "title" from "tasks" where "id" = ?')).toBe('select "id", "title" from "tasks" where "id" = ?');
    expect(clipSql('SELECT s.id AS sessionId, s.label AS label FROM chat_sessions s')).toBe('SELECT s.id AS sessionId, s.label AS label FROM chat_sessions s');
    expect(clipSql('PRAGMA foreign_key_check')).toBe('PRAGMA foreign_key_check');
  });

  it('flattens whitespace and clips what is still too long', () => {
    expect(clipSql('SELECT\n  1\n')).toBe('SELECT 1');
    expect(clipSql(`SELECT '${'x'.repeat(500)}'`)).toHaveLength(401);
  });
});
