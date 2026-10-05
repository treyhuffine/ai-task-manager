/**
 * `listBackgroundTaskEvents` — the lookup that lets the background-task strip
 * show a task that started further back than the transcript's loaded page:
 * the task's lifecycle rows plus the tool call that launched it and its
 * result, for both envelope shapes, and nothing else.
 *
 * Lifecycle rows go through `parseStreamEvent`, as in the app: the lookup
 * narrows on the source and content the parser writes (and a partial index
 * on them), so a fixture shaped any other way would test a row that never
 * exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

describe('listBackgroundTaskEvents', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-queries-bg-tasks-'));
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seed() {
    const q = await import('@/lib/db/queries');
    const { parseStreamEvent } = await import('@/lib/runner/parse');
    const session = q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local' });
    const other = q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local' });
    let n = 0;
    const at = () => `2026-01-01T00:00:${String(++n).padStart(2, '0')}.000Z`;
    const add = (sessionId: string, source: string, fields: Record<string, unknown>) => {
      const row = q.insertChatEvent({ sessionId, role: 'system', source, createdAt: at(), ...fields } as never);
      expect(row).not.toBeNull();
      return row!;
    };
    // A provider event stored exactly as the runner stores it.
    const emit = (sessionId: string, event: Record<string, unknown>) => {
      const input = parseStreamEvent(sessionId, { timestamp: at(), ...event } as never);
      expect(input).not.toBeNull();
      const row = q.insertChatEvent(input!);
      expect(row).not.toBeNull();
      return row!;
    };

    const launch = add(session.id, 'tool_call', { role: 'assistant', toolName: 'Bash', externalToolCallId: 'toolu_1', toolInput: { command: 'pnpm dev' } });
    const started = emit(session.id, {
      type: 'background_task', phase: 'started', taskId: 't1', toolUseId: 'toolu_1', description: 'Dev server', status: 'running',
    });
    // Plenty of unrelated traffic in between, like a long session.
    for (let i = 0; i < 5; i++) add(session.id, 'agent', { role: 'assistant', content: `note ${i}` });
    const output = add(session.id, 'tool_result', { role: 'tool', externalToolCallId: 'toolu_1', content: 'ready on :3000' });
    // Another task that is not asked for.
    emit(session.id, { type: 'background_task', phase: 'started', taskId: 't2', description: 'Tests', status: 'running' });
    // The legacy Claude envelope.
    const legacy = emit(session.id, {
      type: 'unknown', providerType: 'claude', raw: { subtype: 'task_started', task_id: 't3', description: 'Old style' },
    });
    // Carries the id but is not a background-task envelope: the decoder rejects it.
    add(session.id, 'system', { raw: { type: 'tool_call', taskId: 't1' } });
    // Same task id in another session.
    emit(other.id, { type: 'background_task', phase: 'started', taskId: 't1', description: 'Elsewhere', status: 'running' });
    // The task finishes and hands its result back: a visible terminal row.
    const finished = emit(session.id, {
      type: 'background_task', phase: 'completed', taskId: 't1', status: 'completed', summary: 'Dev server stopped',
      report: { summary: 'Dev server stopped', outputFile: null, usage: null },
    });

    return { q, sessionId: session.id, launch, started, output, legacy, finished };
  }

  it('stores lifecycle rows in the shapes the lookup narrows on', async () => {
    const { started, legacy, finished } = await seed();
    expect([started, legacy, finished].map((r) => [r.source, r.content])).toEqual([
      ['system', 'background_task'],
      ['system', 'task_started'],
      ['background_task', 'Dev server stopped'],
    ]);
  });

  it('returns the lifecycle plus the launching call and its output, oldest first', async () => {
    const { q, sessionId, launch, started, output, finished } = await seed();
    const rows = q.listBackgroundTaskEvents(sessionId, ['t1']);
    expect(rows.map((r) => r.id)).toEqual([launch.id, started.id, output.id, finished.id]);
  });

  it('reads the legacy Claude envelope too', async () => {
    const { q, sessionId, legacy } = await seed();
    expect(q.listBackgroundTaskEvents(sessionId, ['t3']).map((r) => r.id)).toEqual([legacy.id]);
  });

  it('only returns what was asked for, from this session', async () => {
    const { q, sessionId } = await seed();
    const rows = q.listBackgroundTaskEvents(sessionId, ['t1', 't3']);
    const descriptions = rows
      .map((r) => (r.raw as { description?: string; raw?: { description?: string } } | null))
      .map((raw) => raw?.description ?? raw?.raw?.description)
      .filter(Boolean);
    expect(descriptions).toEqual(['Dev server', 'Old style']);
  });

  it('narrows to the session\'s lifecycle rows by index before parsing raw', async () => {
    const { q } = await seed();
    const { getRawDb } = await import('@/lib/db');
    const db = getRawDb();
    const prepare = vi.spyOn(db, 'prepare');
    q.listBackgroundTaskEvents('any-session', ['t1']);
    const sql = prepare.mock.calls.map(([s]) => s).find((s) => s.includes('json_extract'));
    prepare.mockRestore();
    expect(sql).toBeDefined();
    const params = Array((sql!.match(/\?/g) ?? []).length).fill('x');
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail);
    expect(plan[0]).toBe('SEARCH chat_events USING INDEX idx_chat_events_background_task (session_id=?)');
  });

  it('returns nothing for no ids or unknown ids', async () => {
    const { q, sessionId } = await seed();
    expect(q.listBackgroundTaskEvents(sessionId, [])).toEqual([]);
    expect(q.listBackgroundTaskEvents(sessionId, ['nope'])).toEqual([]);
  });
});
