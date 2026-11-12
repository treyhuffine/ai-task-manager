import type { RouterOutputs } from '@/lib/trpc/router';
import type { SkillSummary } from '@/lib/api/skills';
import { integrationMeta } from '@/components/integrations/integration-meta';

export type LibraryFilter = 'all' | 'apps' | 'connectors' | 'skills';
export type LibraryMode = 'yours' | 'discover';
export type LibraryTarget =
  | { kind: 'provider'; id: string }
  | { kind: 'mcp'; id: string }
  | { kind: 'skill'; ref: string };

export interface LibraryItem {
  connectedAppId?: string;
  sourceRef?: string;
  key: string;
  name: string;
  description: string;
  keywords: string;
  kind: Exclude<LibraryFilter, 'all'>;
  target: LibraryTarget;
  providerId?: string;
  chat: boolean;
  view: boolean;
  status: string;
  attention: boolean;
  draft?: boolean;
  added: boolean;
  usable?: boolean;
}

export interface LibrarySources {
  connectedApps?: RouterOutputs['connectedApps']['catalog'];
  providers?: RouterOutputs['integrations']['statusGet']['providers'];
  connections?: RouterOutputs['integrations']['connectionsGet']['connections'];
  servers?: RouterOutputs['integrations']['mcpServersGet']['servers'];
  skills?: SkillSummary[];
}

/**
 * One row per product. Provider-backed MCP servers stay under their provider.
 * A connection whose server supplies an interface (docs/connected-mcp-apps.md) is an app.
 */
export function libraryItems({ providers = [], connections = [], servers = [], skills = [], connectedApps = [] }: LibrarySources): LibraryItem[] {
  const items: LibraryItem[] = [];
  // Retired providers still need a route to manage their existing accounts.
  const known = new Set(providers.map(provider => provider.id));
  const retired = [...new Set(connections.map(connection => connection.providerId))]
    .filter(id => !known.has(id) && !servers.some(server => !server.providerId && id === `mcp_${server.slug.replace(/[^a-zA-Z0-9_]/g, '_')}`))
    .map(id => ({ id, displayName: id }));
  for (const provider of [...providers, ...retired].filter(provider => !servers.some(server => !server.providerId && provider.id === `mcp_${server.slug.replace(/[^a-zA-Z0-9_]/g, '_')}`))) {
    const accounts = connections.filter(connection => connection.providerId === provider.id);
    const hosted = servers.filter(server => server.providerId === provider.id);
    const added = accounts.length > 0 || hosted.length > 0;
    const attention = accounts.some(account => account.status !== 'active') || hosted.some(server => server.enabled && server.lastStatus !== 'ok');
    const accountNames = accounts.map(account => account.label || account.email || account.accountId).join(' · ');
    const meta = integrationMeta(provider.id);
    items.push({ key: `provider:${provider.id}`, name: provider.displayName, description: meta.description,
      keywords: `${provider.id} ${meta.category} ${accountNames}`, kind: 'connectors', providerId: provider.id,
      target: { kind: 'provider', id: provider.id }, chat: true, view: false,
      status: attention ? 'Needs attention' : accounts.length > 1 ? `${accounts.length} accounts` : accounts.length === 1 ? accountNames : added ? 'Finish setup' : 'Connect account',
      attention, added });
  }
  for (const server of servers.filter(server => !server.providerId)) items.push({ key: `mcp:${server.id}`, name: server.displayName,
    description: server.url, keywords: `${server.slug} custom MCP`, kind: 'connectors', target: { kind: 'mcp', id: server.id }, chat: true, view: false,
    status: !server.enabled ? 'Disabled' : server.lastStatus === 'ok' ? 'Connected' : 'Needs attention',
    attention: server.enabled && server.lastStatus !== 'ok', added: true, usable: server.enabled && server.lastStatus === 'ok' });
  for (const skill of skills) items.push({ key: `skill:${skill.ref}`, name: skill.name, description: skill.description || 'Instructions for a repeatable workflow.',
    keywords: skill.location.kind === 'project' ? skill.location.projectName : skill.location.kind, kind: 'skills', target: { kind: 'skill', ref: skill.ref },
    chat: true, view: false, status: skill.hasErrors ? 'Needs attention' : skill.location.kind === 'draft' ? 'Draft' : skill.location.kind === 'project' ? skill.location.projectName : skill.location.kind === 'global' ? 'All agents on this computer' : 'Ri agents',
    attention: skill.hasErrors, added: true, draft: skill.location.kind === 'draft' });
  for (const item of items) {
    const connected = connectedApps.find(app => item.target.kind === 'mcp' ? app.id === item.target.id : item.target.kind === 'provider' && app.providerId === item.target.id);
    if (connected) { item.view = true; item.kind = 'apps'; item.connectedAppId = connected.id; }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export function filterLibrary(items: LibraryItem[], mode: LibraryMode, filter: LibraryFilter, query: string): LibraryItem[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(item => (mode === 'discover' ? item.kind === 'connectors' || !!item.connectedAppId : item.added)
    && (filter === 'all' || item.kind === filter || (filter === 'connectors' && !!item.connectedAppId))
    && terms.every(term => `${item.name} ${item.description} ${item.keywords}`.toLocaleLowerCase().includes(term)));
}

export function libraryLocation(query: Record<string, string>) {
  return { mode: query.browse === 'discover' ? 'discover' as const : 'yours' as const,
    filter: ['apps', 'connectors', 'skills'].includes(query.filter) ? query.filter as LibraryFilter : 'all' as const,
    search: query.q ?? '', provider: query.provider, mcp: query.mcp };
}

export function libraryRoute(query: Record<string, string>, patch: Record<string, string | undefined>): string {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value); else next.delete(key);
  }
  return next.size ? `?${next}` : '';
}
