import { describe, expect, it } from 'vitest';
import type { CodexTranscriptLine } from '@agentex/agent';
import {
  codexLiveCoverage,
  createCodexReplayFilter,
  mapCodexLineToInput,
} from './codex-on-disk';

// Shapes copied from a real rollout (codex app-server, Sept 2026): a turn
// opens with `task_started`, items land as `event_msg/item_completed` plus a
// `response_item` twin, and the turn closes with `task_complete`.
let offset = 0;
function line(type: string, payload: Record<string, unknown>): CodexTranscriptLine {
  offset += 100;
  const timestamp = '2026-09-21T16:15:24.481Z';
  return {
    raw: { timestamp, type, payload },
    type,
    timestamp,
    payload,
    eventId: `codex:thread-1:${offset}`,
  };
}

const TURN_A = '01a0c4c0-1c7e-7190-8d85-66c83a5e0dab';
const TURN_B = '01a0c4c2-1c52-7d91-83e6-d6932c88e1c4';

function turn(turnId: string, n: number): CodexTranscriptLine[] {
  return [
    line('event_msg', { type: 'task_started', turn_id: turnId }),
    line('turn_context', { turn_id: turnId, cwd: '/repo' }),
    line('event_msg', { type: 'item_completed', turn_id: turnId, item: { type: 'AgentMessage', id: `msg_${n}` } }),
    line('response_item', {
      type: 'message',
      id: `msg_${n}`,
      role: 'assistant',
      content: [{ type: 'output_text', text: `Answer ${n}` }],
    }),
    line('response_item', { type: 'reasoning', id: `rs_${n}`, summary: [{ type: 'summary_text', text: `Thinking ${n}` }] }),
    line('response_item', {
      type: 'function_call',
      name: 'exec_command',
      call_id: `call_${n}`,
      arguments: '{"cmd":"git status"}',
    }),
    line('response_item', { type: 'function_call', name: 'write_stdin', call_id: `call_poll_${n}`, arguments: '{}' }),
    line('response_item', { type: 'function_call_output', call_id: `call_${n}`, output: 'clean' }),
    line('event_msg', { type: 'task_complete', turn_id: turnId, last_agent_message: `Answer ${n}` }),
  ];
}

function replay(lines: CodexTranscriptLine[], coverage = codexLiveCoverage([])) {
  const isUnseen = createCodexReplayFilter(coverage);
  return lines
    .filter((l) => isUnseen(l))
    .map((l) => mapCodexLineToInput('chat-1', l))
    .filter((input) => input !== null);
}

describe('mapCodexLineToInput', () => {
  it('keys replayed rows by Codex item id, so a rollout Codex rewrote in place cannot duplicate them', () => {
    const before = line('response_item', { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'hm' }] });
    // The same line after a newer Codex migrated the file: new fields, and
    // every byte offset after the first changed line has moved.
    const after = { ...line('response_item', { ...before.payload, content: null }), raw: { ...before.raw, ordinal: 7 } };
    expect(after.eventId).not.toBe(before.eventId);
    expect(mapCodexLineToInput('chat-1', after)?.externalEventId)
      .toBe(mapCodexLineToInput('chat-1', before)?.externalEventId);
  });

  it('keeps a call and its output distinct, and keys a turn result by turn id', () => {
    const [, , , , , call, , output, complete] = turn(TURN_A, 1);
    expect(mapCodexLineToInput('chat-1', call!)?.externalEventId).toBe('codex-item:function_call:call_1');
    expect(mapCodexLineToInput('chat-1', output!)?.externalEventId).toBe('codex-item:function_call_output:call_1');
    expect(mapCodexLineToInput('chat-1', complete!)?.externalEventId).toBe(`codex-item:task_complete:${TURN_A}`);
  });

  it('falls back to the line id when Codex gave the item no usable id', () => {
    const legacy = line('response_item', { type: 'message', id: 'item_0', role: 'assistant', content: [{ type: 'output_text', text: 'old' }] });
    expect(mapCodexLineToInput('chat-1', legacy)?.externalEventId).toBe(legacy.eventId);
  });

  it('stores the provider item id on messages and reasoning, and never a turn id', () => {
    const [, , , message, reasoning] = turn(TURN_A, 1);
    expect(mapCodexLineToInput('chat-1', message!)).toMatchObject({ source: 'agent', content: 'Answer 1', externalMessageId: 'msg_1' });
    expect(mapCodexLineToInput('chat-1', reasoning!)).toMatchObject({ source: 'thinking', externalMessageId: 'rs_1' });
    expect(mapCodexLineToInput('chat-1', message!)).not.toHaveProperty('externalTurnId');
  });
});

describe('createCodexReplayFilter', () => {
  it('replays every mapped line when the live stream wrote nothing', () => {
    expect(replay(turn(TURN_A, 1)).map((r) => r.source)).toEqual([
      'agent', 'thinking', 'tool_call', 'tool_call', 'tool_result', 'result',
    ]);
  });

  it('drops a whole turn the live stream saw, including tool plumbing it has no twin for', () => {
    // What the live adapter wrote for turn A: a clean command_execution
    // under Codex's own item id, which matches nothing on disk.
    const coverage = codexLiveCoverage([
      { externalTurnId: TURN_A, externalMessageId: 'exec-1', externalToolCallId: 'exec-1' },
      { externalTurnId: TURN_A, externalMessageId: 'msg_1', externalToolCallId: null },
    ]);
    const rows = replay([...turn(TURN_A, 1), ...turn(TURN_B, 2)], coverage);
    expect(rows.map((r) => r.content ?? r.toolName)).toEqual([
      'Answer 2', 'Thinking 2', 'exec_command', 'write_stdin', 'clean', 'Answer 2',
    ]);
  });

  it('falls back to item ids when the cursor starts mid-turn, before any turn marker', () => {
    const coverage = codexLiveCoverage([
      { externalTurnId: TURN_A, externalMessageId: 'msg_1', externalToolCallId: null },
      { externalTurnId: TURN_A, externalMessageId: 'rs_1', externalToolCallId: null },
      { externalTurnId: TURN_A, externalMessageId: 'call_1', externalToolCallId: 'call_1' },
    ]);
    const midTurn = turn(TURN_A, 1).slice(3, 8);
    expect(replay(midTurn, coverage).map((r) => r.toolName)).toEqual(['write_stdin']);
  });

  it('reads the turn id from newer response_items that carry it inline', () => {
    const coverage = codexLiveCoverage([{ externalTurnId: TURN_B, externalMessageId: null, externalToolCallId: null }]);
    const inline = line('response_item', {
      type: 'message',
      id: 'msg_9',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'inline' }],
      internal_chat_message_metadata_passthrough: { turn_id: TURN_B },
    });
    expect(replay([inline], coverage)).toEqual([]);
  });

  it('ignores legacy item_N ids, which repeat across turns', () => {
    const coverage = codexLiveCoverage([{ externalTurnId: null, externalMessageId: 'item_0', externalToolCallId: null }]);
    expect(coverage.itemIds.size).toBe(0);
    const legacy = line('response_item', { type: 'message', id: 'item_0', role: 'assistant', content: [{ type: 'output_text', text: 'new turn' }] });
    expect(replay([legacy], coverage).map((r) => r.content)).toEqual(['new turn']);
  });
});
