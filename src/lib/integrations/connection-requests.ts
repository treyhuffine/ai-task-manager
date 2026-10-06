/**
 * Connecting accounts from chat (docs/connecting-from-chat.md). Three ways a Connect card appears,
 * all written by the server into the chat that needs it, never decided by the chat:
 *
 *   1. An agent calls `request_connection` because the user's request needs a service it has no
 *      tools for (`requestConnection`). The only model judgment in the flow is making that call.
 *   2. An integration call fails because a connection stopped working or needs more access
 *      (`recordPausedConnection`, from the integrations MCP route's pause hook). Automatic.
 *   3. Either of the above resolves to "connected, but this agent can't use it": the card offers
 *      to give the agent access, through the same setting the Agents view writes.
 *
 * The card is a `connection_request` row carrying a `ConnectionRequestView`. The user's answer (a
 * sign-in, a pasted key, an allow click, or "Not now") goes through the card routes, which only a
 * person reaches, and becomes a `connection_response` row. Then the asking agent is woken with a
 * note, after its process reloads so the new tools are really there.
 *
 * Requests are durable (the rows), so a card still works after a restart. Only the link between an
 * in-flight sign-in and its card is in memory (begin-connect.ts); if that's lost, the next click
 * finds the account connected and resolves the card.
 */
import type { ChatEventRecord, ChatEventSource, WorkspaceIntegrationScopeAccount, WorkspaceRecord } from '@/db/types';
import {
	getChatEventById,
	getChatSessionWithExecution,
	getWorkspace,
	insertChatEvent,
	listSessionEventsBySource,
	listWorkspaces,
	setWorkspaceIntegrationScopes,
} from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { healthCheckSession } from '@/lib/executor/health';
import { isImportMirror } from '@/lib/import/mirror';
import { dispatchSessionTurn } from '@/lib/sessions/deliver';
import type { ActionOutcome, Connection, IntegrationRuntime } from '@integrations/engine';
import { PROVIDER_CATALOG } from '@integrations/engine/providers';
import { beginConnect, type BeginConnectResult } from './begin-connect';
import {
	connectionNote,
	describeAccounts,
	looksLikeEmail,
	matchAccounts,
	namesAccount,
	resolveService,
	type CardAccount,
	type CatalogProvider,
	type CatalogToolkit,
	type ConnectionOutcome,
	type ConnectionRequestKind,
	type ConnectionRequestView,
	type ConnectionResponseView,
} from './connection-catalog';
import {
	buildCredential,
	getIntegrationOwnerId,
	getIntegrationRuntime,
	getMcpServerStore,
	resolveWorkspaceIntegrationFilter,
} from './runtime';
import { pinKey, pinOfConnection, scopePins } from './scope-pins';
import { validateIntegrationScopes } from './scopes';

/** An integration call's non-ok outcome, as the MCP pause hook hands it over. */
type FailedOutcome = Extract<ActionOutcome, { ok: false }>;

const REQUEST: ChatEventSource = 'connection_request';
const RESPONSE: ChatEventSource = 'connection_response';

/** How long a woken agent may wait for its running turn to end before the note goes in anyway. */
const IDLE_WAIT_MS = 10 * 60_000;
const IDLE_POLL_MS = 2_000;

export type RequestConnectionResult =
  | { status: 'card_shown'; service: string; message: string }
  | { status: 'already_available'; service: string; message: string }
  | { status: 'already_asked'; service: string; message: string }
  | { status: 'declined_earlier'; service: string; message: string }
  | { status: 'ambiguous'; options: string[]; message: string }
  | { status: 'unsupported'; message: string }
  | { status: 'unknown_agent'; agents: string[]; message: string }
  | { status: 'no_chat'; message: string };

