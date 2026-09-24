/**
 * `listBackgroundTaskEvents` — the lookup that lets the background-task strip
 * show a task that started further back than the transcript's loaded page:
 * the task's lifecycle rows plus the tool call that launched it and its
 * result, for both envelope shapes, and nothing else.
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
    const session = q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local' });
    const other = q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local' });
    let n = 0;
    const at = () => `2026-01-01T00:00:${String(++n).padStart(2, '0')}.000Z`;
    const add = (sessionId: string, source: string, fields: Record<string, unknown>) => {
      const row = q.insertChatEvent({ sessionId, role: 'system', source, createdAt: at(), ...fields } as never);
      expect(row).not.toBeNull();
      return row!;
    };

    const launch = add(session.id, 'tool_call', { role: 'assistant', toolName: 'Bash', externalToolCallId: 'toolu_1', toolInput: { command: 'pnpm dev' } });
    const started = add(session.id, 'system', {
      raw: { type: 'background_task', phase: 'started', taskId: 't1', toolUseId: 'toolu_1', description: 'Dev server', status: 'running' },
    });
    // Plenty of unrelated traffic in between, like a long session.
    for (let i = 0; i < 5; i++) add(session.id, 'agent', { role: 'assistant', content: `note ${i}` });
    const output = add(session.id, 'tool_result', { role: 'tool', externalToolCallId: 'toolu_1', content: 'ready on :3000' });
    // Another task that is not asked for.
    add(session.id, 'system', { raw: { type: 'background_task', phase: 'started', taskId: 't2', description: 'Tests' } });
    // The legacy Claude envelope.
    const legacy = add(session.id, 'system', {
      raw: { type: 'unknown', providerType: 'claude', raw: { subtype: 'task_started', task_id: 't3', description: 'Old style' } },
    });
    // Carries the id but is not a background-task envelope: the decoder rejects it.
    add(session.id, 'system', { raw: { type: 'tool_call', taskId: 't1' } });
    // Same task id in another session.
    add(other.id, 'system', { raw: { type: 'background_task', phase: 'started', taskId: 't1', description: 'Elsewhere' } });

    return { q, sessionId: session.id, launch, started, output, legacy };
  }

  it('returns the lifecycle plus the launching call and its output, oldest first', async () => {
    const { q, sessionId, launch, started, output } = await seed();
    const rows = q.listBackgroundTaskEvents(sessionId, ['t1']);
    expect(rows.map((r) => r.id)).toEqual([launch.id, started.id, output.id]);
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

  it('returns nothing for no ids or unknown ids', async () => {
    const { q, sessionId } = await seed();
    expect(q.listBackgroundTaskEvents(sessionId, [])).toEqual([]);
    expect(q.listBackgroundTaskEvents(sessionId, ['nope'])).toEqual([]);
  });
});
