import { randomUUID } from 'node:crypto';
import { CallToolResultSchema } from '@modelcontextprotocol/core';
import { inputDigest, type IntegrationRuntimeOptions } from '@integrations/engine';
import { processState } from '@/lib/process-state';
import { integrationSourceMetadata } from '@/lib/integrations/source-metadata';
import type { McpCapabilityTool } from '@/lib/integrations/mcp-capabilities';
import { getIntegrationOwnerId, getMcpViewAuthority } from '@/lib/integrations/runtime';
import { isCurrentMcpTransport } from '@/lib/integrations/mcp-lifecycle';
import { hostedMcpConnectionId } from '@/lib/integrations/hosted-mcp';
import { getChatSessionWithExecution, getMcpAppResult, getWorkspace, insertChatEvent, insertMcpAppResult } from '@/lib/db/queries';
import { normalizeIntegrationScopes, pinMatchesConnection, scopePins } from '@/lib/integrations/scope-pins';
import { sessionCaller, sessionIdFromCaller, listPendingApprovals, resolvePendingApprovals, cancelConnectedAppApprovals } from '@/lib/integrations/approval';
import { isImportMirror } from '@/lib/import/mirror';
import { encodeSource } from '@/lib/chat-sources/reference';
import { safeMcpIcon } from '@/lib/integrations/mcp-icons';
import { appToolVisible, entrypointIcons, mentionsSearchTool, modelToolVisible, settingsCapability, toolTitle, viewMetadata, MCP_APP_EVENT } from './metadata';
import { declaredCsp, type DeclaredNetwork, type ViewCsp } from '@ri/mcp-apps-host/csp';
import { McpViewStore, MAX_DELIVERED_RESULT, MAX_RESULT, type Capture, type CaptureKind, type ModelContext, type View } from './store';
import { prepareResource } from './resource';

