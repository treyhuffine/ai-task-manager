import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Connected app context and app-sent messages at dispatch: a send waiting in
 * a device's queue is rechecked before the device takes it, and a message an
 * app sent binds none of the person's sources.
 */
const mock = vi.hoisted(() => ({
  createSession: vi.fn(), send: vi.fn(), close: vi.fn(), interrupt: vi.fn(),
  turnContext: vi.fn(), connectedTurnContext: vi.fn(),
}));
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({ createSession: mock.createSession }),
  commandInventoryFromEvent: () => null, listInstalledSkills: async () => [],
  parseAskUserQuestion: () => null,
}));
vi.mock('@/lib/harness/model-discovery', () => ({
  getHarnessModelCatalog: async () => [{ id: 'opus', supportedEfforts: ['high'] }],
  resolveHarnessSelection: async () => ({ providerId: 'claude', model: 'opus', variant: null, effort: 'high' }),
}));
vi.mock('@/lib/harness/runtime', () => ({
  runtimeContextForHarness: async () => ({}),
  getHarnessRuntime: async () => ({ capabilities: {
    sessions: { supported: true }, planMode: { supported: true }, mcp: { supported: true }, strictMcpIsolation: { supported: true },
    concurrentSend: { supported: true }, modelVariants: { supported: false }, reasoningEffort: { supported: true },
  } }),
}));
vi.mock('@/lib/orchestrator/harness-surface', () => ({
  resolveCliCommand: () => 'ri', resolveServerPort: () => 0,
  installOrchestratorSurface: async () => {}, orchestratorSessionConfig: () => ({}),
  integrationsMcpServer: () => null, browserMcpServer: () => null, renderContentFocusPrompt: () => '',
}));
vi.mock('@/lib/attachments/expand-markers', () => ({ expandMarkers: async (text: string) => text }));
vi.mock('@/lib/entity-refs/expand-markers', () => ({ expandEntityMarkers: (text: string) => text }));
vi.mock('@/lib/server/chat-sources', () => ({ chatSources: { turnContext: mock.turnContext } }));
vi.mock('@/lib/mcp-apps/service', () => ({ connectedTurnContext: mock.connectedTurnContext }));
vi.mock('@/lib/mcp-apps/context-files', () => ({ contextAttachments: () => [] }));

describe('connected app context at dispatch', () => {
  let root: string;
  let previous: Record<string, string | undefined>;
  let q: typeof import('@/lib/db/queries');
  let executor: typeof import('./adapter');
  const context = [{ sourceRef: 'fixture', title: 'Bits & Bolts', serverId: 'server-1', context: { content: [{ type: 'text', text: 'Selected: M6 bolt' }] } }];

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-app-context-'));
    previous = Object.fromEntries(['RI_ROOT', 'RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_MIRROR_DISABLED', 'RI_LOCAL_APPS'].map((key) => [key, process.env[key]]));
    process.env.RI_ROOT = root;
    process.env.RI_DB_PATH = path.join(root, 'data.db');
    process.env.RI_CONFIG_DIR = path.join(root, '.config');
    process.env.RI_MIRROR_DISABLED = '1';
    process.env.RI_LOCAL_APPS = '0';
    vi.resetModules(); vi.clearAllMocks();
    q = await import('@/lib/db/queries');
    executor = await import('./adapter');
    executor._resetExecutorState();
    mock.turnContext.mockResolvedValue('\n\n<ri-chat-sources>bound account</ri-chat-sources>');
    mock.connectedTurnContext.mockResolvedValue([{ sourceRef: 'fixture', app: 'Bits & Bolts', context: context[0]!.context }]);
    mock.send.mockResolvedValue({ result: Promise.resolve({ status: 'completed', summary: null }) });
    mock.close.mockResolvedValue(undefined); mock.interrupt.mockResolvedValue(undefined);
    mock.createSession.mockImplementation(async () => ({ sessionId: 'provider-session', send: mock.send, close: mock.close, interrupt: mock.interrupt }));
  });

  afterEach(async () => {
    await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
    executor._resetExecutorState();
    (await import('@/lib/db')).resetDb();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A message waiting in a device's queue, carrying app context frozen when it was sent. */
  function queuedSend() {
    const session = q.createChatSession({ harness: 'claude', type: 'content' });
    const message = q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'What fits here?', raw: { connectedAppContext: context } })!;
    const device = q.createDevice({ name: 'Laptop', kind: 'computer' });
    const command = q.queueWorkerCommand({ deviceId: device.id, kind: 'send', chatSessionId: session.id, sourceEventId: message.id, payload: {}, actor: { source: 'human' } });
    return { session, message, command };
  }

  it('withdraws a queued send whose app context is no longer allowed, and says so in its chat as final', async () => {
    const { session, message, command } = queuedSend();
    mock.connectedTurnContext.mockRejectedValueOnce(new Error('This app context is no longer available to the chat'));
    const withdrawn = await executor.recheckQueuedSends([command]);
    expect(withdrawn.map((item) => item.id)).toEqual([command.id]);
    expect(mock.connectedTurnContext).toHaveBeenCalledWith(session.id, context);
    expect(q.getSendForEvent(message.id)).toMatchObject({ state: 'cancelled', error: "This message wasn't sent: This app context is no longer available to the chat" });
    const refusal = q.listRecentChatEvents(session.id, 5).find((event) => event.source === 'error');
    expect(refusal).toMatchObject({ content: "This message wasn't sent: This app context is no longer available to the chat", raw: { subtype: 'send_refused', messageId: message.id } });
  });

  it('leaves a queued send whose context is still allowed, and one with no app context, waiting', async () => {
    const { message, command } = queuedSend();
    expect(await executor.recheckQueuedSends([command])).toEqual([]);
    expect(q.getSendForEvent(message.id)).toMatchObject({ state: 'queued' });
    expect(await executor.queuedSendRefusal({ kind: 'send', chatSessionId: null, sourceEventId: null })).toBeNull();
    expect(await executor.queuedSendRefusal({ kind: 'stop', chatSessionId: command.chatSessionId, sourceEventId: command.sourceEventId })).toBeNull();
  });

  it('binds the person\'s sources to their own message', async () => {
    const session = q.createChatSession({ harness: 'claude', type: 'content' });
    const own = q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Summarize my inbox' })!;
    await executor.dispatch(session.id, 'Summarize my inbox', { sourceEventId: own.id });
    expect(mock.turnContext).toHaveBeenCalledWith(session.id, own.id);
    expect(JSON.stringify(mock.send.mock.calls.at(-1))).toContain('bound account');
    await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
  });
});
