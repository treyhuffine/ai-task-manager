import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthCache } from '@agentex/agent';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installMockAgy, MOCK_AGY_MODELS, type MockAgy } from '@/test/fixtures/mock-agy';
import { clearHarnessRuntimeCache, getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';
import { clearHarnessModelCache, getHarnessModels } from '@/lib/harness/model-discovery';
import { resumeCommandForHarness } from '@/lib/harness/registry';

/**
 * Antigravity end to end: Ri's real executor and runner, the real agentex
 * `antigravity` provider, and a stand-in `agy` (src/test/fixtures/mock-agy.ts)
 * reached through `ANTIGRAVITY_COMMAND`. Asserting on the stand-in's argv and
 * stdin checks what Ri's selection, permission mode and session instructions
 * actually become on the command line, which no unit test of either side can.
 */

// The orchestrator surface asks the installed Claude whether it needs a
// CLAUDE.md pointer. Nothing about that is under test here.
vi.mock('@/lib/orchestrator/claude-agents-md', () => ({ shouldWriteClaudeMdPointer: async () => false }));

const MODEL = MOCK_AGY_MODELS[1].id;

let home: TestHome;
let agy: MockAgy;

function clearCaches() {
  clearHarnessRuntimeCache('antigravity');
  clearHarnessModelCache('antigravity');
  // Agentex keys its model cache on the command, and every test gets its own
  // stand-in path, so only the auth read needs dropping.
  clearAuthCache();
}

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-agy-' });
  agy = installMockAgy();
  clearCaches();
});

afterEach(async () => {
  const { recycleHarnessSessions, _resetExecutorState } = await import('@/lib/executor/adapter');
  const { _resetPendingInput } = await import('@/lib/executor/pending-input');
  await recycleHarnessSessions('antigravity');
  _resetExecutorState();
  _resetPendingInput();
  agy.cleanup();
  clearCaches();
  await home.cleanup();
});

/** The value right after `flag` in an argv, or undefined. */
function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function chat(input: { permissionMode?: 'auto_all' | 'plan'; effort?: 'low' | 'medium' | 'high' | 'max'; workspaceId?: string } = {}) {
  const q = await import('@/lib/db/queries');
  return q.createChatSession({
    type: 'orchestration',
    harness: 'antigravity',
    status: 'active',
    model: MODEL,
    effort: input.effort ?? 'high',
    permissionMode: input.permissionMode ?? 'auto_all',
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
}

describe('Antigravity runtime and catalog', () => {
  it('probes the installed CLI and reports what the harness can do', async () => {
    const runtime = await getHarnessRuntime('antigravity', { refresh: true });
    expect(runtime.binary).toMatchObject({
      status: 'supported',
      command: agy.command,
      version: '1.2.14',
      protocolProfile: 'agy-stream-json-v1',
    });
    const supported = Object.fromEntries(
      Object.entries(runtime.capabilities).map(([key, view]) => [key, view.supported]),
    );
    expect(supported).toMatchObject({
      sessions: true,
      resume: true,
      modelDiscovery: true,
      reasoningEffort: true,
      planMode: true,
      modes: true,
      mcp: false,
      strictMcpIsolation: false,
      permissionRequests: false,
      concurrentSend: false,
      durableCatchUp: false,
      sessionModelChange: false,
      sessionEffortChange: false,
    });
  });

  it('lists the models `agy models` reports', async () => {
    const response = await getHarnessModels('antigravity', { refresh: true });
    expect(response.source).toBe('provider');
    expect(response.models.map((model) => [model.id, model.label])).toEqual(
      MOCK_AGY_MODELS.map((model) => [model.id, model.name]),
    );
  });

  it('reads a signed-in CLI as a subscription and a signed-out one as nothing', async () => {
    const signedIn = await resolveHarnessAuth('antigravity', { fresh: true });
    expect(signedIn.binary.installed).toBe(true);
    expect(signedIn.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'subscription', present: true }),
      expect.objectContaining({ method: 'api_key', present: false }),
    ]));

    agy.setSignedIn(false);
    clearCaches();
    const signedOut = await resolveHarnessAuth('antigravity', { fresh: true });
    expect(signedOut.options.some((option) => option.present)).toBe(false);
    // No sign-in means no catalog. Ri falls back to its bundled list, which is empty.
    const models = await getHarnessModels('antigravity', { refresh: true });
    expect(models).toEqual({ source: 'config', models: [] });
  });
});

