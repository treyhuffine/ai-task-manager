/**
 * The runner split (docs/homes-build.md, "P2.1 The runner split"), end to end
 * through the real executor with the fake harness: the spec is built only
 * when a session must start, runs finish from the turn's result, prompts
 * answer only their own chat, plan mode is tracked by the runner, idle
 * sessions close, and a quiet heartbeat check-in closes its harness.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, UserInputResponse } from '@agentex/agent';
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

const PERSON = { source: 'human' as const };

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

  it('starts one session for two messages sent before it exists', async () => {
    const session = await chat();
    const { buildSessionSpec } = await import('./session-spec');
    const { send } = await import('@/lib/runner/local-runner');
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
      model: 'fake-model',
      modelVariant: null,
      effort: null,
    });
    const request = (message: string) => ({ chatSessionId: session.id, message, turnId: message, runId: null, spec });
    await Promise.all([send(request('one')), send(request('two'))]);
    expect(fake!.sessions).toHaveLength(1);
    expect([...fake!.latest().messages].sort()).toEqual(['one', 'two']);
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

describe("an execution's environment, at home (P2.7)", () => {
  it('is resolved when the session starts, written beside the instructions, and added to them', async () => {
    home = await createTestHome({ prefix: 'ri-runner-split-' });
    fake = installFakeHarness('claude');
    const q = await import('@/lib/db/queries');
    const identity = await import('@/lib/home/identity');
    identity.resetHomeIdentityCache();
    identity.ensureHomeIdentity();
    const folder = path.join(home.root, 'notes-agent');
    fs.mkdirSync(folder);
    const ws = q.createWorkspace({ name: 'Notes', cwd: folder, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const created = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Tidy notes' });
    const { dispatch } = await import('./adapter');
    await dispatch(created.session.id, 'hello');

    const instructionsFile = fake!.latest().ctx.config?.instructionsFile;
    expect(instructionsFile).toBeTruthy();
    const instructions = fs.readFileSync(instructionsFile!, 'utf8');
    expect(instructions).toContain('## Your environment');
    expect(instructions).toContain('as the "Notes" agent');
    expect(instructions).toContain(`- Working folder: \`${folder}\`, the agent's folder, which isn't a Git repository.`);
    const { sessionEnvironmentPath } = await import('./session-instructions');
    const environment = JSON.parse(fs.readFileSync(sessionEnvironmentPath(created.session.id), 'utf8'));
    expect(environment).toMatchObject({ agent: { id: ws.id }, executionId: created.execution.id, cwd: folder, mode: 'folder' });
    identity.resetHomeIdentityCache();
  });
});

describe('attached files, for a chat at home', () => {
  it("become their paths in the home's attachments directory, and a marker for no attached file stays", async () => {
    const session = await chat();
    const { saveAttachment, attachmentPath } = await import('@/lib/attachments/save');
    const { expandMarkers } = await import('@/lib/attachments/expand-markers');
    const notes = await saveAttachment({ data: Buffer.from('shopping list'), originalName: 'notes.txt', mimeType: 'text/plain' });
    const content = `read [[file:${notes.fileName}]] and [[file:not-attached.txt]]`;
    const expanded = await expandMarkers(content, [notes]);
    // Expansion leaves a file the agent reads itself for dispatch to place.
    expect(expanded).toBe(content);
    const { dispatch } = await import('./adapter');
    await dispatch(session.id, expanded, { attachments: [notes] });
    expect(fake!.latest().messages).toEqual([`read ${attachmentPath(notes.fileName)} and [[file:not-attached.txt]]`]);
  });
});

describe("a turn's cost (P2 re-review)", () => {
  async function overlap(coalesce: boolean) {
    const session = await chat();
    fake!.coalesce = coalesce;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let firstRunning = false;
    fake!.onTurn(async (turn) => {
      if (turn.message === 'first') {
        firstRunning = true;
        await gate;
      }
      await turn.say(turn.message);
      return { costUsd: turn.message === 'first' ? 3 : 5 };
    });
    const { dispatch } = await import('./adapter');
    const q = await import('@/lib/db/queries');
    const first = dispatch(session.id, 'first');
    // The second is sent while the first's turn is running in the harness.
    await until(() => firstRunning, "the first message's turn");
    const second = dispatch(session.id, 'second');
    await until(() => q.listRuns({}).filter((r) => r.chatSessionId === session.id).length === 2, 'the second run');
    release();
    await Promise.all([first, second]);
    return q
      .listRuns({})
      .filter((r) => r.chatSessionId === session.id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({ status: r.status, cost: r.costUsd ?? 0 }));
  }

  it('goes to the run of the message whose turn it was, when messages overlap', async () => {
    expect(await overlap(false)).toEqual([
      { status: 'completed', cost: 3 },
      { status: 'completed', cost: 5 },
    ]);
  });

  it('goes once to the opening message, when the harness folds a second one into its turn', async () => {
    expect(await overlap(true)).toEqual([
      { status: 'completed', cost: 3 },
      { status: 'completed', cost: 0 },
    ]);
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

    expect(answerPendingInput(other.id, requestId, { allow: true, updatedInput: {} }, PERSON)).toEqual({ ok: false });
    expect(pending.listForSession(session.id)).toHaveLength(1);
    expect(answerPendingInput(session.id, requestId, { allow: true, updatedInput: { command: 'ls' } }, PERSON).ok).toBe(true);
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
    answerPendingInput(session.id, exit.requestId, { allow: true, updatedInput: {} }, PERSON);
    await turn;

    expect(bash).toBe(true);
    expect(q.getChatSession(session.id)).toMatchObject({ permissionMode: 'auto_all', prePlanMode: null });
    const requests = q.listChatEvents(session.id).filter((e) => e.source === 'permission_request');
    expect(requests.map((e) => e.toolName)).toEqual(['ExitPlanMode']);
  });
});

describe('who may answer a prompt (P2.6)', () => {
  async function orchestrator() {
    const q = await import('@/lib/db/queries');
    return q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'ask' });
  }

  async function answerRoute(chatId: string, requestId: string, body: object, credential?: string) {
    const { POST } = await import('@/app/api/sessions/[id]/pending-input/[requestId]/route');
    const { SESSION_CREDENTIAL_HEADER } = await import('@/lib/orchestrator/session-credential');
    const { NextRequest } = await import('next/server');
    const request = new NextRequest(`http://127.0.0.1/api/sessions/${chatId}/pending-input/${requestId}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {},
    });
    return POST(request, { params: Promise.resolve({ id: chatId, requestId }) });
  }

  it('only a person approves a permission, and an agent may deny one', async () => {
    const session = await chat({ permissionMode: 'ask' });
    const agent = await orchestrator();
    const { dispatch } = await import('./adapter');
    const pending = await import('./pending-input');
    const { sessionCredential } = await import('@/lib/orchestrator/session-credential');
    const { HUMAN_ONLY_APPROVAL } = await import('@/lib/runner/pending');
    const answers: UserInputResponse[] = [];
    fake!.onTurn(async (turn) => {
      answers.push(await turn.ask({ toolName: 'Bash', input: { command: 'rm -rf build' } }));
      answers.push(await turn.ask({ toolName: 'Bash', input: { command: 'ls' } }));
    });
    const turn = dispatch(session.id, 'clean up');
    await until(() => pending.listForSession(session.id).length === 1, 'the first prompt');
    const first = pending.listForSession(session.id)[0]!.requestId;
    const asAgent = sessionCredential(agent.id)!;

    const refused = await answerRoute(session.id, first, { allow: true }, asAgent);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'human_only', message: HUMAN_ONLY_APPROVAL });
    expect(pending.listForSession(session.id).map((p) => p.requestId)).toEqual([first]);

    expect((await answerRoute(session.id, first, { allow: false }, asAgent)).status).toBe(200);
    await until(() => pending.listForSession(session.id)[0]?.requestId !== undefined && pending.listForSession(session.id)[0]!.requestId !== first, 'the second prompt');
    const second = pending.listForSession(session.id)[0]!.requestId;
    expect((await answerRoute(session.id, second, { allow: true })).status).toBe(200);
    await turn;
    expect(answers).toEqual([
      { allow: false, message: "Denied by the orchestrator (the user's main chat)." },
      { allow: true, updatedInput: { command: 'ls' } },
    ]);
  });

  it("an agent may answer a question, through the action", async () => {
    const session = await chat({ permissionMode: 'ask' });
    const agent = await orchestrator();
    const { dispatch } = await import('./adapter');
    const pending = await import('./pending-input');
    const { actions } = await import('@/lib/orchestrator/registry');
    const answer = actions.find((a) => a.name === 'answer_pending_input')!;
    const answers: UserInputResponse[] = [];
    const question = { question: 'Which database?', header: 'DB', options: [{ label: 'SQLite', description: '' }, { label: 'Postgres', description: '' }] };
    fake!.onTurn(async (turn) => {
      answers.push(await turn.ask({ toolName: 'AskUserQuestion', input: { questions: [question] } }));
    });
    const turn = dispatch(session.id, 'pick one');
    await until(() => pending.listForSession(session.id).length === 1, 'the question');
    const { requestId } = pending.listForSession(session.id)[0]!;
    const ctx = { remote: true, actor: { source: 'ai' as const, sessionId: agent.id }, caller: { location: 'home' as const } };
    await answer.handler(ctx, { sessionId: session.id, requestId, allow: true, answers: { 'Which database?': 'SQLite' } } as never);
    await turn;
    expect(answers[0]).toMatchObject({ allow: true, updatedInput: { answers: { 'Which database?': 'SQLite' } } });
  });

  it("the action refuses an agent's approval, and a caller elsewhere without a session is an agent", async () => {
    const session = await chat({ permissionMode: 'ask' });
    const agent = await orchestrator();
    const { dispatch } = await import('./adapter');
    const pending = await import('./pending-input');
    const { actions } = await import('@/lib/orchestrator/registry');
    const { HUMAN_ONLY_APPROVAL } = await import('@/lib/runner/pending');
    const answer = actions.find((a) => a.name === 'answer_pending_input')!;
    fake!.onTurn(async (turn) => {
      await turn.say((await turn.ask({ toolName: 'Bash', input: { command: 'ls' } })).allow ? 'allowed' : 'denied');
    });
    const turn = dispatch(session.id, 'list');
    await until(() => pending.listForSession(session.id).length === 1, 'the prompt');
    const { requestId } = pending.listForSession(session.id)[0]!;
    const approve = (ctx: object) => answer.handler(ctx as never, { sessionId: session.id, requestId, allow: true } as never);

    await expect(approve({ remote: true, actor: { source: 'ai', sessionId: agent.id }, caller: { location: 'home' } })).rejects.toMatchObject({
      code: 'unsupported',
      message: HUMAN_ONLY_APPROVAL,
    });
    await expect(approve({ remote: true, caller: { location: 'elsewhere', apiKeyId: 'laptop-key' } })).rejects.toMatchObject({ code: 'unsupported' });
    expect(pending.listForSession(session.id)).toHaveLength(1);
    // The home's own CLI, run by hand, is the person.
    await approve({ remote: true, caller: { location: 'home', apiKeyId: 'home-key' } });
    await turn;
    const q = await import('@/lib/db/queries');
    expect(q.listChatEvents(session.id).some((e) => e.content === 'allowed')).toBe(true);
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
    answerPendingInput(session.id, pending.listForSession(session.id)[0]!.requestId, { allow: false, message: 'no' }, PERSON);
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
