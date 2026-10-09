import { zodToJsonSchema } from 'zod-to-json-schema';
import { modelSafeOutcome, inputDigest, type Connection } from '@integrations/engine';
import { getWorkspace } from '@/lib/db/queries';
import { integrationSourceMetadata } from '@/lib/integrations/source-metadata';
import { getIntegrationRuntime, getIntegrationOwnerId } from '@/lib/integrations/runtime';
import { pinMatchesConnection, scopePins, normalizeIntegrationScopes } from '@/lib/integrations/scope-pins';
import { hostedMcpConnectionId } from '@/lib/integrations/hosted-mcp';
import { sessionCaller } from '@/lib/integrations/approval';
import { recordPausedConnection } from '@/lib/integrations/connection-requests';
import { runSourceInvocation } from '@/lib/integrations/source-invocations';
import { encodeSource, type SourceReference } from './reference';
import { SourceError } from './service';
import type { SourceAdapter, SourceContext, SourceDescriptor } from './types';

async function exact(reference: SourceReference, context: SourceContext) {
  if (reference.kind !== 'integration') throw new SourceError('forbidden', 'Invalid account reference');
  const metadata = await integrationSourceMetadata();
  const toolkit = metadata.toolkits.find(t => t.id === reference.toolkitId);
  const matches = metadata.connections.filter(c => c.providerId === toolkit?.providerId && pinMatchesConnection({ accountId: reference.account.accountId, authConfigId: reference.account.authConfigId ?? undefined }, c));
  if (matches.length !== 1 || matches[0].status !== 'active' || !allowed(reference.toolkitId, matches[0], context)) throw new SourceError('unavailable', 'This exact account is unavailable to this chat');
  const remote = metadata.servers.find(s => (s.entry.providerId ? hostedMcpConnectionId(s.entry) : `mcp-${s.entry.slug}`) === matches[0].id);
  if (remote?.entry.enabled === false) throw new SourceError('unavailable', 'This account is disabled');
  const runtime = await getIntegrationRuntime();
  const live = (await runtime.listConnections({ ownerId: getIntegrationOwnerId(), providerId: toolkit!.providerId })).filter(c => pinMatchesConnection({ accountId: reference.account.accountId, authConfigId: reference.account.authConfigId ?? undefined }, c));
  if (live.length !== 1 || live[0].id !== matches[0].id || live[0].status !== 'active') throw new SourceError('unavailable', 'This account changed. Reconnect it before trying again.');
  return { runtime, connection: live[0], toolkit: runtime.getToolkits().find(t => t.id === reference.toolkitId), remote, authorityKey: inputDigest([live[0].scopes.slice().sort(), remote?.entry.credentialRevision, remote?.entry.capabilityRevision, remote?.entry.enabled, remote?.entry.toolOverrides, remote?.entry.url, context.workspaceId ? normalizeIntegrationScopes(getWorkspace(context.workspaceId)?.integrationScopes) : null]) };
}
function allowed(toolkitId: string, connection: { accountId: string; authConfigId?: string }, context: SourceContext) {
  if (!context.workspaceId) return true;
  const scope = normalizeIntegrationScopes(getWorkspace(context.workspaceId)?.integrationScopes).find(s => s.toolkitId === toolkitId);
  if (!scope) return false;
  const pins = scopePins(scope);
  return !pins.length || pins.some(pin => pinMatchesConnection(pin, connection));
}
function accountName(connection: Connection, connections: Connection[]) {
  const base = (c: Connection) => c.label || c.email || c.accountId;
  const peers = connections.filter(c => c.providerId === connection.providerId && base(c) === base(connection));
  if (peers.length === 1) return base(connection);
  const identity = connection.email || connection.accountId;
  const label = identity === base(connection) ? identity : `${base(connection)} · ${identity}`;
  return peers.filter(c => (c.email || c.accountId) === identity).length > 1
    ? `${label} (${connection.authConfigId || 'default client'})` : label;
}
export const integrationSourceAdapter: SourceAdapter = {
  kind: 'integration',
  async list(context) {
    const { toolkits, connections, servers } = await integrationSourceMetadata();
    return toolkits.flatMap(toolkit => connections.filter(c => c.providerId === toolkit.providerId).map(connection => {
      const sourceRef = encodeSource({ v: 1, kind: 'integration', toolkitId: toolkit.id, account: { accountId: connection.accountId, authConfigId: connection.authConfigId ?? null } });
      const remote = servers.find(s => (s.entry.providerId ? hostedMcpConnectionId(s.entry) : `mcp-${s.entry.slug}`) === connection.id);
      const duplicate = connections.filter(c => c.providerId === connection.providerId && pinMatchesConnection(connection, c)).length > 1;
      const accountLabel = accountName(connection, connections);
      const status = !context.harnessReady || duplicate || remote?.entry.enabled === false ? 'unavailable' : connection.status !== 'active' ? 'reconnect' : !allowed(toolkit.id, connection, context) ? 'needs_access' : 'ready';
      const hasView = remote?.capabilities?.tools.some(t => {
        const meta = t._meta as { ui?: { resourceUri?: string }; 'ui/resourceUri'?: string } | undefined;
        return !!(meta?.ui?.resourceUri ?? meta?.['ui/resourceUri']);
      });
      return { sourceRef, label: `${toolkit.displayName} · ${accountLabel}`, service: toolkit.displayName, accountLabel, groupId: toolkit.id, keywords: [toolkit.id, toolkit.displayName, accountLabel], status, chat: true, view: hasView ? 'advertised' : 'none' } satisfies SourceDescriptor;
    }));
  },
  async actions(ref, ctx) {
    const { toolkit, remote } = await exact(ref, ctx);
    return (toolkit?.actions ?? []).filter(a => a.modelVisible !== false).flatMap(a => {
      const prefix = remote ? `${remote.entry.providerId ?? `mcp.${remote.entry.slug}`}.` : null;
      if (prefix && !a.id.startsWith(prefix)) return [];
      const name = prefix ? a.id.slice(prefix.length) : null;
      const tool = remote?.capabilities?.tools.find(t => t.name === name);
      const visibility = (tool?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility;
      if (remote && (!tool || remote.entry.toolOverrides?.[name!]?.enabled === false || visibility && !visibility.includes('model'))) return [];
      return [{ id: a.id, description: tool?.description ?? a.description, mutating: a.mutating, inputSchema: tool?.inputSchema ?? zodToJsonSchema(a.input), ...(tool?.outputSchema ? { outputSchema: tool.outputSchema } : a.output ? { outputSchema: zodToJsonSchema(a.output) } : {}) }];
    });
  },
  async call(ref, ctx, actionId, input, invocationId, signal) {
    const { runtime, toolkit, connection, authorityKey } = await exact(ref, ctx);
    const action = toolkit?.actions.find(a => a.id === actionId && a.modelVisible !== false);
    if (!action) throw new SourceError('forbidden', 'This action is unavailable');
    const parsed = action.input.parse(input);
    const caller = { ...sessionCaller(ctx.chatId), chatSource: { messageId: ctx.messageId!, sourceRef: encodeSource(ref), invocationId } };
    const outcome = await runSourceInvocation(ctx.chatId, invocationId, { caller, connectionId: connection.id, authorityKey, actionId, input: parsed }, async () => {
      if ((await exact(ref, ctx)).authorityKey !== authorityKey) throw new SourceError('unavailable', 'This account or its access changed before the action ran');
      return runtime.runAction(actionId, parsed, { ownerId: getIntegrationOwnerId(), connectionId: connection.id, allowedConnectionIds: [connection.id], caller, toolAudience: 'model', signal });
    });
    if ((await exact(ref, ctx)).authorityKey !== authorityKey) throw new SourceError('unavailable', 'This account or its access changed before the result arrived');
    if (!outcome.ok && (outcome.reason === 'auth_required' || outcome.reason === 'needs_consent'))
      await recordPausedConnection({ sessionId: ctx.chatId, scopeWorkspaceId: ctx.workspaceId, outcome });
    return outcome.ok ? outcome : modelSafeOutcome(outcome);
  },
};
