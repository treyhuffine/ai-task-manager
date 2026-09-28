import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@agentex/agent';
import { parseStreamEvent } from './adapter';

/**
 * Codex reports a failing turn through its JSON-RPC `error` notification:
 * several "Reconnecting... n/5" retries, then one with no retry left. Only
 * that last one explains why the turn produced nothing, and it used to be
 * stored as a hidden system row, so a failed turn looked like no reply and
 * the user sent the same message again (session 01a0d95d, 2026-09-25).
 */

const codexError = (params: Record<string, unknown>): StreamEvent =>
  ({
    type: 'unknown',
    subtype: 'error',
    providerType: 'codex',
    sessionId: 'thread-1',
    messageId: null,
    eventId: null,
    turnId: 'turn-1',
    parentToolCallId: null,
    timestamp: '2026-09-25T23:21:48.444Z',
    raw: { method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', ...params } },
  }) as unknown as StreamEvent;

describe('Codex error notifications', () => {
  it('keeps a retry hidden', () => {
    const row = parseStreamEvent('chat-1', codexError({
      error: { message: 'Reconnecting... 2/5', additionalDetails: 'stream disconnected before completion' },
      willRetry: true,
    }));
    expect(row?.source).toBe('system');
    expect(row?.content).toBe('error');
  });

  it('shows the error that ends the turn', () => {
    const row = parseStreamEvent('chat-1', codexError({
      error: { message: 'unexpected status 401 Unauthorized: Incorrect API key provided' },
      willRetry: false,
    }));
    expect(row?.source).toBe('error');
    expect(row?.content).toBe('unexpected status 401 Unauthorized: Incorrect API key provided');
  });

  it('adds the details when the message alone is generic', () => {
    const row = parseStreamEvent('chat-1', codexError({
      error: { message: 'stream error', additionalDetails: 'websocket closed by server before response.completed' },
    }));
    expect(row?.source).toBe('error');
    expect(row?.content).toBe('stream error (websocket closed by server before response.completed)');
  });

  it('still says something when Codex sends no message', () => {
    const row = parseStreamEvent('chat-1', codexError({ willRetry: false }));
    expect(row?.source).toBe('error');
    expect(row?.content).toBe('Codex stopped with an error.');
  });
});