export const mcpAppsEnabled = () => process.env.RI_MCP_APPS !== '0';
export const mcpViews = () => processState('mcp-app-views', () => new McpViewStore(view => {
  const ids = listPendingApprovals({ownerId: getIntegrationOwnerId()}).filter(p => p.connectedApp?.viewId === view.id).map(p => p.id);
  if (ids.length) resolvePendingApprovals(ids, 'deny');
  // A view's file watches end with it. A failure here must not become an unhandled rejection: the
  // watch still ends at unsubscribe.
  if (view.capture.kind === 'file') void import('./files').then(files => files.closeHostWatches(view)).catch(() => {});
}));
const assertEnabled = () => { if (!mcpAppsEnabled()) throw new Error('Connected app views are disabled for this Home'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** "Todoist · find-tasks-by-date", or the name once when a screen is titled for its service. */
const viewTitle = (service: string, tool: string) => service.toLocaleLowerCase() === tool.toLocaleLowerCase() ? service : `${service} · ${tool}`;

/**
 * Cached catalog only. Discovery never calls a tool or initializes a server.
 *
 * A connection is listed when its server offers an interface: a result view a
 * model-run tool returns into chat, or an entrypoint a person opens
 * (`_meta["openai/ui"].entrypoints`, OpenAI's MCP extensions spec). A global
 * entrypoint is a standalone screen, which the rail and ⌘K list. A thread
 * entrypoint is a tab beside a chat, and a file entrypoint is the viewer for
 * its extensions. A tool's visibility doesn't hide an entrypoint, since the
 * spec ignores `ui.visibility` when an app opens as one.
 */
export async function connectedAppsCatalog(viewerId?: string) {
  if (!mcpAppsEnabled()) return [];
  const metadata = await integrationSourceMetadata();
  return metadata.servers.flatMap(({entry, capabilities}) => {
    const ui = capabilities?.tools.filter(t => viewMetadata(t) && entry.toolOverrides?.[t.name]?.enabled !== false) ?? [];
    const views = ui.filter(t => modelToolVisible(t));
    const serverIcons = entry.protocol?.info?.icons ?? [];
    const item = (t: McpCapabilityTool) => ({name: t.name, title: toolTitle(t), icons: entrypointIcons(t, serverIcons)});
    const entrypoints = ui.filter(t => viewMetadata(t)!.global).map(item);
    const threads = ui.filter(t => viewMetadata(t)!.thread).map(item);
    const files = ui.flatMap(t => viewMetadata(t)!.file.length ? [{...item(t), extensions: viewMetadata(t)!.file}] : []);
    const settings = !!settingsCapability(entry.protocol?.extensions);
    const mentions = !!mentionsSearchTool(entry.protocol?.extensions, capabilities?.tools ?? []);
    // Settings and @ search alone are not an interface: they live on the connection's page and in the composer.
    if (!views.length && !entrypoints.length && !threads.length && !files.length) return [];
    const connection = metadata.connections.find(c => c.id === hostedMcpConnectionId(entry));
    const toolkitId = entry.providerId ?? `mcp_${entry.slug}`;
    // `name` is this server's own label, often its account ("Todoist 2"). The toolkit's name is the product, shared by every account.
    const toolkitName = metadata.toolkits.find(t => t.id === toolkitId)?.displayName ?? entry.displayName;
    return [{id: entry.id, name: entry.displayName, toolkitName, providerId: entry.providerId, connectionId: connection?.id,
      account: connection?.label || connection?.email || connection?.accountId || entry.displayName,
      available: !!connection && connection.status === 'active' && entry.enabled,
      sourceRef: connection ? encodeSource({v: 1, kind: 'integration', toolkitId, account: {accountId: connection.accountId, authConfigId: connection.authConfigId ?? null}}) : null,
      icons: serverIcons,
      standalone: entrypoints.length > 0,
      entrypoints, threads, files, settings, mentions,
      views: views.map(t => ({name: t.name, title: toolTitle(t)})),
      // A capture without a chat is a screen the person opened (Open app), which reopens full screen.
      recent: [...mcpViews().captures.values()].filter(c => c.serverId === entry.id && (!c.viewerId || c.viewerId === viewerId) && (c.kind ?? 'result') !== 'thread' && (c.kind ?? 'result') !== 'preview' && (c.kind ?? 'result') !== 'settings')
        .map(c => ({id: c.id, chatId: c.chatId, title: c.title, created: c.created, launched: !c.chatId, kind: c.kind ?? 'result', tool: c.tool}))}];
  });
}

/** A chat may not use this account, or connected apps at all. Every other refusal is about the account itself. */
export class ChatAccessError extends Error {}

/**
 * Whether a chat may use this exact account: a chat that can use connected
 * apps at all, and, for an agent's chat, an agent whose integration scopes
 * include the toolkit and pin this account if they pin any. Throws why not.
 */
function chatAccess(chatId: string, toolkitId: string, connection: Parameters<typeof pinMatchesConnection>[1]) {
  const chat = getChatSessionWithExecution(chatId);
  if (!chat || chat.status === 'archived' || isImportMirror(chat) || ['result_review', 'app-builder', 'app-try'].includes(chat.surfaceKind ?? '')) throw new ChatAccessError('This chat cannot use connected apps');
  if (!chat.workspaceId) return;
  const scopes = normalizeIntegrationScopes(getWorkspace(chat.workspaceId)?.integrationScopes);
  const scope = scopes.find(s => s.toolkitId === toolkitId);
  if (!scope || (scopePins(scope).length && !scopePins(scope).some(pin => pinMatchesConnection(pin, connection)))) throw new ChatAccessError('This exact account is not available to this chat');
}

/**
 * The tabs a chat can open beside it (OpenAI's thread entrypoint): each
 * available connection's thread entrypoints, only on accounts that chat may
 * use. Cached metadata only, like the catalog.
 */
export async function connectedChatTabs(chatId: string, viewerId?: string) {
  const apps = await connectedAppsCatalog(viewerId);
  const metadata = await integrationSourceMetadata();
  return apps.filter(app => app.available && app.threads.length).flatMap(app => {
    const entry = metadata.servers.find(server => server.entry.id === app.id)?.entry;
    const connection = metadata.connections.find(c => c.id === app.connectionId);
    if (!entry || !connection) return [];
    try { chatAccess(chatId, entry.providerId ?? `mcp_${entry.slug}`, connection); }
    catch { return []; }
    return app.threads.map(thread => ({serverId: app.id, app: app.toolkitName, account: app.account, ...thread}));
  });
}

/**
 * Current access to a server on its exact account, and for `chatId` when
 * given: the check every app operation repeats. The server is on, its
 * account is connected, the chat may use that account, and the server's
 * transport is current. Tool calls then run through the current tool
 * settings and approval policy, so nothing about access is remembered from
 * when a view opened beyond which account it was for.
 *
 * The runtime, the connections and the transport come from one build, and
 * the server entry is read after it. `stale` lets a check that calls nothing
 * on the server (a status poll, context, a send) answer from the current
 * build past its age while it refreshes in the background. Operations that
 * reach the server (opening, reading, calling a tool, a launch) wait for a
 * current one.
 */
export async function authority(serverId: string, chatId?: string, options: {stale?: boolean} = {}) {
  assertEnabled();
  const {runtime, connections, view} = await getMcpViewAuthority(serverId, options);
  const metadata = await integrationSourceMetadata();
  const remote = metadata.servers.find(s => s.entry.id === serverId);
  if (!remote) throw new Error('This app was removed from Ri.');
  const app = remote.entry.displayName;
  if (!remote.entry.enabled) throw new Error(`${app} is turned off. Turn it on in Settings to open this.`);
  const connection = connections.find(c => c.id === hostedMcpConnectionId(remote.entry));
  if (!connection || connection.status !== 'active') throw new Error(`Reconnect your ${app} account to open this.`);
  const toolkitId = remote.entry.providerId ?? `mcp_${remote.entry.slug}`;
  if (chatId) chatAccess(chatId, toolkitId, connection);
  const sourceRef = encodeSource({v: 1, kind: 'integration', toolkitId, account: {accountId: connection.accountId, authConfigId: connection.authConfigId ?? null}});
  // The build's transport, still matching the entry just read.
  const transport = view && isCurrentMcpTransport(view.snapshot, {get: id => id === remote.entry.id ? remote.entry : null}) ? view : null;
  if (!transport) throw new Error(`${app} can't be reached right now.`);
  return {remote, runtime, connection, sourceRef, transport};
}

/**
 * Current access for a capture, on the account it was made with: the same
 * connection, so a result never runs on an account it didn't come from.
 * `stale` as for `authority`: a check that reaches nothing on the server.
 * Operations that do pass false.
 */
async function checkCapture(capture: Capture, stale = true) {
  const current = await authority(capture.serverId, capture.chatId, {stale});
  if (current.connection.id !== capture.connectionId || current.sourceRef !== capture.sourceRef) throw new Error('This app’s account changed. Open it again, or ask for a new result.');
  return current;
}

/**
 * A model's result stored when it arrived (`mcp_app_results`), to open again
 * after it left memory or the Home restarted, for as long as its chat exists.
 * Its title and display come from the server's tools as they are now, and
 * access is checked again when it opens, like any view.
 */
async function storedResult(id: string): Promise<Capture> {
  const row = getMcpAppResult(id);
  const result = row && CallToolResultSchema.safeParse(row.result);
  // A screen the person opened was never stored, and one that left memory has closed. So has a result from before this table.
  if (!row || !result?.success) throw new Error('This view is no longer open. Open the app again, or ask for a new result.');
  const metadata = await integrationSourceMetadata();
  const remote = metadata.servers.find(s => s.entry.id === row.serverId);
  const tool = remote?.capabilities?.tools.find(t => t.name === row.tool);
  const capture: Capture = {id, serverId: row.serverId, connectionId: row.connectionId, sourceRef: row.sourceRef, chatId: row.chatSessionId, tool: row.tool,
    input: object(row.input), result: result.data, resourceUri: row.resourceUri, legacy: (tool && viewMetadata(tool)?.legacy) ?? false,
    title: viewTitle(remote?.entry.displayName ?? 'App', tool ? toolTitle(tool) : row.tool), created: Date.parse(`${row.createdAt.replace(' ', 'T')}Z`), kind: 'result'};
  mcpViews().put(capture);
  return capture;
}
/** A view, rechecked as a check (`stale`) unless `fresh`: pass that before anything reaches the server. */
export async function checkedView(viewId: string, viewerId: string, options: {fresh?: boolean} = {}) {
  const view = mcpViews().get(viewId, viewerId);
  const current = await checkCapture(view.capture, !options.fresh);
  return {view, ...current};
}

/** Called by the trusted engine before dispatch. The observer closes over the
 * original authority, so a late result cannot inherit replacement credentials. */
export async function prepareMcpResultCapture(event: Parameters<NonNullable<IntegrationRuntimeOptions['prepareMcpResult']>>[0]) {
  const chatId = sessionIdFromCaller(event.caller);
  if (!mcpAppsEnabled() || event.audience !== 'model' || !chatId || event.caller?.connectedApp || event.ownerId !== getIntegrationOwnerId()) return;
  if (Buffer.byteLength(JSON.stringify(event.input)) > 64 * 1024) return;
  const metadata = await integrationSourceMetadata();
  const remote = metadata.servers.find(s => hostedMcpConnectionId(s.entry) === event.connectionId);
  if (!remote) return;
  const prefix = `${remote.entry.providerId ?? `mcp.${remote.entry.slug}`}.`;
  if (!event.actionId.startsWith(prefix)) return;
  const toolName = event.actionId.slice(prefix.length);
  const tool = remote.capabilities?.tools.find(t => t.name === toolName), ui = tool && viewMetadata(tool);
  if (!tool || !ui || !modelToolVisible(tool)) return;
  // The engine is already running this call on its build, so this only checks.
  const current = await authority(remote.entry.id, chatId, {stale: true});
  const binding = {serverId: remote.entry.id, connectionId: event.connectionId, sourceRef: current.sourceRef,
    chatId, tool: toolName, title: viewTitle(remote.entry.displayName, toolTitle(tool)), input: structuredClone(object(event.input)), resourceUri: ui.resourceUri, legacy: ui.legacy, kind: 'result' as const};
  return async (result: unknown) => {
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT) return;
    const capture: Capture = {...binding, id: randomUUID(), result: CallToolResultSchema.parse(result), created: Date.now()};
    await checkCapture(capture);
    if (!mcpViews().put(capture)) return;
    // The result is stored on its own, so it opens again for as long as the chat exists. The transcript
    // event carries only its id, so transcript pages never read it and its private metadata stays here.
    insertMcpAppResult({id: capture.id, chatSessionId: chatId, serverId: capture.serverId, connectionId: capture.connectionId, sourceRef: capture.sourceRef,
      tool: capture.tool, resourceUri: capture.resourceUri, input: capture.input, result: capture.result as Record<string, unknown>});
    insertChatEvent({id: capture.id, sessionId: chatId, source: 'system', role: 'system', content: MCP_APP_EVENT,
      externalEventId: `mcp-view:${event.attemptId}`, raw: {subtype: MCP_APP_EVENT}, createdAt: new Date().toISOString()});
  };
}

/** The key a server's declared network is known under: its tools and where it runs both decide it. */
const networkKey = (entry: {capabilityRevision?: string; url: string}) => `${entry.capabilityRevision ?? ''}\n${entry.url}`;

/**
 * Open a view. Its interface is read from the app's server every time,
 * through the live access checks: Ri keeps no copy. A server that can't be
 * reached, or an account that needs reconnecting, says so plainly, and the
 * reply in the chat is unaffected.
 */
export async function openConnectedView(captureId: string, viewerId: string, chatId?: string) {
  const capture = mcpViews().kept(captureId) ?? await storedResult(captureId);
  if (capture.chatId !== chatId || (capture.viewerId && capture.viewerId !== viewerId)) throw new Error('This result belongs to a different viewer or chat');
  const view = mcpViews().open(capture, viewerId);
  // Reading the interface reaches the server, so opening waits for a current build.
  const current = await checkCapture(capture, false);
  const app = current.remote.entry.displayName;
  let resource: ReturnType<typeof prepareResource> | null = null, unsupported: string | undefined;
  const tool = current.transport.tools.find(t => t.name === capture.tool);
  if (!tool || viewMetadata(tool)?.resourceUri !== capture.resourceUri) unsupported = 'This app’s declared resource changed';
  else {
    const raw = await current.transport.readResource({uri: capture.resourceUri}).catch(() => { throw new Error(`${app} can't be reached right now.`); });
    await checkCapture(capture);
    try {
      resource = prepareResource(raw, capture.resourceUri, capture.legacy, {serverIsLocal: (await import('./files')).serverRunsHere(current.remote.entry)});
      noteNetwork(capture.serverId, networkKey(current.remote.entry), capture.resourceUri, resource.csp);
    } catch (error) { unsupported = error instanceof Error ? error.message : 'The app interface could not load'; }
  }
  await checkCapture(capture);
  mcpViews().get(view.id, viewerId);
  let widgetState: unknown;
  if (capture.legacy && view.context) {
    const context = object(view.context);
    const first = Array.isArray(context.content) ? object(context.content[0]) : {};
    if (first.type === 'text' && typeof first.text === 'string') {try {widgetState = JSON.parse(first.text);} catch { /* Non-JSON context is still useful to chat. */ }}
  }
  return {id: view.id, captureId: capture.id, title: capture.title, serverId: capture.serverId, sourceRef: capture.sourceRef, chatId: capture.chatId,
    resource, unsupported, input: capture.input, result: capture.result, revision: view.revision, widgetState, legacy: capture.legacy,
    kind: capture.kind ?? 'result', created: capture.created, deepLink: capture.deepLink ?? null, file: capture.file ? {name: capture.file.name} : null,
    // OpenAI's model context host state: what this view last attached, or null, given again on every remount.
    modelContext: view.context && view.contextUpdateId ? {updateId: view.contextUpdateId, ...view.context} : null,
    tool: capture.tool, app, icons: current.remote.entry.protocol?.info?.icons ?? [],
    // How long ago the result arrived, by the home's clock, so a browser with a skewed clock still knows a fresh one.
    ageMs: Math.max(0, Date.now() - capture.created)};
}

/**
 * `resources/read` from a view. The file a file entrypoint opened is read by
 * Ri itself (`files.ts`). Any other URI goes to the view's own server, on its
 * exact account, rechecked like a tool call. A view never reads another
 * server's resources. Bits & Bolts reads its STEP importer this way.
 */
export async function readConnectedResource(viewId: string, viewerId: string, params: {uri: string; _meta?: Record<string, unknown>}) {
  if (typeof params.uri !== 'string' || params.uri.length > 4096 || !/^[a-z][a-z0-9+.-]*:/i.test(params.uri)) throw new Error('Invalid resource URI');
  const files = await import('./files');
  // A host file is Ri's own to read, so that only checks. Anything else reaches the server.
  const host = files.isHostResource(params.uri);
  const {view, transport} = await checkedView(viewId, viewerId, {fresh: !host});
  if (host) return files.readHostResource(view, params.uri, params._meta);
  const result = await transport.readResource({uri: params.uri, ...(params._meta ? {_meta: params._meta} : {})});
  await checkCapture(view.capture);
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_DELIVERED_RESULT) throw new Error('This resource is too large for the app view.');
  return result;
}