describe('Antigravity chats through the real runner', () => {
  it('runs a turn with the chosen model and effort, in auto mode', async () => {
    const session = await chat();
    const { dispatch } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');

    await dispatch(session.id, 'hello');

    const [argv, ...rest] = agy.sessionSpawns();
    expect(rest).toEqual([]);
    expect(flagValue(argv!, '--model')).toBe(MODEL);
    expect(flagValue(argv!, '--effort')).toBe('high');
    expect(argv).toContain('--dangerously-skip-permissions');
    expect(argv).not.toContain('--mode');
    expect(argv).not.toContain('--conversation');

    const events = q.listChatEvents(session.id);
    expect(events.some((event) => event.source === 'agent' && event.content === 'agy heard: hello')).toBe(true);
    const stored = q.getChatSession(session.id)!;
    expect(stored.externalSessionId).toMatch(/^mock-conv-\d+$/);
    expect(resumeCommandForHarness('antigravity', stored.externalSessionId))
      .toBe(`agy --conversation ${stored.externalSessionId}`);
  });

  it('keeps one process for the conversation and resumes it after a restart', async () => {
    const session = await chat();
    const { dispatch, close } = await import('@/lib/executor/adapter');
    const q = await import('@/lib/db/queries');

    await dispatch(session.id, 'first');
    await dispatch(session.id, 'second');
    expect(agy.sessionSpawns()).toHaveLength(1);
    expect(agy.stdin().map((line) => String(line.message.content).split('\n').at(-1))).toEqual(['first', 'second']);
    expect(agy.stdin()[0].message.content).toContain('Current Ri agent instruction preferences');

    const conversation = q.getChatSession(session.id)!.externalSessionId!;
    await close(session.id);
    await dispatch(session.id, 'third');

    const spawns = agy.sessionSpawns();
    expect(spawns).toHaveLength(2);
    expect(flagValue(spawns[1]!, '--conversation')).toBe(conversation);
    expect(q.getChatSession(session.id)!.externalSessionId).toBe(conversation);
    expect(q.listChatEvents(session.id).some((event) => event.content?.endsWith('third'))).toBe(true);
  });

  it('runs plan mode read-only, without skipping permissions', async () => {
    const session = await chat({ permissionMode: 'plan', effort: 'max' });
    const { dispatch } = await import('@/lib/executor/adapter');

    await dispatch(session.id, 'plan it');

    const [argv] = agy.sessionSpawns();
    expect(flagValue(argv!, '--mode')).toBe('plan');
    expect(flagValue(argv!, '--effort')).toBe('max');
    expect(argv).not.toContain('--dangerously-skip-permissions');
  });

  it("gives an agent's main chat its brief ahead of the first message, and writes nothing into its folder", async () => {
    const folder = path.join(home.root, 'code', 'site');
    fs.mkdirSync(folder, { recursive: true });
    const q = await import('@/lib/db/queries');
    const workspace = q.createWorkspace({
      name: 'site',
      cwd: folder,
      isGit: false,
      filesToCopy: [],
      status: 'active',
      browserEnabled: false,
      purpose: 'Keep the marketing site current',
      instructions: 'Never deploy on Fridays.',
    });
    const session = await chat({ workspaceId: workspace.id });
    const { dispatch } = await import('@/lib/executor/adapter');

    await dispatch(session.id, 'What is running?');

    const [first] = agy.stdin();
    const text = String(first!.message.content);
    expect(text).toContain('Never deploy on Fridays.');
    expect(text.endsWith('What is running?')).toBe(true);
    expect(text.indexOf('Never deploy on Fridays.')).toBeLessThan(text.indexOf('What is running?'));
    expect(fs.readdirSync(folder)).toEqual([]);
  });

  it('refuses to start while the rollout flag is off', async () => {
    const session = await chat();
    const { dispatch } = await import('@/lib/executor/adapter');
    const saved = process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED;
    process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED = 'false';
    try {
      await expect(dispatch(session.id, 'hello')).rejects.toThrow(/disabled by the rollout configuration/);
      expect(agy.sessionSpawns()).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED;
      else process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED = saved;
    }
  });
});


