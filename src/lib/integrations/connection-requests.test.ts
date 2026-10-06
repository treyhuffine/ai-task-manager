import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Row = { id: string; sessionId: string; source: string; content: string | null; toolInput: unknown; toolIsError?: boolean | null };
  return {
    rows: [] as Row[],
    sessions: new Map<string, { id: string; status: string; executionId: string | null; surfaceKind: string | null; externalSessionId: string | null; workspaceId: string | null }>(),
    workspaces: new Map<string, { id: string; name: string; integrationScopes: { toolkitId: string; accounts?: { accountId: string }[] }[] }>(),
    connections: [] as { id: string; providerId: string; accountId: string; email?: string; label?: string }[],
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
  setWorkspaceIntegrationScopes: (id: string, scopes: { toolkitId: string }[]) => {
    h.scopesSet.push({ id, scopes });
    const ws = h.workspaces.get(id);
    if (ws) ws.integrationScopes = scopes;
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
  // As the real one stores them: no pins means every account.
  validateIntegrationScopes: async (scopes: { toolkitId: string; accounts?: unknown[] }[]) => ({
    ok: true,
    scopes: scopes.map((s) => (s.accounts?.length ? s : { toolkitId: s.toolkitId })),
  }),
}));
vi.mock('./runtime', async () => {
  // An agent's access resolves from its stored scopes exactly as at call time.
  const { resolveIntegrationFilter } = await vi.importActual<typeof import('./workspace-filter')>('./workspace-filter');
  const runtime = {
    getToolkits: () => [
      { id: 'gmail', providerId: 'google', displayName: 'Gmail', actions: [{ scopes: ['gmail.readonly'] }, { scopes: ['gmail.send'] }] },
      { id: 'google_calendar', providerId: 'google', displayName: 'Google Calendar', scopes: ['calendar.events'], actions: [] },
      { id: 'outlook_calendar', providerId: 'microsoft', displayName: 'Outlook Calendar' },
      // Hosted services (Slack, Todoist…) register their toolkit only once connected.
      ...(h.connections.some((c) => c.providerId === 'slack') ? [{ id: 'slack', providerId: 'slack', displayName: 'Slack' }] : []),
      { id: 'telegram', providerId: 'telegram', displayName: 'Telegram' },
      { id: 'mcp_team_calendar', providerId: 'mcp_team_calendar', displayName: 'MCP: team_calendar' },
    ],
    getProviders: () => [{ id: 'telegram', auth: { kind: 'custom' } }],
    listConnections: async () => h.connections,
    listAccountChoices: async (providerId: string) =>
      h.connections.filter((c) => c.providerId === providerId).map((c) => ({ connectionId: c.id, email: c.email })),
    connectDirect: h.connectDirect,
  };
  return {
    getMcpServerStore: () => ({ list: () => [{ slug: 'team_calendar', displayName: 'Team Calendar' }] }),
    getIntegrationOwnerId: () => 'local',
    buildCredential: (_kind: string, fields: Record<string, string>) => ({ type: 'api_key', key: Object.values(fields)[0] }),
    resolveWorkspaceIntegrationFilter: (id: string) =>
      resolveIntegrationFilter(h.workspaces.get(id)?.integrationScopes ?? [], runtime as never, 'local'),
    getIntegrationRuntime: async () => runtime,
  };
});

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
const request = new Request('http://localhost/api/integrations/requests/x');
const ask = (over: Partial<Parameters<typeof requestConnection>[0]> = {}) =>
  requestConnection({ sessionId: CHAT, scopeWorkspaceId: null, service: 'Gmail', reason: 'to read my inbox', ...over });
const cards = () => h.rows.filter((r) => r.source === 'connection_request');
const lastView = () => cards().at(-1)?.toolInput as ConnectionRequestView;
const responses = () => h.rows.filter((r) => r.source === 'connection_response');
/** A connected Google account. Its account id is `acct-<id>`. */
const google = (id: string, email: string) => ({ id, providerId: 'google', accountId: `acct-${id}`, email });
const scopesOf = (workspaceId: string) => h.workspaces.get(workspaceId)!.integrationScopes;
const giveScopes = (workspaceId: string, scopes: { toolkitId: string; accounts?: { accountId: string }[] }[]) => {
  h.workspaces.get(workspaceId)!.integrationScopes = scopes;
};