/** `entrypoint` is a person opening a standalone screen, which the spec lets past `ui.visibility`. */
async function invoke(view: View, name: string, args: Record<string, unknown>, invocationId: string, caller: 'model' | 'app' | 'entrypoint') {
  const current = await checkCapture(view.capture, false);
  const tool = current.transport.tools.find(t => t.name === name);
  const allowed = !!tool && (caller === 'entrypoint'
    ? name === view.capture.tool && (view.capture.kind ?? 'result') !== 'result' && launchAllowed(view.capture.kind as LaunchKind, tool, current.remote)
    : caller === 'app' ? appToolVisible(tool) : modelToolVisible(tool));
  if (!tool || current.remote.entry.toolOverrides?.[name]?.enabled === false || !allowed) throw new Error('This tool is not available to this app');
  // The engine still checks visibility, so an entrypoint runs as whichever audience its tool admits.
  const audience = caller === 'entrypoint' ? (modelToolVisible(tool) ? 'model' : 'app') : caller;
  if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024) throw new Error('App input exceeds its limit');
  const actionId = `${current.remote.entry.providerId ?? `mcp.${current.remote.entry.slug}`}.${name}`;
  const fingerprint = inputDigest([actionId, args, current.connection.id, audience]);
  const result = await mcpViews().call(view, invocationId, fingerprint, async () => {
    const connectedApp = {viewId: view.id, invocationId, sourceRef: view.capture.sourceRef, viewerId: view.viewerId};
    let original: unknown;
    // A file view's calls carry the file's path to a server on this computer (`files.ts`).
    const callMeta = view.capture.kind === 'file' ? await (await import('./files')).fileCallMeta(view, current.remote.entry) : undefined;
    const outcome = await (async () => {
      try {
        return await current.runtime.runAction(actionId, args, {ownerId: getIntegrationOwnerId(), connectionId: current.connection.id,
          allowedConnectionIds: [current.connection.id], toolAudience: audience, ...(callMeta ? {callMeta} : {}),
          caller: {...(view.capture.chatId ? sessionCaller(view.capture.chatId) : {type: 'app' as const, id: `mcp-view:${view.id}`}), connectedApp},
          captureOriginalResult: value => { original = value; }});
      } finally {
        // An approval can be registered after cancellation overtakes the call.
        // Already admitted effects may finish, but cannot create a retry grant.
        if (mcpViews().isCancelled(view, invocationId)) await clearInvocationApproval(view, invocationId);
      }
    })();
    mcpViews().assertInvocation(view, invocationId);
    await checkCapture(view.capture);
    if (!outcome.ok) {
      if (outcome.reason === 'approval_required') return {kind: 'approval' as const,
        ids: listPendingApprovals({ownerId: getIntegrationOwnerId()}).filter(p => p.connectedApp?.viewId === view.id && p.connectedApp.invocationId === invocationId).map(p => p.id), preview: outcome.preview};
      throw new Error(outcome.reason === 'error' ? outcome.message : `This operation needs attention: ${outcome.reason}`);
    }
    return {kind: 'result' as const, result: CallToolResultSchema.parse(original)};
  });
  await checkCapture(view.capture);
  mcpViews().get(view.id, view.viewerId);
  return result;
}
export async function callConnectedView(viewId: string, viewerId: string, name: string, args: Record<string, unknown>, invocationId: string) {
  const {view} = await checkedView(viewId, viewerId);
  return invoke(view, name, args, invocationId, 'app');
}

