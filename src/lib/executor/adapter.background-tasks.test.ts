import { beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@agentex/agent';
import {
  _recordBackgroundTaskEvent,
  _resetExecutorState,
  hasBackgroundTasks,
  listBackgroundTaskSessions,
  listBackgroundTaskIds,
  parseStreamEvent,
  persistStreamEvent,
} from './adapter';
import type { EventWriter } from './event-writer';
import { sessionChannel, subscribe } from '@/lib/realtime/bus';
import { listBackgroundTaskSessions as listBackgroundTaskSessionsSnapshot } from './status-snapshot';

function taskEvent(
  phase: 'started' | 'progress' | 'completed',
  status: 'running' | 'completed' | 'failed' | 'stopped',
): StreamEvent {
  return {
    type: 'background_task',
    providerType: 'codex',
    sessionId: 'root-thread',
    messageId: null,
    eventId: `child-1-${phase}`,
    turnId: 'root-turn',
    parentToolCallId: null,
    timestamp: '2026-07-15T20:00:00.000Z',
    phase,
    taskId: 'child-1',
    taskType: 'subagent',
    status,
    description: 'Inspect status handling',
    summary: phase === 'completed' ? 'Inspection complete' : null,
    parentTaskId: null,
    raw: {},
  } as unknown as StreamEvent;
}

describe('executor adapter background-task lifecycle', () => {
  beforeEach(() => {
    _resetExecutorState();
  });

  it('persists normalized lifecycle as hidden system metadata', () => {
    expect(parseStreamEvent('chat-1', taskEvent('started', 'running'))).toMatchObject({
      sessionId: 'chat-1',
      source: 'system',
      content: 'background_task',
      raw: expect.objectContaining({ type: 'background_task', taskId: 'child-1' }),
    });
  });

  it('persists terminal lifecycle as a visible outcome with its summary', () => {
    expect(parseStreamEvent('chat-1', taskEvent('completed', 'completed'))).toMatchObject({
      sessionId: 'chat-1',
      source: 'background_task',
      content: 'Inspection complete',
      toolIsError: false,
      raw: expect.objectContaining({ type: 'background_task', taskId: 'child-1' }),
    });
    expect(parseStreamEvent('chat-1', taskEvent('completed', 'failed'))).toMatchObject({
      source: 'background_task',
      toolIsError: true,
    });
  });

  it('keeps background membership independent from root turn events', () => {
    expect(_recordBackgroundTaskEvent('chat-1', taskEvent('started', 'running'))).toBe(true);
    expect(hasBackgroundTasks('chat-1')).toBe(true);
    expect(listBackgroundTaskIds('chat-1')).toEqual(['child-1']);
    expect(listBackgroundTaskSessions()).toEqual(['chat-1']);
    expect(listBackgroundTaskSessionsSnapshot()).toEqual(['chat-1']);

    expect(_recordBackgroundTaskEvent('chat-1', {
      type: 'result',
      providerType: 'codex',
    })).toBe(false);
    expect(listBackgroundTaskSessions()).toEqual(['chat-1']);

    expect(_recordBackgroundTaskEvent('chat-1', taskEvent('completed', 'completed'))).toBe(true);
    expect(hasBackgroundTasks('chat-1')).toBe(false);
    expect(listBackgroundTaskSessions()).toEqual([]);
  });

  it('does not remove session membership while another child remains active', () => {
    _recordBackgroundTaskEvent('chat-1', taskEvent('started', 'running'));
    expect(_recordBackgroundTaskEvent('chat-1', {
      ...taskEvent('started', 'running'),
      taskId: 'child-2',
    })).toBe(true);

    expect(_recordBackgroundTaskEvent('chat-1', taskEvent('completed', 'completed'))).toBe(true);
    expect(listBackgroundTaskSessions()).toEqual(['chat-1']);
    expect(listBackgroundTaskIds('chat-1')).toEqual(['child-2']);
  });

  it('publishes exact task ids when membership changes without changing active state', () => {
    const frames: Array<{ active: boolean; taskIds: string[] }> = [];
    const unsubscribe = subscribe(sessionChannel('chat-1'), (message) => {
      if (message.kind === 'background_tasks') {
        frames.push({ active: message.active, taskIds: message.taskIds });
      }
    });

    try {
      _recordBackgroundTaskEvent('chat-1', taskEvent('started', 'running'));
      _recordBackgroundTaskEvent('chat-1', {
        ...taskEvent('started', 'running'),
        taskId: 'child-2',
      });
      _recordBackgroundTaskEvent('chat-1', taskEvent('completed', 'completed'));

      expect(frames).toEqual([
        { active: true, taskIds: ['child-1'] },
        { active: true, taskIds: ['child-1', 'child-2'] },
        { active: true, taskIds: ['child-2'] },
      ]);
    } finally {
      unsubscribe();
    }
  });

  it('updates ephemeral membership only for explicitly live persistence', async () => {
    const writer: EventWriter = {
      async write() {},
    };

    await persistStreamEvent('chat-1', taskEvent('started', 'running'), writer);
    expect(hasBackgroundTasks('chat-1')).toBe(false);

    await persistStreamEvent('chat-1', taskEvent('started', 'running'), writer, {
      trackBackgroundTaskRuntime: true,
    });
    expect(hasBackgroundTasks('chat-1')).toBe(true);

    // A durable replay of an older start cannot resurrect a task after its
    // live terminal edge has cleared authoritative runtime membership.
    await persistStreamEvent('chat-1', taskEvent('completed', 'completed'), writer, {
      trackBackgroundTaskRuntime: true,
    });
    expect(hasBackgroundTasks('chat-1')).toBe(false);
    await persistStreamEvent('chat-1', taskEvent('started', 'running'), writer);
    expect(hasBackgroundTasks('chat-1')).toBe(false);
  });
});
