import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import { migrationTags, migrationsFolderUpTo } from '@/test/fixtures/migrations';
import { initDatabase } from './index';
import { runMigrations } from './migrate';

it('adds conversation routing and delivery tables without rewriting chats, rowids or full-text search', () => {
  const previous = migrationsFolderUpTo('0029_misty_ben_urich');
  const db = new Database(':memory:');
  try {
    sqliteVec.load(db); initDatabase(db, previous.folder);
    db.exec(`INSERT INTO chat_sessions(rowid,id,harness,type,status,permission_mode) VALUES (41,'existing','claude','orchestration','active','ask');
      INSERT INTO chat_events(rowid,id,session_id,role,source,content) VALUES (73,'existing-event','existing','assistant','agent','Preserve quartz history');`);
    const applied = db.prepare('SELECT id FROM __drizzle_migrations').all().length;
    expect(runMigrations(db, path.resolve(__dirname, '../../../drizzle')).applied).toBe(migrationTags().length - applied);
    expect(db.prepare("SELECT rowid,content FROM chat_events WHERE id='existing-event'").get()).toEqual({ rowid: 73, content: 'Preserve quartz history' });
    expect(db.prepare("SELECT rowid FROM chat_events_fts WHERE chat_events_fts MATCH 'quartz'").pluck().all()).toEqual([73]);
    for (const table of ['conversation_connections', 'conversation_identities', 'conversation_threads', 'conversation_inputs', 'conversation_outputs']) {
      const columns = db.pragma(`table_info(${table})`) as Array<{ name: string; notnull: number; dflt_value: string | null }>;
      expect(columns.find(column => column.name === 'created_at')?.notnull).toBe(1);
      expect(columns.find(column => column.name === 'updated_at')?.notnull).toBe(1);
      expect(columns.find(column => column.name === 'status')?.dflt_value ?? null).toBeNull();
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { db.close(); previous.cleanup(); }
});