async function clearInvocationApproval(view: View, invocationId: string) {
  const resolved = cancelConnectedAppApprovals({viewId: view.id, invocationId, sourceRef: view.capture.sourceRef, viewerId: view.viewerId}, view.capture.chatId ?? null);
  if (resolved.length) await (await import('@/lib/integrations/approval-events')).recordApprovalDecision(resolved, 'deny');
}
export async function cancelConnectedInvocation(viewId: string, viewerId: string, invocationId: string) {
  // Cleanup needs ownership, not current provider access. Revocation must not
  // prevent a viewer from clearing an unanswered operation they initiated.
  const view = mcpViews().get(viewId, viewerId);
  mcpViews().cancel(view, invocationId);
  await clearInvocationApproval(view, invocationId);
}

export type LaunchKind = Exclude<CaptureKind, 'result'>;
export interface LaunchOptions {
  /** Which entrypoint: a global screen (the default), a tab beside `chatId`, a file's viewer, a settings button or a form option's preview. */
  kind?: LaunchKind;
  chatId?: string;
  /** OpenAI's deep link, an app-relative URL. Global screens only. */
  deepLink?: string;
  /** A preview's arguments, from the server's own preview target. */
  args?: Record<string, unknown>;
  /** The opened file's host handle, for a file entrypoint (`files.ts`). */
  file?: { handle: string };
  /** Start a new instance even when one is open. */
  fresh?: boolean;
}

