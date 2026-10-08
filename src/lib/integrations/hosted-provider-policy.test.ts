import { describe, expect, it } from 'vitest';
import { createRegistry } from '@integrations/engine';
import { ingestMcpServer } from '@integrations/engine/mcp';
import { HOSTED_MCP_PROVIDERS } from '@integrations/engine/providers';
import { inMemoryStore, plaintextSecretBox } from '@integrations/engine/testing';
import { defaultApprovalMode } from './write-policy';

describe('broad hosted integration permissions', () => {
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

  // Vendor annotations from dataforseo/mcp-server-typescript 3.1.3 (src/core/tools/tool-annotations.ts).
  it('runs DataForSEO data requests on standing intent, like other paid research reads', async () => {
    const definition = HOSTED_MCP_PROVIDERS.find((provider) => provider.id === 'dataforseo')!;
    const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
    const registry = createRegistry();
    await ingestMcpServer(registry, inMemoryStore(), plaintextSecretBox(), {
      name: 'builtin_dataforseo',
      identity: { providerId: definition.id, displayName: definition.displayName },
      trustToolAnnotations: true,
      ...(definition.defaultMutationRisk ? { defaultRisk: definition.defaultMutationRisk } : {}),
      client: {
        listTools: async () => ({ tools: [
          ...['docs_index', 'docs_list_sections', 'docs_search'].map((name) => ({ name, inputSchema: { type: 'object' as const }, annotations: read })),
          { name: 'api_request', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
        ] }),
        callTool: async () => ({ content: [] }),
      },
    });
    for (const name of ['docs_index', 'docs_list_sections', 'docs_search']) {
      expect(registry.getAction(`dataforseo.${name}`)!.action).toMatchObject({ mutating: false, risk: 'low' });
    }
    const request = registry.getAction('dataforseo.api_request')!.action;
    expect(request).toMatchObject({ mutating: true, risk: 'medium' });
    expect(defaultApprovalMode({ actionId: request.id, risk: request.risk!, mutating: true })).toBe('auto');
  });
});
