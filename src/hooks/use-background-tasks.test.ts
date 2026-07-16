import { describe, expect, it } from 'vitest';
import type { ChatEventRecord } from '@/db/types';
import { deriveBackgroundTasks, deriveTaskDetail } from './use-background-tasks';

/**
 * Build a chat-event row mirroring how the adapter stores a Claude background
 * task: agentex surfaces these as `type:"unknown"` / `providerType:"claude"`
 * with the CLI payload nested under `raw` (whose own `subtype` is `task_*`).
 * This matches what `getClaudeTaskDetails` / our `decodeClaudeTask` decode.
 */
function sysTaskEvent(
  subtype: string,
  cli: Record<string, unknown>,
  createdAt: string,
): ChatEventRecord {
  return {
    source: 'system',
    content: subtype,
    raw: {
      type: 'unknown',
      providerType: 'claude',
      subtype: 'system',
      raw: { subtype, ...cli },
    },
    createdAt,
  } as unknown as ChatEventRecord;
}

function otherEvent(source: string, createdAt: string): ChatEventRecord {
  return { source, content: 'hi', raw: {}, createdAt } as unknown as ChatEventRecord;
}

function backgroundTaskEvent(
  providerType: string,
  phase: 'started' | 'progress' | 'completed',
  fields: Record<string, unknown>,
  createdAt: string,
): ChatEventRecord {
  return {
    source: 'system',
    content: 'background_task',
    raw: {
      type: 'background_task',
      providerType,
      phase,
      ...fields,
    },
    createdAt,
  } as unknown as ChatEventRecord;
}

