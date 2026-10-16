import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import { migrationsFolderUpTo } from '@/test/fixtures/migrations';
import { initDatabase } from './index';
import { inspectMigrationHistory, runMigrations } from './migrate';

it('adds durable coordination without rebuilding populated conversations or their search index', () => {
  const previous = migrationsFolderUpTo('0016_team_ai_auth_mode');
  const db = new Database(':memory:');
  try {
    sqliteVec.load(db);
    initDatabase(db, previous.folder);
    db.exec(`
      INSERT INTO chat_sessions(rowid, id, harness, type, status, permission_mode)
      VALUES (13, 'source', 'claude', 'orchestration', 'active', 'auto_all'),
             (29, 'target', 'claude', 'orchestration', 'active', 'auto_all');
      INSERT INTO chat_events(rowid, id, session_id, role, source, content)
      VALUES (73, 'original', 'source', 'user', 'user', 'Preserve quartz context');
    `);
    const before = db.prepare('SELECT rowid, * FROM chat_events').all();
    const chats = db.prepare('SELECT rowid, * FROM chat_sessions ORDER BY rowid').all();
    const folder = path.resolve(__dirname, '../../../drizzle');
    const pending = inspectMigrationHistory(db, folder).pending.length;
    expect(runMigrations(db, folder)).toEqual({ applied: pending });
    expect(db.prepare('SELECT rowid, * FROM chat_events').all()).toEqual(before);
    expect(db.prepare('SELECT rowid, * FROM chat_sessions ORDER BY rowid').all()).toEqual(chats);
    expect(db.prepare("SELECT rowid FROM chat_events_fts WHERE chat_events_fts MATCH 'quartz'").pluck().all()).toEqual([73]);
    db.exec(`INSERT INTO agent_requests(id, source_session_id, source_address, target_address, target_session_id, request_key, kind, content, status, message_event_id)
      VALUES ('request', 'source', 'orchestrator', 'session:target', 'target', 'same-key', 'question', 'Question', 'queued', 'input');`);
    expect(() => db.exec(`INSERT INTO agent_requests(id, source_session_id, source_address, target_address, request_key, kind, content, status, message_event_id)
      VALUES ('duplicate', 'source', 'orchestrator', 'session:target', 'same-key', 'question', 'Changed question', 'queued', 'other-input');`)).toThrow(/UNIQUE/);
    const columns = db.pragma('table_info(agent_requests)') as Array<{ name: string; dflt_value: unknown; notnull: number }>;
    for (const name of ['kind', 'status']) expect(columns.find(column => column.name === name)?.dflt_value).toBe(null);
    for (const name of ['created_at', 'updated_at']) expect(columns.find(column => column.name === name)?.notnull).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    previous.cleanup();
  }
});
