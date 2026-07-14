import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('external session import migration', () => {
  let root: string | null = null;
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  it('backfills legacy imports and qualifies live ids by provider', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-import-migration-'));
    sqlite = new Database(path.join(root, 'legacy.db'));
    sqlite.pragma('foreign_keys = ON');

    for (const migration of [
      '0000_brave_daredevil.sql',
      '0001_silky_wolfsbane.sql',
      '0002_fine_sphinx.sql',
      '0003_tranquil_leader.sql',
    ]) {
      sqlite.exec(fs.readFileSync(path.join(process.cwd(), 'drizzle', migration), 'utf8')
        .replaceAll('--> statement-breakpoint', ''));
    }

    sqlite.exec(`
      INSERT INTO agents (id, kind, name, harness)
      VALUES ('agent-claude', 'executor', 'Claude', 'claude_code');
      INSERT INTO agents (id, kind, name, harness)
      VALUES ('agent-codex', 'executor', 'Codex', 'codex');
      INSERT INTO chat_sessions (
        id, agent_id, type, surface_kind, surface_ref, status,
        external_session_id, external_transcript_path, external_sync_offset,
        external_sync_last_event_id
      ) VALUES (
        'imported-chat', 'agent-claude', 'execution', 'imported_agent', 'claude', 'archived',
        'legacy-import-id', '/tmp/legacy.jsonl', 2048, 'legacy-last-event'
      );
      INSERT INTO chat_sessions (id, agent_id, type, status, external_session_id)
      VALUES ('live-claude', 'agent-claude', 'execution', 'active', 'provider-owned-id');
    `);

    sqlite.exec(fs.readFileSync(
      path.join(process.cwd(), 'drizzle', '0004_broad_rachel_grey.sql'),
      'utf8',
    ).replaceAll('--> statement-breakpoint', ''));

    const ledger = sqlite.prepare(`
      SELECT * FROM external_session_imports WHERE chat_session_id = 'imported-chat'
    `).get() as Record<string, unknown>;
    expect(ledger).toMatchObject({
      provider_type: 'claude',
      external_session_id: 'legacy-import-id',
      source_kind: 'file',
      source_path: '/tmp/legacy.jsonl',
      source_size: 2048,
      sync_offset: 2048,
      sync_last_event_id: 'legacy-last-event',
      source_content_sha256: null,
      status: 'current',
    });

    const imported = sqlite.prepare(`
      SELECT external_provider_type, external_session_id, external_transcript_path,
        external_sync_offset, external_sync_last_event_id
      FROM chat_sessions WHERE id = 'imported-chat'
    `).get() as Record<string, unknown>;
    expect(imported).toEqual({
      external_provider_type: null,
      external_session_id: null,
      external_transcript_path: null,
      external_sync_offset: null,
      external_sync_last_event_id: null,
    });

    expect(sqlite.prepare(`
      SELECT external_provider_type FROM chat_sessions WHERE id = 'live-claude'
    `).pluck().get()).toBe('claude');

    expect(() => sqlite!.exec(`
      INSERT INTO chat_sessions (id, agent_id, type, status, external_provider_type, external_session_id)
      VALUES ('live-codex', 'agent-codex', 'execution', 'active', 'codex', 'provider-owned-id');
    `)).not.toThrow();
    expect(() => sqlite!.exec(`
      INSERT INTO chat_sessions (id, agent_id, type, status, external_provider_type, external_session_id)
      VALUES ('live-claude-duplicate', 'agent-claude', 'execution', 'active', 'claude', 'provider-owned-id');
    `)).toThrow(/UNIQUE constraint failed/);
  });
});
