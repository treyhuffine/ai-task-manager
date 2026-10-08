import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations, inspectMigrationHistory } from './migrate';
import { applyPendingTestSchema } from '@/test/pending-schema';

// Exercise the pending feature schema on top of the unchanged released main
// history. Fixture DDL is test-only, and never claims a migration was shipped.
const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
const fixtureTables = ['work_results', 'work_result_tasks', 'work_result_decisions', 'work_result_ai_reviews'] as const;
const expectedIndexes = [
  'idx_work_results_source_chat',
  'idx_work_results_source_execution',
  'idx_work_results_user',
  'uniq_work_results_successor',
  'uniq_work_result_tasks_pair',
  'idx_work_result_tasks_task',
  'idx_work_result_decisions_result',
  'uniq_work_result_decision_feedback',
  'work_result_ai_reviews_reportResultId_unique',
  'idx_work_result_ai_reviews_result',
  'idx_work_result_ai_reviews_session',
  'idx_work_result_ai_reviews_run',
  'uniq_work_result_ai_review_active',
].sort();

type SqlRow = Record<string, string | number | null>;
let dir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-work-result-rename-'));
  sqlite = new Database(path.join(dir, 'test.db'));
  sqlite.pragma('foreign_keys = ON');
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function releaseJournal() {
  return JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
}

function insert(table: string, row: SqlRow) {
  const columns = Object.keys(row).map((column) => `"${column}"`).join(', ');
  const placeholders = Object.keys(row).map(() => '?').join(', ');
  sqlite.prepare(`INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`).run(...Object.values(row));
}

function row(table: string, id: string): SqlRow {
  return sqlite.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) as SqlRow;
}

function rows(table: string) {
  return sqlite.prepare(`SELECT rowid, * FROM "${table}" ORDER BY id`).all();
}

