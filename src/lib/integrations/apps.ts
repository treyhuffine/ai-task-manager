/**
 * Personal apps as connectors, one OAuth connection per place (docs/personal-apps.md).
 *
 * An app is an ordinary MCP server that runs on its own. Ri adds it once, for its own chats, and
 * that connection also opens the app's screens in Ri. Each agent the person allows gets its own
 * connection: a separate server entry, so a separate dynamic client registration and token, and
 * the app's consent screen asks what that agent may see. The engine treats an app's places as the
 * accounts of one connector (`app_<slug>`), and each place is pinned to its own account wherever
 * tools, screens and mentions are offered (`workspace-filter.ts`, `mcp-apps/service.ts`).
 *
 * Allowing an agent to use an app is an access decision: the agent sees whatever the app shows,
 * including what the app read from the person's accounts. `allowConsequence` (./app-access-copy)
 * says so, and the UI shows it before the app's consent screen opens.
 */
import { APP_NAME } from '@/constants/app';
import { getWorkspace, listWorkspaces, setWorkspaceIntegrationScopes } from '@/lib/db/queries';
import { normalizeIntegrationScopes } from './scope-pins';
import { beginMcpAuthorization } from './mcp-authorization';
import { removeMcpServer } from './mcp-lifecycle';
import {
  appPlaceAccountId, appToolkitId, samePlace, toSlug,
  type McpAppBinding, type McpAppPlace, type McpServerEntry,
} from './mcp-servers';
import { MCP_LIMITS, validateMcpUrl } from './mcp-validate';
import {
  appPlaceLabel, getIntegrationConnectionStore, getIntegrationOwnerId, getMcpServerStore, invalidateIntegrationRuntime,
} from './runtime';

export class PersonalAppError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'conflict', message: string) {
    super(message);
    this.name = 'PersonalAppError';
  }
}

/** Connections across every app and place. Each is a server entry, so this bounds the store. */
export const MAX_APP_CONNECTIONS = 200;

export interface PersonalAppPlaceView {
  place: McpAppPlace;
  /** `Ri`, or the agent's name. */
  label: string;
  /** The server entry for this place's connection. */
  serverId: string;
  /** Connected, waiting for the person to finish signing in, or not working. */
  status: 'connected' | 'sign_in' | 'unavailable';
  error?: string;
}

export interface PersonalAppView {
  id: string;
  name: string;
  /** The connector id every place shares. */
  toolkitId: string;
  url: string;
  /** Ri's own connection, which also opens the app's screens in Ri. */
  ri: PersonalAppPlaceView | null;
  agents: PersonalAppPlaceView[];
}

type AuthorizationStart = Awaited<ReturnType<typeof beginMcpAuthorization>>;
type RequestLike = Pick<Request, 'headers' | 'url'>;

function appEntries(): McpServerEntry[] {
  return getMcpServerStore().list().filter((entry) => entry.app);
}

function placeView(entry: McpServerEntry): PersonalAppPlaceView {
  const status = entry.lastStatus === 'ok' && entry.lastAuthorizationId ? 'connected'
    : !entry.lastAuthorizationId || entry.lastFailure?.kind === 'auth' ? 'sign_in' : 'unavailable';
  return {
    place: entry.app!.place,
    label: appPlaceLabel(entry.app!.place),
    serverId: entry.id,
    status,
    ...(status === 'unavailable' && entry.lastError ? { error: entry.lastError } : {}),
  };
}

