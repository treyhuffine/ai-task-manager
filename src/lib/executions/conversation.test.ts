import { describe, expect, it } from 'vitest';
import type { ChatEventRecord } from '@/db/types';
import {
  NO_RESPONSE_REQUESTED,
  conversationText,
  pickConversationMessages,
} from './conversation';

let seq = 0;

/**
 * Synthetic event factory — only `source` and `content` matter here.
 * Everything else gets a stable dummy so a schema change forces an
 * explicit update in one place.
 */
function ev(source: string, content: string | null): ChatEventRecord {
  seq += 1;
  const id = `e${seq}`;
  return {
    id,
    createdAt: `2026-07-30T00:00:${String(seq).padStart(2, '0')}Z`,
    updatedAt: `2026-07-30T00:00:${String(seq).padStart(2, '0')}Z`,
    sessionId: 's1',
    role: source === 'user' ? 'user' : 'assistant',
    source,
    content,
    toolName: null,
    toolInput: null,
    toolIsError: null,
    toolExitCode: null,
    raw: null,
    externalEventId: null,
    externalMessageId: null,
    externalTurnId: null,
    externalToolCallId: null,
    externalParentToolCallId: null,
    sourcePartIndex: 0,
    attachments: [],
  };
}

const ids = (events: ChatEventRecord[]) => events.map((e) => e.id);

describe('conversationText', () => {
  it('strips file markers and trims', () => {
    expect(conversationText({ content: '  [[file:abc.png]] look at this  ' })).toBe(
      'look at this',
    );
  });

  it('handles null content', () => {
    expect(conversationText({ content: null })).toBe('');
  });

  it('collapses whitespace left before a newline', () => {
    expect(conversationText({ content: 'one [[file:a.txt]]\ntwo' })).toBe('one\ntwo');
  });
});

describe('pickConversationMessages', () => {
  it('drops thinking, tool calls, tool results, system and result events', () => {
    const events = [
      ev('system', 'init'),
      ev('user', 'fix the bug'),
      ev('thinking', 'hmm'),
      ev('tool_call', null),
      ev('tool_result', 'ok'),
      ev('agent', 'Fixed it.'),
      ev('result', null),
    ];
    const picked = pickConversationMessages(events, 10);
    expect(picked.map((e) => e.source)).toEqual(['user', 'agent']);
    expect(picked.map((e) => e.content)).toEqual(['fix the bug', 'Fixed it.']);
  });

  it('keeps only the final agent message of a turn', () => {
    const events = [
      ev('user', 'ship it'),
      ev('agent', 'Let me check the schema...'),
      ev('tool_call', null),
      ev('agent', 'Found it, updating now...'),
      ev('tool_call', null),
      ev('agent', 'Done, all tests pass.'),
    ];
    const picked = pickConversationMessages(events, 10);
    expect(picked.map((e) => e.content)).toEqual(['ship it', 'Done, all tests pass.']);
  });

  it('keeps one final reply per turn across multiple turns, in order', () => {
    const events = [
      ev('user', 'q1'),
      ev('agent', 'narration 1'),
      ev('agent', 'a1'),
      ev('user', 'q2'),
      ev('agent', 'narration 2'),
      ev('agent', 'a2'),
    ];
    const picked = pickConversationMessages(events, 10);
    expect(picked.map((e) => e.content)).toEqual(['q1', 'a1', 'q2', 'a2']);
  });

  it('falls back to the last non-empty agent message when the turn ends blank', () => {
    const events = [
      ev('user', 'q'),
      ev('agent', 'the real answer'),
      ev('agent', '   '),
      ev('agent', null),
    ];
    const picked = pickConversationMessages(events, 10);
    expect(picked.map((e) => e.content)).toEqual(['q', 'the real answer']);
  });

  it('skips the synthetic no-response placeholder', () => {
    const events = [
      ev('user', 'q'),
      ev('agent', 'the real answer'),
      ev('agent', NO_RESPONSE_REQUESTED),
    ];
    const picked = pickConversationMessages(events, 10);
    expect(picked.map((e) => e.content)).toEqual(['q', 'the real answer']);
  });

  it('keeps an attachment-only user message even though its text is empty', () => {
    const events = [ev('user', '[[file:shot.png]]'), ev('agent', 'Nice screenshot.')];
    const picked = pickConversationMessages(events, 10);
    expect(picked.map((e) => e.source)).toEqual(['user', 'agent']);
  });

  it('tail-slices to the limit so the newest messages survive', () => {
    const events = [
      ev('user', 'q1'),
      ev('agent', 'a1'),
      ev('user', 'q2'),
      ev('agent', 'a2'),
      ev('user', 'q3'),
      ev('agent', 'a3'),
    ];
    expect(pickConversationMessages(events, 3).map((e) => e.content)).toEqual([
      'a2',
      'q3',
      'a3',
    ]);
  });

  it('returns nothing for a zero limit', () => {
    const events = [ev('user', 'q'), ev('agent', 'a')];
    expect(pickConversationMessages(events, 0)).toEqual([]);
  });

  it('handles an agent-only stream with no user turn', () => {
    const events = [ev('agent', 'narration'), ev('tool_call', null), ev('agent', 'summary')];
    expect(pickConversationMessages(events, 10).map((e) => e.content)).toEqual(['summary']);
  });

  it('handles consecutive user messages', () => {
    const events = [ev('user', 'q1'), ev('user', 'q2'), ev('agent', 'a')];
    expect(pickConversationMessages(events, 10).map((e) => e.content)).toEqual([
      'q1',
      'q2',
      'a',
    ]);
  });

  it('returns an empty list when nothing is conversational', () => {
    const events = [ev('system', 'init'), ev('thinking', 'hmm'), ev('tool_call', null)];
    expect(ids(pickConversationMessages(events, 10))).toEqual([]);
  });
});
