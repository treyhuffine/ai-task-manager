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
    expect(agy.stdin().map((line) => line.message.content)).toEqual(['first', 'second']);

    const conversation = q.getChatSession(session.id)!.externalSessionId!;
    await close(session.id);
    await dispatch(session.id, 'third');

    const spawns = agy.sessionSpawns();
    expect(spawns).toHaveLength(2);
    expect(flagValue(spawns[1]!, '--conversation')).toBe(conversation);
    expect(q.getChatSession(session.id)!.externalSessionId).toBe(conversation);
    expect(q.listChatEvents(session.id).some((event) => event.content === 'agy heard: third')).toBe(true);
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
