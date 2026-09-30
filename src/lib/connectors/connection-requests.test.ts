import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Row = { id: string; sessionId: string; source: string; content: string | null; toolInput: unknown; toolIsError?: boolean | null };
  return {
    rows: [] as Row[],
    sessions: new Map<string, { id: string; status: string; executionId: string | null; surfaceKind: string | null; externalSessionId: string | null; workspaceId: string | null }>(),
    workspaces: new Map<string, { id: string; name: string; connectorScopes: { toolkitId: string }[] }>(),
    connections: [] as { id: string; providerId: string; email?: string; label?: string }[],
    filterToolkits: new Map<string, string[]>(),
    running: new Set<string>(),
    recycled: [] as string[],
    recycledWorkspaces: [] as string[],
    dispatched: [] as { sessionId: string; text: string }[],
    scopesSet: [] as { id: string; scopes: unknown }[],
    begin: vi.fn(),
    connectDirect: vi.fn(),
  };
});

vi.mock('@/lib/db/queries', () => ({
  getChatEventById: (id: string) => h.rows.find((r) => r.id === id) ?? null,
  getChatSessionWithExecution: (id: string) => h.sessions.get(id) ?? null,
  getWorkspace: (id: string) => h.workspaces.get(id),
  listWorkspaces: () => [...h.workspaces.values()],
  insertChatEvent: (row: Omit<(typeof h.rows)[number], 'id'>) => {
    const inserted = { ...row, id: `row-${h.rows.length + 1}` };
    h.rows.push(inserted);
    return inserted;
  },
  listSessionEventsBySource: (sessionId: string, sources: string[]) =>
    h.rows.filter((r) => r.sessionId === sessionId && sources.includes(r.source)),
  setWorkspaceConnectorScopes: (id: string, scopes: { toolkitId: string }[]) => {
    h.scopesSet.push({ id, scopes });
    const ws = h.workspaces.get(id);
    if (ws) ws.connectorScopes = scopes;
    return ws;
  },
}));
vi.mock('@/lib/executor/adapter', () => ({
  isRunning: (id: string) => h.running.has(id),
  recycleWhenIdle: async (id: string) => {
    h.recycled.push(id);
  },
  recycleWorkspaceSessions: async (id: string) => {
    h.recycledWorkspaces.push(id);
  },
}));
vi.mock('@/lib/executor/health', () => ({ healthCheckSession: async () => ({}) }));
vi.mock('@/lib/sessions/deliver', () => ({
  dispatchSessionTurn: (sessionId: string, _executionId: string | null, text: string) => h.dispatched.push({ sessionId, text }),
}));
vi.mock('./begin-connect', () => ({ beginConnect: h.begin }));
vi.mock('./scopes', () => ({
  validateConnectorScopes: async (scopes: { toolkitId: string }[]) => ({ ok: true, scopes }),
}));
vi.mock('./runtime', () => ({
  getMcpServerStore: () => ({ list: () => [{ slug: 'team_calendar', displayName: 'Team Calendar' }] }),
  getConnectorOwnerId: () => 'local',
  buildCredential: (_kind: string, fields: Record<string, string>) => ({ type: 'api_key', key: Object.values(fields)[0] }),
  resolveWorkspaceConnectorFilter: async (id: string) => ({ toolkits: h.filterToolkits.get(id) ?? [], connectionPins: {}, allowedAccounts: {} }),
  getConnectorRuntime: async () => ({
    getToolkits: () => [
      { id: 'gmail', providerId: 'google', displayName: 'Gmail', actions: [{ scopes: ['gmail.readonly'] }, { scopes: ['gmail.send'] }] },
      { id: 'google_calendar', providerId: 'google', displayName: 'Google Calendar', scopes: ['calendar.events'], actions: [] },
      { id: 'outlook_calendar', providerId: 'microsoft', displayName: 'Outlook Calendar' },
      { id: 'slack', providerId: 'slack', displayName: 'Slack' },
      { id: 'todoist', providerId: 'todoist', displayName: 'Todoist' },
      { id: 'telegram', providerId: 'telegram', displayName: 'Telegram' },
      { id: 'mcp_team_calendar', providerId: 'mcp_team_calendar', displayName: 'MCP: team_calendar' },
    ],
    getProviders: () => [{ id: 'telegram', auth: { kind: 'custom' } }],
    listConnections: async () => h.connections,
    connectDirect: h.connectDirect,
  }),
}));