function releasedFixture() {
  expect(runMigrations(sqlite, migrationsFolder)).toEqual({ applied: releaseJournal().entries.length });
  applyPendingTestSchema(sqlite);

  for (const id of ['actor', 'source', 'event-source', 'feedback', 'reviewer']) {
    insert('chat_sessions', { id, harness: 'codex', type: 'orchestration', status: 'active', permission_mode: 'ask' });
  }
  insert('workspaces', {
    id: 'workspace', name: 'Migration fixture', slug: 'migration-fixture', cwd: dir,
    is_git: 0, files_to_copy: '[]', collapsed: 0, skip_live_confirm: 0, browser_enabled: 0, status: 'active',
  });
  insert('executions', { id: 'execution', workspace_id: 'workspace', status: 'active' });
  insert('runs', { id: 'run', harness: 'codex', trigger_kind: 'manual', status: 'completed' });
  insert('chat_events', { id: 'source-event', session_id: 'event-source', role: 'assistant', source: 'harness', content: 'Retained outcome' });
  insert('chat_events', { id: 'feedback-message', session_id: 'feedback', role: 'user', source: 'human', content: 'Please preserve this feedback' });
  insert('tasks', { id: 'task', raw_input: 'Verify migration', title: 'Verify migration', status: 'todo' });

  const attachment = {
    file_name: '0199d70b-9b00-7000-8000-000000000001.md', original_name: 'inspection.md',
    mime_type: 'text/markdown', size: 128, uploaded_at: '2026-10-08T12:34:56.000Z',
  };
  const snapshot: SqlRow = {
    rowid: 41, id: 'snapshot', created_at: '2026-10-07 10:11:12', updated_at: '2026-10-08 12:34:56',
    user_id: 'local', actor_source: 'ai', actor_user_id: 'local', actor_session_id: 'actor',
    source_chat_session_id: 'source', source_execution_id: 'execution', source_event_id: 'source-event',
    request_hash: 'snapshot-request', title: 'Original inspection', body: '# Retained snapshot\n\nExact original body.',
    attention: 'Review the attachment', attachments: JSON.stringify([attachment]),
    links: JSON.stringify([{ url: 'https://example.test/preview', label: 'Preview' }]),
    code_revision: JSON.stringify({ commit: 'abc123', branch: 'migration-test', executionId: 'execution' }),
    supersedes_id: null,
  };
  insert('work_results', snapshot);
  insert('work_results', { ...snapshot, rowid: 88, id: 'successor', request_hash: 'successor-request', body: 'Corrected inspection', supersedes_id: 'snapshot' });
  insert('work_results', { ...snapshot, rowid: 177, id: 'report', request_hash: 'report-request', title: 'AI review report', body: 'Retained AI report' });
  insert('work_result_tasks', { rowid: 52, id: 'association', result_id: 'snapshot', task_id: 'task' });
  insert('work_result_decisions', {
    rowid: 67, id: 'decision', created_at: '2026-10-08 12:35:00', updated_at: '2026-10-08 12:36:00',
    user_id: 'local', result_id: 'snapshot', request_hash: 'decision-request', disposition: 'changes_requested',
    actor_source: 'human', actor_user_id: 'local', actor_session_id: 'actor', note: 'Retain the selected inspection',
    feedback_session_id: 'feedback', feedback_message_id: 'feedback-message', attachments: JSON.stringify([attachment]),
    context: JSON.stringify({ reviewId: 'ai-review', attachmentFileName: attachment.file_name, previewTargetId: 'preview-target' }),
  });
  const review: SqlRow = {
    rowid: 233, id: 'ai-review', created_at: '2026-10-08 12:35:01', updated_at: '2026-10-08 12:36:01',
    user_id: 'local', result_id: 'snapshot', actor_source: 'human', actor_user_id: 'local', actor_session_id: 'actor',
    request_hash: 'review-request', focus: 'Migration integrity', brief: 'Inspect the retained evidence',
    selection: JSON.stringify({ attachmentFileNames: [attachment.file_name], previewTargetIds: ['preview-target'] }),
    scope: JSON.stringify({ executionId: 'execution', sourceChatSessionId: 'source' }),
    provenance: JSON.stringify({ authorSessionId: 'actor', reviewerSessionId: 'reviewer', runtimeRunId: 'run' }),
    reviewer_session_id: 'reviewer', run_id: 'run', report_result_id: 'report', status: 'completed', status_reason: 'Inspection complete',
  };
  insert('work_result_ai_reviews', review);
  insert('work_result_ai_reviews', { ...review, rowid: 301, id: 'active-review', result_id: 'successor', request_hash: 'active-request', report_result_id: null, status: 'queued' });
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
}

function applyFixtureSchema() {
  applyPendingTestSchema(sqlite);
  expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
}