describe('Antigravity permission boundaries', () => {
  it.each(['ask', 'auto_edits'] as const)('refuses %s at chat creation and updates', async (permissionMode) => {
    const q = await import('@/lib/db/queries');
    expect(() => q.createChatSession({ type: 'orchestration', harness: 'antigravity', permissionMode })).toThrow(/not supported/);
    const session = await chat();
    expect(() => q.updateChatSession(session.id, { permissionMode })).toThrow(/not supported/);
    expect(q.getChatSession(session.id)?.permissionMode).toBe('auto_all');
    expect(agy.sessionSpawns()).toEqual([]);
  });

  it('refuses an unsupported stored mode at the final runner boundary', async () => {
    const session = await chat();
    const { getRawDb } = await import('@/lib/db');
    // Model a row written by an older client that did not validate modes.
    getRawDb().prepare('UPDATE chat_sessions SET permission_mode = ? WHERE id = ?').run('ask', session.id);
    const { dispatch } = await import('@/lib/executor/adapter');
    await expect(dispatch(session.id, 'hello')).rejects.toThrow(/not supported/);
    expect(agy.sessionSpawns()).toEqual([]);
  });

  it('validates the initial mode before creating an execution through the API', async () => {
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'permission-api', cwd: home.root, isGit: false, filesToCopy: [], status: 'active' });
    const { POST } = await import('@/app/api/workspaces/[id]/sessions/route');
    const post = (permissionMode: string) => POST(new Request('http://localhost/api/workspaces/test/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ harness: 'antigravity', model: MODEL, permissionMode }),
    }) as never, { params: Promise.resolve({ id: ws.id }) });
    for (const mode of ['ask', 'auto_edits', 'invalid']) {
      expect((await post(mode)).status).toBe(400);
      expect(q.listWorkspaceExecutions(ws.id)).toEqual([]);
    }
    const response = await post('plan');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ harness: 'antigravity', permissionMode: 'plan' });
    expect(q.listWorkspaceExecutions(ws.id)).toHaveLength(1);
    expect(agy.sessionSpawns()).toEqual([]);
  });
});


