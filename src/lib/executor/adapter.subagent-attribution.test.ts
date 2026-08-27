import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@agentex/agent';
import { parseStreamEvent } from './adapter';

/**
 * Attribution mapping for nested actors.
 *
 * Claude Code streams a subagent's own events onto the parent session's
 * stream tagged with `parent_tool_use_id`; agentex normalizes that to
 * `parentToolCallId`. The adapter dropped it, so those rows were stored
 * indistinguishable from the session's own replies. Everything downstream —
 * the transcript's final-reply pick, the unread bump, the nested render —
 * keys off the column these tests cover.
 */

function base(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    providerType: 'claude',
    sessionId: 'sess-1',
    messageId: 'msg_01abc',
    eventId: 'uuid-1',
    turnId: null,
    parentToolCallId: null,
    timestamp: '2026-08-25T12:18:33.394Z',
    raw: {},
    ...overrides,
  };
}

const assistant = (overrides: Partial<Record<string, unknown>> = {}): StreamEvent =>
  ({ type: 'assistant', text: 'Let me read the core files.', ...base(overrides) }) as unknown as StreamEvent;

describe('parseStreamEvent nested-actor attribution', () => {
  it('leaves the parent tool call null for the session\'s own output', () => {
    const row = parseStreamEvent('chat-1', assistant());
    expect(row?.source).toBe('agent');
    expect(row?.externalParentToolCallId).toBeNull();
  });

  it('carries the launching tool call id onto a subagent message', () => {
    const row = parseStreamEvent('chat-1', assistant({ parentToolCallId: 'toolu_014YX2' }));
    expect(row?.source).toBe('agent');
    expect(row?.externalParentToolCallId).toBe('toolu_014YX2');
  });

  it('carries the provider message id', () => {
    const row = parseStreamEvent('chat-1', assistant());
    expect(row?.externalMessageId).toBe('msg_01abc');
  });

  it('normalizes an absent message id to null rather than undefined', () => {
    // Codex emits null here; the column must hold null so `is null` filters
    // and the backfill's idempotency check both behave.
    const row = parseStreamEvent('chat-1', assistant({ messageId: null }));
    expect(row?.externalMessageId).toBeNull();
  });

  it('attributes every nested source, not just assistant text', () => {
    // A subagent's thinking and tool work arrive on the same stream and must
    // travel with its transcript, or an expanded subagent shows only prose.
    const thinking = parseStreamEvent(
      'chat-1',
      { type: 'thinking', text: 'considering', ...base({ parentToolCallId: 'toolu_a' }) } as unknown as StreamEvent,
    );
    const call = parseStreamEvent(
      'chat-1',
      {
        type: 'tool_call',
        name: 'Read',
        input: { file_path: '/tmp/a.ts' },
        toolCallId: 'toolu_child',
        ...base({ parentToolCallId: 'toolu_a' }),
      } as unknown as StreamEvent,
    );
    const result = parseStreamEvent(
      'chat-1',
      {
        type: 'tool_result',
        content: 'ok',
        toolCallId: 'toolu_child',
        isError: false,
        ...base({ parentToolCallId: 'toolu_a' }),
      } as unknown as StreamEvent,
    );

    expect(thinking?.externalParentToolCallId).toBe('toolu_a');
    expect(call?.externalParentToolCallId).toBe('toolu_a');
    expect(result?.externalParentToolCallId).toBe('toolu_a');
    // The child's own tool-call id stays distinct from its parent's.
    expect(call?.externalToolCallId).toBe('toolu_child');
  });

  it('keeps a subagent tool call distinguishable from the launch that spawned it', () => {
    // The launch is the session's own action (no parent tag) and its
    // externalToolCallId is what the child's events point back at.
    const launch = parseStreamEvent(
      'chat-1',
      {
        type: 'tool_call',
        name: 'Agent',
        input: { description: 'Find playbank page implementation' },
        toolCallId: 'toolu_014YX2',
        ...base(),
      } as unknown as StreamEvent,
    );
    expect(launch?.externalToolCallId).toBe('toolu_014YX2');
    expect(launch?.externalParentToolCallId).toBeNull();
  });
});