export class ConnectionRequestError extends Error {
  constructor(
    readonly code: 'not_found' | 'already_answered' | 'invalid' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

// ── Reading a chat's cards ──────────────────────────────────────────────────

function asView(row: ChatEventRecord): ConnectionRequestView | null {
  const v = row.toolInput as Partial<ConnectionRequestView> | null;
  return row.source === REQUEST && v && typeof v.providerId === 'string' && typeof v.kind === 'string'
    ? (v as ConnectionRequestView)
    : null;
}

function asResponse(row: ChatEventRecord): ConnectionResponseView | null {
  const v = row.toolInput as Partial<ConnectionResponseView> | null;
  return row.source === RESPONSE && v && typeof v.requestEventId === 'string' ? (v as ConnectionResponseView) : null;
}

interface ChatCards {
  open: { row: ChatEventRecord; view: ConnectionRequestView }[];
  /** `provider|agent|toolkit` the user said "Not now" to, in this chat. */
  declined: Set<string>;
}

function serviceKeys(providerId: string, agent: ConnectionRequestView['agent'], toolkitIds: readonly string[]): string[] {
  return toolkitIds.map((t) => `${providerId}|${agent?.workspaceId ?? ''}|${t}`);
}

function readChatCards(sessionId: string): ChatCards {
  const rows = listSessionEventsBySource(sessionId, [REQUEST, RESPONSE]);
  const requests = new Map<string, ConnectionRequestView>();
  const answered = new Set<string>();
  const declined = new Set<string>();
  for (const row of rows) {
    const view = asView(row);
    if (view) requests.set(row.id, view);
    const r = asResponse(row);
    if (!r) continue;
    answered.add(r.requestEventId);
    const asked = requests.get(r.requestEventId);
    const keys = serviceKeys(r.providerId, r.agent, asked?.toolkitIds ?? []);
    // A later answer to the same service supersedes an earlier "Not now".
    for (const key of keys) {
      if (r.outcome === 'declined') declined.add(key);
      else declined.delete(key);
    }
  }
  const open = rows
    .map((row) => ({ row, view: asView(row) }))
    .filter((c): c is { row: ChatEventRecord; view: ConnectionRequestView } => c.view !== null && !answered.has(c.row.id));
  return { open, declined };
}

/**
 * An open card of the same kind covering any of the same services for the same agent: one card per
 * service. A card of another kind is a different ask: a Connect card left open after the account got
 * connected in Settings mustn't block the "Allow for this agent" the agent needs now.
 */
function openCardFor(
  cards: ChatCards,
  kind: ConnectionRequestKind,
  providerId: string,
  agent: ConnectionRequestView['agent'],
  toolkitIds: readonly string[],
): { row: ChatEventRecord; view: ConnectionRequestView } | undefined {
  const wanted = new Set(serviceKeys(providerId, agent, toolkitIds));
  return cards.open.find(
    (c) => c.view.kind === kind && serviceKeys(c.view.providerId, c.view.agent, c.view.toolkitIds).some((k) => wanted.has(k)),
  );
}

// ── Catalog and state ───────────────────────────────────────────────────────

function catalogProviders(): CatalogProvider[] {
  return PROVIDER_CATALOG.map((p) => ({ id: p.id, displayName: p.displayName, method: p.method, credentialFields: p.credentialFields }));
}

const MCP_PROVIDER_PREFIX = 'mcp_';

/**
 * What the matcher can resolve: every first-party toolkit, plus each MCP server the user added, by
 * the name they gave it ("Team Calendar", not "MCP: team_calendar"). An MCP server is connected
 * whenever it's ingested, so it can only ever be available or need an agent's access, never a
 * sign-in: servers are added in Settings.
 *
 * A built-in hosted service (Slack, Notion, Linear, Todoist…) only registers its toolkit once it's
 * connected, under the provider's own id. Until then it stands in under that id, so asking for it
 * gets a Connect card rather than "unsupported", and the card's service is the one it connects.
 */
function matchCatalog(runtime: IntegrationRuntime): { toolkits: CatalogToolkit[]; providers: CatalogProvider[] } {
  const names = new Map<string, string>();
  try {
    for (const server of getMcpServerStore().list()) names.set(`${MCP_PROVIDER_PREFIX}${server.slug}`, server.displayName);
  } catch {
    /* no MCP store yet */
  }
  const registered = runtime.getToolkits().map((t) => ({
    id: t.id,
    providerId: t.providerId,
    displayName: names.get(t.providerId) ?? t.displayName,
  }));
  const withToolkits = new Set(registered.map((t) => t.providerId));
  const hosted = catalogProviders()
    .filter((p) => p.method === 'mcp' && !withToolkits.has(p.id))
    .map((p) => ({ id: p.id, providerId: p.id, displayName: p.displayName }));
  const toolkits = [...registered, ...hosted];
  const mcpProviders: CatalogProvider[] = [...new Set(toolkits.map((t) => t.providerId))]
    .filter((id) => id.startsWith(MCP_PROVIDER_PREFIX))
    .map((id) => ({ id, displayName: names.get(id) ?? id, method: 'custom' }));
  return { toolkits, providers: [...catalogProviders(), ...mcpProviders] };
}

function providerEntry(providerId: string): CatalogProvider | undefined {
  return catalogProviders().find((p) => p.id === providerId);
}

async function providerConnections(runtime: IntegrationRuntime, providerId: string): Promise<Connection[]> {
  const all = await runtime.listConnections({ ownerId: getIntegrationOwnerId() });
  return all.filter((c) => c.providerId === providerId);
}

function agentRef(ws: WorkspaceRecord | null | undefined): ConnectionRequestView['agent'] {
  return ws ? { workspaceId: ws.id, name: ws.name } : null;
}

function cardAccount(c: Connection): CardAccount {
  return { accountId: c.accountId, authConfigId: c.authConfigId ?? null, connectionId: c.id, label: c.email ?? c.label ?? c.accountId };
}

/**
 * Which of a provider's connections an agent can use, per toolkit, exactly as its integration scope
 * resolves at call time: none when the toolkit isn't granted, the pinned account(s) when it's
 * pinned, and every connection when it's granted for all accounts.
 */
async function usableByAgent(workspaceId: string, toolkitIds: readonly string[], connections: readonly Connection[]): Promise<Map<string, Set<string>>> {
  const filter = await resolveWorkspaceIntegrationFilter(workspaceId);
  const usable = new Map<string, Set<string>>();
  for (const t of toolkitIds) {
    if (!filter.toolkits.includes(t)) usable.set(t, new Set());
    else if (filter.connectionPins[t]) usable.set(t, new Set([filter.connectionPins[t]!]));
    else if (filter.allowedAccounts[t]?.length) usable.set(t, new Set(filter.allowedAccounts[t]!.map((a) => a.connectionId)));
    else usable.set(t, new Set(connections.map((c) => c.id)));
  }
  return usable;
}

/**
 * The services connected to Ri that an agent can't use yet, by name. An agent with scoped access
 * sees tools only for what it's been given, so without this it can't know "Team Calendar" or
 * "Gmail" are there to ask for. The main chat sees every connected service already.
 */
export async function connectedButUnavailable(workspaceId: string): Promise<string[]> {
  const runtime = await getIntegrationRuntime();
  const connected = new Set((await runtime.listConnections({ ownerId: getIntegrationOwnerId() })).map((c) => c.providerId));
  const available = new Set((await resolveWorkspaceIntegrationFilter(workspaceId)).toolkits);
  return matchCatalog(runtime)
    .toolkits.filter((t) => connected.has(t.providerId) && !available.has(t.id))
    .map((t) => t.displayName);
}

const PROVIDER_LIST = 'Google (Gmail, Calendar, Drive, Docs, Sheets), Microsoft 365 (Outlook Mail and Calendar), Slack, Notion, Linear, Jira, Todoist and about 25 more';

// ── 1. The agent asks ───────────────────────────────────────────────────────

export interface RequestConnectionInput {
  /** The calling chat, from its credential or session token. */
  sessionId: string | null;
  /** The agent whose integration scope the calling endpoint serves (`?ws=`); null = the broad set. */
  scopeWorkspaceId: string | null;
  service: string;
  reason: string;
  /** Another agent to ask for, by name. Omitted = the calling agent (or the main chat). */
  forAgent?: string | null;
  /** The user explicitly asked, in their latest message, to connect this service. */
  userAsked?: boolean;
  /** The account the user named, in their words ("trey@marketstandard.app", "Market Standard"). */
  account?: string | null;
}

export async function requestConnection(input: RequestConnectionInput): Promise<RequestConnectionResult> {
  const session = input.sessionId ? getChatSessionWithExecution(input.sessionId) : null;
  if (!input.sessionId || !session) {
    return {
      status: 'no_chat',
      message: 'There is no chat to show a Connect card in. Ask the user to connect it in Settings, Plugins.',
    };
  }
  const runtime = await getIntegrationRuntime();
  const catalog = matchCatalog(runtime);
  const resolution = resolveService(input.service, catalog.toolkits, catalog.providers);
  if (resolution.kind === 'unsupported') {
    return {
      status: 'unsupported',
      message: `Ri can't connect to "${input.service}". Tell the user it isn't supported. Ri can connect ${PROVIDER_LIST}.`,
    };
  }
  if (resolution.kind === 'ambiguous') {
    const options = resolution.options.map((o) => o.label);
    return {
      status: 'ambiguous',
      options,
      message: `"${input.service}" could be ${options.join(' or ')}. Ask the user which one they use, then call request_connection again with that name.`,
    };
  }
  const match = resolution.match;

  // Whose access this is: an agent named explicitly, else the calling agent, else the main chat.
  let target: WorkspaceRecord | null = input.scopeWorkspaceId ? getWorkspace(input.scopeWorkspaceId) ?? null : null;
  const onBehalf = Boolean(input.forAgent?.trim());
  if (onBehalf) {
    const wanted = input.forAgent!.trim().toLowerCase();
    const agents = listWorkspaces({ status: 'active' });
    const found = agents.find((w) => w.name.toLowerCase() === wanted || w.id === input.forAgent);
    if (!found) {
      return {
        status: 'unknown_agent',
        agents: agents.map((w) => w.name),
        message: `No agent is named "${input.forAgent}". Agents: ${agents.map((w) => w.name).join(', ') || 'none'}.`,
      };
    }
    target = getWorkspace(found.id) ?? null;
  }

  const connections = await providerConnections(runtime, match.providerId);
  const isMcp = match.providerId.startsWith(MCP_PROVIDER_PREFIX);
  if (connections.length === 0 && isMcp) {
    return {
      status: 'unsupported',
      message: `${match.label} is an MCP server that isn't running right now. Ask the user to check it in Settings, Plugins.`,
    };
  }
  const choices = connections.map(cardAccount);
  // An MCP server's connection is vestigial, it has no accounts to name.
  const hint = isMcp ? null : input.account?.trim() || null;
  const named = matchAccounts(hint, choices);
  const requestedAccount = hint && (named.length > 0 || namesAccount(hint)) ? hint : null;
  // An address that isn't connected is an account to connect. Words that fit no single connected
  // account ("work") leave the choice to the user, on the card.
  const newAccount = requestedAccount !== null && named.length === 0 && looksLikeEmail(requestedAccount);
  const agent = agentRef(target);

  let kind: ConnectionRequestKind = 'connect';
  let toolkitIds = match.toolkitIds;
  let preselected: string[] = [];
  if (connections.length > 0 && !newAccount) {
    // The accounts this request is about: the one(s) named, else any connected one.
    const usable = target ? await usableByAgent(target.id, match.toolkitIds, connections) : null;
    const wanted = named.length > 0 ? named : choices;
    const missing = match.toolkitIds.filter((t) => {
      if (!usable) return false; // the main chat uses every connected account
      const ids = usable.get(t)!;
      return named.length > 0 ? !named.every((a) => ids.has(a.connectionId)) : ids.size === 0;
    });
    if (missing.length === 0) {
      // Usable already. An agent asking for something it has usually started before the account
      // was connected, so its tool list is stale: reload it once this turn ends.
      if (!onBehalf) await executor.recycleWhenIdle(input.sessionId);
      // Confirm the account that was named, else every account it can use.
      const on = (named.length > 0 || !usable
        ? wanted
        : choices.filter((c) => match.toolkitIds.every((t) => usable.get(t)!.has(c.connectionId)))
      ).map((c) => c.label);
      const accounts = on.length > 0 && !isMcp ? ` on ${describeAccounts(on)}` : '';
      const choose = on.length > 1 && !isMcp ? ' Pass `account` to choose.' : named.length > 0 && !isMcp ? ' Pass it as `account`.' : '';
      return {
        status: 'already_available',
        service: match.label,
        message: onBehalf
          ? `${match.label} is already connected and available to the "${target!.name}" agent${accounts}.`
          : `${match.label} is already connected and available here${accounts}.${choose} If its tools (${match.toolkitIds.map((t) => `${t}__…`).join(', ')}) aren't in your list, they were connected after this chat started. The app reloads your tools when this turn ends, so they'll be there on your next turn.`,
      };
    }
    kind = 'allow_agent';
    toolkitIds = missing;
    // Checked to start with: the account the agent named, or the only one there is. With several
    // and none named, nothing: the user picks, rather than handing over every inbox at once.
    preselected = isMcp ? [] : named.length > 0 ? named.map((a) => a.accountId) : choices.length === 1 ? [choices[0]!.accountId] : [];
  }

  const cards = readChatCards(input.sessionId);
  const open = openCardFor(cards, kind, match.providerId, agent, toolkitIds);
  if (open) {
    return {
      status: 'already_asked',
      service: match.label,
      message: `A card for ${open.view.label} is already waiting in this chat, and it covers ${match.label}. Stop and wait for the user to answer it.`,
    };
  }
  if (serviceKeys(match.providerId, agent, toolkitIds).some((k) => cards.declined.has(k)) && !input.userAsked) {
    return {
      status: 'declined_earlier',
      service: match.label,
      message: `The user said "Not now" to ${match.label} earlier in this chat. Don't ask again unless they bring it up. Continue without it.`,
    };
  }

  const entry = catalog.providers.find((p) => p.id === match.providerId);
  writeRequest(input.sessionId, {
    kind,
    providerId: match.providerId,
    providerName: match.providerName,
    label: match.label,
    toolkitIds,
    method: entry?.method ?? 'oauth2',
    credentialFields: entry?.credentialFields ?? [],
    reason: input.reason.trim().slice(0, 300) || null,
    requestedBy: 'agent',
    agent,
    onBehalf,
    connectionId: null,
    account: null,
    scopes: null,
    authConfigId: null,
    accounts: kind === 'allow_agent' && !isMcp ? choices : [],
    preselected,
    requestedAccount,
  });
  const forWhom = onBehalf ? `the "${target!.name}" agent` : 'this agent';
  const what = kind === 'allow_agent'
    ? `give ${forWhom} access to ${match.label}${named.length > 0 ? ` on ${describeAccounts(named.map((a) => a.label))}` : choices.length > 1 && !isMcp ? ', choosing which accounts' : ''}`
    : newAccount && connections.length > 0
      ? `connect another ${match.providerName} account (${requestedAccount}) for ${match.label}`
      : `connect ${match.label}${requestedAccount ? ` (${requestedAccount})` : ''}`;
  const unclear = kind === 'allow_agent' && requestedAccount && named.length === 0
    ? ` No connected account is clearly "${requestedAccount}", so the user picks.`
    : '';
  return {
    status: 'card_shown',
    service: match.label,
    message: `A card asking the user to ${what} is now in this chat.${unclear} Tell them briefly, then stop and wait. You'll get a note when they decide, naming exactly which accounts you got.`,
  };
}

function writeRequest(sessionId: string, view: ConnectionRequestView): ChatEventRecord | null {
  const verb = view.kind === 'reconnect' ? 'Reconnect' : view.kind === 'more_access' ? 'More access for' : view.kind === 'allow_agent' ? 'Allow' : 'Connect';
  return insertChatEvent({
    sessionId,
    role: 'system',
    source: REQUEST,
    content: `${verb} ${view.label}`,
    toolName: null,
    toolInput: view,
    createdAt: new Date().toISOString(),
  });
}

// ── 2. A connection stopped working ─────────────────────────────────────────

/**
 * An integration call paused for lack of access. Writes a Reconnect or More access card into the
 * chat that made the call (once per provider while one is open). The agent is told the same thing
 * the tool result says: the user is being asked, retry after.
 */
export async function recordPausedConnection(args: {
  sessionId: string | null;
  scopeWorkspaceId: string | null;
  outcome: FailedOutcome;
}): Promise<void> {
  const { sessionId, outcome } = args;
  if (!sessionId || (outcome.reason !== 'auth_required' && outcome.reason !== 'needs_consent')) return;
  if (!getChatSessionWithExecution(sessionId)) return;
  const runtime = await getIntegrationRuntime();
  const providerId = outcome.providerId;
  const entry = providerEntry(providerId);
  const toolkitIds = runtime.getToolkits().filter((t) => t.providerId === providerId).map((t) => t.id);

  let kind: ConnectionRequestKind;
  let connectionId: string | null = null;
  let scopes: string[] | null = null;
  let authConfigId: string | null = null;
  if (outcome.reason === 'needs_consent') {
    kind = 'more_access';
    connectionId = outcome.connectionId;
    scopes = outcome.missingScopes;
  } else {
    // The host's `authorizationRequired` hook builds `/connect?provider&scopes&client&connection`.
    const url = safeUrl(outcome.authorizationUrl);
    connectionId = url?.searchParams.get('connection') ?? null;
    authConfigId = url?.searchParams.get('client') ?? null;
    scopes = parseScopes(url?.searchParams.get('scopes'));
    kind = connectionId ? 'reconnect' : 'connect';
  }
  const connection = connectionId ? (await providerConnections(runtime, providerId)).find((c) => c.id === connectionId) : undefined;
  const agent = agentRef(args.scopeWorkspaceId ? getWorkspace(args.scopeWorkspaceId) : null);
  // One app-raised card per connection (or per unconnected provider) while it's open.
  const cards = readChatCards(sessionId);
  if (
    cards.open.some(
      (c) =>
        c.view.requestedBy === 'app' &&
        c.view.providerId === providerId &&
        (c.view.agent?.workspaceId ?? '') === (agent?.workspaceId ?? '') &&
        c.view.connectionId === connectionId,
    )
  ) {
    return;
  }

  writeRequest(sessionId, {
    kind,
    providerId,
    providerName: entry?.displayName ?? providerId,
    label: entry?.displayName ?? providerId,
    toolkitIds,
    method: entry?.method ?? 'oauth2',
    credentialFields: entry?.credentialFields ?? [],
    reason: null,
    requestedBy: 'app',
    agent,
    onBehalf: false,
    connectionId,
    account: connection?.email ?? connection?.label ?? null,
    scopes,
    authConfigId,
  });
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw, 'http://localhost');
  } catch {
    return null;
  }
}