describe('disabled Antigravity new selections', () => {
  it('rejects the shared selection resolver and execution API before creating artifacts', async () => {
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'disabled-api', cwd: home.root, isGit: false, filesToCopy: [], status: 'active' });
    vi.stubEnv('NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED', 'false');
    try {
      const { resolveHarnessSelection } = await import('@/lib/harness/model-discovery');
      await expect(resolveHarnessSelection('antigravity', { model: MODEL })).rejects.toThrow(/disabled by the rollout configuration/);
      const { POST } = await import('@/app/api/workspaces/[id]/sessions/route');
      const response = await POST(new Request('http://localhost/api/workspaces/test/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ harness: 'antigravity', model: MODEL }),
      }) as never, { params: Promise.resolve({ id: ws.id }) });
      expect(response.status).toBe(409);
      expect(q.listWorkspaceExecutions(ws.id)).toEqual([]);
      expect(agy.sessionSpawns()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('preserves existing main chats and the explicit disabled choice instead of substituting a harness', async () => {
    const existing = await chat();
    const q = await import('@/lib/db/queries');
    vi.stubEnv('NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED', 'false');
    try {
      const { parseChatOverride, startNewMainChat, ensureMainChat } = await import('@/lib/sessions/main-chat');
      const override = parseChatOverride({ providerId: 'antigravity', model: MODEL });
      expect(override.providerId).toBe('antigravity');
      await expect(startNewMainChat(null, override)).rejects.toThrow(/disabled by the rollout configuration/);
      expect(q.getChatSession(existing.id)?.status).toBe('active');
      expect((await ensureMainChat(null)).id).toBe(existing.id);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});


describe('fresh-chat switches keep permissions', () => {
  const surfaces = ['execution', 'main', 'content'] as const;
  type Surface = (typeof surfaces)[number];

  async function seedSwitch(surface: Surface, harness: 'claude' | 'antigravity', mode: 'ask' | 'plan', prePlanMode: 'ask' | 'auto_all' | null) {
    const q = await import('@/lib/db/queries');
    const model = harness === 'claude' ? 'opus' : MODEL;
    let session;
    if (surface === 'execution') {
      const ws = q.createWorkspace({ name: 'switch', cwd: home.root, isGit: false, filesToCopy: [], status: 'active' });
      session = q.createExecutionWithChat({ workspaceId: ws.id, harness, label: null, model, permissionMode: mode }).session;
    } else {
      session = q.createChatSession({
        harness, model, permissionMode: mode, type: surface === 'main' ? 'orchestration' : 'content',
        ...(surface === 'content' ? { surfaceKind: 'note', surfaceRef: 'switch-note' } : {}),
      });
    }
    q.updateChatSession(session.id, { prePlanMode });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Keep this conversation' });
    const post = async (overrides: { model?: string; effort?: string }) => {
      const body = { providerId: 'antigravity', model: MODEL, ...overrides };
      const request = (data: object) => new Request('http://localhost/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
      });
      if (surface === 'execution') {
        const { POST } = await import('@/app/api/sessions/[id]/new-chat/route');
        return POST(request(body) as never, { params: Promise.resolve({ id: session.id }) });
      }
      if (surface === 'main') {
        const { POST } = await import('@/app/api/orchestrator-chat/route');
        return POST(request(body));
      }
      const { POST } = await import('@/app/api/document-chat/route');
      return POST(request({ ...body, entityType: 'note', entityId: 'switch-note' }));
    };
    return { q, session, post };
  }

  it.each(surfaces)('keeps Antigravity plan mode during model and effort changes in %s chats', async (surface) => {
    const { q, session, post } = await seedSwitch(surface, 'antigravity', 'plan', 'auto_all');
    const modelResponse = await post({ model: MOCK_AGY_MODELS[0].id });
    expect(modelResponse.status).toBe(200);
    const modelChat = (await modelResponse.json()).session;
    expect(modelChat).toMatchObject({ permissionMode: 'plan', prePlanMode: 'auto_all' });
    const effortResponse = await post({ effort: 'max' });
    expect(effortResponse.status).toBe(200);
    const effortChat = (await effortResponse.json()).session;
    expect(effortChat).toMatchObject({ permissionMode: 'plan', prePlanMode: 'auto_all', effort: 'max' });
    expect(effortChat.id).not.toBe(session.id);
    expect(q.getChatSession(effortChat.id)?.permissionMode).toBe('plan');
  });

  it.each(surfaces)('refuses Claude ask to Antigravity before changing %s chats', async (surface) => {
    const { q, session, post } = await seedSwitch(surface, 'claude', 'ask', null);
    const before = q.listChatSessions({ status: 'active' });
    const response = await post({ effort: 'high' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/ask.*not supported by antigravity/) });
    expect(q.getChatSession(session.id)).toMatchObject({ status: 'active', permissionMode: 'ask' });
    expect(q.listChatSessions({ status: 'active' })).toEqual(before);
  });

  it.each(surfaces)('refuses incompatible pre-plan permissions before changing %s chats', async (surface) => {
    const { q, session, post } = await seedSwitch(surface, 'claude', 'plan', 'ask');
    const response = await post({});
    expect(response.status).toBe(409);
    expect(q.getChatSession(session.id)).toMatchObject({ status: 'active', permissionMode: 'plan', prePlanMode: 'ask' });
    expect(q.listChatSessions({ status: 'active' })).toHaveLength(1);
  });
});