describe('deriveBackgroundTasks', () => {
  it('tracks a running background shell (server) as active', () => {
    const tasks = deriveBackgroundTasks([
      sysTaskEvent(
        'task_started',
        {
          task_id: 't1',
          tool_use_id: 'toolu_1',
          task_type: 'local_bash',
          description: 'next dev -p 4224',
        },
        '2026-06-23T00:00:00.000Z',
      ),
      sysTaskEvent(
        'task_progress',
        { task_id: 't1', usage: { total_tokens: 1200 } },
        '2026-06-23T00:00:01.000Z',
      ),
    ]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskId: 't1',
      toolUseId: 'toolu_1',
      taskType: 'local_bash',
      description: 'next dev -p 4224',
      status: 'running',
      isActive: true,
      totalTokens: 1200,
      startedAt: '2026-06-23T00:00:00.000Z',
    });
  });

  it('tracks a normalized Codex subagent until its terminal lifecycle event', () => {
    const started = backgroundTaskEvent(
      'codex',
      'started',
      {
        taskId: 'child-thread-1',
        taskType: 'subagent',
        status: 'running',
        description: 'Review provider status handling',
        summary: null,
        parentTaskId: null,
      },
      '2026-07-15T20:00:00.000Z',
    );

    expect(deriveBackgroundTasks([started])[0]).toMatchObject({
      taskId: 'child-thread-1',
      providerType: 'codex',
      taskType: 'subagent',
      status: 'running',
      isActive: true,
    });

    const completed = backgroundTaskEvent(
      'codex',
      'completed',
      {
        taskId: 'child-thread-1',
        taskType: 'subagent',
        status: 'completed',
        description: null,
        summary: 'Found the stale rail hydration path.',
        parentTaskId: null,
      },
      '2026-07-15T20:01:00.000Z',
    );
    expect(deriveBackgroundTasks([started, completed])[0]).toMatchObject({
      status: 'completed',
      summary: 'Found the stale rail hydration path.',
      isActive: false,
    });
  });

  it('keeps child work active after a root result until child completion arrives', () => {
    const started = backgroundTaskEvent(
      'claude',
      'started',
      { taskId: 'child-2', taskType: 'subagent', status: 'running' },
      '2026-07-15T20:00:00.000Z',
    );
    const rootResult = {
      source: 'result',
      content: null,
      raw: { type: 'result', providerType: 'claude' },
      createdAt: '2026-07-15T20:00:10.000Z',
    } as unknown as ChatEventRecord;

    expect(deriveBackgroundTasks([started, rootResult])[0]?.isActive).toBe(true);
  });

  it('marks a task completed via task_notification and parses usage', () => {
    const tasks = deriveBackgroundTasks([
      sysTaskEvent(
        'task_started',
        { task_id: 't2', task_type: 'local_agent', description: 'research' },
        '2026-06-23T00:00:00.000Z',
      ),
      sysTaskEvent(
        'task_notification',
        {
          task_id: 't2',
          status: 'completed',
          usage: { total_tokens: 13036, tool_uses: 1, duration_ms: 5406 },
        },
        '2026-06-23T00:00:05.000Z',
      ),
    ]);

    expect(tasks[0]).toMatchObject({
      taskId: 't2',
      status: 'completed',
      isActive: false,
      totalTokens: 13036,
      toolUses: 1,
      durationMs: 5406,
    });
  });

  it('honors a killed status from a task_updated patch', () => {
    const tasks = deriveBackgroundTasks([
      sysTaskEvent('task_started', { task_id: 't3', task_type: 'local_bash' }, '2026-06-23T00:00:00.000Z'),
      sysTaskEvent(
        'task_updated',
        { task_id: 't3', patch: { status: 'killed', end_time: 1782163121494 } },
        '2026-06-23T00:00:02.000Z',
      ),
    ]);

    expect(tasks[0].status).toBe('killed');
    expect(tasks[0].isActive).toBe(false);
  });

  it('sorts active tasks before terminal ones, newest first within a group', () => {
    const tasks = deriveBackgroundTasks([
      sysTaskEvent('task_started', { task_id: 'done', task_type: 'local_agent' }, '2026-06-23T00:00:00.000Z'),
      sysTaskEvent('task_notification', { task_id: 'done', status: 'completed' }, '2026-06-23T00:00:01.000Z'),
      sysTaskEvent('task_started', { task_id: 'live', task_type: 'local_bash' }, '2026-06-23T00:00:02.000Z'),
    ]);

    expect(tasks.map((t) => t.taskId)).toEqual(['live', 'done']);
    expect(tasks[0].isActive).toBe(true);
  });

  it('ignores non-task system events and non-system events', () => {
    const tasks = deriveBackgroundTasks([
      // an `init` system event (type:unknown but subtype not task_*)
      {
        source: 'system',
        content: 'init',
        raw: { type: 'unknown', providerType: 'claude', subtype: 'system', raw: { subtype: 'init' } },
        createdAt: '2026-06-23T00:00:00.000Z',
      } as unknown as ChatEventRecord,
      otherEvent('agent', '2026-06-23T00:00:01.000Z'),
      otherEvent('tool_call', '2026-06-23T00:00:02.000Z'),
    ]);
    expect(tasks).toHaveLength(0);
  });

  it('derives command, output, and timeline for a task (no file watcher)', () => {
    const events: ChatEventRecord[] = [
      { source: 'tool_call', externalToolCallId: 'toolu_9', toolInput: { command: 'next dev -p 4224' }, createdAt: '2026-06-23T00:00:00.000Z' } as unknown as ChatEventRecord,
      sysTaskEvent('task_started', { task_id: 'tD', tool_use_id: 'toolu_9', task_type: 'local_bash', description: 'next dev' }, '2026-06-23T00:00:00.100Z'),
      sysTaskEvent('task_progress', { task_id: 'tD' }, '2026-06-23T00:00:01.000Z'),
      sysTaskEvent('task_notification', { task_id: 'tD', status: 'completed' }, '2026-06-23T00:00:02.000Z'),
      { source: 'tool_result', externalToolCallId: 'toolu_9', content: 'Listening on :4224', toolIsError: false, createdAt: '2026-06-23T00:00:02.100Z' } as unknown as ChatEventRecord,
    ];
    const task = deriveBackgroundTasks(events)[0];
    const detail = deriveTaskDetail(events, task);

    expect(detail.command).toBe('next dev -p 4224');
    expect(detail.output).toBe('Listening on :4224');
    expect(detail.outputIsError).toBe(false);
    expect(detail.updates.map((u) => u.phase)).toEqual(['started', 'progress', 'notification']);
    expect(detail.updates.at(-1)?.status).toBe('completed');
  });
});