function parseScopes(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((s) => typeof s === 'string') && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

// ── 3. The user answers the card (human-only routes) ────────────────────────

function openCard(eventId: string): { row: ChatEventRecord; view: ConnectionRequestView } {
  const row = getChatEventById(eventId);
  const view = row ? asView(row) : null;
  if (!row || !view) throw new ConnectionRequestError('not_found', 'That connection request no longer exists.');
  const answered = readChatCards(row.sessionId).open.every((c) => c.row.id !== row.id);
  if (answered) throw new ConnectionRequestError('already_answered', 'That connection request was already answered.');
  return { row, view };
}

/**
 * Connect (or reconnect, or add access) through the provider's sign-in. If the account is already
 * connected now (connected in Settings meanwhile, or a sign-in finished across a restart), the card
 * resolves right away instead.
 */
export async function startCardSignIn(
  request: Pick<Request, 'headers' | 'url'>,
  eventId: string,
  returnTo: string | null,
): Promise<{ done: true } | BeginConnectResult> {
  const { row, view } = openCard(eventId);
  if (view.method === 'mcp') throw new ConnectionRequestError('invalid', `${view.label} connects from Settings, under Plugins.`);
  if (view.method !== 'oauth2') throw new ConnectionRequestError('invalid', `${view.label} connects with a key, not a sign-in.`);
  const runtime = await getIntegrationRuntime();
  if (view.kind === 'connect') {
    // Connected meanwhile (in Settings, or a sign-in that finished across a restart): resolve
    // without another sign-in, but only when it's clear which account the card meant.
    const accounts = (await providerConnections(runtime, view.providerId)).map(cardAccount);
    const named = matchAccounts(view.requestedAccount, accounts);
    const meant = named.length > 0 || view.requestedAccount ? named : accounts;
    if (meant.length === 1) {
      await resolveCard(row, view, 'connected', meant);
      return { done: true };
    }
  }
  if (view.kind === 'allow_agent') throw new ConnectionRequestError('invalid', 'This card gives access, it has no sign-in.');
  // A new connection asks for what the card's services need, as Settings does, so the first call
  // after signing in doesn't stop for more access. Reconnect / more access carry their own scopes.
  const scopes = view.scopes ?? (view.kind === 'connect' ? toolkitScopes(runtime, view.toolkitIds) : null);
  return beginConnect(request, {
    providerId: view.providerId,
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    ...(view.connectionId ? { existingConnectionId: view.connectionId } : {}),
    ...(view.authConfigId ? { authConfigId: view.authConfigId } : {}),
    returnTo,
    onCompleted: (connection) => resolveCard(row, view, 'connected', [cardAccount(connection)]),
  });
}

/** Every scope the given toolkits' actions use: a toolkit's upfront bundle, else its actions' union. */
function toolkitScopes(runtime: IntegrationRuntime, toolkitIds: readonly string[]): string[] {
  const set = new Set<string>();
  for (const t of runtime.getToolkits()) {
    if (!toolkitIds.includes(t.id)) continue;
    for (const scope of t.scopes ?? t.actions.flatMap((a) => a.scopes ?? [])) set.add(scope);
  }
  return [...set];
}

/** Connect an API-key provider with the fields typed into the card. They never touch the chat. */
export async function connectCardWithKey(eventId: string, fields: Record<string, string>): Promise<void> {
  const { row, view } = openCard(eventId);
  if (view.method === 'mcp') throw new ConnectionRequestError('invalid', `${view.label} connects from Settings, under Plugins.`);
  if (view.method === 'oauth2') throw new ConnectionRequestError('invalid', `${view.label} connects with a sign-in, not a key.`);
  const runtime = await getIntegrationRuntime();
  const provider = runtime.getProviders().find((p) => p.id === view.providerId);
  if (!provider) throw new ConnectionRequestError('invalid', `Unknown provider ${view.providerId}.`);
  let connection: Connection;
  try {
    connection = await runtime.connectDirect(view.providerId, { credential: buildCredential(provider.auth.kind, fields) });
  } catch (e) {
    throw new ConnectionRequestError('failed', e instanceof Error ? e.message : String(e));
  }
  await resolveCard(row, view, 'connected', [cardAccount(connection)]);
}

/**
 * Give the card's agent access to the accounts the user checked, exactly those. The choice is
 * checked against the live connections, so an account disconnected since can't be granted.
 */
export async function allowCardForAgent(eventId: string, accountIds: readonly string[] = []): Promise<void> {
  const { row, view } = openCard(eventId);
  if (view.kind !== 'allow_agent' || !view.agent) throw new ConnectionRequestError('invalid', 'This card has no agent to give access to.');
  const live = (await providerConnections(await getIntegrationRuntime(), view.providerId)).map(cardAccount);
  // An MCP server's single vestigial connection, or a card from before accounts were offered with
  // only one account to give: nothing to choose.
  const offered = view.accounts && view.accounts.length > 0 ? view.accounts : live;
  let chosen = live.filter((a) => accountIds.includes(a.accountId) && offered.some((o) => o.accountId === a.accountId));
  if (chosen.length === 0 && offered.length === 1 && accountIds.length === 0) chosen = live.filter((a) => a.accountId === offered[0]!.accountId);
  if (chosen.length === 0) throw new ConnectionRequestError('invalid', 'Choose at least one account.');
  await resolveCard(row, view, 'allowed', chosen);
}

export async function declineCard(eventId: string): Promise<void> {
  const { row, view } = openCard(eventId);
  await resolveCard(row, view, 'declined', []);
}

// ── Resolving a card and waking the agent ───────────────────────────────────

/**
 * Give an agent these toolkits on exactly these accounts, through the Agents view's own validation.
 * A toolkit it doesn't have yet is added pinned to them. One it has on other accounts gets them
 * added to its pins. One it has for every account already covers them.
 */
async function grantAccess(workspaceId: string, toolkitIds: readonly string[], accounts: readonly CardAccount[]): Promise<void> {
  const ws = getWorkspace(workspaceId);
  if (!ws || accounts.length === 0) return;
  const stored = ws.integrationScopes ?? [];
  const wanted = accounts.map(pinOfConnection);
  const next: { toolkitId: string; accounts: WorkspaceIntegrationScopeAccount[] }[] = stored.map((sc) => ({
    toolkitId: sc.toolkitId,
    accounts: scopePins(sc),
  }));
  let changed = false;
  for (const toolkitId of toolkitIds) {
    const existing = next.find((sc) => sc.toolkitId === toolkitId);
    if (!existing) {
      next.push({ toolkitId, accounts: wanted });
      changed = true;
      continue;
    }
    const pins = existing.accounts;
    if (pins.length === 0) continue; // already every account
    const added = wanted.filter((w) => !pins.some((p) => pinKey(p) === pinKey(w)));
    if (added.length === 0) continue;
    existing.accounts = [...pins, ...added];
    changed = true;
  }
  if (!changed) return;
  const result = await validateIntegrationScopes(next, { stored });
  if (!result.ok) throw new ConnectionRequestError('failed', result.error);
  setWorkspaceIntegrationScopes(workspaceId, result.scopes);
  await executor.recycleWorkspaceSessions(workspaceId);
}

async function resolveCard(
  row: ChatEventRecord,
  view: ConnectionRequestView,
  outcome: ConnectionOutcome,
  granted: readonly CardAccount[],
): Promise<void> {
  // A sign-in can land after the card was answered another way (two tabs). First answer wins.
  if (readChatCards(row.sessionId).open.every((c) => c.row.id !== row.id)) return;
  const isMcp = view.providerId.startsWith(MCP_PROVIDER_PREFIX);
  // Name exactly the accounts this answer covers. A reconnect keeps the card's own account.
  const accountLabels = isMcp ? [] : granted.length > 0 ? granted.map((a) => a.label) : view.account ? [view.account] : [];
  // Only an asked-for service changes an agent's access. An app-raised card (Reconnect, More access)
  // restores a connection the agent already uses, and lists every service of the provider.
  if (outcome !== 'declined' && view.agent && view.requestedBy === 'agent' && (view.kind === 'connect' || view.kind === 'allow_agent')) {
    await grantAccess(view.agent.workspaceId, view.toolkitIds, granted);
  }
  const response: ConnectionResponseView = {
    requestEventId: row.id,
    outcome,
    providerId: view.providerId,
    label: view.label,
    account: accountLabels[0] ?? null,
    accounts: outcome === 'declined' ? [] : accountLabels,
    agent: view.agent,
  };
  const text = outcome === 'declined' ? 'Not now' : outcome === 'allowed' ? 'Allowed' : view.kind === 'reconnect' ? 'Reconnected' : 'Connected';
  const shown = outcome === 'declined' || accountLabels.length === 0 ? '' : ` (${describeAccounts(accountLabels)})`;
  insertChatEvent({
    sessionId: row.sessionId,
    role: 'system',
    source: RESPONSE,
    content: `${text}: ${view.label}${shown}`,
    toolName: null,
    toolInput: response,
    toolIsError: outcome === 'declined',
    createdAt: new Date().toISOString(),
  });
  const note = connectionNote(outcome, view, { accounts: accountLabels, forOtherAgent: view.onBehalf ? view.agent?.name ?? null : null });
  // New tools only reach a harness when its process restarts, so reload the asking chat before the
  // note, unless it was a decline or on another agent's behalf (nothing new for this chat).
  wakeAgent(row.sessionId, note, { reload: outcome !== 'declined' && !view.onBehalf });
}

function deliverable(sessionId: string) {
  const session = getChatSessionWithExecution(sessionId);
  if (!session || session.status === 'archived' || isImportMirror(session)) return null;
  return session;
}

/**
 * Tell the asking agent what happened. If its turn is still running, wait for it to end (bounded),
 * so the reload doesn't cut the turn off and the note starts a turn that has the new tools.
 */
function wakeAgent(sessionId: string, note: string, opts: { reload: boolean }): void {
  const go = async () => {
    const session = deliverable(sessionId);
    if (!session) return;
    if (opts.reload) await executor.recycleWhenIdle(sessionId);
    try {
      await healthCheckSession(sessionId, { redispatchOrphans: false });
    } catch (err) {
      console.error(`[integrations] pre-dispatch health check failed for ${sessionId}:`, err);
    }
    dispatchSessionTurn(sessionId, session.executionId ?? null, note);
  };
  const started = Date.now();
  const tick = () => {
    if (!executor.isRunning(sessionId) || Date.now() - started > IDLE_WAIT_MS) {
      void go().catch((err) => console.error(`[integrations] waking ${sessionId} failed:`, err));
      return;
    }
    setTimeout(tick, IDLE_POLL_MS);
  };
  tick();
}
