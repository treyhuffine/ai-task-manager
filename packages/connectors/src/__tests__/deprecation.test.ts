/**
 * Deprecated actions (G3): an action can be marked `deprecated`/`replacedBy`. It stays CALLABLE
 * (the action id is a public contract) but the projected description is annotated so the agent
 * prefers the replacement. `projectedDescription` is the single source both projections use.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toToolSet } from '../ai-sdk';
import { serveMcp } from '../mcp';
import type { McpToolResult } from '../mcp';
import { projectedDescription } from '../core/projection-shared';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit, httpAction } from '../core/authoring';
import { bearer } from '../auth/direct';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

/** A runtime with one normal + one deprecated action — shared by the projection tests. */
function deprecatedRuntime() {
  const http = fakeHttp(async () => ({ json: {} }));
  const provider = defineProvider({ id: 'svc', displayName: 'Svc', baseUrl: 'https://api.svc.test', auth: bearer() });
  const toolkit = defineToolkit({
    id: 'svc',
    providerId: 'svc',
    displayName: 'Svc',
    actions: [
      httpAction({ id: 'svc.new_way', description: 'The new way.', input: z.object({}), request: () => ({ method: 'GET', path: '/v2' }) }),
      httpAction({
        id: 'svc.old_way',
        description: 'The old way.',
        deprecated: true,
        replacedBy: 'svc.new_way',
        input: z.object({}),
        request: () => ({ method: 'GET', path: '/v1' }),
      }),
    ],
  });
  const registry = createRegistry();
  registry.addBundle({ provider, toolkits: [toolkit] });
  const store = inMemoryStore();
  return createConnectorRuntime({
    registry, store, authRequests: store, secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([]), redactor: createRedactor(), fetch: http.fetch,
  });
}

describe('projectedDescription', () => {
  it('passes a normal description through unchanged', () => {
    expect(projectedDescription({ description: 'List things.' })).toBe('List things.');
  });
  it('annotates a deprecated action with its replacement', () => {
    expect(projectedDescription({ description: 'Old way.', deprecated: true, replacedBy: 'svc.new_way' })).toBe(
      'DEPRECATED — use `svc.new_way` instead. Old way.',
    );
  });
  it('annotates a deprecated action with no replacement', () => {
    expect(projectedDescription({ description: 'Old.', deprecated: true })).toBe('DEPRECATED. Old.');
  });
});

describe('deprecated actions in the AI-SDK projection', () => {
  it('keeps the deprecated tool callable but marks its description', async () => {
    const tools = await toToolSet(deprecatedRuntime());
    expect(tools.svc__old_way).toBeDefined(); // still callable — not dropped
    expect((tools.svc__old_way as { description: string }).description).toBe('DEPRECATED — use `svc.new_way` instead. The old way.');
    expect((tools.svc__new_way as { description: string }).description).toBe('The new way.');
  });
});

describe('deprecated actions in the MCP projection (parity)', () => {
  it('registers the deprecated tool with the same annotated description', () => {
    const registered = new Map<string, string | undefined>();
    const reg = {
      registerTool(name: string, config: { description?: string }, _h: (a: Record<string, unknown>) => Promise<McpToolResult>) {
        registered.set(name, config.description);
      },
    };
    serveMcp(reg, deprecatedRuntime());
    expect(registered.has('svc__old_way')).toBe(true); // still registered — not dropped
    expect(registered.get('svc__old_way')).toBe('DEPRECATED — use `svc.new_way` instead. The old way.');
    expect(registered.get('svc__new_way')).toBe('The new way.');
  });
});