function foreignKeys(table: string) {
  return (sqlite.pragma(`foreign_key_list("${table}")`) as Array<{
    table: string; from: string; to: string; on_delete: string;
  }>).map(({ table: parent, from, to, on_delete }) => ({ parent, from, to, onDelete: on_delete }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

function assertFixtureIndexes() {
  const tables = [...fixtureTables];
  const indexes = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name IN (${tables.map(() => '?').join(', ')})`)
    .pluck().all(...tables);
  expect(indexes.sort()).toEqual(expectedIndexes);
}

describe('pending work result database fixture', () => {
  it('keeps retained rows, sparse rowids, all 15 foreign keys, indexes, and release journal through fixture retries', () => {
    releasedFixture();
    const before = fixtureTables.map((name) => ({ rows: rows(name), foreignKeys: foreignKeys(name) }));
    const journalBefore = sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY rowid').all();
    expect(before.reduce((count, table) => count + table.foreignKeys.length, 0)).toBe(15);

    applyFixtureSchema();

    for (const [index, name] of fixtureTables.entries()) {
      expect(rows(name)).toEqual(before[index].rows);
      expect(foreignKeys(name)).toEqual(before[index].foreignKeys);
    }
    expect(JSON.parse(row('work_result_decisions', 'decision').context as string)).toEqual({
      reviewId: 'ai-review', attachmentFileName: '0199d70b-9b00-7000-8000-000000000001.md', previewTargetId: 'preview-target',
    });
    assertFixtureIndexes();
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY rowid').all()).toEqual(journalBefore);
    expect(inspectMigrationHistory(sqlite, migrationsFolder).pending).toEqual([]);
    expect(runMigrations(sqlite, migrationsFolder)).toEqual({ applied: 0 });
    for (const [index, name] of fixtureTables.entries()) expect(rows(name)).toEqual(before[index].rows);
  });

  it('preserves populated released user and agent records while adding nullable preferences', () => {
    runMigrations(sqlite, migrationsFolder);
    insert('areas', { rowid: 73, id: 'area', name: 'Active area', status: 'active' });
    insert('user_state', { id: 1, description: 'About the owner', active_area_id: 'area' });
    insert('workspaces', {
      rowid: 241, id: 'agent', name: 'Agent', slug: 'agent', cwd: dir, is_git: 0,
      files_to_copy: '[]', collapsed: 0, skip_live_confirm: 0, browser_enabled: 0,
      status: 'active', instructions: 'Standing instructions stay distinct.',
    });
    const ownerBefore = rows('user_state');
    const agentBefore = rows('workspaces');
    const foreignKeysBefore = foreignKeys('user_state');
    const journalBefore = sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY rowid').all();

    applyFixtureSchema();

    expect(rows('user_state')).toEqual(ownerBefore.map((r) => ({ ...(r as SqlRow), work_result_guidance: null })));
    expect(rows('workspaces')).toEqual(agentBefore.map((r) => ({
      ...(r as SqlRow), work_result_guidance: null, review_before_handoff: null, review_defaults: null,
    })));
    expect(foreignKeys('user_state')).toEqual(foreignKeysBefore);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY rowid').all()).toEqual(journalBefore);
  });

  it('preserves SET NULL provenance and feedback plus task-association CASCADE behavior', () => {
    releasedFixture();
    applyFixtureSchema();
    const snapshot = row('work_results', 'snapshot');
    const decision = row('work_result_decisions', 'decision');
    const review = row('work_result_ai_reviews', 'ai-review');

    sqlite.prepare('DELETE FROM chat_sessions WHERE id = ?').run('actor');
    expect(row('work_results', 'snapshot').actor_session_id).toBeNull();
    expect(row('work_result_decisions', 'decision').actor_session_id).toBeNull();
    expect(row('work_result_ai_reviews', 'ai-review').actor_session_id).toBeNull();
    sqlite.prepare('DELETE FROM chat_sessions WHERE id = ?').run('source');
    expect(row('work_results', 'snapshot').source_chat_session_id).toBeNull();
    sqlite.prepare('DELETE FROM chat_events WHERE id = ?').run('source-event');
    expect(row('work_results', 'snapshot').source_event_id).toBeNull();
    sqlite.prepare('DELETE FROM executions WHERE id = ?').run('execution');
    expect(row('work_results', 'snapshot').source_execution_id).toBeNull();
    sqlite.prepare('DELETE FROM chat_sessions WHERE id = ?').run('feedback');
    expect(row('work_result_decisions', 'decision').feedback_session_id).toBeNull();
    expect(row('work_result_decisions', 'decision').feedback_message_id).toBe('feedback-message');
    sqlite.prepare('DELETE FROM chat_sessions WHERE id = ?').run('reviewer');
    expect(row('work_result_ai_reviews', 'ai-review').reviewer_session_id).toBeNull();
    sqlite.prepare('DELETE FROM runs WHERE id = ?').run('run');
    expect(row('work_result_ai_reviews', 'ai-review').run_id).toBeNull();
    sqlite.prepare('DELETE FROM tasks WHERE id = ?').run('task');
    expect(rows('work_result_tasks')).toEqual([]);

    expect(row('work_results', 'snapshot')).toEqual({ ...snapshot, actor_session_id: null, source_chat_session_id: null, source_event_id: null, source_execution_id: null });
    expect(row('work_result_decisions', 'decision')).toEqual({ ...decision, actor_session_id: null, feedback_session_id: null });
    expect(row('work_result_ai_reviews', 'ai-review')).toEqual({ ...review, actor_session_id: null, reviewer_session_id: null, run_id: null });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps each retained-result RESTRICT relationship and every unique/check guard', () => {
    releasedFixture();
    applyFixtureSchema();

    // Isolate each RESTRICT relationship so another child cannot mask its loss.
    for (const keeper of ['successor', 'association', 'decision', 'ai-review', 'report']) {
      sqlite.exec('SAVEPOINT restrict_guard');
      try {
        if (keeper !== 'association') sqlite.exec('DELETE FROM work_result_tasks');
        if (keeper !== 'decision') sqlite.exec('DELETE FROM work_result_decisions');
        sqlite.prepare('DELETE FROM work_result_ai_reviews WHERE id <> ?').run(['ai-review', 'report'].includes(keeper) ? 'ai-review' : '');
        if (keeper !== 'successor') sqlite.prepare('DELETE FROM work_results WHERE id = ?').run('successor');
        expect(() => sqlite.prepare('DELETE FROM work_results WHERE id = ?').run(keeper === 'report' ? 'report' : 'snapshot')).toThrow(/FOREIGN KEY constraint failed/);
      } finally {
        sqlite.exec('ROLLBACK TO restrict_guard');
        sqlite.exec('RELEASE restrict_guard');
      }
    }

    expect(() => insert('work_results', { ...row('work_results', 'successor'), id: 'duplicate-successor' })).toThrow(/UNIQUE constraint failed/);
    expect(() => insert('work_results', { ...row('work_results', 'report'), id: 'self-successor', supersedes_id: 'self-successor' })).toThrow(/CHECK constraint failed/);
    expect(() => insert('work_result_tasks', { ...row('work_result_tasks', 'association'), id: 'duplicate-association' })).toThrow(/UNIQUE constraint failed/);
    expect(() => insert('work_result_decisions', { ...row('work_result_decisions', 'decision'), id: 'duplicate-feedback' })).toThrow(/UNIQUE constraint failed/);
    expect(() => insert('work_result_ai_reviews', { ...row('work_result_ai_reviews', 'ai-review'), id: 'duplicate-report' })).toThrow(/UNIQUE constraint failed/);
    expect(() => insert('work_result_ai_reviews', { ...row('work_result_ai_reviews', 'active-review'), id: 'duplicate-active', status: 'running' })).toThrow(/UNIQUE constraint failed/);
    expect(() => sqlite.prepare('UPDATE work_result_ai_reviews SET report_result_id = result_id WHERE id = ?').run('ai-review')).toThrow(/CHECK constraint failed/);
    expect(() => sqlite.prepare('UPDATE work_result_ai_reviews SET report_result_id = NULL WHERE id = ?').run('ai-review')).toThrow(/CHECK constraint failed/);

    // The partial unique indexes must still allow absent feedback and inactive
    // reviews, rather than accidentally becoming unconditional constraints.
    for (const id of ['unlinked-decision-1', 'unlinked-decision-2']) {
      insert('work_result_decisions', { ...row('work_result_decisions', 'decision'), id, feedback_session_id: null });
    }
    for (const id of ['failed-review-1', 'failed-review-2']) {
      insert('work_result_ai_reviews', { ...row('work_result_ai_reviews', 'active-review'), id, status: 'failed' });
    }
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('builds the pending fixture after released bootstrap without adding a release migration', () => {
    expect(runMigrations(sqlite, migrationsFolder)).toEqual({ applied: releaseJournal().entries.length });
    applyFixtureSchema();
    for (const name of fixtureTables) {
      expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = ?').pluck().get(name)).toBe(name);
    }
    assertFixtureIndexes();
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(inspectMigrationHistory(sqlite, migrationsFolder).pending).toEqual([]);
    expect(runMigrations(sqlite, migrationsFolder)).toEqual({ applied: 0 });
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
