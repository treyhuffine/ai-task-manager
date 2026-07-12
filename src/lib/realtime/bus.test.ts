import { describe, expect, it } from 'vitest';
import type { ChatEventRecord } from '@/db/types';
import {
  globalSessionChannel,
  publishChatEvent,
  publishReconcileDone,
  publishRuntime,
  subscribe,
  type GlobalSessionStreamMessage,
} from './bus';

describe('global session lifecycle channel', () => {
  it('publishes runtime edges and durable outcomes', () => {
    const updates: GlobalSessionStreamMessage[] = [];
    const unsubscribe = subscribe(globalSessionChannel, (message) => {
      if (message.kind === 'session_updated') updates.push(message);
    });

    try {
      publishRuntime('session-a', true);
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

      expect(updates).toEqual([
        { kind: 'session_updated', sessionId: 'session-a', reason: 'runtime' },
        { kind: 'session_updated', sessionId: 'session-a', reason: 'outcome' },
      ]);
    } finally {
      unsubscribe();
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
