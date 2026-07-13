import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@agentex/agent';
import type { CreateChatEventInput } from '@/db/types';
import { registerAgentRuntimeSecret } from '@/lib/agents/redaction';
import { parseStreamEvent, persistStreamEvent } from './adapter';

function base(type: StreamEvent['type'], patch: Record<string, unknown>): StreamEvent {
  return {
    type,
    providerType: 'opencode',
    sessionId: 'external-session',
    messageId: 'message-1',
    eventId: 'part-1',
    turnId: null,
    parentToolCallId: null,
    timestamp: '2026-07-13T00:00:00.000Z',
    raw: {},
    ...patch,
  } as StreamEvent;
}

describe('OpenCode event persistence', () => {
  it('uses the cumulative part text and replaces repeated text observations', async () => {
    const replacePart = vi.fn(async (event: CreateChatEventInput) => { void event; });
    const write = vi.fn(async (event: CreateChatEventInput) => { void event; });
    await persistStreamEvent('chat-1', base('assistant', {
      text: ' world',
      raw: { id: 'part-1', type: 'text', text: 'Hello world' },
    }), { write, replacePart });

    expect(write).not.toHaveBeenCalled();
    expect(replacePart).toHaveBeenCalledWith(expect.objectContaining({
      externalEventId: 'part-1',
      sourcePartIndex: 0,
      content: 'Hello world',
    }));
  });

  it('keeps a tool call and result with the same OpenCode part ID distinct', () => {
    const call = parseStreamEvent('chat-1', base('tool_call', {
      toolCallId: 'call-1',
      name: 'bash',
      input: { command: 'pwd' },
    }));
    const result = parseStreamEvent('chat-1', base('tool_result', {
      toolCallId: 'call-1',
      toolName: 'bash',
      content: '/repo',
      isError: false,
    }));

    expect(call).toMatchObject({ externalEventId: 'part-1', sourcePartIndex: 0, source: 'tool_call' });
    expect(result).toMatchObject({ externalEventId: 'part-1', sourcePartIndex: 1, source: 'tool_result' });
  });

  it('redacts a registered Cursor key from normalized content and raw event data', async () => {
    const secret = 'cursor-key-do-not-persist';
    registerAgentRuntimeSecret(secret, 'cursor-api-key');
    const write = vi.fn(async (event: CreateChatEventInput) => { void event; });
    await persistStreamEvent('chat-1', {
      type: 'tool_result',
      providerType: 'cursor',
      eventId: 'tool-result-1',
      sessionId: 'cursor-session',
      messageId: null,
      turnId: null,
      parentToolCallId: null,
      timestamp: '2026-07-13T00:00:00.000Z',
      toolCallId: 'call-1',
      toolName: 'shell',
      content: `CURSOR_API_KEY=${secret}`,
      isError: false,
      exitCode: 0,
      raw: { stdout: secret },
    } as StreamEvent, { write });

    const persisted = write.mock.calls[0]![0];
    expect(JSON.stringify(persisted)).not.toContain(secret);
    expect(persisted.content).toContain('[redacted:cursor-api-key]');
  });
});
