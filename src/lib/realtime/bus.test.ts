import { describe, expect, it } from 'vitest';
import type { ChatEventRecord } from '@/db/types';
import {
  globalSessionChannel,
  publishBackgroundTaskActivity,
  publishChatEvent,
  publishReconcileDone,
  publishRuntime,
  publishSessionTitle,
  sessionChannel,
  subscribe,
  type GlobalSessionStreamMessage,
} from './bus';

describe('global session lifecycle channel', () => {
  it('publishes runtime edges and durable outcomes', () => {
    const updates: GlobalSessionStreamMessage[] = [];
    const backgroundStates: Array<{ active: boolean; taskIds: string[] }> = [];
    const unsubscribe = subscribe(globalSessionChannel, (message) => {
      if (message.kind === 'session_updated') updates.push(message);
    });
    const unsubscribeSession = subscribe(sessionChannel('session-a'), (message) => {
      if (message.kind === 'background_tasks') {
        backgroundStates.push({ active: message.active, taskIds: message.taskIds });
      }
    });

    try {
      publishRuntime('session-a', true);
      publishBackgroundTaskActivity('session-a', true, ['child-1']);
      publishChatEvent({
        id: 'event-agent',
        sessionId: 'session-a',
        source: 'agent',
      } as ChatEventRecord);
      publishChatEvent({
        id: 'event-result',
        sessionId: 'session-a',
        source: 'result',
      } as ChatEventRecord);
      publishChatEvent({
        id: 'event-background',
        sessionId: 'session-a',
        source: 'background_task',
      } as ChatEventRecord);

      expect(updates).toEqual([
        { kind: 'session_updated', sessionId: 'session-a', reason: 'runtime' },
        { kind: 'session_updated', sessionId: 'session-a', reason: 'background_task' },
        { kind: 'session_updated', sessionId: 'session-a', reason: 'outcome' },
        { kind: 'session_updated', sessionId: 'session-a', reason: 'outcome' },
      ]);
      expect(backgroundStates).toEqual([{ active: true, taskIds: ['child-1'] }]);
    } finally {
      unsubscribe();
      unsubscribeSession();
    }
  });

  it('publishes reconcile drift only when rows were replayed', () => {
    const updates: GlobalSessionStreamMessage[] = [];
    const unsubscribe = subscribe(globalSessionChannel, (message) => {
      if (message.kind === 'session_updated') updates.push(message);
    });

    try {
      publishReconcileDone('session-b', 0);
      publishReconcileDone('session-b', 2);

      expect(updates).toEqual([
        { kind: 'session_updated', sessionId: 'session-b', reason: 'reconcile' },
      ]);
    } finally {
      unsubscribe();
    }
  });
});


describe('title metadata refresh', () => {
  it('refreshes the chat and rail without publishing a conversational event', () => {
    const local: string[] = []; const global: GlobalSessionStreamMessage[] = [];
    const stopLocal = subscribe(sessionChannel('title-session'), (message) => local.push(message.kind));
    const stopGlobal = subscribe(globalSessionChannel, (message) => {
      if (message.kind === 'session_updated') global.push(message);
    });
    try {
      publishSessionTitle('title-session');
      expect(local).toEqual(['title_changed']);
      expect(global).toEqual([{ kind: 'session_updated', sessionId: 'title-session', reason: 'title' }]);
    } finally { stopLocal(); stopGlobal(); }
  });
});