import {
  ConnectionRequestError,
  connectedButUnavailable,
  allowCardForAgent,
  connectCardWithKey,
  declineCard,
  recordPausedConnection,
  requestConnection,
  startCardSignIn,
} from './connection-requests';
import type { ConnectionRequestView } from './connection-catalog';

const CHAT = 'chat-1';
const request = new Request('http://localhost/api/connectors/requests/x');
const ask = (over: Partial<Parameters<typeof requestConnection>[0]> = {}) =>
  requestConnection({ sessionId: CHAT, scopeWorkspaceId: null, service: 'Gmail', reason: 'to read my inbox', ...over });
const cards = () => h.rows.filter((r) => r.source === 'connection_request');
const lastView = () => cards().at(-1)?.toolInput as ConnectionRequestView;
const responses = () => h.rows.filter((r) => r.source === 'connection_response');

beforeEach(() => {
  h.rows.length = 0;
  h.sessions.clear();
  h.sessions.set(CHAT, { id: CHAT, status: 'active', executionId: null, surfaceKind: null, externalSessionId: null, workspaceId: null });
  h.workspaces.clear();
  h.workspaces.set('ws-ri', { id: 'ws-ri', name: 'ri', connectorScopes: [] });
  h.connections.length = 0;
  h.filterToolkits.clear();
  h.running.clear();
  h.recycled.length = 0;
  h.recycledWorkspaces.length = 0;
  h.dispatched.length = 0;
  h.scopesSet.length = 0;
  h.begin.mockReset();
  h.connectDirect.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let the wake-up (health check, then dispatch) run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('requestConnection', () => {
  it('needs a chat to put the card in', async () => {
    expect((await ask({ sessionId: null })).status).toBe('no_chat');
    expect((await ask({ sessionId: 'gone' })).status).toBe('no_chat');
    expect(cards()).toEqual([]);
  });

  it('answers without a card when the service is unsupported or ambiguous', async () => {
    expect(await ask({ service: 'Spotify' })).toMatchObject({ status: 'unsupported' });
    expect(await ask({ service: 'my calendar' })).toMatchObject({
      status: 'ambiguous',
      options: ['Google Calendar', 'Outlook Calendar'],
    });
    expect(cards()).toEqual([]);
  });

  it('shows a Connect card when the account is not connected', async () => {
    const result = await ask();
    expect(result).toMatchObject({ status: 'card_shown', service: 'Gmail' });
    expect(result.message).toContain('stop and wait');
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({ sessionId: CHAT, content: 'Connect Gmail' });
    expect(lastView()).toMatchObject({
      kind: 'connect',
      providerId: 'google',
      providerName: 'Google',
      label: 'Gmail',
      toolkitIds: ['gmail'],
      method: 'oauth2',
      reason: 'to read my inbox',
      requestedBy: 'agent',
      agent: null,
      onBehalf: false,
    });
  });

  it('carries the key fields for a service that connects with a key', async () => {
    await ask({ service: 'Telegram' });
    expect(lastView()).toMatchObject({ method: 'custom', credentialFields: ['token'] });
  });

  it('sends a hosted MCP service to Settings: no sign-in or key from the card', async () => {
    await ask({ service: 'Todoist' });
    expect(lastView()).toMatchObject({ method: 'mcp' });
    await expect(startCardSignIn(request, cards()[0]!.id, null)).rejects.toThrow(/Settings, under Connectors/);
    await expect(connectCardWithKey(cards()[0]!.id, { token: 'x' })).rejects.toThrow(/Settings, under Connectors/);
    expect(h.connectDirect).not.toHaveBeenCalled();
  });

  it('tells the main chat a connected account is already there, and reloads its tools', async () => {
    h.connections.push({ id: 'c1', providerId: 'google', email: 'me@example.com' });
    expect(await ask()).toMatchObject({ status: 'already_available' });
    expect(h.recycled).toEqual([CHAT]);
    expect(cards()).toEqual([]);
  });

  it('offers to give an agent access to a connected account it cannot use', async () => {
    h.connections.push({ id: 'c1', providerId: 'google', email: 'me@example.com' });
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'card_shown' });
    expect(lastView()).toMatchObject({
      kind: 'allow_agent',
      agent: { workspaceId: 'ws-ri', name: 'ri' },
      account: 'me@example.com',
      connectionId: 'c1',
    });
    h.filterToolkits.set('ws-ri', ['gmail']);
    h.rows.length = 0;
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'already_available' });
  });

  it('resolves an MCP server by the name the user gave it, for agent access only', async () => {
    // Not running (no connection): nothing to sign in to, it's managed in Settings.
    expect(await ask({ service: 'Team Calendar', scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'unsupported' });
    h.connections.push({ id: 'mcp_team_calendar', providerId: 'mcp_team_calendar', label: 'team_calendar' });
    expect(await ask({ service: 'the team calendar', scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'card_shown' });
    expect(lastView()).toMatchObject({ kind: 'allow_agent', label: 'Team Calendar', toolkitIds: ['mcp_team_calendar'], account: null });
  });

  it('asks for another agent by name, and says which agents exist otherwise', async () => {
    expect(await ask({ forAgent: 'nope' })).toMatchObject({ status: 'unknown_agent', agents: ['ri'] });
    expect(await ask({ forAgent: 'RI' })).toMatchObject({ status: 'card_shown' });
    expect(lastView()).toMatchObject({ agent: { workspaceId: 'ws-ri', name: 'ri' }, onBehalf: true });
  });

  it('keeps one open card per service per chat', async () => {
    await ask();
    expect(await ask({ service: 'google' })).toMatchObject({ status: 'already_asked' });
    expect(cards()).toHaveLength(1);
  });

  it("doesn't ask again after a decline unless the user asked", async () => {
    await ask();
    await declineCard(cards()[0]!.id);
    expect(await ask()).toMatchObject({ status: 'declined_earlier' });
    expect(await ask({ userAsked: true })).toMatchObject({ status: 'card_shown' });
  });
});