/**
 * OpenAI's deep link value: an app-relative URL that starts with one `/`, has
 * no fragment and fits in 2 KiB. Anything else is refused rather than guessed.
 */
export function normalizeDeepLink(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || value.includes('#') || /[\u0000-\u001f\u007f\\]/.test(value))
    throw new Error('A deep link must be an app-relative path that starts with /, without a fragment.');
  return value;
}

/**
 * Whether a person may open `tool` as `kind`. A global screen, thread tab and
 * file viewer need the matching entrypoint. A settings button may open any
 * of the server's interfaces when the server publishes settings, and a form
 * option's preview any of its interfaces, since the server named the tool.
 */
function launchAllowed(kind: LaunchKind, tool: McpCapabilityTool, remote: {entry: {protocol?: {extensions?: unknown}}}) {
  const ui = viewMetadata(tool);
  if (!ui) return false;
  if (kind === 'global') return ui.global;
  if (kind === 'thread') return ui.thread;
  if (kind === 'file') return ui.file.length > 0;
  if (kind === 'settings') return !!settingsCapability(remote.entry.protocol?.extensions);
  return true;
}
const LAUNCH_REFUSAL: Record<LaunchKind, string> = {
  global: 'This app has no screen to open here. Try it in chat instead.',
  thread: 'This app has no tab to open beside a chat.',
  file: 'This app does not open files.',
  settings: 'This setting has no interface to open.',
  preview: 'This preview has no interface to open.',
};

