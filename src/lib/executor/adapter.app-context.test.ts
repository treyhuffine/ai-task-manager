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

function coordinationAssignment(q: typeof import('@/lib/db/queries'), input: { id: string; sourceSessionId: string; sourceAddress: string; targetAddress: string; targetSessionId: string; requestKey: string; kind: 'question'; content: string; messageEventId: string; parentRequestId?: string }) {
  const { content, messageEventId, ...work } = input;
  const request = q.createAgentRequest(work);
  q.createAgentDelivery({ id: input.id, requestId: input.id, sourceSessionId: input.sourceSessionId, kind: 'request', senderKind: 'agent', targetAddress: input.targetAddress, targetSessionId: input.targetSessionId, eventId: messageEventId, payload: {version:1, content, prompt:content, attachments:[]}, status:'queued' });
  q.persistAgentDelivery(input.id);
  return request;
}

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
  function queuedSend(senderSessionId?: string) {
    const session = q.createChatSession({ harness: 'claude', type: 'content' });
    const message = q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', senderSessionId, content: 'What fits here?', raw: { connectedAppContext: context } })!;
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

  it('refuses a cancelled assignment after preparation and in the device queue', async () => {
    const source = q.createChatSession({ type: 'orchestration', harness: 'claude' });
    const { session, message, command } = queuedSend(source.id);
    const request = coordinationAssignment(q, { id: 'cancelled-assignment', sourceSessionId: source.id, sourceAddress: 'orchestrator', targetAddress: `session:${session.id}`, targetSessionId: session.id, requestKey: 'cancelled', kind: 'question', content: message.content!, messageEventId: message.id });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    mock.turnContext.mockImplementationOnce(async () => { await gate; return ''; });
    const pending = executor.dispatch(session.id, 'Review', { sourceEventId: message.id });
    const refused = expect(pending).rejects.toMatchObject({ code: 'invalid_state' });
    await vi.waitFor(() => expect(mock.turnContext).toHaveBeenCalled());
    q.finishAgentRequest(request.id, 'cancelled', 'Cancelled');
    release();
    await refused;
    expect(q.getRunForSourceEvent(message.id)).toBeNull();
    expect(mock.createSession).not.toHaveBeenCalled();
    expect(await executor.queuedSendRefusal(command)).toContain('request has ended');
    expect((await executor.recheckQueuedSends([command])).map(row => row.id)).toEqual([command.id]);
  });

  it.each(['input', 'continuation'])('does not send a cancelled assignment %s when harness startup finishes after abort', async (kind) => {
    const session = q.createChatSession({ type: 'content', harness: 'claude' });
    const source = q.createChatSession({ type: 'orchestration', harness: 'claude' });
    const message = q.insertChatEvent({ sessionId: session.id, senderSessionId: source.id, role: 'user', source: 'user', content: 'Review' })!;
    const request = coordinationAssignment(q, { id: 'cancel-during-spawn', sourceSessionId: source.id, sourceAddress: 'orchestrator', targetAddress: `session:${session.id}`, targetSessionId: session.id, requestKey: 'during-spawn', kind: 'question', content: 'Review', messageEventId: message.id });
    let eventId = message.id;
    if (kind === 'continuation') {
      q.updateAgentRequest(request.id, { status: 'waiting' });
      const child = coordinationAssignment(q, { id: 'completed-child', sourceSessionId: session.id, sourceAddress: `session:${session.id}`, targetAddress: `session:${source.id}`, targetSessionId: source.id, requestKey: 'child-context', parentRequestId: request.id, kind: 'question', content: 'Context', messageEventId: 'child-input' });
      q.finishAgentRequest(child.id, 'completed', 'Here is the context.');
      const answer = q.terminalAgentDelivery(child.id)!;
      q.updateAgentDelivery(answer.id, { targetSessionId: session.id });
      q.persistAgentDelivery(answer.id);
      eventId = answer.eventId;

    }
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const create = mock.createSession.getMockImplementation()!;
    mock.createSession.mockImplementationOnce(async (...args) => { await gate; return create(...args); });
    const reserved = q.reserveAgentRequestTurn(request.id)!;
    const pending = executor.dispatch(session.id, 'Review', { sourceEventId: eventId, runId: reserved.run.id });
    const refused = expect(pending).rejects.toMatchObject({ code: 'invalid_state' });
    await vi.waitFor(() => expect(mock.createSession).toHaveBeenCalled());
    expect(q.getAgentRequest(request.id)?.runId).toBeTruthy();
    q.finishAgentRequest(request.id, 'cancelled', 'Cancelled');
    await executor.abort(session.id);
    release();
    await refused;
    expect(mock.send).not.toHaveBeenCalled();
    expect(q.getAgentRequest(request.id)?.status).toBe('cancelled');
  });

  it('honors Stop during startup without a home admission callback, as a worker must', async () => {
    const session = q.createChatSession({ type: 'content', harness: 'claude' });
    const message = q.insertChatEvent({ sessionId: session.id, source: 'user', role: 'user', content: 'Review' })!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const create = mock.createSession.getMockImplementation()!;
    mock.createSession.mockImplementationOnce(async (...args) => { await gate; return create(...args); });
    const pending = executor.dispatch(session.id, 'Review', { sourceEventId: message.id });
    const refused = expect(pending).rejects.toMatchObject({ code: 'invalid_state', message: expect.stringContaining('Interrupted') });
    await vi.waitFor(() => expect(mock.createSession).toHaveBeenCalled());
    await executor.abort(session.id);
    release();
    await refused;
    expect(mock.send).not.toHaveBeenCalled();
    await executor.dispatch(session.id, 'A later explicit message');
    expect(mock.send).toHaveBeenCalledOnce();
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
