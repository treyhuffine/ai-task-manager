import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HarnessId } from '@/lib/harness/registry';

const mock = vi.hoisted(() => ({ createSession: vi.fn(), cleanup: vi.fn(), browserMcpServer: vi.fn() }));
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ createSession: mock.createSession }),
  commandInventoryFromEvent: () => null,
  listInstalledSkills: async () => [],
}));
vi.mock('@/lib/agent-skills/shipped', () => ({ removeOwnedProjectSkillLinks: mock.cleanup }));
vi.mock('@/lib/harness/model-discovery', () => ({
  getHarnessModelCatalog: async (harness: string) => [{ id: harness === 'claude' ? 'opus' : harness === 'codex' ? 'gpt-6-astra' : 'test-model' }],
}));
vi.mock('@/lib/harness/runtime', () => ({
  runtimeContextForHarness: async () => ({ config: {}, env: {} }),
  getHarnessRuntime: async (harness: string) => ({ capabilities: {
    sessions: { supported: true }, planMode: { supported: true },
    mcp: { supported: harness === 'claude' }, strictMcpIsolation: { supported: harness === 'claude' },
    concurrentSend: { supported: harness === 'claude' || harness === 'codex' },
    modelVariants: { supported: false }, reasoningEffort: { supported: false },
  } }),
}));
vi.mock('@/lib/orchestrator/harness-surface', async (original) => ({
  ...await original<typeof import('@/lib/orchestrator/harness-surface')>(),
  installOrchestratorSurface: async () => {}, orchestratorSessionConfig: () => ({}),
  integrationsMcpServer: () => null, browserMcpServer: mock.browserMcpServer,
}));