beforeEach(() => {
  h.rows.length = 0;
  h.sessions.clear();
  h.sessions.set(CHAT, { id: CHAT, status: 'active', executionId: null, surfaceKind: null, externalSessionId: null, workspaceId: null });
  h.workspaces.clear();
  h.workspaces.set('ws-ri', { id: 'ws-ri', name: 'ri', integrationScopes: [] });
  h.connections.length = 0;
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

  it('asks for a hosted service that registers no tools until connected', async () => {
    // Slack's toolkit only exists once it's connected: before, it must not read as "unsupported".
    expect(await ask({ service: 'Slack' })).toMatchObject({ status: 'card_shown', service: 'Slack' });
    expect(lastView()).toMatchObject({ kind: 'connect', providerId: 'slack', toolkitIds: ['slack'], method: 'mcp' });
    // Connected (in Settings): the agent that lacked it gets an allow card for the same toolkit id.
    h.connections.push({ id: 'mcp-slack', providerId: 'slack', accountId: 'T123', label: 'Acme workspace' });
    expect(await ask({ service: 'Slack', scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'card_shown' });
    expect(lastView()).toMatchObject({ kind: 'allow_agent', toolkitIds: ['slack'], preselected: ['T123'] });
  });

  it("doesn't let a Connect card left open block the allow the agent needs once it's connected", async () => {
    await ask({ scopeWorkspaceId: 'ws-ri' });
    h.connections.push(google('c1', 'me@example.com'));
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'card_shown' });
    expect(cards().map((c) => (c.toolInput as ConnectionRequestView).kind)).toEqual(['connect', 'allow_agent']);
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'already_asked' });
  });

  it('sends a hosted MCP service to Settings: no sign-in or key from the card', async () => {
    await ask({ service: 'Todoist' });
    expect(lastView()).toMatchObject({ method: 'mcp' });
    await expect(startCardSignIn(request, cards()[0]!.id, null)).rejects.toThrow(/Settings, under Plugins/);
    await expect(connectCardWithKey(cards()[0]!.id, { token: 'x' })).rejects.toThrow(/Settings, under Plugins/);
    expect(h.connectDirect).not.toHaveBeenCalled();
  });

  it('tells the main chat a connected account is already there, and reloads its tools', async () => {
    h.connections.push(google('c1', 'me@example.com'));
    expect(await ask()).toMatchObject({ status: 'already_available' });
    expect(h.recycled).toEqual([CHAT]);
    expect(cards()).toEqual([]);
  });

  it('offers to give an agent access to a connected account it cannot use', async () => {
    h.connections.push(google('c1', 'me@example.com'));
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'card_shown' });
    expect(lastView()).toMatchObject({
      kind: 'allow_agent',
      agent: { workspaceId: 'ws-ri', name: 'ri' },
      accounts: [{ accountId: 'acct-c1', authConfigId: null, connectionId: 'c1', label: 'me@example.com' }],
      // The only account is checked to start with.
      preselected: ['acct-c1'],
    });
    giveScopes('ws-ri', [{ toolkitId: 'gmail' }]);
    h.rows.length = 0;
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'already_available' });
  });

  it('resolves an MCP server by the name the user gave it, for agent access only', async () => {
    // Not running (no connection): nothing to sign in to, it's managed in Settings.
    expect(await ask({ service: 'Team Calendar', scopeWorkspaceId: 'ws-ri' })).toMatchObject({ status: 'unsupported' });
    h.connections.push({ id: 'mcp_team_calendar', providerId: 'mcp_team_calendar', accountId: 'team_calendar', label: 'team_calendar' });
    expect(await ask({ service: 'the team calendar', scopeWorkspaceId: 'ws-ri', account: 'team' })).toMatchObject({ status: 'card_shown' });
    // A server has no accounts to name or choose.
    expect(lastView()).toMatchObject({ kind: 'allow_agent', label: 'Team Calendar', toolkitIds: ['mcp_team_calendar'], accounts: [], preselected: [], requestedAccount: null });
    await allowCardForAgent(cards()[0]!.id);
    expect(responses()[0]).toMatchObject({ content: 'Allowed: Team Calendar', toolInput: { accounts: [] } });
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

  it('asks for each service on its own card, even from the same provider', async () => {
    // "Look in Gmail and Google Calendar": two calls, two cards. One per provider hid Calendar.
    expect(await ask()).toMatchObject({ status: 'card_shown' });
    expect(await ask({ service: 'Google Calendar' })).toMatchObject({ status: 'card_shown' });
    expect(cards().map((c) => (c.toolInput as ConnectionRequestView).toolkitIds)).toEqual([['gmail'], ['google_calendar']]);
    // A card for the whole provider overlaps both, so it waits on them.
    expect(await ask({ service: 'Google' })).toMatchObject({ status: 'already_asked', message: expect.stringContaining('A card for Gmail') });
  });

  it("doesn't ask again after a decline unless the user asked", async () => {
    await ask();
    await declineCard(cards()[0]!.id);
    expect(await ask()).toMatchObject({ status: 'declined_earlier' });
    expect(await ask({ userAsked: true })).toMatchObject({ status: 'card_shown' });
  });

  it('holds a decline to the service it was for', async () => {
    await ask();
    await declineCard(cards()[0]!.id);
    expect(await ask({ service: 'Google Calendar' })).toMatchObject({ status: 'card_shown' });
  });

  it('lets a later answer to the same service lift an earlier decline', async () => {
    await ask();
    await declineCard(cards()[0]!.id);
    await ask({ userAsked: true });
    h.connections.push(google('c1', 'me@example.com'));
    await startCardSignIn(request, cards()[1]!.id, null);
    h.connections.length = 0;
    expect(await ask()).toMatchObject({ status: 'card_shown' });
  });
});

