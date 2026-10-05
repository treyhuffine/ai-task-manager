import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { mcpToolVisible, type McpToolDef } from '@connectors/engine/mcp';
import { ACCOUNT_DEMOS, type AccountDemo } from '@/lib/plugins/demo-catalog';
import { getConnectorOwnerId, getConnectorRuntime, getMcpServerStore, getMcpViewConnection, type McpViewConnection } from '@/lib/connectors/runtime';
import { hostedMcpConnectionId } from '@/lib/connectors/hosted-mcp';
import { isCurrentMcpTransport } from '@/lib/connectors/mcp-lifecycle';
import { listPendingApprovals } from '@/lib/connectors/approval';
import { OperationError } from '@/lib/server/operation';
import { launchPluginEvaluation } from './evaluation';
import { accountRpcSchema } from '@/lib/plugins/evaluation-contract';
export { accountRpcSchema } from '@/lib/plugins/evaluation-contract';

type Rpc = z.infer<typeof accountRpcSchema>;
type ToolResult = { content: unknown[]; structuredContent?: unknown; _meta?: Record<string, unknown>; isError?: boolean };
type Reply = { result: unknown; approvalIds?: string[] };
type Delivery = { fingerprint: string; status: 'pending' | 'captured' | 'approval' | 'unknown'; promise: Promise<Reply> };
interface Session { viewer: string; owner: string; expires: number; view: McpViewConnection; deliveries: Map<string, Delivery>; bytes: number }
const globals = globalThis as typeof globalThis & { __riAccountEvaluations?: Map<string, Session> };
const sessions = globals.__riAccountEvaluations ??= new Map();
function fail(message: string, status = 403): never { throw new OperationError(status, { error: 'account_view_unavailable', message }); }
function prune() { for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id); }
const bounded = (value: unknown, size: number) => Buffer.byteLength(JSON.stringify(value)) <= size;
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function accountEvaluationCatalog() {
  const servers = getMcpServerStore().list().filter(server => ACCOUNT_DEMOS.includes(server.providerId as AccountDemo));
  return Promise.all(servers.map(async server => {
    const view = server.enabled && server.lastStatus === 'ok' ? await getMcpViewConnection(server.id) : null;
    const tools = view?.tools.filter(tool => uiUri(tool) && mcpToolVisible(tool, 'model') && server.toolOverrides?.[tool.name]?.enabled !== false) ?? [];
    return { providerId: server.providerId!, serverId: server.id, label: server.displayName,
      available: !!view, interactiveTools: tools.length, status: !view ? 'Reconnect' : tools.length ? 'Interactive views discovered' : 'Tools available, no interactive view discovered' };
  }));
}

export async function launchAccountEvaluation(parentOrigin: string, serverId: string, viewer: string) {
  const view = await getMcpViewConnection(serverId);
  if (!view || !ACCOUNT_DEMOS.includes(view.snapshot.providerId as AccountDemo)) fail('Connect this account in Plugins, then try again.');
  prune();
  if (sessions.size >= 32) fail('Too many temporary views are open. Close one and try again.', 429);
  const launched = await launchPluginEvaluation(parentOrigin);
  const handle = randomUUID();
  sessions.set(handle, { viewer, owner: getConnectorOwnerId(), expires: Date.parse(launched.expiresAt), view, deliveries: new Map(), bytes: 0 });
  return { ...launched, url: `${launched.url}?account=${handle}`, handle, account: view.snapshot.displayName, providerId: view.snapshot.providerId! };
}

export async function assertAccountEvaluation(handle: string, viewer: string) {
  prune();
  const session = sessions.get(handle);
  if (!session || session.viewer !== viewer || session.owner !== getConnectorOwnerId()) fail('This temporary account view ended. Open a new view explicitly.', 410);
  if (!isCurrentMcpTransport(session.view.snapshot, getMcpServerStore())) fail('This account or its access changed. Reconnect before opening a new view.');
  const connections = await (await getConnectorRuntime()).listConnections({ ownerId: session.owner });
  if (!connections.some(value => value.id === hostedMcpConnectionId(session.view.snapshot) && value.status === 'active')) fail('This account is no longer connected.');
  return session;
}
export function endAccountEvaluation(handle: string, viewer: string) {
  const session = sessions.get(handle);
  if (session?.viewer === viewer) sessions.delete(handle);
}
function uiUri(tool: McpToolDef) { const uri = tool._meta?.ui?.resourceUri ?? tool._meta?.['ui/resourceUri']; return typeof uri === 'string' && uri.length <= 1000 ? uri : null; }
function enabledTools(session: Session) { return session.view.tools.filter(tool => session.view.snapshot.toolOverrides?.[tool.name]?.enabled !== false); }
function checkedResource(result: Awaited<ReturnType<McpViewConnection['readResource']>>, uri: string) {
  const resource = result.contents?.[0];
  if (result.contents?.length !== 1 || resource?.uri !== uri || resource.mimeType !== 'text/html;profile=mcp-app' || !bounded(result, 20 * 1024 * 1024)) fail('This service returned an unsupported UI resource. Its text result is still available.');
  const ui = resource._meta?.ui as { csp?: Record<string, string[]>; permissions?: Record<string, unknown> } | undefined;
  const domains = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
  if (ui?.permissions && Object.keys(ui.permissions).some(key => key !== 'clipboardWrite')) fail('This view requires a permission that the demo does not support.');
  if (ui?.csp && Object.entries(ui.csp).some(([key, values]) => !['resourceDomains', 'connectDomains', 'frameDomains', 'baseUriDomains'].includes(key)
    || !Array.isArray(values) || values.length > 8 || values.some(value => key !== 'resourceDomains' || !domains.includes(value)))) fail('This view requires a network policy that has not been qualified. Its text result is still available.');
  return result;
}

