import path from 'node:path';
import { createRegistry } from '@integrations/engine';
import { fileStore } from '@integrations/engine/store';
import { registerAllProviders, HOSTED_MCP_PROVIDERS } from '@integrations/engine/providers';
import { getIntegrationsDir } from './storage';
import { readMcpMetadata } from './mcp-servers';

/** Definitions and saved connection metadata only. Never builds the live MCP runtime. */
export async function integrationSourceMetadata() {
  const dir = getIntegrationsDir();
  const registry = createRegistry();
  registerAllProviders(registry);
  const servers = readMcpMetadata(dir);
  const remoteProviders = new Set(HOSTED_MCP_PROVIDERS.map(p => p.id));
  const toolkits = registry.toolkits().filter(t => !remoteProviders.has(t.providerId)).map(t => ({ id: t.id, providerId: t.providerId, displayName: t.displayName }));
  for (const { entry } of servers) {
    const providerId = entry.providerId ?? `mcp_${entry.slug}`;
    if (!toolkits.some(t => t.id === providerId)) toolkits.push({ id: providerId, providerId, displayName: HOSTED_MCP_PROVIDERS.find(p => p.id === providerId)?.displayName ?? entry.displayName });
  }
  return { toolkits, servers, connections: await fileStore({ dir: path.resolve(dir) }).list({ ownerId: 'local' }) };
}
