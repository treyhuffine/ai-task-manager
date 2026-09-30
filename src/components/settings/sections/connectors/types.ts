// Client-side shapes for the connectors engine API (/api/connectors/*). The
// engine owns these records (they live in its home store under
// `.config/connectors`, not the app DB), so they are declared here rather than
// derived from the Drizzle schema.
import type { HostedMcpEndpointSetup } from '@connectors/engine/providers';
import type { McpCapabilityChanges } from '@/lib/connectors/mcp-capabilities';

export interface HostedMcpAccount {
  serverId: string;
  connectionId?: string;
  accountId?: string;
  label?: string;
  enabled?: boolean;
  requiresAuth: boolean;
  configured?: boolean;
  authConfigId?: string;
  endpointConfig?: HostedMcpEndpointSetup;
  status?: 'ok' | 'unreachable' | 'error';
  error?: string;
  toolCount?: number;
  lastCheckedAt?: string;
  lastAuthorizationId?: string;
  capabilityRevision?: string;
  capabilityChanges?: McpCapabilityChanges;
}

export interface HostedConnectIntent {
  serverId?: string;
  existingConnectionId?: string;
  addAccount?: boolean;
  setupId?: string;
  label?: string;
  endpointId?: string;
  instanceUrl?: string;
  fields?: Record<string, string>;
}

export interface ProviderStatus {
  id: string;
  displayName: string;
  method: 'oauth2' | 'api_key' | 'custom' | 'mcp';
  /** OAuth only: a bundled/env client or at least one bring-your-own app exists. */
  configured: boolean;
  desktopCallback?: { kind: 'loopback' | 'relay'; redirectUri?: string };
  credentialFields?: string[];
  /** A built-in provider whose tools and authorization come from its hosted server. */
  mcp?: {
    serverId?: string;
    status?: 'ok' | 'unreachable' | 'error';
    error?: string;
    requiresAuth: boolean;
    authKind?: 'oauth' | 'bearer' | 'none';
    credentialLabel?: string;
    helpUrl?: string;
    endpointConfig?: HostedMcpEndpointSetup;
    oauthRegistration?: 'dynamic' | 'registered';
    authConfigId?: string;
    redirectUri?: string;
    accounts?: HostedMcpAccount[];
    capabilityRevision?: string;
    capabilityChanges?: McpCapabilityChanges;
  };
  /**
   * Client-only marker: a connection whose provider the engine no longer lists.
   * Still shown so the account can be tested and disconnected, never connected.
   */
  orphan?: boolean;
}

export interface Connection {
  id: string;
  providerId: string;
  accountId: string;
  email?: string | null;
  label?: string | null;
  scopes: string[];
  status: string;
}

export function isRegisteredMcp(provider: ProviderStatus): boolean {
  return provider.method === 'mcp' && provider.mcp?.oauthRegistration === 'registered';
}

/** Registered hosted services always use their stable callback, including desktop. */
export function oauthAppRedirectUri(provider: ProviderStatus, fallback: string): string {
  if (isRegisteredMcp(provider)) return provider.mcp?.redirectUri ?? '';
  return provider.desktopCallback ? provider.desktopCallback.redirectUri || 'http://127.0.0.1/oauth/callback' : fallback;
}

export interface ActionInfo {
  id: string;
  description: string;
  mutating: boolean;
  risk: string;
  scopes: string[];
}

export interface ToolkitInfo {
  id: string;
  displayName: string;
  providerId: string;
  scopes: string[];
  actions: ActionInfo[];
}

export type ApprovalMode = 'auto' | 'ask';

export interface WritePolicyAction {
  mode: ApprovalMode;
  defaultMode: ApprovalMode;
  overridden: boolean;
}

export interface TestResult {
  ok: boolean;
  status: string;
  error?: string;
}

export interface AuthConfigSummary {
  id: string;
  providerId: string;
  label?: string;
  isDefault: boolean;
  status: string;
}

export interface ByoForm {
  label: string;
  clientId: string;
  clientSecret: string;
}

export const EMPTY_BYO_FORM: ByoForm = { label: '', clientId: '', clientSecret: '' };

export interface McpToolOverride {
  enabled?: boolean;
  mutating?: boolean;
}

export interface McpServerEntry {
  id: string;
  /** Built-in servers are managed through their provider card. */
  providerId?: string;
  slug: string;
  displayName: string;
  url: string;
  enabled: boolean;
  auth: { kind: 'none' } | { kind: 'bearer' } | { kind: 'header'; header: string } | { kind: 'oauth' };
  tools?: { name: string; description?: string }[];
  toolOverrides?: Record<string, McpToolOverride>;
  lastStatus?: 'ok' | 'unreachable' | 'error';
  lastError?: string;
  lastToolCount?: number;
  lastCheckedAt?: string;
  capabilityRevision?: string;
  capabilityChanges?: McpCapabilityChanges;
}

export interface McpForm {
  name: string;
  url: string;
  authKind: 'none' | 'bearer' | 'header' | 'oauth';
  header: string;
  secret: string;
}

export const EMPTY_MCP_FORM: McpForm = { name: '', url: '', authKind: 'none', header: '', secret: '' };

/** Prefer the API error body's reason ("API 400 …" hides it) so failures read clearly. */
export function errMsg(e: unknown): string {
  const body = (e as { body?: { error?: string } }).body;
  if (body?.error) return body.error;
  return e instanceof Error ? e.message : String(e);
}

/** "client_id" → "Client ID", "api_token" → "Api Token". */
export function prettyField(field: string): string {
  return field
    .split(/[_\s]+/)
    .map((w) => (w.toLowerCase() === 'id' ? 'ID' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Credential field names that should render as password inputs. */
export const SECRETY = /(secret|token|key|password|pass)/i;

/** The human handle for a connected account: email, then label, then the raw account id. */
export function connectionIdentity(c: Connection): string {
  return c.email || c.label || c.accountId;
}