/**
 * A person opening an app: an entrypoint, a settings button or a form
 * preview. It runs through the ordinary approval gate, never automatically.
 * An entrypoint gets `{}` as OpenAI's spec requires, a file viewer its
 * `FileInput`, and a preview the arguments its server named.
 *
 * One live instance per entrypoint (docs/connected-mcp-apps.md, "Instances"):
 * a thread tab per chat, and a global screen per person. Opening it again
 * returns to that instance without calling the tool, and a deep link moves it
 * through `host-context-changed`. `fresh` starts over. A model's tool call
 * never reuses one: its result shows in the chat on its own (the reading of
 * openai/mcp-extensions issue 54 Ri takes).
 */
export async function prepareConnectedLaunch(serverId: string, viewerId: string, name: string, options: LaunchOptions = {}) {
  const kind = options.kind ?? 'global';
  if (kind === 'thread' && !options.chatId) throw new Error('A tab opens beside a chat.');
  if (options.chatId && kind !== 'thread' && kind !== 'file' && kind !== 'preview') throw new Error('This app opens on its own, not in a chat.');
  const deepLink = normalizeDeepLink(options.deepLink);
  if (deepLink && kind !== 'global') throw new Error('Deep links open global screens only.');
  const current = await authority(serverId, options.chatId);
  const tool = current.transport.tools.find(t => t.name === name);
  if (!tool || current.remote.entry.toolOverrides?.[name]?.enabled === false || !launchAllowed(kind, tool, current.remote)) throw new Error(LAUNCH_REFUSAL[kind]);
  const ui = viewMetadata(tool)!;
  if (!options.fresh && (kind === 'global' || kind === 'thread')) {
    const open = [...mcpViews().captures.values()].findLast(c => c.kind === kind && c.serverId === serverId && c.tool === name && c.viewerId === viewerId
      && (c.chatId ?? null) === (options.chatId ?? null) && c.connectionId === current.connection.id && c.sourceRef === current.sourceRef);
    if (open) {
      if (deepLink) open.deepLink = deepLink;
      return {kind: 'open' as const, captureId: open.id, deepLink: open.deepLink};
    }
  }
  let input: Record<string, unknown> = {};
  let file: Capture['file'];
  if (kind === 'preview') {
    input = object(options.args);
    if (Buffer.byteLength(JSON.stringify(input)) > 64 * 1024) throw new Error('Preview input exceeds its limit');
  } else if (kind === 'file') {
    const opened = await (await import('./files')).fileLaunchInput({viewerId, serverId, chatId: options.chatId, extensions: ui.file, handle: options.file?.handle});
    input = opened.input; file = opened.file;
  }
  const invocationId = randomUUID();
  const capture: Capture = {id: invocationId, serverId, connectionId: current.connection.id, sourceRef: current.sourceRef, viewerId,
    ...(options.chatId ? {chatId: options.chatId} : {}), kind, ...(deepLink ? {deepLink} : {}), ...(file ? {file} : {}),
    tool: name, title: viewTitle(current.remote.entry.displayName, toolTitle(tool)), input, result: {content: []}, resourceUri: ui.resourceUri, legacy: ui.legacy, created: Date.now()};
  const view = mcpViews().open(capture, viewerId);
  return {kind: 'launch' as const, viewId: view.id, invocationId};
}
export async function launchConnectedView(viewId: string, viewerId: string) {
  const view = mcpViews().get(viewId, viewerId);
  if (view.capture.viewerId !== viewerId || (view.capture.kind ?? 'result') === 'result') throw new Error('This view is not a launch request');
  const result = await invoke(view, view.capture.tool, view.capture.input, view.capture.id, 'entrypoint');
  if (result.kind === 'approval') return {...result, viewId: view.id};
  view.capture.result = result.result;
  mcpViews().put(view.capture);
  return {kind: 'opened' as const, captureId: view.capture.id};
}

/** A deep link to a global screen that is already open: Ri sends it to the app as `host-context-changed`. */
export async function navigateConnectedScreen(viewId: string, viewerId: string, url: string) {
  const {view} = await checkedView(viewId, viewerId);
  if (view.capture.kind !== 'global') throw new Error('Deep links open global screens only.');
  view.capture.deepLink = normalizeDeepLink(url) ?? '/';
  return {deepLink: view.capture.deepLink};
}
export async function connectedViewStatus(viewId: string, viewerId: string) {
  const {view} = await checkedView(viewId, viewerId);
  return {revision: view.revision};
}
export async function decideConnectedApproval(viewId: string, viewerId: string, ids: string[], approve: boolean) {
  const {view} = await checkedView(viewId, viewerId);
  const allowed = listPendingApprovals({ownerId: getIntegrationOwnerId()}).filter(p => p.connectedApp?.viewId === viewId && p.connectedApp.viewerId === viewerId);
  if (!ids.length || ids.some(id => !allowed.some(p => p.id === id))) throw new Error('This approval expired or belongs to another app');
  if (approve) for (const pending of allowed) if (ids.includes(pending.id)) mcpViews().assertInvocation(view, pending.connectedApp!.invocationId);
  const decision = approve ? 'approve' : 'deny';
  const {resolved} = resolvePendingApprovals(ids, decision);
  await (await import('@/lib/integrations/approval-events')).recordApprovalDecision(resolved, decision);
}
/** One `ui/update-model-context` may carry this much, images included. */
export const MAX_CONTEXT = 768 * 1024;
const CONTEXT_BLOCKS = new Set(['text', 'image', 'resource_link', 'resource']);

