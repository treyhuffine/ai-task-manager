/**
 * An in-memory stand-in for Composio's REST API v3.1, for tests. It speaks the same paths and
 * shapes the client uses, enforces the same ownership rules (a key reaches one project, a session
 * executes only its allowed tools for its pinned account), and lets a test misbehave on purpose:
 * ignore a restriction, change a tool's schema, fail a request, or lose a response after a write.
 *
 * Use `fake.fetch` as the client's `fetch`.
 */
import { randomBytes } from 'node:crypto';

type Status = 'INITIALIZING' | 'INITIATED' | 'ACTIVE' | 'FAILED' | 'EXPIRED' | 'INACTIVE' | 'REVOKED';

export interface FakeAccount {
  id: string;
  user_id: string;
  status: Status;
  toolkit: string;
  auth_config_id: string;
  alias?: string;
  /** The provider identity the fake "Google" reports for this account. */
  email: string;
  disabled: boolean;
  /** Present to prove parsing drops token state. */
  state: { access_token: string };
}

export interface FakeTool {
  slug: string;
  toolkit: string;
  version: string;
  input_parameters: Record<string, unknown>;
  description?: string;
}

/** A session create body, as the fake reads it. */
interface SessionBody {
  user_id: string;
  toolkits?: { enable: string[] };
  tools?: Record<string, { enable: string[] }>;
  connected_accounts?: Record<string, string[]>;
  manage_connections?: { enable?: boolean; enable_wait_for_connections?: boolean; enable_connection_removal?: boolean };
  workbench?: { enable?: boolean };
  proxy_execute?: { enable: boolean };
  multi_account?: { enable?: boolean };
  preload?: { tools?: string[] };
  search?: { enable?: boolean };
  execute?: { enable_multi_execute?: boolean };
  instant?: false | Record<string, unknown>;
}

/** Every request body the fake handles, read loosely as a server would. */
interface RequestBody extends Partial<SessionBody> {
  auth_config_id?: string;
  alias?: string;
  callback_url?: string;
  redirect_url?: string;
  toolkit?: { slug: string };
  auth_config?: { type?: string; name?: string };
  enabled?: boolean;
  version?: string;
  connected_account_id?: string;
  arguments?: Record<string, unknown>;
  tool_slug?: string;
}

interface FakeSession {
  id: string;
  user_id: string;
  body: SessionBody;
  deleted: boolean;
}

export interface Execution {
  via: 'session' | 'pinned';
  sessionId?: string;
  slug: string;
  accountId: string;
  version?: string;
  args: Record<string, unknown>;
}

const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const notFound = (what: string) => json(404, { error: { message: `${what} not found`, status: 404, request_id: 'req_fake' } });