describe('connectedButUnavailable', () => {
  it("names the connected services an agent can't use yet, by the names the user knows", async () => {
    h.connections.push({ id: 'c1', providerId: 'google', email: 'me@example.com' });
    h.connections.push({ id: 'mcp_team_calendar', providerId: 'mcp_team_calendar' });
    h.filterToolkits.set('ws-ri', ['gmail']);
    expect(await connectedButUnavailable('ws-ri')).toEqual(['Google Calendar', 'Team Calendar']);
  });
});

describe('recordPausedConnection', () => {
  it('turns an auth failure on a known connection into a Reconnect card', async () => {
    h.connections.push({ id: 'c1', providerId: 'google', email: 'me@example.com' });
    await recordPausedConnection({
      sessionId: CHAT,
      scopeWorkspaceId: null,
      outcome: {
        ok: false,
        reason: 'auth_required',
        providerId: 'google',
        authorizationUrl: `http://localhost:4224/connect?provider=google&scopes=${encodeURIComponent('["gmail.readonly"]')}&client=byo-1&connection=c1`,
      },
    });
    expect(cards()[0]).toMatchObject({ content: 'Reconnect Google' });
    expect(lastView()).toMatchObject({
      kind: 'reconnect',
      requestedBy: 'app',
      reason: null,
      connectionId: 'c1',
      account: 'me@example.com',
      scopes: ['gmail.readonly'],
      authConfigId: 'byo-1',
    });
  });

  it('turns missing scopes into a More access card, once while it is open', async () => {
    const outcome = { ok: false as const, reason: 'needs_consent' as const, providerId: 'google', connectionId: 'c1', missingScopes: ['gmail.send'], authorizationUrl: 'x' };
    await recordPausedConnection({ sessionId: CHAT, scopeWorkspaceId: null, outcome });
    await recordPausedConnection({ sessionId: CHAT, scopeWorkspaceId: null, outcome });
    expect(cards()).toHaveLength(1);
    expect(lastView()).toMatchObject({ kind: 'more_access', scopes: ['gmail.send'] });
  });

  it('ignores calls with no chat and other pauses', async () => {
    await recordPausedConnection({ sessionId: null, scopeWorkspaceId: null, outcome: { ok: false, reason: 'auth_required', providerId: 'google', authorizationUrl: 'x' } });
    await recordPausedConnection({ sessionId: CHAT, scopeWorkspaceId: null, outcome: { ok: false, reason: 'approval_required', actionId: 'a', risk: 'high', preview: {} } });
    expect(cards()).toEqual([]);
  });
});