/** Every personal app, with Ri's connection and each agent's. */
export function listPersonalApps(): PersonalAppView[] {
  const apps = new Map<string, McpServerEntry[]>();
  for (const entry of appEntries()) apps.set(entry.app!.id, [...(apps.get(entry.app!.id) ?? []), entry]);
  return [...apps.values()].map((entries) => {
    const first = entries.find((entry) => entry.app!.place.kind === 'ri') ?? entries[0]!;
    const ri = entries.find((entry) => entry.app!.place.kind === 'ri');
    return {
      id: first.app!.id,
      name: first.app!.name,
      toolkitId: appToolkitId(first.app!.slug),
      url: first.url,
      ri: ri ? placeView(ri) : null,
      agents: entries.filter((entry) => entry.app!.place.kind === 'agent').map(placeView)
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function getPersonalApp(appId: string): PersonalAppView {
  const app = listPersonalApps().find((item) => item.id === appId);
  if (!app) throw new PersonalAppError('not_found', 'This app isn’t connected anymore.');
  return app;
}

/** A server slug no other entry has, derived from the app and the place. */
function entrySlug(app: Pick<McpAppBinding, 'slug'>, place: McpAppPlace): string {
  const base = `${app.slug}_at_${place.kind === 'ri' ? 'ri' : place.workspaceId.replace(/[^a-zA-Z0-9]/g, '').slice(-12).toLowerCase()}`;
  const store = getMcpServerStore();
  let slug = base;
  for (let n = 2; store.getBySlug(slug); n += 1) slug = `${base}_${n}`;
  return slug;
}

async function connectPlace(app: Omit<McpAppBinding, 'place'>, url: string, place: McpAppPlace, request?: RequestLike, returnTo?: string) {
  const store = getMcpServerStore();
  if (store.list().filter((entry) => entry.app).length >= MAX_APP_CONNECTIONS) {
    throw new PersonalAppError('conflict', `Ri can hold at most ${MAX_APP_CONNECTIONS} app connections. Remove an app or an agent's access first.`);
  }
  const entry = await store.create({
    app: { ...app, place },
    slug: entrySlug(app, place),
    displayName: place.kind === 'ri' ? app.name : `${app.name} · ${appPlaceLabel(place)}`,
    url,
    auth: { kind: 'oauth' },
  });
  try {
    const start = await beginMcpAuthorization(entry, request, returnTo);
    return { entry, start };
  } catch (error) {
    await store.remove(entry.id);
    throw new PersonalAppError('invalid', error instanceof Error ? error.message : 'Could not start signing in to the app.');
  }
}

/**
 * Add an app by its MCP address and connect Ri's own chats to it. The app's consent screen opens
 * next (`authUrl`); its tools and screens appear once the person allows it there.
 */
export async function addPersonalApp(input: { name: string; url: string; returnTo?: string }, request?: RequestLike): Promise<{ app: PersonalAppView } & AuthorizationStart> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new PersonalAppError('invalid', 'Name the app.');
  if (name.length > MCP_LIMITS.maxNameLength) throw new PersonalAppError('invalid', 'That name is too long.');
  const slug = toSlug(name);
  if (!slug) throw new PersonalAppError('invalid', 'Use letters or numbers in the name.');
  const url = validateMcpUrl(input.url);
  if (!url.ok) throw new PersonalAppError('invalid', url.error);
  const existing = appEntries();
  if (existing.some((entry) => entry.app!.slug === slug)) throw new PersonalAppError('conflict', `An app named ${name} is already connected.`);
  if (existing.some((entry) => sameAddress(entry.url, url.url))) throw new PersonalAppError('conflict', 'That app is already connected.');
  const { entry, start } = await connectPlace({ id: crypto.randomUUID(), slug, name }, url.url, { kind: 'ri' }, request, input.returnTo);
  invalidateIntegrationRuntime();
  return { app: getPersonalApp(entry.app!.id), ...start };
}

/** Loopback aliases are one app: `localhost`, `127.0.0.1` and `[::1]` at the same port and path. */
function sameAddress(a: string, b: string): boolean {
  const canonical = (value: string) => {
    const url = new URL(value);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.hostname = 'localhost';
    url.hash = '';
    return url.href.replace(/\/+$/, '');
  };
  try { return canonical(a) === canonical(b); } catch { return a === b; }
}

/**
 * Let an agent use an app through its own connection. The agent's scope names the app with its own
 * account, so the app's tools reach the agent's chats once the person allows it on the app's
 * consent screen, and never through Ri's or another agent's connection.
 */
export async function allowPersonalAppInAgent(input: { appId: string; workspaceId: string; returnTo?: string }, request?: RequestLike): Promise<AuthorizationStart> {
  const workspace = getWorkspace(input.workspaceId);
  if (!workspace) throw new PersonalAppError('not_found', 'That agent isn’t here anymore.');
  const entries = appEntries().filter((entry) => entry.app!.id === input.appId);
  const app = entries[0]?.app;
  if (!app) throw new PersonalAppError('not_found', 'This app isn’t connected anymore.');
  const place: McpAppPlace = { kind: 'agent', workspaceId: workspace.id };
  addAppScope(workspace.id, appToolkitId(app.slug), place);
  const current = entries.find((entry) => samePlace(entry.app!.place, place));
  // Signing in again replaces the agent's connection in place, keeping its client registration.
  if (current) return beginMcpAuthorization(current, request, input.returnTo);
  const { start } = await connectPlace(app, entries[0]!.url, place, request, input.returnTo);
  await recycleAgent(workspace.id);
  return start;
}

/** Stop an agent using an app: its scope goes, and Ri forgets the agent's connection and token. */
export async function removePersonalAppFromAgent(input: { appId: string; workspaceId: string }): Promise<void> {
  const place: McpAppPlace = { kind: 'agent', workspaceId: input.workspaceId };
  const entries = appEntries().filter((entry) => entry.app!.id === input.appId);
  const app = entries[0]?.app;
  if (!app) throw new PersonalAppError('not_found', 'This app isn’t connected anymore.');
  removeAppScope(input.workspaceId, appToolkitId(app.slug));
  for (const entry of entries.filter((item) => samePlace(item.app!.place, place))) await forget(entry);
  invalidateIntegrationRuntime();
  await recycleAgent(input.workspaceId);
}

/** Remove an app from Ri: every place's connection, and every agent's scope for it. */
export async function removePersonalApp(appId: string): Promise<void> {
  const entries = appEntries().filter((entry) => entry.app!.id === appId);
  if (!entries.length) return;
  const toolkitId = appToolkitId(entries[0]!.app!.slug);
  const agents = [...listWorkspaces({ status: 'active' }), ...listWorkspaces({ status: 'archived' })]
    .filter((workspace) => (workspace.integrationScopes ?? []).some((scope) => scope.toolkitId === toolkitId));
  for (const workspace of agents) removeAppScope(workspace.id, toolkitId);
  for (const entry of entries) await forget(entry);
  invalidateIntegrationRuntime();
  for (const workspace of agents) await recycleAgent(workspace.id);
}

async function forget(entry: McpServerEntry) {
  await removeMcpServer(entry, getMcpServerStore(), getIntegrationConnectionStore(), getIntegrationOwnerId());
}

function addAppScope(workspaceId: string, toolkitId: string, place: McpAppPlace) {
  const scopes = normalizeIntegrationScopes(getWorkspace(workspaceId)?.integrationScopes).filter((scope) => scope.toolkitId !== toolkitId);
  setWorkspaceIntegrationScopes(workspaceId, [...scopes, { toolkitId, accounts: [{ accountId: appPlaceAccountId(place) }] }]);
}

function removeAppScope(workspaceId: string, toolkitId: string) {
  const scopes = normalizeIntegrationScopes(getWorkspace(workspaceId)?.integrationScopes);
  if (!scopes.some((scope) => scope.toolkitId === toolkitId)) return;
  setWorkspaceIntegrationScopes(workspaceId, scopes.filter((scope) => scope.toolkitId !== toolkitId));
}

/** The agent's running chats pick up the change on their next turn, as with any scope change. */
async function recycleAgent(workspaceId: string) {
  await (await import('@/lib/executor/adapter')).recycleWorkspaceSessions(workspaceId);
}

/** The name an app's place goes by, for the person: `Ri`, or the agent. */
export function placeName(place: McpAppPlace): string {
  return place.kind === 'ri' ? APP_NAME : appPlaceLabel(place);
}
