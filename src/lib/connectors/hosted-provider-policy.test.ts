import { describe, expect, it } from 'vitest';
import { createRegistry } from '@connectors/engine';
import { ingestMcpServer } from '@connectors/engine/mcp';
import { HOSTED_MCP_PROVIDERS } from '@connectors/engine/providers';
import { inMemoryStore, plaintextSecretBox } from '@connectors/engine/testing';
import { defaultApprovalMode } from './write-policy';

describe('broad hosted connector permissions', () => {
  it.each(HOSTED_MCP_PROVIDERS.filter((provider) => provider.defaultMutationRisk === 'high'))('keeps $id writes gated even when upstream calls them non-destructive', async (definition) => {
    const { id } = definition;
    const registry = createRegistry();
    await ingestMcpServer(registry, inMemoryStore(), plaintextSecretBox(), {
      name: `builtin_${id}`,
      identity: { providerId: id, displayName: definition.displayName },
      trustToolAnnotations: true,
      defaultRisk: definition.defaultMutationRisk,
      client: {
        listTools: async () => ({ tools: [
          { name: 'search_records', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
          { name: 'execute_action', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: false } },
          { name: 'unknown_action', inputSchema: { type: 'object' } },
        ] }),
        callTool: async () => ({ content: [] }),
      },
    });
    for (const tool of ['execute_action', 'unknown_action']) {
      const action = registry.getAction(`${id}.${tool}`)!.action;
      expect(defaultApprovalMode({ actionId: action.id, risk: action.risk ?? 'low', mutating: action.mutating ?? false })).toBe('ask');
    }
    const read = registry.getAction(`${id}.search_records`)!.action;
    expect(defaultApprovalMode({ actionId: read.id, risk: read.risk ?? 'low', mutating: read.mutating ?? false })).toBe('auto');
  });
});
