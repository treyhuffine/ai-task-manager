import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from './migrate';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('integration names migration', () => {
  it('preserves scopes, rowids, child links, notification subscriptions and queued deliveries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-migration-'));
    temporary.push(dir);
    fs.mkdirSync(path.join(dir, 'meta'));
    fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [
      { idx: 0, version: '6', when: 1, tag: '0000_before', breakpoints: true },
      { idx: 1, version: '6', when: 2, tag: '0001_names', breakpoints: true },
    ] }));
    fs.writeFileSync(path.join(dir, '0000_before.sql'), `
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, connector_scopes TEXT);
      CREATE TABLE children (workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE);
      CREATE TABLE notification_channels (id TEXT PRIMARY KEY, kind TEXT, events TEXT);
      CREATE TABLE notification_deliveries (id TEXT PRIMARY KEY, channel_id TEXT REFERENCES notification_channels(id), event_type TEXT, dedupe_key TEXT, event TEXT);
      INSERT INTO workspaces(rowid, id, connector_scopes) VALUES (42, 'agent', '[{"toolkitId":"gmail","accounts":[{"accountId":"a"}]}]');
      INSERT INTO children VALUES ('agent');
      INSERT INTO notification_channels(rowid, id, kind, events) VALUES (24, 'telegram', 'connector', '["connector.approval_required","trigger.completed"]'), (25, 'browser', 'web_push', '["connector.approval_required"]');
      INSERT INTO notification_deliveries VALUES ('approval', 'telegram', 'connector.approval_required', 'connector.approval_required:a1', '{"type":"connector.approval_required","dedupeKey":"connector.approval_required:a1","body":"Keep this","other":"connector"}');
    `);
    fs.copyFileSync(path.resolve('drizzle/0006_integration_names.sql'), path.join(dir, '0001_names.sql'));
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      runMigrations(db, dir);
      runMigrations(db, dir);
      expect(db.prepare('SELECT rowid, * FROM workspaces').get()).toEqual({ rowid: 42, id: 'agent', integration_scopes: '[{"toolkitId":"gmail","accounts":[{"accountId":"a"}]}]' });
      expect(db.prepare('SELECT * FROM children').all()).toEqual([{ workspace_id: 'agent' }]);
      expect(db.prepare('SELECT rowid, kind, events FROM notification_channels ORDER BY rowid').all()).toEqual([
        { rowid: 24, kind: 'integration', events: '["integration.approval_required","trigger.completed"]' },
        { rowid: 25, kind: 'web_push', events: '["integration.approval_required"]' },
      ]);
      const delivery = db.prepare('SELECT * FROM notification_deliveries').get() as { event_type: string; dedupe_key: string; event: string };
      expect(delivery.event_type).toBe('integration.approval_required');
      expect(delivery.dedupe_key).toBe('integration.approval_required:a1');
      expect(JSON.parse(delivery.event)).toEqual({ type: 'integration.approval_required', dedupeKey: 'integration.approval_required:a1', body: 'Keep this', other: 'connector' });
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 2 });
    } finally { db.close(); }
  });
});
