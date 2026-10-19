import { randomUUID } from 'node:crypto';
import { CallToolResultSchema } from '@modelcontextprotocol/core';
import { inputDigest, type IntegrationRuntimeOptions } from '@integrations/engine';
import { processState } from '@/lib/process-state';
import { integrationSourceMetadata } from '@/lib/integrations/source-metadata';
import type { McpCapabilityTool } from '@/lib/integrations/mcp-capabilities';
import { getIntegrationRuntime, getIntegrationOwnerId, getMcpViewConnection } from '@/lib/integrations/runtime';
import { hostedMcpConnectionId } from '@/lib/integrations/hosted-mcp';
import { getChatSessionWithExecution, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import { normalizeIntegrationScopes, pinMatchesConnection, scopePins } from '@/lib/integrations/scope-pins';
import { sessionCaller, sessionIdFromCaller, listPendingApprovals, resolvePendingApprovals, cancelConnectedAppApprovals } from '@/lib/integrations/approval';
import { isImportMirror } from '@/lib/import/mirror';
import { encodeSource } from '@/lib/chat-sources/reference';
import { safeMcpIcon } from '@/lib/integrations/mcp-icons';
import { appToolVisible, entrypointIcons, mentionsSearchTool, modelToolVisible, settingsCapability, toolTitle, viewMetadata, MCP_APP_EVENT } from './metadata';
import { McpViewStore, MAX_CALLS, MAX_DELIVERED, MAX_DELIVERED_RESULT, MAX_RESULT, VIEW_TTL, type Capture, type CaptureKind, type ModelContext, type View } from './store';
import { prepareResource } from './resource';

export const mcpAppsEnabled = () => process.env.RI_MCP_APPS !== '0';
export const mcpViews = () => processState('mcp-app-views', () => new McpViewStore(Date.now, view => {
  const ids = listPendingApprovals({ownerId: getIntegrationOwnerId()}).filter(p => p.connectedApp?.viewId === view.id).map(p => p.id);
  if (ids.length) resolvePendingApprovals(ids, 'deny');
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
  mcpViews().prune();
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

/** Current access to a server on its exact account, and for `chatId` when given: the one check every app operation repeats. */
export async function authority(serverId: string, chatId?: string) {
  assertEnabled();
  const metadata = await integrationSourceMetadata();
  const remote = metadata.servers.find(s => s.entry.id === serverId);
  if (!remote?.entry.enabled) throw new Error('This connection is disabled or removed');
  const runtime = await getIntegrationRuntime();
  const connection = (await runtime.listConnections({ownerId: getIntegrationOwnerId()})).find(c => c.id === hostedMcpConnectionId(remote.entry));
  if (!connection || connection.status !== 'active') throw new Error('Reconnect this exact account before opening its app');
  const toolkitId = remote.entry.providerId ?? `mcp_${remote.entry.slug}`;
  let scopes: ReturnType<typeof normalizeIntegrationScopes> | null = null;
  if (chatId) {
    const chat = getChatSessionWithExecution(chatId);
    if (!chat || chat.status === 'archived' || isImportMirror(chat) || ['result_review', 'app-builder', 'app-try'].includes(chat.surfaceKind ?? '')) throw new Error('This chat cannot use connected apps');
    if (chat.workspaceId) {
      scopes = normalizeIntegrationScopes(getWorkspace(chat.workspaceId)?.integrationScopes);
      const scope = scopes.find(s => s.toolkitId === toolkitId);
      if (!scope || (scopePins(scope).length && !scopePins(scope).some(pin => pinMatchesConnection(pin, connection)))) throw new Error('This exact account is not available to this chat');
    }
  }
  const sourceRef = encodeSource({v: 1, kind: 'integration', toolkitId, account: {accountId: connection.accountId, authConfigId: connection.authConfigId ?? null}});
  const revision = inputDigest([sourceRef, connection.id, connection.scopes.slice().sort(), remote.entry.url, remote.entry.credentialRevision, remote.entry.capabilityRevision, remote.entry.toolOverrides, remote.entry.enabled, scopes]);
  const transport = await getMcpViewConnection(serverId);
  if (!transport) throw new Error('This account is reconnecting or its capabilities changed');
  return {remote, runtime, connection, sourceRef, revision, transport};
}

async function checkCapture(capture: Capture) {
  if (capture.created + VIEW_TTL <= Date.now()) throw new Error('This app view has expired. Request a new result.');
  const current = await authority(capture.serverId, capture.chatId);
  if (current.revision !== capture.authority || current.connection.id !== capture.connectionId || current.sourceRef !== capture.sourceRef) throw new Error('This app’s account or access changed. Request a new result.');
  return current;
}
async function checkedView(viewId: string, viewerId: string) {
  const view = mcpViews().get(viewId, viewerId);
  const current = await checkCapture(view.capture);
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
  const current = await authority(remote.entry.id, chatId);
  const binding = {serverId: remote.entry.id, connectionId: event.connectionId, sourceRef: current.sourceRef, authority: current.revision,
    chatId, tool: toolName, title: viewTitle(remote.entry.displayName, toolTitle(tool)), input: structuredClone(object(event.input)), resourceUri: ui.resourceUri, legacy: ui.legacy, kind: 'result' as const};
  return async (result: unknown) => {
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT) return;
    const capture: Capture = {...binding, id: randomUUID(), result: CallToolResultSchema.parse(result), created: Date.now()};
    await checkCapture(capture);
    if (!mcpViews().put(capture)) return;
    insertChatEvent({id: capture.id, sessionId: chatId, source: 'system', role: 'system', content: MCP_APP_EVENT,
      externalEventId: `mcp-view:${event.attemptId}`, raw: {subtype: MCP_APP_EVENT}, createdAt: new Date().toISOString()});
  };
}

export async function openConnectedView(captureId: string, viewerId: string, chatId?: string) {
  const capture = mcpViews().capture(captureId);
  if (capture.chatId !== chatId || (capture.viewerId && capture.viewerId !== viewerId)) throw new Error('This result belongs to a different viewer or chat');
  const current = await checkCapture(capture);
  const view = mcpViews().open(capture, viewerId);
  let unsupported: string | undefined;
  if (!view.resource) {
    view.resourcePromise ??= (async () => {
      const tool = current.transport.tools.find(t => t.name === capture.tool);
      if (!tool || viewMetadata(tool)?.resourceUri !== capture.resourceUri) throw new Error('This app’s declared resource changed');
      const raw = await current.transport.readResource({uri: capture.resourceUri});
      await checkCapture(capture);
      return prepareResource(raw, capture.resourceUri, capture.legacy);
    })();
    try { view.resource = await view.resourcePromise; }
    catch (error) { unsupported = error instanceof Error ? error.message : 'The app interface could not load'; }
    finally { view.resourcePromise = undefined; }
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
    resource: view.resource ?? null, unsupported, input: capture.input, result: capture.result, revision: view.revision, widgetState, legacy: capture.legacy,
    kind: capture.kind ?? 'result', created: capture.created, deepLink: capture.deepLink ?? null, file: capture.file ? {name: capture.file.name} : null,
    // OpenAI's model context host state: what this view last attached, or null, given again on every remount.
    modelContext: view.context && view.contextUpdateId ? {updateId: view.contextUpdateId, ...view.context} : null,
    tool: capture.tool, app: current.remote.entry.displayName, icons: current.remote.entry.protocol?.info?.icons ?? []};
}

/**
 * `resources/read` from a view. The file a file entrypoint opened is read by
 * Ri itself (`files.ts`). Any other URI goes to the view's own server, on its
 * exact account, rechecked like a tool call. A view never reads another
 * server's resources. Bits & Bolts reads its STEP importer this way.
 */
export async function readConnectedResource(viewId: string, viewerId: string, params: {uri: string; _meta?: Record<string, unknown>}) {
  const {view, transport} = await checkedView(viewId, viewerId);
  if (typeof params.uri !== 'string' || params.uri.length > 4096 || !/^[a-z][a-z0-9+.-]*:/i.test(params.uri)) throw new Error('Invalid resource URI');
  const files = await import('./files');
  if (files.isHostResource(params.uri)) return files.readHostResource(view, params.uri, params._meta);
  if ((view.reads = (view.reads ?? 0) + 1) > MAX_CALLS) throw new Error('This app view reached its operation limit. Open it again to continue.');
  const result = await transport.readResource({uri: params.uri, ...(params._meta ? {_meta: params._meta} : {})});
  await checkCapture(view.capture);
  const size = Buffer.byteLength(JSON.stringify(result));
  if (size > MAX_DELIVERED_RESULT || size + view.delivered > MAX_DELIVERED) throw new Error('This resource is too large for the app view.');
  view.delivered += size;
  return result;
}

/** `entrypoint` is a person opening a standalone screen, which the spec lets past `ui.visibility`. */
async function invoke(view: View, name: string, args: Record<string, unknown>, invocationId: string, caller: 'model' | 'app' | 'entrypoint') {
  const current = await checkCapture(view.capture);
  const tool = current.transport.tools.find(t => t.name === name);
  const allowed = !!tool && (caller === 'entrypoint'
    ? name === view.capture.tool && (view.capture.kind ?? 'result') !== 'result' && launchAllowed(view.capture.kind as LaunchKind, tool, current.remote)
    : caller === 'app' ? appToolVisible(tool) : modelToolVisible(tool));
  if (!tool || current.remote.entry.toolOverrides?.[name]?.enabled === false || !allowed) throw new Error('This tool is not available to this app');
  // The engine still checks visibility, so an entrypoint runs as whichever audience its tool admits.
  const audience = caller === 'entrypoint' ? (modelToolVisible(tool) ? 'model' : 'app') : caller;
  if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024) throw new Error('App input exceeds its limit');
  const actionId = `${current.remote.entry.providerId ?? `mcp.${current.remote.entry.slug}`}.${name}`;
  const fingerprint = inputDigest([actionId, args, current.revision, audience]);
  const result = await mcpViews().call(view, invocationId, fingerprint, async () => {
    const connectedApp = {viewId: view.id, invocationId, sourceRef: view.capture.sourceRef, viewerId: view.viewerId};
    let original: unknown;
    const outcome = await (async () => {
      try {
        return await current.runtime.runAction(actionId, args, {ownerId: getIntegrationOwnerId(), connectionId: current.connection.id,
          allowedConnectionIds: [current.connection.id], toolAudience: audience,
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
    const now = Date.now();
    const open = [...mcpViews().captures.values()].findLast(c => c.kind === kind && c.serverId === serverId && c.tool === name && c.viewerId === viewerId
      && (c.chatId ?? null) === (options.chatId ?? null) && c.connectionId === current.connection.id && c.authority === current.revision && c.created + VIEW_TTL > now);
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
  const capture: Capture = {id: invocationId, serverId, connectionId: current.connection.id, sourceRef: current.sourceRef, authority: current.revision, viewerId,
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
  return {revision: view.revision, expiresAt: view.created + VIEW_TTL};
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
export async function freezeConnectedContext(chatId: string, viewerId: string, refs: {viewId: string; revision: number}[]) {
  if (refs.length > 8) throw new Error('Too many app views attached to this message');
  return Promise.all(refs.map(async ref => {
    const {view} = await checkedView(ref.viewId, viewerId);
    // A global screen belongs to the person, so its context goes with whichever chat they send next.
    if (view.capture.chatId !== chatId && !(view.capture.kind === 'global' && !view.capture.chatId)) throw new Error('App context changed. Try sending again.');
    if (view.revision !== ref.revision) throw new Error('App context changed. Try sending again.');
    return {sourceRef: view.capture.sourceRef, title: view.capture.title, serverId: view.capture.serverId, authority: view.capture.authority, context: view.context ?? null};
  }));
}

/** Recheck persisted context on every dispatch, including orphan/retry recovery. */
export async function connectedTurnContext(chatId: string, value: unknown) {
  if (!Array.isArray(value) || value.length > 8 || Buffer.byteLength(JSON.stringify(value)) > 8 * MAX_CONTEXT + 64 * 1024) throw new Error('Invalid connected app context');
  return Promise.all(value.map(async item => {
    const frozen = object(item);
    if (typeof frozen.serverId !== 'string') throw new Error('Invalid app context source');
    const current = await authority(frozen.serverId, chatId);
    if (current.revision !== frozen.authority || current.sourceRef !== frozen.sourceRef) throw new Error('This app context is no longer available to the chat');
    return {sourceRef: current.sourceRef, app: current.remote.entry.displayName, context: modelInput(frozen.context)};
  }));
}

/** OpenAI's spec keeps content block `_meta` (titles, thumbnails) out of model input. */
function modelInput(context: unknown) {
  const value = object(context);
  if (!Array.isArray(value.content)) return context ?? null;
  return {...value, content: value.content.map(block => Object.fromEntries(Object.entries(object(block)).filter(([key]) => key !== '_meta')))};
}
