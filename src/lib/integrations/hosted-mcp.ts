import { INTEGRATION_LABELS } from '@/constants/integrations';
import { getHostedMcpProvider, type HostedMcpProvider } from '@integrations/engine/providers';
import { IntegrationError, type ConnectionStore } from '@integrations/engine';
import type { McpServerEntry, McpServerStore } from './mcp-servers';
import { activateMcpServer } from './mcp-lifecycle';
import { createHash, randomUUID } from 'node:crypto';
import { hostedMcpUrlMatches, resolveHostedMcpUrl, type HostedEndpointInput } from './hosted-endpoint';
import { usesRegisteredOAuth } from './hosted-oauth-config';
export { hostedMcpEndpointSetup, trustHostedMcpAnnotations } from './hosted-endpoint';

/** Only a catalog-pinned endpoint may take a built-in provider's identity and trust policy. */
export function hostedMcpDefinition(entry: McpServerEntry): HostedMcpProvider | undefined {
  if (!entry.providerId) return undefined;
  const definition = getHostedMcpProvider(entry.providerId);
  if (!definition || !hostedMcpUrlMatches(definition, entry.url) || (entry.auth.kind !== (definition.auth?.kind ?? 'oauth') && !(definition.tokenAuth && entry.auth.kind === 'bearer'))) {
    throw new Error(`The built-in ${INTEGRATION_LABELS.singular.toLowerCase()} no longer matches its trusted service configuration. Reconnect it from Settings.`);
  }
  return definition;
}

/** Presence of the catalog-selected credential, without exposing its value. */
export async function hostedMcpRequiresAuth(
  entry: McpServerEntry | undefined,
  servers: Pick<McpServerStore, 'getOAuthState' | 'openSecret'>,
): Promise<boolean> {
  if (!entry?.enabled) return true;
  if (entry.auth.kind === 'none') return false;
  if (entry.auth.kind === 'oauth') return !(await servers.getOAuthState(entry.id))?.tokens;
  return !(await servers.openSecret(entry.id));
}

export function hostedMcpConnectionId(entry: McpServerEntry): string {
  return entry.connectionId ?? `mcp-${entry.slug}`;
}

export interface HostedAccountSelection {
  serverId?: string;
  existingConnectionId?: string;
  addAccount?: boolean;
  /** A client-generated UUID makes retries of Add account resolve the same pending setup. */
  setupId?: string;
  label?: string;
}

export function hostedAccountSelection(input: Record<string, unknown>): HostedAccountSelection {
  const selected: HostedAccountSelection = {};
  for (const key of ['serverId', 'existingConnectionId', 'setupId', 'label'] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || (key !== 'label' && !value.trim())) throw new IntegrationError('invalid_input', `Invalid ${key}.`);
    selected[key] = value.trim();
  }
  if (input.addAccount !== undefined) {
    if (typeof input.addAccount !== 'boolean') throw new IntegrationError('invalid_input', 'Invalid account selection.');
    selected.addAccount = input.addAccount;
  }
  if (selected.setupId && !selected.addAccount) throw new IntegrationError('invalid_input', 'An account setup identifier requires Add account.');
  return selected;
}