describe('choosing accounts', () => {
  const GITCONNECTED = google('c1', 'trey@gitconnected.com');
  const MARKET = google('c2', 'trey@marketstandard.app');

  beforeEach(() => {
    h.connections.push(GITCONNECTED, MARKET);
  });

  it('offers every account and checks none when the agent named none', async () => {
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({
      status: 'card_shown',
      message: expect.stringContaining('give this agent access to Gmail, choosing which accounts'),
    });
    expect(lastView()).toMatchObject({
      kind: 'allow_agent',
      accounts: [
        { accountId: 'acct-c1', connectionId: 'c1', label: 'trey@gitconnected.com' },
        { accountId: 'acct-c2', connectionId: 'c2', label: 'trey@marketstandard.app' },
      ],
      preselected: [],
      requestedAccount: null,
    });
    // Nothing checked is not "all of them".
    await expect(allowCardForAgent(cards()[0]!.id)).rejects.toMatchObject({ code: 'invalid', message: 'Choose at least one account.' });
    expect(h.scopesSet).toEqual([]);
  });

  it('checks the account the agent named, by its words', async () => {
    expect(await ask({ scopeWorkspaceId: 'ws-ri', account: 'Market Standard' })).toMatchObject({
      message: expect.stringContaining('give this agent access to Gmail on trey@marketstandard.app'),
    });
    expect(lastView()).toMatchObject({ preselected: ['acct-c2'], requestedAccount: 'Market Standard' });
  });

  it('grants exactly the accounts checked, and names them to the agent', async () => {
    await ask({ scopeWorkspaceId: 'ws-ri' });
    await allowCardForAgent(cards()[0]!.id, ['acct-c2']);
    await settle();
    expect(scopesOf('ws-ri')).toEqual([{ toolkitId: 'gmail', accounts: [{ accountId: 'acct-c2' }] }]);
    expect(responses()[0]).toMatchObject({
      content: 'Allowed: Gmail (trey@marketstandard.app)',
      toolInput: { outcome: 'allowed', account: 'trey@marketstandard.app', accounts: ['trey@marketstandard.app'] },
    });
    expect(h.dispatched[0]!.text).toContain('allowed this agent to use Gmail on trey@marketstandard.app.');
  });

  it('tells the agent to pick with `account` when it got several', async () => {
    await ask({ scopeWorkspaceId: 'ws-ri' });
    await allowCardForAgent(cards()[0]!.id, ['acct-c1', 'acct-c2']);
    await settle();
    expect(responses()[0]).toMatchObject({ content: 'Allowed: Gmail (trey@gitconnected.com and trey@marketstandard.app)' });
    expect(h.dispatched[0]!.text).toContain('on trey@gitconnected.com and trey@marketstandard.app (pass `account` to choose)');
  });

  it("refuses accounts the card didn't offer", async () => {
    await ask({ scopeWorkspaceId: 'ws-ri' });
    // Connected after the card was shown: the user never saw it as a choice.
    h.connections.push(google('c3', 'later@example.com'));
    await expect(allowCardForAgent(cards()[0]!.id, ['acct-c3', 'nope'])).rejects.toMatchObject({ code: 'invalid' });
  });

  it('adds an account to a service the agent has on other accounts', async () => {
    giveScopes('ws-ri', [{ toolkitId: 'gmail', accounts: [{ accountId: 'acct-c1' }] }]);
    // It can already use Gmail, so only a named account it lacks is worth a card.
    expect(await ask({ scopeWorkspaceId: 'ws-ri' })).toMatchObject({
      status: 'already_available',
      message: expect.stringContaining('available here on trey@gitconnected.com.'),
    });
    expect(await ask({ scopeWorkspaceId: 'ws-ri', account: 'trey@marketstandard.app' })).toMatchObject({ status: 'card_shown' });
    await allowCardForAgent(cards()[0]!.id, ['acct-c2']);
    expect(scopesOf('ws-ri')).toEqual([{ toolkitId: 'gmail', accounts: [{ accountId: 'acct-c1' }, { accountId: 'acct-c2' }] }]);
  });

  it('asks only for the services an agent lacks, and leaves all-account access alone', async () => {
    giveScopes('ws-ri', [{ toolkitId: 'gmail' }]);
    await ask({ scopeWorkspaceId: 'ws-ri', service: 'Google', account: 'marketstandard' });
    expect(lastView()).toMatchObject({ toolkitIds: ['google_calendar'], preselected: ['acct-c2'] });
    await allowCardForAgent(cards()[0]!.id, ['acct-c2']);
    expect(scopesOf('ws-ri')).toEqual([
      { toolkitId: 'gmail' },
      { toolkitId: 'google_calendar', accounts: [{ accountId: 'acct-c2' }] },
    ]);
  });

  it('names every usable account when the service is there already', async () => {
    expect(await ask()).toMatchObject({
      status: 'already_available',
      message: expect.stringContaining('on trey@gitconnected.com and trey@marketstandard.app. Pass `account` to choose.'),
    });
    expect(await ask({ account: 'gitconnected' })).toMatchObject({
      message: expect.stringContaining('available here on trey@gitconnected.com. Pass it as `account`.'),
    });
    giveScopes('ws-ri', [{ toolkitId: 'gmail' }]);
    expect(await ask({ scopeWorkspaceId: 'ws-ri', account: 'trey@marketstandard.app' })).toMatchObject({
      status: 'already_available',
      message: expect.stringContaining('available here on trey@marketstandard.app. Pass it as `account`.'),
    });
  });

  it('takes "my Market Standard email" for the account it names', async () => {
    await ask({ scopeWorkspaceId: 'ws-ri', account: 'my Market Standard email' });
    expect(lastView()).toMatchObject({ kind: 'allow_agent', preselected: ['acct-c2'] });
  });

  it('leaves the choice to the user when the words fit no single account', async () => {
    // Not an address, so not a new account to connect: the user picks from what's there.
    expect(await ask({ scopeWorkspaceId: 'ws-ri', account: 'trey' })).toMatchObject({
      status: 'card_shown',
      message: expect.stringContaining('No connected account is clearly "trey", so the user picks.'),
    });
    expect(lastView()).toMatchObject({ kind: 'allow_agent', preselected: [], requestedAccount: 'trey' });
    h.rows.length = 0;
    // Words that only say what kind of account aren't a name at all.
    expect(await ask({ scopeWorkspaceId: 'ws-ri', account: 'my email' })).toMatchObject({
      message: expect.not.stringContaining('No connected account is clearly'),
    });
    expect(lastView()).toMatchObject({ requestedAccount: null });
  });

  it('asks to connect an account the user named that is not connected', async () => {
    expect(await ask({ scopeWorkspaceId: 'ws-ri', account: 'trey@bounce.dev' })).toMatchObject({
      status: 'card_shown',
      message: expect.stringContaining('connect another Google account (trey@bounce.dev) for Gmail'),
    });
    expect(lastView()).toMatchObject({ kind: 'connect', requestedAccount: 'trey@bounce.dev', toolkitIds: ['gmail'] });
    // Other Google accounts are connected, but not the one asked for: go to the sign-in.
    h.begin.mockResolvedValue({ requestId: 'a', authorizationUrl: 'u' });
    expect(await startCardSignIn(request, cards()[0]!.id, null)).toMatchObject({ authorizationUrl: 'u' });
    await h.begin.mock.calls[0]![1].onCompleted(google('c4', 'trey@bounce.dev'));
    await settle();
    expect(scopesOf('ws-ri')).toEqual([{ toolkitId: 'gmail', accounts: [{ accountId: 'acct-c4' }] }]);
    expect(h.dispatched[0]!.text).toContain('connected Gmail on trey@bounce.dev.');
    expect(h.dispatched[0]!.text).not.toContain("isn't the account you asked for");
  });

  it('says so when the sign-in landed on a different account than asked', async () => {
    await ask({ account: 'trey@bounce.dev' });
    h.begin.mockResolvedValue({ requestId: 'a', authorizationUrl: 'u' });
    await startCardSignIn(request, cards()[0]!.id, null);
    await h.begin.mock.calls[0]![1].onCompleted(MARKET);
    await settle();
    expect(h.dispatched[0]!.text).toContain("That isn't the account you asked for (trey@bounce.dev)");
  });

  it('resolves a Connect card without a sign-in only when it is clear which account it meant', async () => {
    h.connections.length = 0;
    await ask({ account: 'trey@bounce.dev' });
    await ask({ service: 'Google Calendar' });
    h.connections.push(GITCONNECTED, MARKET);
    h.begin.mockResolvedValue({ requestId: 'a', authorizationUrl: 'u' });
    // Asked for an account that still isn't there, and two others with nothing named: sign in.
    expect(await startCardSignIn(request, cards()[0]!.id, null)).toMatchObject({ authorizationUrl: 'u' });
    expect(await startCardSignIn(request, cards()[1]!.id, null)).toMatchObject({ authorizationUrl: 'u' });
    h.connections.push(google('c4', 'trey@bounce.dev'));
    expect(await startCardSignIn(request, cards()[0]!.id, null)).toEqual({ done: true });
    expect(responses()[0]).toMatchObject({ toolInput: { accounts: ['trey@bounce.dev'] } });
  });

  it("doesn't take account names for an MCP server", async () => {
    h.connections.push({ id: 'mcp_team_calendar', providerId: 'mcp_team_calendar', accountId: 'team_calendar' });
    expect(await ask({ service: 'Team Calendar', account: 'trey@marketstandard.app' })).toMatchObject({ status: 'already_available' });
  });
});