export async function accountEvaluationRpc(value: Rpc, viewer: string): Promise<Reply> {
  const input = accountRpcSchema.parse(value);
  if (!bounded(input, 64 * 1024)) fail('The view request is too large.', 413);
  const session = await assertAccountEvaluation(input.handle, viewer);
  const tools = enabledTools(session);
  if (input.method === 'initialize') return { result: { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {} }, serverInfo: { name: `${session.view.snapshot.providerId} · ${session.view.snapshot.displayName}`, version: 'evaluation' } } };
  if (input.method === 'tools/list') return { result: { tools } };
  if (input.method === 'resources/list') return { result: { resources: [...new Set(tools.flatMap(tool => uiUri(tool) ? [uiUri(tool)!] : []))].map(uri => ({ uri, name: uri, mimeType: 'text/html;profile=mcp-app' })) } };
  if (input.method === 'resources/read') {
    if (!input.uri || !tools.some(tool => uiUri(tool) === input.uri)) fail('This UI resource does not belong to the selected account.');
    const result = checkedResource(await session.view.readResource({ uri: input.uri }), input.uri);
    await assertAccountEvaluation(input.handle, viewer);
    return { result };
  }
  if (!input.invocationId || !input.name) fail('The tool call has no stable invocation reference.');
  const tool = tools.find(value => value.name === input.name);
  if (!tool || !mcpToolVisible(tool, input.audience)) fail('This tool is not available to the view.');
  const key = input.invocationId;
  const digest = fingerprint({ name: input.name, arguments: input.arguments ?? {}, audience: input.audience });
  const prior = session.deliveries.get(key);
  if (prior) {
    if (prior.fingerprint !== digest) fail('This invocation was already used with different input.', 409);
    if (!(input.retryApproval && prior.status === 'approval')) return currentReply(prior);
  }
  if (!prior && session.deliveries.size >= 80) fail('The temporary view call limit was reached.', 429);
  const delivery = { fingerprint: digest, status: 'pending' as Delivery['status'], promise: null as unknown as Promise<Reply> };
  session.deliveries.set(key, delivery);
  delivery.promise = (async () => {
    let captured: unknown;
    const outcome = await (await getConnectorRuntime()).runAction(`${session.view.snapshot.providerId}.${input.name}`, input.arguments ?? {}, {
      ownerId: session.owner, connectionId: hostedMcpConnectionId(session.view.snapshot), caller: { type: 'app' },
      toolAudience: input.audience, captureOriginalResult: result => { captured = result; },
    });
    if (!outcome.ok) {
      delivery.status = outcome.reason === 'approval_required' ? 'approval' : 'captured';
      const approvalIds = outcome.reason === 'approval_required' ? listPendingApprovals({ ownerId: session.owner })
        .filter(pending => pending.sessionId === null && pending.actionId === outcome.actionId && pending.connectionId === hostedMcpConnectionId(session.view.snapshot) && fingerprint(pending.preview) === fingerprint(outcome.preview)).map(value => value.id) : undefined;
      return { result: { isError: true, content: [{ type: 'text', text: outcome.reason === 'error' ? outcome.message : `This call needs ${outcome.reason.replaceAll('_', ' ')}. No upstream tool was replayed.` }] }, ...(approvalIds?.length ? { approvalIds } : {}) };
    }
    if (!captured || !bounded(captured, 512 * 1024) || session.bytes + Buffer.byteLength(JSON.stringify(captured)) > 8 * 1024 * 1024) {
      delivery.status = 'unknown';
      fail('The tool completed but its UI result could not be captured. It will not be repeated.', 409);
    }
    session.bytes += Buffer.byteLength(JSON.stringify(captured));
    delivery.status = 'captured';
    return { result: captured as ToolResult };
  })().catch(error => { if (delivery.status === 'pending') delivery.status = 'unknown'; throw error; });
  return currentReply(delivery);
  async function currentReply(value: Delivery) {
    const reply = await value.promise;
    await assertAccountEvaluation(input.handle, viewer);
    return reply;
  }
}