describe('scoped handoff guidance and general agent instructions at the dispatch boundary', () => {
  let root: string;
  let folder: string;
  let previous: Record<string, string | undefined>;
  let q: typeof import('@/lib/db/queries');
  let executor: typeof import('./adapter');

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-instruction-delivery-'));
    folder = path.join(root, 'agent');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'README.md'), 'User folder\n');
    previous = Object.fromEntries(['RI_ROOT', 'RI_DB_PATH', 'RI_WORK_DIR', 'RI_CONFIG_DIR', 'RI_MIRROR_DISABLED'].map((key) => [key, process.env[key]]));
    process.env.RI_ROOT = root;
    process.env.RI_DB_PATH = path.join(root, 'data.db');
    process.env.RI_WORK_DIR = path.join(root, '.work');
    process.env.RI_CONFIG_DIR = path.join(root, '.config');
    process.env.RI_MIRROR_DISABLED = '1';
    vi.resetModules(); vi.clearAllMocks();
    q = await import('@/lib/db/queries');
    executor = await import('./adapter');
    executor._resetExecutorState();
    (await import('@/lib/work-results/capabilities')).setWorkResultCapabilities({ handoffsEnabled: false, aiReviewEnabled: false });
    mock.cleanup.mockResolvedValue({ entries: [] });
    mock.browserMcpServer.mockReturnValue(null);
    mock.createSession.mockImplementation(async () => ({
      sessionId: `provider-session-${mock.createSession.mock.calls.length}`, close: vi.fn(async () => {}),
      send: vi.fn(async () => ({ result: Promise.resolve({ status: 'completed', summary: 'ok' }) })),
    }));
    q.updateUserState({ workResultGuidance: 'SHARED HANDOFF: Include concise verification.' });
  });

  afterEach(async () => {
    executor._resetExecutorState();
    (await import('@/lib/db')).resetDb();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seed(harness: HarnessId, surface: string, resumed: boolean) {
    const workspace = surface === 'agent' || surface === 'execution'
      ? q.createWorkspace({ name: 'Code', cwd: folder, isGit: surface === 'agent', instructions: 'AGENT: Explain changes.',
        workResultGuidance: 'AGENT HANDOFF: Include migration evidence.' })
      : null;
    const execution = surface === 'execution' ? q.createExecution({ workspaceId: workspace!.id }) : null;
    const session = q.createChatSession({ harness, model: harness === 'claude' ? 'opus' : harness === 'codex' ? 'gpt-6-astra' : 'test-model',
      type: surface === 'execution' ? 'execution' : surface === 'task' || surface === 'note' ? 'content' : 'orchestration',
      workspaceId: workspace?.id ?? null, executionId: execution?.id ?? null,
      surfaceKind: surface === 'task' || surface === 'note' ? surface : null,
      surfaceRef: surface === 'task' || surface === 'note' ? 'focused-entity' : null,
      externalSessionId: resumed ? `earlier-provider-session-${surface}` : null,
    });
    return { workspace, session };
  }

  it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const)(
    'delivers Slack presentation and audience on fresh, resumed and cached %s turns', async harness => {
      for (const resumed of [false, true]) {
        const { session } = seed(harness, 'app', resumed);
        const connection = q.createConversationConnection({ id: session.id, provider: 'slack', name: 'Ri Personal',
          enabled: true, workspaceId: null, externalWorkspaceId: 'T001', externalAgentId: resumed ? 'UBOT_RESUMED' : 'UBOT_FRESH', channels: ['C001'] });
        const thread = q.ensureConversationThread(connection.id, 'C001', '123.000001');
        q.bindConversationThread(thread.id, session.id);
        await executor.dispatch(session.id, 'List my tasks.', { internalCall: true });
        const handle = await mock.createSession.mock.results.at(-1)!.value;
        await executor.dispatch(session.id, 'And the overdue ones?', { internalCall: true });
        for (const [message] of handle.send.mock.calls as [string][]) {
          expect(message).toContain('Response format for this Slack conversation');
          expect(message).toContain('actual task, note, area and agent names');
          expect(message).toContain('delivered to its originating conversation automatically');
          expect(message).toContain("replace Ri's UI-only entity-reference");
        }
        expect(handle.send).toHaveBeenCalledTimes(2);
        await executor.close(session.id);
      }
    },
  );

  it("carries the status line rule on an execution's messages while status lines are on, and on no other chat", async () => {
    const sent = async (surface: string) => {
      const { session } = seed('claude', surface, false);
      await executor.dispatch(session.id, 'Fix the login bug.', { internalCall: true });
      const handle = await mock.createSession.mock.results.at(-1)!.value;
      const message: string = handle.send.mock.calls.at(-1)![0];
      await executor.close(session.id);
      return message;
    };
    const execution = await sent('execution');
    expect(execution).toContain('# Status line');
    expect(execution).toContain('set_chat_status');
    expect(execution.endsWith('Fix the login bug.')).toBe(true);
    for (const surface of ['app', 'agent', 'task']) expect(await sent(surface)).not.toContain('# Status line');
    q.updateUserState({ chatStatusLines: false });
    expect(await sent('execution')).toBe('Fix the login bug.');
  });

  it('attaches the signed email draft surface to an ordinary execution', async () => {
    (await import('@/lib/auth/config-file')).writeAuthConfig({ localToken: 'instruction-test-token' });
    const { session } = seed('claude', 'execution', false);
    await executor.dispatch(session.id, 'Draft an email', { internalCall: true });
    const call = mock.createSession.mock.calls.at(-1)![0];
    expect(call.config.mcpServers).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'email', url: expect.stringContaining('/api/orchestrator/email/mcp') })]));
    expect(fs.readFileSync(call.config.instructionsFile, 'utf8')).toContain('create_email_draft');
    await executor.close(session.id);
  });

  it('delivers browser connection guidance with an attached browser, without needing to load a skill', async () => {
    const { BROWSER_CONNECTION_INSTRUCTIONS } = await import('@/lib/browser/instructions');
    mock.browserMcpServer.mockReturnValue({ name: 'browser', type: 'http', url: 'http://localhost:5151/api/orchestrator/browser/mcp?profile=test' });
    const { session } = seed('claude', 'execution', false);
    await executor.dispatch(session.id, 'Use the open browser.', { internalCall: true });
    let call = mock.createSession.mock.calls.at(-1)![0];
    expect(call.config.mcpServers).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'browser' })]));
    expect(fs.readFileSync(call.config.instructionsFile, 'utf8')).toContain(BROWSER_CONNECTION_INSTRUCTIONS);
    await executor.close(session.id);

    mock.browserMcpServer.mockReturnValue(null);
    const withoutBrowser = seed('claude', 'execution', false).session;
    await executor.dispatch(withoutBrowser.id, 'Continue working.', { internalCall: true });
    call = mock.createSession.mock.calls.at(-1)![0];
    expect(fs.readFileSync(call.config.instructionsFile, 'utf8')).not.toContain(BROWSER_CONNECTION_INSTRUCTIONS);
    await executor.close(withoutBrowser.id);
  });

  it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const)(
    'keeps handoff preferences out of fresh, resumed and cached %s ordinary chats', async (harness) => {
      // Status lines add their own rule to an execution's messages (checked
      // below). This is about handoff preferences alone.
      q.updateUserState({ chatStatusLines: false });
      for (const surface of ['app', 'task', 'note', 'agent', 'execution']) {
        for (const resumed of [false, true]) {
          const { workspace, session } = seed(harness, surface, resumed);
          const original = q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'CURRENT: Answer in detail.' })!;
          const folderBefore = fs.readdirSync(folder, { recursive: true }).map(String).sort();
          await executor.dispatch(session.id, original.content!, { internalCall: true });
          const call = mock.createSession.mock.calls.at(-1)![0];
          const handle = await mock.createSession.mock.results.at(-1)!.value;
          const native = harness === 'claude' || harness === 'codex' || harness === 'antigravity';
          const context = native ? fs.readFileSync(call.config.instructionsFile, 'utf8') : handle.send.mock.calls.at(-1)![0];
          expect(context).not.toContain('SHARED HANDOFF:');
          expect(context).not.toContain('AGENT HANDOFF:');
          expect(context).toContain('current request takes precedence');
          expect(context).toContain('read-only restrictions');
          if (workspace) {
            expect(context).toContain('AGENT: Explain changes.');
          }
          if (surface === 'agent') {
            expect(context).toContain('Never edit files in this folder');
            expect(fs.readdirSync(folder, { recursive: true }).map(String).sort()).toEqual(folderBefore);
          }
          if (surface === 'task' || surface === 'note') expect(context).toContain('focused-entity');
          if (resumed) expect(call.sessionParams.sessionId).toBe(`earlier-provider-session-${surface}`);
          const builds = mock.createSession.mock.calls.length;
          await executor.dispatch(session.id, 'CACHED: Continue.', { internalCall: true });
          expect(mock.createSession).toHaveBeenCalledTimes(builds);
          if (!native && workspace) expect(handle.send.mock.calls.at(-1)![0]).toContain('AGENT: Explain changes.');
          if (native && !(harness === 'antigravity' && resumed)) expect(handle.send.mock.calls.at(-1)![0]).toBe('CACHED: Continue.');
          expect(handle.send.mock.calls.at(-1)![0]).not.toContain('SHARED HANDOFF:');
          expect(q.listChatEvents(session.id).find((event) => event.id === original.id)?.content).toBe(original.content);
          await executor.close(session.id);
        }
      }
    },
  );

  it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const)('replaces and clears general agent instructions on cached %s chats', async (harness) => {
    const { workspace, session } = seed(harness, 'agent', true);
    await executor.dispatch(session.id, 'First request', { internalCall: true });
    const handle = await mock.createSession.mock.results.at(-1)!.value;
    q.updateWorkspace(workspace!.id, { instructions: 'AGENT: Use comparisons.' });
    // The submitted message must use current DB values even if a settings
    // change lands before the scheduled native-session recycle can finish.
    await executor.dispatch(session.id, 'Second request', { internalCall: true });
    let sent = handle.send.mock.calls.at(-1)![0];
    expect(sent).toContain('AGENT: Use comparisons.');
    expect(sent).not.toContain('Explain changes.');
    q.updateWorkspace(workspace!.id, { instructions: null });
    await executor.dispatch(session.id, 'Third request', { internalCall: true });
    sent = handle.send.mock.calls.at(-1)![0];
    expect(sent).toContain('No agent instructions apply to this chat.');
    expect(sent).toContain('replaces earlier agent instruction preferences');
    expect(sent).not.toContain('Use comparisons.');
    await executor.recycleWhenIdle(session.id);
    await executor.dispatch(session.id, 'After recycle', { internalCall: true });
    const call = mock.createSession.mock.calls.at(-1)![0];
    if (call.config.instructionsFile) {
      const rebuilt = fs.readFileSync(call.config.instructionsFile, 'utf8');
      expect(rebuilt).toContain('No agent instructions apply to this chat.');
      expect(rebuilt).not.toContain('Use comparisons.');
    }
  });

  it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const)('delivers only feature discovery to %s ordinary author turns', async (harness) => {
    const capabilities = await import('@/lib/work-results/capabilities');
    capabilities.setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: true });
    for (const surface of ['app', 'task', 'note', 'agent', 'execution']) {
      const { session } = seed(harness, surface, true);
      await executor.dispatch(session.id, 'Progress update', { internalCall: true });
      const handle = await mock.createSession.mock.results.at(-1)!.value;
      let sent = handle.send.mock.calls.at(-1)![0];
      expect(sent).toContain('call get_handoff_context before preparing or reporting');
      expect(sent).toContain('Use ordinary chat for progress');
      expect(sent).not.toContain('SHARED HANDOFF:');
      expect(sent).not.toContain('AGENT HANDOFF:');
      expect(sent).not.toContain('Upload an existing local screenshot');
      await executor.dispatch(session.id, 'Cached progress update', { internalCall: true });
      sent = handle.send.mock.calls.at(-1)![0];
      expect(sent).toContain('get_handoff_context');
      expect(sent).not.toContain('SHARED HANDOFF:');
      capabilities.setWorkResultCapabilities({ handoffsEnabled: false });
      await executor.dispatch(session.id, 'Another ordinary message', { internalCall: true });
      expect(handle.send.mock.calls.at(-1)![0]).not.toContain('get_handoff_context');
      capabilities.setWorkResultCapabilities({ handoffsEnabled: true });
      await executor.close(session.id);
    }
  });

  it('refreshes preferences if settings change while native session startup is awaiting', async () => {
    const { workspace, session } = seed('codex', 'agent', false);
    mock.createSession.mockImplementationOnce(async () => {
      q.updateWorkspace(workspace!.id, { instructions: 'AGENT: Changed during startup.' });
      await executor.recycleWhenIdle(session.id);
      return { sessionId: 'provider-session', close: vi.fn(async () => {}),
        send: vi.fn(async () => ({ result: Promise.resolve({ status: 'completed', summary: 'ok' }) })) };
    });
    await executor.dispatch(session.id, 'Current request', { internalCall: true });
    const handle = await mock.createSession.mock.results[0].value;
    expect(handle.send.mock.calls[0][0]).toContain('AGENT: Changed during startup.');
    expect(handle.close).toHaveBeenCalledOnce();
    expect(executor.hasHarnessSession(session.id)).toBe(false);
  });

  it.each(['claude', 'codex', 'cursor', 'opencode', 'antigravity'] as const)(
    'retires live overrides when %s cached preferences return to their spawn value, including unset', async (harness) => {
      for (const initial of ['AGENT: Initial preference.', null]) {
        const { workspace, session } = seed(harness, 'agent', false);
        q.updateWorkspace(workspace!.id, { instructions: initial });
        await executor.dispatch(session.id, 'Initial request', { internalCall: true });
        const handle = await mock.createSession.mock.results.at(-1)!.value;
        q.updateWorkspace(workspace!.id, { instructions: 'AGENT: Temporary preference.' });
        await executor.dispatch(session.id, 'Temporary request', { internalCall: true });
        expect(handle.send.mock.calls.at(-1)![0]).toContain('Temporary preference.');
        q.updateWorkspace(workspace!.id, { instructions: initial });
        await executor.dispatch(session.id, 'Restored request', { internalCall: true });
        const restored = handle.send.mock.calls.at(-1)![0];
        expect(restored).toContain(initial ?? 'No agent instructions apply to this chat.');
        expect(restored).not.toContain('Temporary preference.');
        await executor.close(session.id);
      }
    },
  );

  it('replaces a possibly accepted live override after a native send fails', async () => {
    const { workspace, session } = seed('codex', 'agent', false);
    await executor.dispatch(session.id, 'Initial request', { internalCall: true });
    const handle = await mock.createSession.mock.results[0].value;
    q.updateWorkspace(workspace!.id, { instructions: 'AGENT: Possibly accepted preference.' });
    handle.send.mockRejectedValueOnce(new Error('Send interrupted after acceptance'));
    await expect(executor.dispatch(session.id, 'Interrupted request', { internalCall: true }))
      .rejects.toThrow('Send interrupted');
    q.updateWorkspace(workspace!.id, { instructions: 'AGENT: Explain changes.' });
    await executor.dispatch(session.id, 'Retry request', { internalCall: true });
    expect(handle.send.mock.calls.at(-1)![0]).toContain('AGENT: Explain changes.');
  });
});