describe('answering a card', () => {
  it('starts the sign-in with what the card needs, and resolves it when the sign-in lands', async () => {
    await ask();
    const id = cards()[0]!.id;
    h.begin.mockResolvedValue({ requestId: 'auth-1', authorizationUrl: 'https://accounts.example/auth' });
    expect(await startCardSignIn(request, id, '/?session=chat-1')).toMatchObject({ authorizationUrl: 'https://accounts.example/auth' });
    const opts = h.begin.mock.calls[0]![1];
    // Asks for what Gmail's actions need in the one sign-in, not just the sign-in identity.
    expect(opts).toMatchObject({ providerId: 'google', returnTo: '/?session=chat-1', scopes: ['gmail.readonly', 'gmail.send'] });

    await opts.onCompleted({ id: 'c9', providerId: 'google', email: 'me@example.com' });
    await settle();
    expect(responses()[0]).toMatchObject({ content: 'Connected: Gmail (me@example.com)', toolInput: { outcome: 'connected', account: 'me@example.com' } });
    // Reload first, so the note starts a turn that has the new tools.
    expect(h.recycled).toEqual([CHAT]);
    expect(h.dispatched[0]!.text).toContain('The user connected Gmail (account me@example.com).');
  });

  it('resolves at once when the account got connected meanwhile', async () => {
    await ask();
    h.connections.push({ id: 'c1', providerId: 'google', email: 'me@example.com' });
    expect(await startCardSignIn(request, cards()[0]!.id, null)).toEqual({ done: true });
    expect(h.begin).not.toHaveBeenCalled();
    expect(responses()).toHaveLength(1);
  });

  it('reconnects through the existing connection and its scopes', async () => {
    await recordPausedConnection({ sessionId: CHAT, scopeWorkspaceId: null, outcome: { ok: false, reason: 'needs_consent', providerId: 'google', connectionId: 'c1', missingScopes: ['gmail.send'], authorizationUrl: 'x' } });
    h.begin.mockResolvedValue({ requestId: 'auth-2', authorizationUrl: 'u' });
    await startCardSignIn(request, cards()[0]!.id, null);
    expect(h.begin.mock.calls[0]![1]).toMatchObject({ existingConnectionId: 'c1', scopes: ['gmail.send'] });
  });

  it('connects a key service with the typed fields', async () => {
    await ask({ service: 'Telegram' });
    h.connectDirect.mockResolvedValue({ id: 'c2', providerId: 'telegram', label: 'Telegram' });
    await connectCardWithKey(cards()[0]!.id, { token: 'tok_123' });
    expect(h.connectDirect).toHaveBeenCalledWith('telegram', { credential: { type: 'api_key', key: 'tok_123' } });
    expect(responses()[0]).toMatchObject({ toolInput: { outcome: 'connected' } });
  });

  it('gives an agent access through its connector scope, and recycles its sessions', async () => {
    h.connections.push({ id: 'c1', providerId: 'google', email: 'me@example.com' });
    await ask({ scopeWorkspaceId: 'ws-ri' });
    await allowCardForAgent(cards()[0]!.id);
    await settle();
    expect(h.scopesSet).toEqual([{ id: 'ws-ri', scopes: [{ toolkitId: 'gmail' }] }]);
    expect(h.recycledWorkspaces).toEqual(['ws-ri']);
    expect(responses()[0]).toMatchObject({ content: 'Allowed: Gmail (me@example.com)' });
    expect(h.dispatched[0]!.text).toContain('allowed this agent to use Gmail');
  });

  it('grants a connection made for an agent to that agent', async () => {
    await ask({ scopeWorkspaceId: 'ws-ri' });
    h.begin.mockResolvedValue({ requestId: 'a', authorizationUrl: 'u' });
    await startCardSignIn(request, cards()[0]!.id, null);
    await h.begin.mock.calls[0]![1].onCompleted({ id: 'c1', providerId: 'google', email: 'me@example.com' });
    expect(h.scopesSet).toEqual([{ id: 'ws-ri', scopes: [{ toolkitId: 'gmail' }] }]);
  });

  it('records Not now and tells the agent without reloading it', async () => {
    await ask();
    await declineCard(cards()[0]!.id);
    await settle();
    expect(responses()[0]).toMatchObject({ content: 'Not now: Gmail', toolIsError: true });
    expect(h.recycled).toEqual([]);
    expect(h.dispatched[0]!.text).toContain('chose not to connect Gmail');
  });

  it('refuses a card that was already answered, or never existed', async () => {
    await ask();
    const id = cards()[0]!.id;
    await declineCard(id);
    await expect(declineCard(id)).rejects.toMatchObject({ code: 'already_answered' });
    await expect(declineCard('nope')).rejects.toBeInstanceOf(ConnectionRequestError);
  });

  it('waits for a running turn to end before waking the agent', async () => {
    vi.useFakeTimers();
    await ask();
    h.running.add(CHAT);
    await declineCard(cards()[0]!.id);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.dispatched).toEqual([]);
    h.running.delete(CHAT);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(h.dispatched).toHaveLength(1);
  });
});
