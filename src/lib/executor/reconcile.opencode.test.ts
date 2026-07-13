import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChatSessionWithExecution: vi.fn(),
  getAgent: vi.fn(),
  updateChatSession: vi.fn(),
  persistStreamEvent: vi.fn(),
  attachHistory: vi.fn(),
  createSessionRecord: vi.fn((input: unknown) => input),
  publishReconcileStarted: vi.fn(),
  publishReconcileDone: vi.fn(),
}));

vi.mock('@agentex/agent', () => ({
  createSessionRecord: mocks.createSessionRecord,
  getProvider: () => ({ attachHistory: mocks.attachHistory }),
  getClaudeTranscriptPath: vi.fn(),
  peekClaudeTranscript: vi.fn(),
  readClaudeTranscript: vi.fn(),
  getCodexTranscriptPath: vi.fn(),
  peekCodexTranscript: vi.fn(),
  readCodexTranscript: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  getChatSessionWithExecution: mocks.getChatSessionWithExecution,
  getAgent: mocks.getAgent,
  updateChatSession: mocks.updateChatSession,
  listReconcilableSessions: vi.fn(() => []),
  listStuckBootstrapExecutions: vi.fn(() => []),
  recordExecutionSetupError: vi.fn(),
  insertChatEvent: vi.fn(),
}));

vi.mock('@/lib/realtime/bus', () => ({
  publishReconcileStarted: mocks.publishReconcileStarted,
  publishReconcileDone: mocks.publishReconcileDone,
}));

vi.mock('./harness', () => ({ mapHarnessToProvider: () => 'opencode' }));
vi.mock('./adapter', () => ({
  persistStreamEvent: mocks.persistStreamEvent,
  resolveCwd: () => '/repo',
  isRunning: () => false,
}));
vi.mock('./codex-on-disk', () => ({ mapCodexLineToInput: vi.fn() }));
vi.mock('@/lib/agents/runtime', () => ({
  runtimeContextForHarness: vi.fn(async () => ({ cwd: '/repo', config: { command: 'opencode' } })),
}));

import { reconcileSession } from './reconcile';

function session(id: string, checkpoint: { kind: string; value: unknown } | null = null) {
  return {
    id,
    agentId: 'agent-opencode',
    externalSessionId: 'external-opencode',
    externalHistoryCheckpoint: checkpoint,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAgent.mockReturnValue({ id: 'agent-opencode', harness: 'opencode' });
  mocks.persistStreamEvent.mockResolvedValue(undefined);
});

describe('OpenCode durable history reconciliation', () => {
  it('advances the provider checkpoint only after the event is persisted', async () => {
    const checkpoint = { kind: 'opencode', value: { messageId: 'm1', partId: 'p1' } };
    mocks.getChatSessionWithExecution.mockReturnValue(session('open-reconcile-1'));
    const close = vi.fn();
    mocks.attachHistory.mockResolvedValue({
      async *catchUp() {
        yield {
          eventId: 'm1:p1',
          event: { type: 'assistant_message', content: 'Recovered' },
          checkpoint,
        };
      },
      close,
    });

    const result = await reconcileSession('open-reconcile-1');

    expect(result).toEqual({ drift: true, replayed: 1 });
    expect(mocks.persistStreamEvent).toHaveBeenCalledWith('open-reconcile-1', {
      type: 'assistant_message',
      content: 'Recovered',
      eventId: 'm1:p1',
    });
    expect(mocks.updateChatSession).toHaveBeenCalledWith('open-reconcile-1', {
      externalHistoryCheckpoint: checkpoint,
    });
    expect(mocks.persistStreamEvent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.updateChatSession.mock.invocationCallOrder[0]!);
    expect(close).toHaveBeenCalledOnce();
  });

  it('falls back once to bounded full resync when the checkpoint disappeared', async () => {
    const stale = { kind: 'opencode', value: { messageId: 'gone', partId: 'gone' } };
    const recovered = { kind: 'opencode', value: { messageId: 'm2', partId: 'p2' } };
    mocks.getChatSessionWithExecution.mockReturnValue(session('open-reconcile-2', stale));
    const calls: Array<{ after?: unknown; mode: string }> = [];
    mocks.attachHistory.mockResolvedValue({
      async *catchUp(options: { after?: unknown; mode: string }) {
        calls.push(options);
        if (options.mode === 'incremental') {
          throw Object.assign(new Error('checkpoint missing'), { code: 'history_checkpoint_not_found' });
        }
        yield {
          eventId: 'm2:p2',
          event: { type: 'assistant_message', content: 'Recovered from full history' },
          checkpoint: recovered,
        };
      },
      close: vi.fn(),
    });

    const result = await reconcileSession('open-reconcile-2');

    expect(result).toEqual({ drift: true, replayed: 1 });
    expect(calls).toEqual([
      { after: stale, mode: 'incremental' },
      { after: undefined, mode: 'bounded_full_resync' },
    ]);
    expect(mocks.updateChatSession).toHaveBeenLastCalledWith('open-reconcile-2', {
      externalHistoryCheckpoint: recovered,
    });
  });
});