/** Never silently pick the first account when the caller has more than one. */
export async function resolveHostedMcpAccount(
  definition: HostedMcpProvider,
  servers: Pick<McpServerStore, 'list' | 'get'>,
  connections: Pick<ConnectionStore, 'get'>,
  ownerId: string,
  options: HostedAccountSelection = {},
): Promise<McpServerEntry | undefined> {
  if (options.addAccount && (options.serverId || options.existingConnectionId)) throw new IntegrationError('invalid_input', 'Choose an existing account or add a new one.');
  if (options.setupId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.setupId)) throw new IntegrationError('invalid_input', 'Invalid account setup identifier.');
  const entries = servers.list().filter(entry => entry.providerId === definition.id);
  let selected: McpServerEntry | undefined;
  if (options.addAccount) {
    if (definition.auth?.kind === 'none') throw new IntegrationError('invalid_input', 'This service does not use accounts.');
    const setupId = options.setupId;
    selected = setupId ? entries.find(entry => entry.slug === `builtin_${definition.id}_${setupId.replaceAll('-', '_')}`) : undefined;
  } else if (options.serverId) {
    selected = servers.get(options.serverId) ?? undefined;
    if (!selected || selected.providerId !== definition.id ||
      (options.existingConnectionId && hostedMcpConnectionId(selected) !== options.existingConnectionId)) {
      throw new IntegrationError('connection_not_found', 'The selected account was not found.');
    }
  } else if (options.existingConnectionId) {
    selected = entries.find(entry => hostedMcpConnectionId(entry) === options.existingConnectionId);
    if (!selected) {
      const old = await connections.get(options.existingConnectionId);
      if (!old || old.connection.providerId !== definition.id || old.connection.ownerId !== ownerId) {
        throw new IntegrationError('connection_not_found', 'The selected account was not found.');
      }
    }
  } else {
    if (entries.length > 1) throw new IntegrationError('account_required', 'Choose the account to reconnect, or add another account.');
    selected = entries[0];
  }
  if (selected) {
    const stored = await connections.get(hostedMcpConnectionId(selected));
    if (stored && stored.connection.ownerId !== ownerId) throw new IntegrationError('connection_not_found', 'The selected account was not found.');
    hostedMcpDefinition(selected);
  }
  return selected;
}