export function createFakeComposio(options: { apiKey?: string; project?: { id: string; name: string }; linkBase?: string } = {}) {
  const linkBase = options.linkBase ?? 'https://connect.composio.test';
  const state = {
    apiKeys: new Set([options.apiKey ?? 'ak_fake_project_key']),
    project: options.project ?? { id: 'proj_fake', name: 'Ri dev' },
    authConfigs: [] as { id: string; toolkit: string; managed: boolean; name: string }[],
    accounts: [] as FakeAccount[],
    sessions: new Map<string, FakeSession>(),
    tools: new Map<string, FakeTool[]>(),
    executions: [] as Execution[],
    requests: [] as { method: string; path: string; body?: unknown }[],
    /** Fail the next request matching `method path` (prefix match on path). */
    failures: [] as { method: string; path: string; status: number; body?: unknown; headers?: Record<string, string> }[],
    /** Drop the connection after the next matching write was applied. */
    dropAfterWrite: [] as { method: string; path: string }[],
    /** Return a session readback that ignores restrictions (simulating a vendor change). */
    sessionTamper: undefined as undefined | ((config: Record<string, unknown>, routerTools: string[]) => void),
    /** Extra tools a session's tool listing returns. */
    extraSessionTools: [] as FakeTool[],
    /** The data a tool returns, by slug. */
    results: new Map<string, (args: Record<string, unknown>, account: FakeAccount) => Record<string, unknown>>(),
    /** The vendor does not offer this resource for a scoped key. */
    sessionInfoForbidden: false,
  };

  function addTool(tool: Omit<FakeTool, 'version' | 'input_parameters'> & Partial<FakeTool>) {
    const full: FakeTool = { version: '20261010_00', input_parameters: { type: 'object', properties: {} }, ...tool };
    const versions = state.tools.get(full.slug) ?? [];
    state.tools.set(full.slug, [...versions.filter(v => v.version !== full.version), full]);
  }

  function latest(slug: string): FakeTool | undefined {
    const versions = state.tools.get(slug);
    return versions?.slice().sort((a, b) => b.version.localeCompare(a.version))[0];
  }

  const toolJson = (tool: FakeTool) => ({
    slug: tool.slug, name: tool.slug, description: tool.description ?? `${tool.slug} from the fake`,
    toolkit: { slug: tool.toolkit, name: tool.toolkit, logo: '' }, input_parameters: tool.input_parameters,
    output_parameters: {}, no_auth: false, available_versions: (state.tools.get(tool.slug) ?? []).map(v => v.version),
    version: tool.version, scopes: [], scope_requirements: null, tags: [], is_deprecated: false,
  });

  const accountJson = (account: FakeAccount) => ({
    id: account.id, user_id: account.user_id, status: account.status, toolkit: { slug: account.toolkit },
    auth_config: { id: account.auth_config_id, auth_scheme: 'OAUTH2', is_composio_managed: true, is_disabled: false },
    alias: account.alias ?? null, status_reason: null, is_disabled: account.disabled, word_id: null,
    created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z',
    state: { val: account.state }, data: { access_token: account.state.access_token }, params: {},
  });

  function readback(session: FakeSession) {
    const body = session.body;
    const config: Record<string, unknown> = {
      user_id: session.user_id,
      ...(body.toolkits ? { toolkits: { enabled: body.toolkits.enable } } : {}),
      ...(body.tools ? { tools: Object.fromEntries(Object.entries(body.tools).map(([k, v]) => [k, { enabled: v.enable }])) } : {}),
      ...(body.connected_accounts ? { connected_accounts: body.connected_accounts } : {}),
      instant: body.instant === false ? false : { return_instant_charge: false, return_prices_in_search: false },
      manage_connections: {
        enabled: body.manage_connections?.enable ?? true,
        enable_wait_for_connections: body.manage_connections?.enable_wait_for_connections ?? false,
        enable_connection_removal: body.manage_connections?.enable_connection_removal ?? true,
      },
      workbench: { enable: body.workbench?.enable ?? true },
      ...(body.proxy_execute ? { proxy_execute: body.proxy_execute } : {}),
      multi_account: { enable: body.multi_account?.enable ?? false },
      preload: { tools: body.preload?.tools ?? [] },
      search: { enable: body.search?.enable ?? true },
      execute: { enable_multi_execute: body.execute?.enable_multi_execute ?? true },
    };
    const routerTools: string[] = [];
    if (config.search && (config.search as { enable: boolean }).enable) routerTools.push('COMPOSIO_SEARCH_TOOLS');
    if ((config.manage_connections as { enabled: boolean }).enabled) routerTools.push('COMPOSIO_MANAGE_CONNECTIONS');
    state.sessionTamper?.(config, routerTools);
    return { session_id: session.id, mcp: { type: 'http', url: `https://fake.composio/mcp/${session.id}` }, tool_router_tools: routerTools, config, config_version: 1 };
  }

  function sessionTools(session: FakeSession): FakeTool[] {
    const allowed = Object.values(session.body.tools ?? {}).flatMap(v => v.enable);
    return [...allowed.map(slug => latest(slug)).filter((tool): tool is FakeTool => Boolean(tool)), ...state.extraSessionTools];
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v3\.1/, '');
    const method = request.method;
    const text = method === 'GET' ? '' : await request.text();
    const body = text ? JSON.parse(text) as RequestBody : undefined;
    state.requests.push({ method, path, ...(body !== undefined ? { body } : {}) });
    if (!state.apiKeys.has(request.headers.get('x-api-key') ?? '')) {
      return json(401, { error: { message: 'Invalid API key', status: 401, request_id: 'req_fake' } });
    }
    const failure = state.failures.findIndex(f => f.method === method && path.startsWith(f.path));
    if (failure >= 0) {
      const [f] = state.failures.splice(failure, 1);
      return json(f!.status, f!.body ?? { error: { message: `Fake failure ${f!.status}`, status: f!.status } }, f!.headers);
    }
    const response = route(method, path, url, body);
    const drop = state.dropAfterWrite.findIndex(d => d.method === method && path.startsWith(d.path));
    if (drop >= 0) {
      state.dropAfterWrite.splice(drop, 1);
      throw new TypeError('fetch failed (fake: connection dropped after the write was applied)');
    }
    return response;
  }

  function route(method: string, path: string, url: URL, body?: RequestBody): Response {
    const segments = path.split('/').filter(Boolean);
    if (method === 'GET' && path === '/auth/session/info') {
      if (state.sessionInfoForbidden) return json(403, { error: { message: 'Forbidden', status: 403 } });
      return json(200, { project: { id: `uuid-${state.project.id}`, nano_id: state.project.id, name: state.project.name, org_id: 'org', email: 'x', webhook_secret: 'whsec_leak' }, api_key: { key: 'ak_leak' } });
    }
    if (segments[0] === 'auth_configs') {
      if (method === 'GET') {
        const toolkit = url.searchParams.get('toolkit_slug');
        const items = state.authConfigs.filter(c => !toolkit || c.toolkit === toolkit).map(c => ({
          id: c.id, uuid: c.id, type: 'default', toolkit: { slug: c.toolkit, logo: '' }, name: c.name,
          is_composio_managed: c.managed, status: 'ENABLED', no_of_connections: 0, tool_access_config: {},
        }));
        return json(200, { items, next_cursor: null, total_pages: 1, current_page: 1, total_items: items.length });
      }
      if (method === 'POST') {
        const created = { id: id('ac'), toolkit: body!.toolkit!.slug, managed: body!.auth_config?.type === 'use_composio_managed_auth', name: body!.auth_config?.name ?? '' };
        state.authConfigs.push(created);
        return json(201, { toolkit: { slug: created.toolkit }, auth_config: { id: created.id, auth_scheme: 'OAUTH2', is_composio_managed: created.managed } });
      }
    }
    if (segments[0] === 'connected_accounts') {
      if (method === 'POST' && segments[1] === 'link') {
        const config = state.authConfigs.find(c => c.id === body!.auth_config_id);
        if (!config) return notFound('Auth config');
        const account: FakeAccount = {
          id: id('ca'), user_id: body!.user_id!, status: 'INITIATED', toolkit: config.toolkit, auth_config_id: config.id,
          ...(body!.alias ? { alias: body!.alias } : {}), email: '', disabled: false, state: { access_token: 'ya29.secret-token' },
        };
        state.accounts.push(account);
        return json(201, { link_token: id('lt'), redirect_url: `${linkBase}/link/${account.id}?callback=${encodeURIComponent(body!.callback_url ?? '')}`, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), connected_account_id: account.id });
      }
      if (method === 'GET' && segments.length === 1) {
        const users = url.searchParams.get('user_ids')?.split(',');
        const toolkits = url.searchParams.get('toolkit_slugs')?.split(',');
        const statuses = url.searchParams.get('statuses')?.split(',');
        const ids = url.searchParams.get('connected_account_ids')?.split(',');
        const items = state.accounts.filter(a => (!users || users.includes(a.user_id)) && (!toolkits || toolkits.includes(a.toolkit))
          && (!statuses || statuses.includes(a.status)) && (!ids || ids.includes(a.id))).map(accountJson);
        return json(200, { items, next_cursor: null, total_pages: 1, current_page: 1, total_items: items.length });
      }
      const account = state.accounts.find(a => a.id === segments[1]);
      if (!account) return notFound('Connected account');
      if (method === 'GET' && segments.length === 2) return json(200, accountJson(account));
      if (method === 'POST' && segments[2] === 'refresh') {
        account.status = 'INITIATED';
        return json(200, { id: account.id, status: account.status, redirect_url: `${linkBase}/link/${account.id}?callback=${encodeURIComponent(body?.redirect_url ?? '')}` });
      }
      if (method === 'PATCH' && segments[2] === 'status') {
        account.disabled = !body!.enabled;
        account.status = body!.enabled ? 'ACTIVE' : 'INACTIVE';
        return json(200, { success: true });
      }
      if (method === 'POST' && segments[2] === 'revoke') {
        account.status = 'REVOKED';
        return json(200, { revoked_tokens: ['access_token', 'refresh_token'], connected_account: { id: account.id, status: 'REVOKED' } });
      }
      if (method === 'DELETE' && segments.length === 2) {
        state.accounts = state.accounts.filter(a => a.id !== account.id);
        return json(200, { success: true });
      }
    }
    if (segments[0] === 'tools') {
      if (method === 'GET' && segments.length === 1) {
        const toolkit = url.searchParams.get('toolkit_slug');
        const slugs = url.searchParams.get('tool_slugs')?.split(',');
        const items = [...state.tools.keys()].map(slug => latest(slug)!).filter(t => (!toolkit || t.toolkit === toolkit) && (!slugs || slugs.includes(t.slug))).map(toolJson);
        return json(200, { items, next_cursor: null, total_pages: 1, current_page: 1, total_items: items.length });
      }
      if (method === 'GET' && segments.length === 2) {
        const version = url.searchParams.get('version');
        const tool = (state.tools.get(segments[1]!) ?? []).find(v => v.version === version);
        return tool ? json(200, toolJson(tool)) : json(410, { error: { message: 'That tool version is retired.', status: 410 } });
      }
      if (method === 'POST' && segments[1] === 'execute') {
        const slug = segments[2]!;
        const tool = (state.tools.get(slug) ?? []).find(v => v.version === body!.version);
        if (!tool) return json(410, { error: { message: 'That tool version is retired.', status: 410 } });
        const account = state.accounts.find(a => a.id === body!.connected_account_id);
        if (!account || account.user_id !== body!.user_id) return notFound('Connected account');
        if (account.status !== 'ACTIVE') return json(200, { data: {}, error: 'Connected account is not active', successful: false, log_id: id('log') });
        state.executions.push({ via: 'pinned', slug, accountId: account.id, version: body!.version, args: body!.arguments ?? {} });
        const data = state.results.get(slug)?.(body!.arguments ?? {}, account) ?? {};
        return json(200, { data, error: null, successful: true, log_id: id('log') });
      }
    }
    if (segments[0] === 'tool_router' && segments[1] === 'session') {
      if (method === 'POST' && segments.length === 2) {
        const session: FakeSession = { id: id('trs'), user_id: body!.user_id!, body: body as SessionBody, deleted: false };
        state.sessions.set(session.id, session);
        return json(201, readback(session));
      }
      const session = state.sessions.get(segments[2]!);
      if (!session || session.deleted) return notFound('Session');
      if (method === 'GET' && segments.length === 3) return json(200, readback(session));
      if (method === 'DELETE' && segments.length === 3) {
        session.deleted = true;
        return json(200, { session_id: session.id, deleted: true });
      }
      if (method === 'GET' && segments[3] === 'tools') {
        const items = sessionTools(session).map(toolJson);
        return json(200, { items, next_cursor: null, total_pages: 1, current_page: 1, total_items: items.length });
      }
      if (method === 'POST' && segments[3] === 'execute') {
        const slug = body!.tool_slug as string;
        if (!sessionTools(session).some(t => t.slug === slug)) return json(403, { error: { message: `Tool ${slug} is not enabled in this session`, status: 403 } });
        const toolkit = latest(slug)?.toolkit ?? '';
        const pinned = session.body.connected_accounts?.[toolkit] ?? [];
        const account = state.accounts.find(a => a.id === pinned[0] && a.user_id === session.user_id);
        if (!account) return json(400, { error: { message: 'No connected account for this toolkit', status: 400 } });
        if (account.status !== 'ACTIVE') return json(200, { result_type: 'failed', data: {}, error: 'Connected account is expired. Reconnect it.', log_id: id('log') });
        state.executions.push({ via: 'session', sessionId: session.id, slug, accountId: account.id, args: body!.arguments ?? {} });
        const data = state.results.get(slug)?.(body!.arguments ?? {}, account) ?? { ok: true };
        return json(200, { result_type: 'completed', data, error: null, log_id: id('log') });
      }
    }
    return json(404, { error: { message: `Fake has no route for ${method} ${path}`, status: 404 } });
  }

  return {
    state,
    addTool,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch,
    /** The user finished the provider's consent for this account. */
    completeLink(accountId: string, email: string) {
      const account = state.accounts.find(a => a.id === accountId);
      if (!account) throw new Error(`no fake account ${accountId}`);
      account.status = 'ACTIVE';
      account.email = email;
      return account;
    },
    /** An account that exists in the project outside Ri's flow (e.g. another app's user). */
    seedAccount(account: Partial<FakeAccount> & { user_id: string; toolkit: string; email: string }): FakeAccount {
      const config = state.authConfigs.find(c => c.toolkit === account.toolkit) ?? (() => {
        const created = { id: id('ac'), toolkit: account.toolkit, managed: true, name: 'seed' };
        state.authConfigs.push(created);
        return created;
      })();
      const full: FakeAccount = { id: id('ca'), status: 'ACTIVE', auth_config_id: config.id, disabled: false, state: { access_token: 'ya29.other' }, ...account };
      state.accounts.push(full);
      return full;
    },
    liveSessions: () => [...state.sessions.values()].filter(s => !s.deleted),
  };
}