describe('connectedButUnavailable', () => {
  it("names the connected services an agent can't use yet, by the names the user knows", async () => {
    h.connections.push(google('c1', 'me@example.com'));
    h.connections.push({ id: 'mcp_team_calendar', providerId: 'mcp_team_calendar', accountId: 'team_calendar' });
    giveScopes('ws-ri', [{ toolkitId: 'gmail' }]);
    expect(await connectedButUnavailable('ws-ri')).toEqual(['Google Calendar', 'Team Calendar']);
  });
});

describe('recordPausedConnection', () => {
  it('turns an auth failure on a known connection into a Reconnect card', async () => {
    h.connections.push(google('c1', 'me@example.com'));
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

    await opts.onCompleted(google('c9', 'me@example.com'));
    await settle();
    expect(responses()[0]).toMatchObject({
      content: 'Connected: Gmail (me@example.com)',
      toolInput: { outcome: 'connected', account: 'me@example.com', accounts: ['me@example.com'] },
    });
    // Reload first, so the note starts a turn that has the new tools.
    expect(h.recycled).toEqual([CHAT]);
    expect(h.dispatched[0]!.text).toContain('The user connected Gmail on me@example.com.');
  });

  it('resolves at once when the account got connected meanwhile', async () => {
    await ask();
    h.connections.push(google('c1', 'me@example.com'));
    expect(await startCardSignIn(request, cards()[0]!.id, null)).toEqual({ done: true });
    expect(h.begin).not.toHaveBeenCalled();
    expect(responses()).toHaveLength(1);
  });

  it("doesn't change an agent's access when a Reconnect card resolves", async () => {
    // The card lists every Google service. Resolving it must not hand them all to the agent.
    h.connections.push(google('c1', 'me@example.com'));
    giveScopes('ws-ri', [{ toolkitId: 'gmail', accounts: [{ accountId: 'acct-c1' }] }]);
    await recordPausedConnection({
      sessionId: CHAT,
      scopeWorkspaceId: 'ws-ri',
      outcome: { ok: false, reason: 'auth_required', providerId: 'google', authorizationUrl: '/connect?provider=google&connection=c1' },
    });
    expect(lastView()).toMatchObject({ kind: 'reconnect', agent: { workspaceId: 'ws-ri' } });
    h.begin.mockResolvedValue({ requestId: 'a', authorizationUrl: 'u' });
    await startCardSignIn(request, cards()[0]!.id, null);
    await h.begin.mock.calls[0]![1].onCompleted(google('c1', 'me@example.com'));
    expect(h.scopesSet).toEqual([]);
    expect(responses()[0]).toMatchObject({ content: 'Reconnected: Google (me@example.com)' });
  });

  it('reconnects through the existing connection and its scopes', async () => {
    await recordPausedConnection({ sessionId: CHAT, scopeWorkspaceId: null, outcome: { ok: false, reason: 'needs_consent', providerId: 'google', connectionId: 'c1', missingScopes: ['gmail.send'], authorizationUrl: 'x' } });
    h.begin.mockResolvedValue({ requestId: 'auth-2', authorizationUrl: 'u' });
    await startCardSignIn(request, cards()[0]!.id, null);
    expect(h.begin.mock.calls[0]![1]).toMatchObject({ existingConnectionId: 'c1', scopes: ['gmail.send'] });
  });

  it('connects a key service with the typed fields', async () => {
    await ask({ service: 'Telegram' });
    h.connectDirect.mockResolvedValue({ id: 'c2', providerId: 'telegram', accountId: 'bot-1', label: 'Telegram' });
    await connectCardWithKey(cards()[0]!.id, { token: 'tok_123' });
    expect(h.connectDirect).toHaveBeenCalledWith('telegram', { credential: { type: 'api_key', key: 'tok_123' } });
    expect(responses()[0]).toMatchObject({ toolInput: { outcome: 'connected' } });
  });

  it('gives an agent access through its integration scope, and recycles its sessions', async () => {
    h.connections.push(google('c1', 'me@example.com'));
    await ask({ scopeWorkspaceId: 'ws-ri' });
    await allowCardForAgent(cards()[0]!.id);
    await settle();
    // Pinned to the account it was given, not every Google account connected later.
    expect(h.scopesSet).toEqual([{ id: 'ws-ri', scopes: [{ toolkitId: 'gmail', accounts: [{ accountId: 'acct-c1' }] }] }]);
    expect(h.recycledWorkspaces).toEqual(['ws-ri']);
    expect(responses()[0]).toMatchObject({ content: 'Allowed: Gmail (me@example.com)' });
    expect(h.dispatched[0]!.text).toContain('allowed this agent to use Gmail on me@example.com.');
  });

  it('grants a connection made for an agent to that agent', async () => {
    await ask({ scopeWorkspaceId: 'ws-ri' });
    h.begin.mockResolvedValue({ requestId: 'a', authorizationUrl: 'u' });
    await startCardSignIn(request, cards()[0]!.id, null);
    await h.begin.mock.calls[0]![1].onCompleted(google('c1', 'me@example.com'));
    expect(h.scopesSet).toEqual([{ id: 'ws-ri', scopes: [{ toolkitId: 'gmail', accounts: [{ accountId: 'acct-c1' }] }] }]);
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