/**
 * Keep the parts of a content block Ri shows or gives the model: its standard
 * fields, `annotations`, and OpenAI's `openai/title` and `openai/thumbnail`.
 * Other `_meta` is dropped, and audio is refused, as OpenAI's spec lists it
 * unsupported.
 */
function contextBlock(raw: unknown): Record<string, unknown> {
  const block = object(raw), type = block.type;
  if (typeof type !== 'string' || !CONTEXT_BLOCKS.has(type)) throw new Error(`App context cannot include ${typeof type === 'string' ? type : 'that'} content`);
  const meta = object(block._meta);
  const title = typeof meta['openai/title'] === 'string' && meta['openai/title'].trim() && meta['openai/title'].length <= 200 ? meta['openai/title'] : undefined;
  const thumbnail = type === 'text' ? safeMcpIcon(meta['openai/thumbnail']) : null;
  const keep = {...block};
  delete keep._meta;
  const kept = {...(title ? {'openai/title': title} : {}), ...(thumbnail ? {'openai/thumbnail': thumbnail} : {})};
  return {...keep, ...(Object.keys(kept).length ? {_meta: kept} : {})};
}

/**
 * A view's model context replaces whatever it attached before (OpenAI's spec:
 * the update is idempotent per app instance). The `updateId` changes only
 * when the content or structured content does.
 */
export async function updateConnectedContext(viewId: string, viewerId: string, context: unknown) {
  const {view} = await checkedView(viewId, viewerId);
  if (Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT) throw new Error('App context exceeds 768 KiB');
  const input = object(context);
  // Only standard model content is eligible for a later human send. Transport
  // metadata, private result metadata and arbitrary host-looking fields are not.
  const content = (Array.isArray(input.content) ? input.content : []).map(contextBlock);
  const parsed = CallToolResultSchema.parse({content, ...(input.structuredContent !== undefined ? {structuredContent: input.structuredContent} : {})});
  const second = Math.floor(Date.now() / 1000);
  if (view.contextSecond !== second) { view.contextSecond = second; view.contextCount = 0; }
  if (++view.contextCount > 10) throw new Error('This app is updating context too quickly');
  const next: ModelContext = {content: parsed.content as Record<string, unknown>[], ...(parsed.structuredContent != null ? {structuredContent: object(parsed.structuredContent)} : {})};
  const empty = !next.content.length && next.structuredContent === undefined;
  if (JSON.stringify(next) !== JSON.stringify(view.context ?? null)) view.contextUpdateId = empty ? undefined : randomUUID();
  view.context = empty ? undefined : next;
  return {revision: ++view.revision, updateId: view.contextUpdateId ?? null};
}

/**
 * The person removed an app's context from the composer. It is dropped as a
 * whole, as OpenAI's spec groups an app's context, and the view is told with
 * `openai/modelContext: null`.
 */
export async function clearConnectedContext(viewId: string, viewerId: string) {
  const {view} = await checkedView(viewId, viewerId);
  view.context = undefined;
  view.contextUpdateId = undefined;
  return {revision: ++view.revision};
}
/** A global screen's context left off a message because the chat it went to may not use that account. */
export interface SkippedConnectedContext { viewId: string; app: string; reason: string }

/**
 * The context a message carries, frozen as the person sends it. A chat's own
 * views must still be what the composer showed. A global screen's context goes
 * only to a chat that may use its account: in one that may not, it is left off
 * and named in `skipped`, so the person is told rather than the send refused.
 */
export async function freezeConnectedContext(chatId: string, viewerId: string, refs: {viewId: string; revision: number}[]) {
  if (refs.length > 8) throw new Error('Too many app views attached to this message');
  const skipped: SkippedConnectedContext[] = [];
  const frozen = await Promise.all(refs.map(async ref => {
    const {view} = await checkedView(ref.viewId, viewerId);
    // A global screen belongs to the person, so its context goes with whichever chat they send next.
    const global = view.capture.kind === 'global' && !view.capture.chatId;
    if (view.capture.chatId !== chatId && !global) throw new Error('App context changed. Try sending again.');
    if (view.revision !== ref.revision) throw new Error('App context changed. Try sending again.');
    // A chat's own view is checked for that chat already. A global screen's context goes only to a
    // chat that may use the account: an agent's chat sees only the accounts its agent may use.
    if (global) {
      const destination = await authority(view.capture.serverId, chatId, {stale: true}).catch(error => {
        if (error instanceof ChatAccessError) return null;
        throw error;
      });
      if (!destination) { skipped.push({viewId: view.id, app: view.capture.title, reason: 'This chat can\'t use that account.'}); return null; }
      if (destination.sourceRef !== view.capture.sourceRef || destination.connection.id !== view.capture.connectionId) throw new Error('App context changed. Try sending again.');
    }
    // Images and blobs become attachments the message names, so raw keeps no bytes.
    const {context, files} = await (await import('./context-files')).materializeContextFiles(view);
    return {sourceRef: view.capture.sourceRef, title: view.capture.title, serverId: view.capture.serverId, context,
      ...(files.length ? {files} : {})};
  }));
  return {context: frozen.filter(item => item !== null), skipped};
}