export type FakeComposio = ReturnType<typeof createFakeComposio>;

/** Register the tools of Ri's catalog with simple schemas and identity results. */
export function seedCatalogTools(fake: FakeComposio): void {
  const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
  const tools: [string, string, Record<string, unknown>][] = [
    ['GMAIL_FETCH_EMAILS', 'gmail', object({ query: { type: 'string' }, max_results: { type: 'integer' } })],
    ['GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', 'gmail', object({ message_id: { type: 'string' } }, ['message_id'])],
    ['GMAIL_FETCH_MESSAGE_BY_THREAD_ID', 'gmail', object({ thread_id: { type: 'string' } }, ['thread_id'])],
    ['GMAIL_GET_PROFILE', 'gmail', object({ user_id: { type: 'string' } })],
    ['GMAIL_CREATE_EMAIL_DRAFT', 'gmail', object({ recipient_email: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } })],
    ['GMAIL_SEND_DRAFT', 'gmail', object({ draft_id: { type: 'string' } }, ['draft_id'])],
    ['GMAIL_SEND_EMAIL', 'gmail', object({ recipient_email: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, ['recipient_email'])],
    ['GOOGLECALENDAR_LIST_CALENDARS', 'googlecalendar', object({ page_token: { type: 'string' }, max_results: { type: 'integer' } })],
    ['GOOGLECALENDAR_EVENTS_LIST', 'googlecalendar', object({ calendarId: { type: 'string' }, timeMin: { type: 'string' }, timeMax: { type: 'string' }, pageToken: { type: 'string' }, singleEvents: { type: 'boolean' } })],
    ['GOOGLECALENDAR_CREATE_EVENT', 'googlecalendar', object({ summary: { type: 'string' }, start_datetime: { type: 'string' }, calendar_id: { type: 'string' } })],
    ['GOOGLECALENDAR_GET_CALENDAR', 'googlecalendar', object({ calendar_id: { type: 'string' } })],
  ];
  for (const [slug, toolkit, input_parameters] of tools) fake.addTool({ slug, toolkit, input_parameters });
  fake.state.results.set('GMAIL_GET_PROFILE', (_args, account) => ({ emailAddress: account.email, messagesTotal: 10 }));
  fake.state.results.set('GOOGLECALENDAR_GET_CALENDAR', (_args, account) => ({ id: account.email, summary: account.email, timeZone: 'America/Denver' }));
}
