/**
 * The runner split (docs/homes-build.md, "P2.1 The runner split"), end to end
 * through the real executor with the fake harness: the spec is built only
 * when a session must start, runs finish from the turn's result, prompts
 * answer only their own chat, plan mode is tracked by the runner, idle
 * sessions close, and a quiet heartbeat check-in closes its harness.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@agentex/agent';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';

const specBuilds = vi.hoisted(() => ({ count: 0 }));
vi.mock('./session-spec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-spec')>();
  return {
    ...actual,
    buildSessionSpec: async (...args: Parameters<typeof actual.buildSessionSpec>) => {
      specBuilds.count += 1;
      return actual.buildSessionSpec(...args);
    },
  };
});

let home: TestHome | null = null;
let fake: FakeHarness | null = null;

afterEach(async () => {
  const { _resetExecutorState } = await import('./adapter');
  const { _resetPendingInput } = await import('./pending-input');
  _resetExecutorState();
  _resetPendingInput();
  fake?.restore();
  fake = null;
  specBuilds.count = 0;
  await home?.cleanup();
  home = null;
});

async function chat(opts: { permissionMode?: 'auto_all' | 'ask' | 'plan'; prePlanMode?: 'auto_all' | 'ask' } = {}) {
  home = await createTestHome({ prefix: 'ri-runner-split-' });
  fake = installFakeHarness('claude');
  const q = await import('@/lib/db/queries');
  const session = q.createChatSession({
    type: 'orchestration',
    harness: 'claude',
    status: 'active',
    permissionMode: opts.permissionMode ?? 'auto_all',
  });
  if (opts.prePlanMode) q.updateChatSession(session.id, { prePlanMode: opts.prePlanMode });
  return session;
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe('sending', () => {
  it('builds a spec to start a session, and none for a follow-up to a live one', async () => {
    const session = await chat();
    const { dispatch } = await import('./adapter');
    await dispatch(session.id, 'first');
    await dispatch(session.id, 'second');
    expect(specBuilds.count).toBe(1);
    expect(fake!.sessions).toHaveLength(1);
    expect(fake!.latest().messages).toHaveLength(2);
  });

  it('asks for a spec when there is no live session to send into', async () => {
    const session = await chat();
    const { runnerFor } = await import('./placement');
    const sent = await runnerFor(session.id).send({
      chatSessionId: session.id,
      message: 'hello',
      turnId: 'turn-1',
      runId: null,
      spec: null,
    });
    expect(sent).toEqual({ status: 'needs_spec' });
    expect(fake!.sessions).toHaveLength(0);
  });
});

describe('a harness that takes one message at a time', () => {
  it('refuses a second message while the first is starting, without creating a run', async () => {
    home = await createTestHome({ prefix: 'ri-runner-split-' });
    fake = installFakeHarness('opencode');
    const q = await import('@/lib/db/queries');
    const session = q.createChatSession({ type: 'orchestration', harness: 'opencode', status: 'active', permissionMode: 'auto_all' });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    fake.onTurn(async (turn) => {
      await held;
      await turn.say('done');
    });
    const { dispatch, isRunning } = await import('./adapter');
    // Both in the same tick. Either can reach the gate first (their lookups
    // before it finish in any order), and exactly one must be refused.
    const outcomes = [dispatch(session.id, 'first'), dispatch(session.id, 'second')].map((p) =>
      p.then(
        () => 'delivered' as const,
        (err: unknown) => err,
      ),
    );
    // The refused one settles at once; the other is held in its turn.
    await expect(Promise.race(outcomes)).resolves.toMatchObject({ code: 'already_running' });
    expect(isRunning(session.id)).toBe(true);
    release();
    const results = await Promise.all(outcomes);
    expect(results.filter((r) => r === 'delivered')).toHaveLength(1);
    expect(q.listRuns({}).filter((r) => r.chatSessionId === session.id)).toHaveLength(1);
    expect(isRunning(session.id)).toBe(false);
  });
});

describe('runs finish from the turn result', () => {
  it('completes a manual run when its turn ends', async () => {
    const session = await chat();
    const { dispatch } = await import('./adapter');
    const q = await import('@/lib/db/queries');
    await dispatch(session.id, 'hello');
    const runs = q.listRuns({}).filter((r) => r.chatSessionId === session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ triggerKind: 'manual', status: 'completed' });
  });

  it('fails the run, and the caller hears, when the turn fails', async () => {
    const session = await chat();
    const { dispatch, _cacheHarnessSession } = await import('./adapter');
    const q = await import('@/lib/db/queries');
    await dispatch(session.id, 'start it');
    // A turn whose result rejects: the harness died mid-turn.
    const live = fake!.latest();
    const failing = Object.create(live) as AgentSession;
    failing.send = async () => ({ result: Promise.reject(new Error('the harness died')) }) as never;
    _cacheHarnessSession(session.id, failing);

    await expect(dispatch(session.id, 'again')).rejects.toThrow('the harness died');
    const failed = q.listRuns({}).find((r) => r.chatSessionId === session.id && r.status === 'failed');
    expect(failed).toMatchObject({ errorCode: 'agent_error', errorMessage: 'the harness died' });
  });

  it('finishes a run even when nothing waits on the turn', async () => {
    const session = await chat();
    const q = await import('@/lib/db/queries');
    const { runnerFor } = await import('./placement');
    const { buildSessionSpec } = await import('./session-spec');
    const run = q.createRun({
      triggerId: null,
      workspaceId: null,
      executionId: null,
      chatSessionId: session.id,
      harness: 'claude',
      triggerKind: 'manual',
      triggerPayload: null,
      scheduledFor: null,
      status: 'queued',
    });
    q.markRunStarted(run.id);
    const spec = await buildSessionSpec({
      chatSessionId: session.id,
      harness: 'claude',
      cwd: home!.root,
      sessionType: 'orchestration',
      workspaceId: null,
      surfaceKind: null,
      surfaceRef: null,
      existingExternalSessionId: null,
      permissionMode: 'auto_all',
      prePlanMode: null,
      model: null,
      modelVariant: null,
      effort: null,
    });
    const sent = await runnerFor(session.id).send({ chatSessionId: session.id, message: 'hi', turnId: 'unwatched', runId: run.id, spec });
    expect(sent).toEqual({ status: 'delivered' });
    await until(() => q.getRun(run.id)?.status === 'completed', 'the run to complete');
  });

  it('changes nothing when a later result arrives for a run that already failed', async () => {
    const session = await chat();
    const q = await import('@/lib/db/queries');
    const { finishRun } = await import('@/lib/runs/finish');
    const run = q.createRun({
      triggerId: null,
      workspaceId: null,
      executionId: null,
      chatSessionId: session.id,
      harness: 'claude',
      triggerKind: 'manual',
      triggerPayload: null,
      scheduledFor: null,
      status: 'queued',
    });
    q.markRunStarted(run.id);
    finishRun(run.id, { ok: false, errorCode: 'timeout', errorMessage: 'Run exceeded 1s timeout' });
    finishRun(run.id, { ok: true });
    expect(q.getRun(run.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });
});

describe('pending prompts', () => {
  it("answers only the chat that asked", async () => {
    const session = await chat({ permissionMode: 'ask' });
    const other = (await import('@/lib/db/queries')).createChatSession({
      type: 'orchestration',
      harness: 'claude',
      status: 'active',
      permissionMode: 'ask',
    });
    const { dispatch, answerPendingInput } = await import('./adapter');
    const pending = await import('./pending-input');
    fake!.onTurn(async (turn) => {
      const answer = await turn.ask({ toolName: 'Bash', input: { command: 'ls' } });
      await turn.say(answer.allow ? 'allowed' : 'denied');
    });
    const turn = dispatch(session.id, 'list files');
    await until(() => pending.listForSession(session.id).length === 1, 'the prompt');
    const { requestId } = pending.listForSession(session.id)[0]!;

    expect(answerPendingInput(other.id, requestId, { allow: true, updatedInput: {} })).toEqual({ ok: false });
    expect(pending.listForSession(session.id)).toHaveLength(1);
    expect(answerPendingInput(session.id, requestId, { allow: true, updatedInput: { command: 'ls' } }).ok).toBe(true);
    await turn;
  });

  it('follows the mode the session returned to after leaving plan mode', async () => {
    const session = await chat({ permissionMode: 'plan', prePlanMode: 'auto_all' });
    const { dispatch, answerPendingInput } = await import('./adapter');
    const pending = await import('./pending-input');
    const q = await import('@/lib/db/queries');
    let bash: boolean | null = null;
    fake!.onTurn(async (turn) => {
      await turn.ask({ toolName: 'ExitPlanMode', input: { plan: 'do it' } });
      // Back in auto_all: this one is allowed without asking.
      bash = (await turn.ask({ toolName: 'Bash', input: { command: 'ls' } })).allow;
    });
    const turn = dispatch(session.id, 'plan then act');
    await until(() => pending.listForSession(session.id).length === 1, 'the plan prompt');
    const exit = pending.listForSession(session.id)[0]!;
    answerPendingInput(session.id, exit.requestId, { allow: true, updatedInput: {} });
    await turn;

    expect(bash).toBe(true);
    expect(q.getChatSession(session.id)).toMatchObject({ permissionMode: 'auto_all', prePlanMode: null });
    const requests = q.listChatEvents(session.id).filter((e) => e.source === 'permission_request');
    expect(requests.map((e) => e.toolName)).toEqual(['ExitPlanMode']);
  });
});

describe('the P0.4 gaps closed with P2.4', () => {
  it('refuses to send into a chat someone took over, from any path', async () => {
    home = await createTestHome({ prefix: 'ri-runner-split-' });
    fake = installFakeHarness('claude');
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'Taken', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const { execution, session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'work' });
    q.updateExecution(execution.id, { takeoverStartedAt: new Date().toISOString() });
    const { dispatch } = await import('./adapter');
    await expect(dispatch(session.id, 'from a commit helper')).rejects.toThrow(/worked on locally/);
    expect(fake!.sessions).toHaveLength(0);
    expect(q.listRuns({}).filter((r) => r.chatSessionId === session.id)).toHaveLength(0);
  });

  it('clears the prompt a turn was waiting on when it is interrupted', async () => {
    const session = await chat({ permissionMode: 'ask' });
    const { dispatch, abort } = await import('./adapter');
    const pending = await import('./pending-input');
    let answer: boolean | null = null;
    fake!.onTurn(async (turn) => {
      answer = (await turn.ask({ toolName: 'Bash', input: { command: 'rm -rf build' } })).allow;
    });
    const turn = dispatch(session.id, 'clean up');
    await until(() => pending.listForSession(session.id).length === 1, 'the prompt');
    await abort(session.id);
    await turn;
    expect(pending.listForSession(session.id)).toHaveLength(0);
    expect(answer).toBe(false);
  });

  it('archiving an agent stops its chats, from the app or an action', async () => {
    home = await createTestHome({ prefix: 'ri-runner-split-' });
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'Doomed', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'work' });
    const close = vi.fn(async () => {});
    const { _cacheHarnessSession, hasHarnessSession } = await import('./adapter');
    _cacheHarnessSession(session.id, { state: 'idle', close } as unknown as AgentSession);
    const { actions } = await import('@/lib/orchestrator/registry');
    // As the server runs it; from the home's CLI it's handed to the server.
    await actions.find((a) => a.name === 'archive_workspace')!.handler({ remote: true }, { id: ws.id } as never);
    expect(close).toHaveBeenCalledOnce();
    expect(hasHarnessSession(session.id)).toBe(false);
    expect(q.getWorkspace(ws.id)?.status).toBe('archived');
  });
});

describe('closing sessions nobody is using', () => {
  it('closes an idle session, and the next message resumes it', async () => {
    const session = await chat();
    const { dispatch, closeIdleSessions, hasHarnessSession } = await import('./adapter');
    await dispatch(session.id, 'hello');
    const first = fake!.latest();

    expect(await closeIdleSessions(Date.now() + 60_000, 30 * 60_000)).toEqual([]);
    expect(await closeIdleSessions(Date.now() + 31 * 60_000, 30 * 60_000)).toEqual([session.id]);
    expect(hasHarnessSession(session.id)).toBe(false);

    await dispatch(session.id, 'still there?');
    const second = fake!.latest();
    expect(second).not.toBe(first);
    expect(second.resumed).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('leaves a session waiting on a prompt alone', async () => {
    const session = await chat({ permissionMode: 'ask' });
    const { dispatch, closeIdleSessions, answerPendingInput } = await import('./adapter');
    const pending = await import('./pending-input');
    fake!.onTurn(async (turn) => {
      await turn.ask({ toolName: 'Bash', input: { command: 'ls' } });
    });
    const turn = dispatch(session.id, 'list files');
    await until(() => pending.listForSession(session.id).length === 1, 'the prompt');
    expect(await closeIdleSessions(Date.now() + 31 * 60_000, 30 * 60_000)).toEqual([]);
    answerPendingInput(session.id, pending.listForSession(session.id)[0]!.requestId, { allow: false, message: 'no' });
    await turn;
  });
});

describe('a quiet heartbeat check-in', () => {
  it('archives its chat and closes its harness', async () => {
    home = await createTestHome({ prefix: 'ri-runner-split-' });
    const q = await import('@/lib/db/queries');
    const { ensureHeartbeatTrigger } = await import('@/lib/heartbeat/trigger');
    const { HEARTBEAT_QUIET_REPLY } = await import('@/lib/heartbeat/constants');
    const { RESERVED_TRIGGER_IDS } = await import('@/lib/triggers/reserved');
    const { _cacheHarnessSession, hasHarnessSession } = await import('./adapter');
    const { finishRun } = await import('@/lib/runs/finish');
    ensureHeartbeatTrigger();
    const session = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'auto_all' });
    q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: HEARTBEAT_QUIET_REPLY, createdAt: new Date().toISOString() });
    const run = q.createRun({
      triggerId: RESERVED_TRIGGER_IDS.heartbeat,
      workspaceId: null,
      executionId: null,
      chatSessionId: session.id,
      harness: 'claude',
      triggerKind: 'every',
      triggerPayload: null,
      scheduledFor: null,
      status: 'queued',
    });
    q.markRunStarted(run.id);
    const close = vi.fn(async () => {});
    _cacheHarnessSession(session.id, { state: 'idle', close } as unknown as AgentSession);

    finishRun(run.id, { ok: true });
    await until(() => close.mock.calls.length === 1, 'the harness to close');
    expect(q.getChatSession(session.id)?.status).toBe('archived');
    expect(hasHarnessSession(session.id)).toBe(false);
  });
});