/** Keep the old connection/account IDs so agent scopes and saved pins survive the upgrade. */
export async function ensureHostedMcpServer(
  definition: HostedMcpProvider,
  servers: McpServerStore,
  connections: Pick<ConnectionStore, 'list' | 'get' | 'setStatus'>,
  ownerId: string,
  options: HostedEndpointInput & HostedAccountSelection & { secret?: string; authConfigId?: string } = {},
): Promise<McpServerEntry> {
  const auth = { kind: options.secret !== undefined && definition.tokenAuth ? 'bearer' : definition.auth?.kind ?? 'oauth' };
  const pinned = getHostedMcpProvider(definition.id);
  if (!pinned || pinned.url !== definition.url || JSON.stringify(pinned.endpoint) !== JSON.stringify(definition.endpoint) || ((pinned.auth?.kind ?? 'oauth') !== auth.kind && !(pinned.tokenAuth && auth.kind === 'bearer'))) {
    throw new Error(`The built-in ${INTEGRATION_LABELS.singular.toLowerCase()} does not match its trusted service configuration.`);
  }
  if (auth.kind !== 'bearer' && options.secret !== undefined) throw new Error(`This ${INTEGRATION_LABELS.singular.toLowerCase()} does not accept a token.`);
  const secret = options.secret?.trim();
  if (auth.kind === 'bearer' && options.secret !== undefined && !secret) throw new Error('A connection token is required.');
  const existing = await resolveHostedMcpAccount(definition, servers, connections, ownerId, options);
  if (usesRegisteredOAuth(pinned)) {
    if (!options.authConfigId) throw new Error('Choose an OAuth app before connecting.');
    if (existing && existing.authConfigId !== options.authConfigId) throw new Error(`Disconnect this ${INTEGRATION_LABELS.singular.toLowerCase()} before changing its OAuth app.`);
  } else if (options.authConfigId !== undefined) throw new Error(`This ${INTEGRATION_LABELS.singular.toLowerCase()} does not use a registered OAuth app.`);
  const hasSelection = options.endpointId !== undefined || options.instanceUrl !== undefined;
  const url = existing && !hasSelection ? existing.url : resolveHostedMcpUrl(pinned, options);
  if (existing) {
    hostedMcpDefinition(existing);
    if (existing.auth.kind !== auth.kind) throw new Error('Add another account to use a different connection method.');
    if (url !== existing.url) throw new Error(`Disconnect this ${INTEGRATION_LABELS.singular.toLowerCase()} before changing its region or instance.`);
    if (auth.kind === 'bearer' && !secret && !await servers.openSecret(existing.id)) throw new Error('A connection token is required.');
    if (!existing.enabled || secret !== undefined) {
      const updated = await activateMcpServer(existing, servers, connections, ownerId, secret);
      if (!updated) throw new Error(`The ${INTEGRATION_LABELS.singular.toLowerCase()} was disconnected. Try connecting again.`);
      return updated;
    }
    return existing;
  }
  if (auth.kind === 'bearer' && !secret) throw new Error('A connection token is required.');
  const previous = options.addAccount ? [] : (await connections.list({ ownerId, providerId: definition.id }))
    .filter(connection => !options.existingConnectionId || connection.id === options.existingConnectionId);
  if (previous.length > 1) throw new IntegrationError('account_required', 'Choose a saved account to reconnect, or add another account.');
  const distinct = options.addAccount || Boolean(options.existingConnectionId && servers.list().some(entry => entry.providerId === definition.id));
  const setupId = options.setupId ?? randomUUID();
  // A reserved slug keeps a custom server named Todoist distinct from the built-in integration.
  const slug = distinct ? `builtin_${definition.id}_${setupId.replaceAll('-', '_')}` : `builtin_${definition.id}`;
  const connectionId = previous[0]?.id ?? (distinct ? `hosted-${definition.id}-${setupId}` : `hosted-${definition.id}`);
  try {
    return await servers.create({
      providerId: definition.id,
      ...(options.authConfigId ? { authConfigId: options.authConfigId } : {}),
      connectionId,
      accountId: distinct ? previous[0]?.accountId ?? `${definition.id}:${setupId}` : pinned.endpoint
        ? `${definition.id}:${createHash('sha256').update(url).digest('hex').slice(0, 20)}`
        : previous[0]?.accountId ?? `${definition.id}:default`,
      slug,
      displayName: options.label?.trim().slice(0, 120) || previous[0]?.label || (distinct ? `${definition.displayName} ${servers.list().filter(entry => entry.providerId === definition.id).length + 1}` : definition.displayName),
      url,
      auth: { kind: auth.kind as 'oauth' | 'bearer' | 'none' },
    }, secret);
  } catch (error) {
    // Two browser requests may race. Reuse only a valid built-in entry, never a custom server.
    const raced = servers.getBySlug(slug);
    if (raced?.providerId === definition.id && hostedMcpConnectionId(raced) === connectionId) {
      hostedMcpDefinition(raced);
      if (raced.auth.kind !== auth.kind) throw new Error('Add another account to use a different connection method.');
      if (raced.authConfigId !== options.authConfigId) throw new Error(`This ${INTEGRATION_LABELS.singular.toLowerCase()} was connected with a different OAuth app. Disconnect it before changing the app.`);
      if (raced.url !== url) throw new Error(`This ${INTEGRATION_LABELS.singular.toLowerCase()} was connected to a different region or instance. Disconnect it before changing the endpoint.`);
      // A concurrent connect may have supplied a different replacement token.
      if (secret !== undefined) {
        const updated = await activateMcpServer(raced, servers, connections, ownerId, secret);
        if (!updated) throw new Error(`The ${INTEGRATION_LABELS.singular.toLowerCase()} was disconnected. Try connecting again.`);
        return updated;
      }
      return raced;
    }
    throw error;
  }
}

/** Old API tokens cannot stand in for consent to the provider's hosted MCP service. */
export async function markHostedMcpReconnectRequired(
  providerId: string,
  connections: Pick<ConnectionStore, 'list' | 'setStatus'>,
  ownerId: string,
  connectionId?: string,
): Promise<void> {
  for (const connection of await connections.list({ ownerId, providerId })) {
    if (connectionId && connection.id !== connectionId) continue;
    if (connection.status !== 'needs_reauth') {
      const kind = getHostedMcpProvider(providerId)?.auth?.kind ?? 'oauth';
      await connections.setStatus(connection.id, 'needs_reauth', kind === 'oauth' ? 'Sign in to connect the official service' : 'Reconnect the official service in Settings');
    }
  }
}
