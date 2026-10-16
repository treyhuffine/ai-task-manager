import { randomUUID } from 'node:crypto';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { inputDigest, type IntegrationRuntimeOptions } from '@integrations/engine';
import { processState } from '@/lib/process-state';
import { integrationSourceMetadata } from '@/lib/integrations/source-metadata';
import { getIntegrationRuntime, getIntegrationOwnerId, getMcpViewConnection } from '@/lib/integrations/runtime';
import { hostedMcpConnectionId } from '@/lib/integrations/hosted-mcp';
import { getChatSessionWithExecution, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import { normalizeIntegrationScopes, pinMatchesConnection, scopePins } from '@/lib/integrations/scope-pins';
import { sessionCaller, sessionIdFromCaller, listPendingApprovals, resolvePendingApprovals, cancelConnectedAppApprovals } from '@/lib/integrations/approval';
import { isImportMirror } from '@/lib/import/mirror';
import { encodeSource } from '@/lib/chat-sources/reference';
import { appToolVisible, modelToolVisible, viewMetadata, MCP_APP_EVENT } from './metadata';
import { McpViewStore, MAX_RESULT, VIEW_TTL, type Capture, type View } from './store';
import { prepareResource } from './resource';

export const mcpAppsEnabled = () => process.env.RI_MCP_APPS !== '0';
export const mcpViews = () => processState('mcp-app-views', () => new McpViewStore(Date.now, view => {
  const ids = listPendingApprovals({ownerId: getIntegrationOwnerId()}).filter(p => p.connectedApp?.viewId === view.id).map(p => p.id);
  if (ids.length) resolvePendingApprovals(ids, 'deny');
}));
const assertEnabled = () => { if (!mcpAppsEnabled()) throw new Error('Connected app views are disabled for this Home'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Cached catalog only. Discovery never calls a tool or initializes a server. */
export async function connectedAppsCatalog(viewerId?: string) {
  if (!mcpAppsEnabled()) return [];
  const metadata = await integrationSourceMetadata();
  mcpViews().prune();
  return metadata.servers.flatMap(({entry, capabilities}) => {
    const tools = capabilities?.tools.filter(t => viewMetadata(t) && modelToolVisible(t) && entry.toolOverrides?.[t.name]?.enabled !== false) ?? [];
    if (!tools.length) return [];
    const connection = metadata.connections.find(c => c.id === hostedMcpConnectionId(entry));
    const toolkitId = entry.providerId ?? `mcp_${entry.slug}`;
    // `name` is this server's own label, often its account ("Todoist 2"). The toolkit's name is the product, shared by every account.
    const toolkitName = metadata.toolkits.find(t => t.id === toolkitId)?.displayName ?? entry.displayName;
    return [{id: entry.id, name: entry.displayName, toolkitName, providerId: entry.providerId, connectionId: connection?.id,
      account: connection?.label || connection?.email || connection?.accountId || entry.displayName,
      available: !!connection && connection.status === 'active' && entry.enabled,
      sourceRef: connection ? encodeSource({v: 1, kind: 'integration', toolkitId, account: {accountId: connection.accountId, authConfigId: connection.authConfigId ?? null}}) : null,
      tools: tools.map(t => ({name: t.name, title: t.title ?? t.name, description: t.description ?? '', inputSchema: t.inputSchema, global: viewMetadata(t)!.global})),
      recent: [...mcpViews().captures.values()].filter(c => c.serverId === entry.id && (!c.viewerId || c.viewerId === viewerId)).map(c => ({id: c.id, chatId: c.chatId, title: c.title, created: c.created}))}];
  });
}

async function authority(serverId: string, chatId?: string) {
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
    chatId, tool: toolName, title: `${remote.entry.displayName} · ${tool.title ?? tool.name}`, input: structuredClone(object(event.input)), resourceUri: ui.resourceUri, legacy: ui.legacy};
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
    resource: view.resource ?? null, unsupported, input: capture.input, result: capture.result, revision: view.revision, widgetState, legacy: capture.legacy};
}

async function invoke(view: View, name: string, args: Record<string, unknown>, invocationId: string, audience: 'model' | 'app') {
  const current = await checkCapture(view.capture);
  const tool = current.transport.tools.find(t => t.name === name);
  if (!tool || current.remote.entry.toolOverrides?.[name]?.enabled === false || !(audience === 'app' ? appToolVisible(tool) : modelToolVisible(tool))) throw new Error('This tool is not available to this app');
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

/** Explicit human launch, with schema validation and the ordinary approval gate. Never automatic. */
export async function prepareConnectedLaunch(serverId: string, viewerId: string, name: string, args: Record<string, unknown>) {
  const current = await authority(serverId);
  const tool = current.transport.tools.find(t => t.name === name), ui = tool && viewMetadata(tool);
  if (!tool || !ui || !modelToolVisible(tool) || current.remote.entry.toolOverrides?.[name]?.enabled === false) throw new Error('This UI workflow is unavailable');
  if (Buffer.byteLength(JSON.stringify(args)) > 64 * 1024) throw new Error('App input exceeds its limit');
  const invocationId = randomUUID();
  const capture: Capture = {id: invocationId, serverId, connectionId: current.connection.id, sourceRef: current.sourceRef, authority: current.revision, viewerId,
    tool: name, title: `${current.remote.entry.displayName} · ${tool.title ?? name}`, input: args, result: {content: []}, resourceUri: ui.resourceUri, legacy: ui.legacy, created: Date.now()};
  const view = mcpViews().open(capture, viewerId);
  return {viewId: view.id, invocationId};
}
export async function launchConnectedView(viewId: string, viewerId: string) {
  const view = mcpViews().get(viewId, viewerId);
  if (view.capture.viewerId !== viewerId || view.capture.chatId) throw new Error('This view is not a launch request');
  const result = await invoke(view, view.capture.tool, view.capture.input, view.capture.id, 'model');
  if (result.kind === 'approval') return {...result, viewId: view.id};
  view.capture.result = result.result;
  mcpViews().put(view.capture);
  return {kind: 'opened' as const, captureId: view.capture.id};
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
export async function updateConnectedContext(viewId: string, viewerId: string, context: unknown) {
  const {view} = await checkedView(viewId, viewerId);
  if (Buffer.byteLength(JSON.stringify(context)) > 8192) throw new Error('App context exceeds 8 KiB');
  const input = object(context);
  // Only standard model content is eligible for a later human send. Transport
  // metadata, private result metadata and arbitrary host-looking fields are not.
  const parsed = CallToolResultSchema.parse({content: input.content ?? [], ...(input.structuredContent !== undefined ? {structuredContent: input.structuredContent} : {})});
  const second = Math.floor(Date.now() / 1000);
  if (view.contextSecond !== second) { view.contextSecond = second; view.contextCount = 0; }
  if (++view.contextCount > 10) throw new Error('This app is updating context too quickly');
  view.context = {content: parsed.content, ...(parsed.structuredContent !== undefined ? {structuredContent: parsed.structuredContent} : {})};
  return ++view.revision;
}
export async function freezeConnectedContext(chatId: string, viewerId: string, refs: {viewId: string; revision: number}[]) {
  if (refs.length > 8) throw new Error('Too many app views attached to this message');
  return Promise.all(refs.map(async ref => {
    const {view} = await checkedView(ref.viewId, viewerId);
    if (view.capture.chatId !== chatId || view.revision !== ref.revision) throw new Error('App context changed. Try sending again.');
    return {sourceRef: view.capture.sourceRef, title: view.capture.title, serverId: view.capture.serverId, authority: view.capture.authority, context: view.context ?? null};
  }));
}

/** Recheck persisted context on every dispatch, including orphan/retry recovery. */
export async function connectedTurnContext(chatId: string, value: unknown) {
  if (!Array.isArray(value) || value.length > 8 || Buffer.byteLength(JSON.stringify(value)) > 72 * 1024) throw new Error('Invalid connected app context');
  return Promise.all(value.map(async item => {
    const frozen = object(item);
    if (typeof frozen.serverId !== 'string') throw new Error('Invalid app context source');
    const current = await authority(frozen.serverId, chatId);
    if (current.revision !== frozen.authority || current.sourceRef !== frozen.sourceRef) throw new Error('This app context is no longer available to the chat');
    return {sourceRef: current.sourceRef, app: current.remote.entry.displayName, context: frozen.context};
  }));
}
