import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexTranscriptLine } from '@agentex/agent';

const mocks = vi.hoisted(() => ({
  getChatSessionWithExecution: vi.fn(),
  updateChatSession: vi.fn(),
  insertChatEvent: vi.fn(),
  listChatEventIdentities: vi.fn(),
  peekCodexTranscript: vi.fn(),
  readCodexTranscript: vi.fn(),
  isRunning: vi.fn(() => false),
}));

vi.mock('@agentex/agent', () => ({
  createSessionRecord: vi.fn(),
  getProvider: vi.fn(),
  getClaudeTranscriptPath: vi.fn(),
  peekClaudeTranscript: vi.fn(),
  readClaudeTranscript: vi.fn(),
  getCodexTranscriptPath: vi.fn(),
  peekCodexTranscript: mocks.peekCodexTranscript,
  readCodexTranscript: mocks.readCodexTranscript,
}));

vi.mock('@/lib/db/queries', () => ({
  getChatSessionWithExecution: mocks.getChatSessionWithExecution,
  getAgent: () => ({ id: 'agent-codex', harness: 'codex' }),
  updateChatSession: mocks.updateChatSession,
  listReconcilableSessions: vi.fn(() => []),
  listStuckBootstrapExecutions: vi.fn(() => []),
  recordExecutionSetupError: vi.fn(),
  getExternalSessionImportForChat: vi.fn(() => undefined),
  insertChatEvent: mocks.insertChatEvent,
  listChatEventIdentities: mocks.listChatEventIdentities,
}));

vi.mock('@/lib/realtime/bus', () => ({
  publishReconcileStarted: vi.fn(),
  publishReconcileDone: vi.fn(),
}));

vi.mock('./harness', () => ({ mapHarnessToProvider: () => 'codex' }));
vi.mock('./adapter', () => ({
  persistStreamEvent: vi.fn(),
  resolveCwd: () => '/repo',
  isRunning: mocks.isRunning,
}));
vi.mock('@/lib/agents/runtime', () => ({ runtimeContextForHarness: vi.fn() }));

import { reconcileSession } from './reconcile';

const LIVE_TURN = '01a0c4c0-1c7e-7190-8d85-66c83a5e0dab';
const CLI_TURN = '01a0c4c2-1c52-7d91-83e6-d6932c88e1c4';
const CURSOR = 1_000;

function rollout(): Array<{ event: CodexTranscriptLine; offset: number }> {
  const payloads: Array<[string, Record<string, unknown>]> = [
    ['event_msg', { type: 'task_started', turn_id: LIVE_TURN }],
    ['response_item', { type: 'message', id: 'msg_live', role: 'assistant', content: [{ type: 'output_text', text: 'Seen live' }] }],
    ['response_item', { type: 'function_call', name: 'exec_command', call_id: 'call_live', arguments: '{}' }],
    ['response_item', { type: 'function_call', name: 'write_stdin', call_id: 'call_poll', arguments: '{}' }],
    ['response_item', { type: 'function_call_output', call_id: 'call_live', output: 'ok' }],
    ['event_msg', { type: 'task_complete', turn_id: LIVE_TURN, last_agent_message: 'Seen live' }],
    ['event_msg', { type: 'task_started', turn_id: CLI_TURN }],
    ['response_item', { type: 'message', id: 'msg_cli', role: 'assistant', content: [{ type: 'output_text', text: 'Run from the CLI' }] }],
    ['event_msg', { type: 'task_complete', turn_id: CLI_TURN, last_agent_message: 'Run from the CLI' }],
  ];
  return payloads.map(([type, payload], i) => ({
    event: { raw: { type, payload }, type, timestamp: null, payload, eventId: `codex:thread-1:${CURSOR + i * 100}` },
    offset: CURSOR + (i + 1) * 100,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isRunning.mockReturnValue(false);
  mocks.getChatSessionWithExecution.mockReturnValue({
    id: 'chat-1',
    agentId: 'agent-codex',
    externalSessionId: 'thread-1',
    externalTranscriptPath: '/codex/rollout.jsonl',
    externalSyncOffset: CURSOR,
  });
  mocks.peekCodexTranscript.mockResolvedValue({ size: CURSOR + 900, lastEvent: null });
  mocks.readCodexTranscript.mockImplementation(async function* () {
    yield* rollout();
  });
  // What the live adapter wrote for the turn it saw: its own vocabulary
  // (`command_execution` under `exec-…`), tagged with the turn id.
  mocks.listChatEventIdentities.mockReturnValue([
    { externalTurnId: LIVE_TURN, externalMessageId: 'msg_live', externalToolCallId: null },
    { externalTurnId: LIVE_TURN, externalMessageId: 'exec-1', externalToolCallId: 'exec-1' },
  ]);
  mocks.insertChatEvent.mockImplementation((input: unknown) => input);
});

describe('Codex transcript reconciliation', () => {
  it('replays only turns the live stream never saw, and consumes the whole delta', async () => {
    const result = await reconcileSession('chat-1');

    const inserted = mocks.insertChatEvent.mock.calls.map(([input]) => input);
    expect(inserted.map((row) => [row.source, row.content])).toEqual([
      ['agent', 'Run from the CLI'],
      ['result', 'Run from the CLI'],
    ]);
    expect(inserted.map((row) => row.externalEventId)).toEqual([
      'codex-item:message:msg_cli',
      `codex-item:task_complete:${CLI_TURN}`,
    ]);
    expect(result).toEqual({ drift: true, replayed: 2 });
    expect(mocks.updateChatSession).toHaveBeenCalledWith('chat-1', {
      externalTranscriptPath: '/codex/rollout.jsonl',
      externalSyncOffset: CURSOR + 900,
    });
  });

  it('does not count rows the database already had', async () => {
    mocks.insertChatEvent.mockReturnValue(null);

    const result = await reconcileSession('chat-1');

    expect(mocks.insertChatEvent).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ drift: true, replayed: 0 });
  });

  it('defers to the live stream while a turn is running', async () => {
    mocks.isRunning.mockReturnValue(true);

    const result = await reconcileSession('chat-1');

    expect(result).toEqual({ drift: false, replayed: 0, skipped: 'running' });
    expect(mocks.readCodexTranscript).not.toHaveBeenCalled();
    expect(mocks.insertChatEvent).not.toHaveBeenCalled();
  });
});