/**
 * Which of the person's views may send context with a message in this chat:
 * the chat's own, and global screens on an account this chat may use. The
 * composer shows (and sends) only these, so a global screen's context never
 * appears in a chat it couldn't go to. A view that is gone, or another
 * person's, is simply not allowed.
 */
export async function connectedContextAccess(chatId: string, viewerId: string, viewIds: string[]) {
  const access: Record<string, boolean> = {};
  await Promise.all(viewIds.map(async viewId => {
    access[viewId] = await (async () => {
      const {view} = await checkedView(viewId, viewerId);
      if (view.capture.chatId) return view.capture.chatId === chatId;
      if (view.capture.kind !== 'global') return false;
      const destination = await authority(view.capture.serverId, chatId, {stale: true});
      return destination.sourceRef === view.capture.sourceRef && destination.connection.id === view.capture.connectionId;
    })().catch(() => false);
  }));
  return access;
}

/**
 * Recheck persisted context on every dispatch, including orphan and retry
 * recovery and a device taking a queued send: the chat may still use the
 * account the context came from.
 */
export async function connectedTurnContext(chatId: string, value: unknown) {
  if (!Array.isArray(value) || value.length > 8 || Buffer.byteLength(JSON.stringify(value)) > 8 * MAX_CONTEXT + 64 * 1024) throw new Error('Invalid connected app context');
  return Promise.all(value.map(async item => {
    const frozen = object(item);
    if (typeof frozen.serverId !== 'string') throw new Error('Invalid app context source');
    const current = await authority(frozen.serverId, chatId, {stale: true});
    if (current.sourceRef !== frozen.sourceRef) throw new Error('This app context is no longer available to the chat');
    return {sourceRef: current.sourceRef, app: current.remote.entry.displayName, context: modelInput(frozen.context)};
  }));
}

/** OpenAI's spec keeps content block `_meta` (titles, thumbnails) out of model input. */
function modelInput(context: unknown) {
  const value = object(context);
  if (!Array.isArray(value.content)) return context ?? null;
  return {...value, content: value.content.map(block => Object.fromEntries(Object.entries(object(block)).filter(([key]) => key !== '_meta')))};
}

/** The network domains a server's interfaces declared, per interface, for its capability revision. Only domains are kept, never the HTML. */
const networks = () => processState('mcp-app-networks', () => new Map<string, {revision?: string; screens: Map<string, DeclaredNetwork>}>());
/** Reads of a server's interfaces under way for its connection page, so two pages read them once. */
const networkReads = () => processState('mcp-app-network-reads', () => new Map<string, Promise<void>>());
function noteNetwork(serverId: string, revision: string | undefined, uri: string, csp: DeclaredNetwork) {
  const known = networks().get(serverId);
  const current = known && known.revision === revision ? known : {revision, screens: new Map<string, DeclaredNetwork>()};
  current.screens.set(uri, csp);
  networks().set(serverId, current);
}

/**
 * What a server's screens may reach on the network, for its connection page:
 * every domain its interfaces declared, joined. Ri reads each interface once
 * per capability revision (a view opening reads it too) and keeps only the
 * domains. Null when the server has no interface. `read` says how many of
 * its `screens` Ri could read: one it couldn't is read again next time.
 */
export async function connectedAppNetwork(serverId: string) {
  if (!mcpAppsEnabled()) return null;
  const metadata = await integrationSourceMetadata();
  const remote = metadata.servers.find(s => s.entry.id === serverId);
  if (!remote) throw new Error('This app was removed from Ri.');
  const uris = [...new Set((remote.capabilities?.tools ?? []).flatMap(tool => { const ui = viewMetadata(tool); return ui ? [ui.resourceUri] : []; }))];
  if (!uris.length) return null;
  const revision = networkKey(remote.entry);
  const serverIsLocal = (await import('./files')).serverRunsHere(remote.entry);
  const known = () => { const entry = networks().get(serverId); return entry && entry.revision === revision ? entry.screens : new Map<string, DeclaredNetwork>(); };
  if (uris.some(uri => !known().has(uri)) && remote.entry.enabled) {
    const key = `${serverId}\n${revision}`;
    let reading = networkReads().get(key);
    if (!reading) {
      reading = (async () => {
        const current = await authority(serverId);
        for (const uri of uris.filter(item => !known().has(item))) {
          const read = await current.transport.readResource({uri}).catch(() => null);
          const item = (read as {contents?: {_meta?: unknown}[]} | null)?.contents?.[0];
          if (item) noteNetwork(serverId, revision, uri, declaredCsp(item._meta, {serverIsLocal}));
        }
      })().catch(() => { /* Not reachable now: the page lists what Ri already knows. */ }).finally(() => networkReads().delete(key));
      networkReads().set(key, reading);
    }
    await reading;
  }
  const screens = uris.flatMap(uri => { const csp = known().get(uri); return csp ? [csp] : []; });
  const joined = (key: keyof ViewCsp | 'blocked') => [...new Set(screens.flatMap(csp => csp[key]))].sort();
  // `blocked`: what they declared on the person's own computer or local network, which a remote app can't reach.
  return {screens: uris.length, read: screens.length, connectDomains: joined('connectDomains'), resourceDomains: joined('resourceDomains'),
    frameDomains: joined('frameDomains'), baseUriDomains: joined('baseUriDomains'), blocked: joined('blocked')};
}
