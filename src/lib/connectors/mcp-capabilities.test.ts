import { describe, expect, it } from 'vitest';
import { snapshotMcpCapabilities, diffMcpCapabilities } from './mcp-capabilities';

describe('MCP capability snapshots', () => {
  it('ignores tool order, object key order, and unordered schema/permission collections', () => {
    const first = snapshotMcpCapabilities([{ name: 'b' }, { name: 'a', inputSchema: { type: 'object', required: ['a', 'b'], properties: { b: { enum: ['y', 'x'] }, a: {} } }, annotations: { scopes: ['write', 'read'], readOnlyHint: true } }]);
    const reordered = snapshotMcpCapabilities([{ annotations: { readOnlyHint: true, scopes: ['read', 'write'] }, inputSchema: { properties: { a: {}, b: { enum: ['x', 'y'] } }, required: ['b', 'a'], type: 'object' }, name: 'a' }, { name: 'b' }]);
    expect(reordered).toEqual(first);
    expect(diffMcpCapabilities(first, reordered)).toBeUndefined();
  });

  it('identifies additions, removals, schemas, and permission annotations separately', () => {
    const first = snapshotMcpCapabilities([{ name: 'removed' }, { name: 'changed', inputSchema: { type: 'string' }, outputSchema: { type: 'string' }, annotations: { readOnlyHint: true } }]);
    const next = snapshotMcpCapabilities([{ name: 'added' }, { name: 'changed', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }]);
    expect(diffMcpCapabilities(first, next)).toEqual({ revision: next.revision, added: ['added'], removed: ['removed'], changed: [{ name: 'changed', fields: ['inputSchema', 'outputSchema', 'annotations'] }] });
  });

  it('preserves tuple position semantics instead of normalizing every array', () => {
    const first = snapshotMcpCapabilities([{ name: 'tuple', inputSchema: { prefixItems: [{ type: 'string' }, { type: 'number' }] } }]);
    const next = snapshotMcpCapabilities([{ name: 'tuple', inputSchema: { prefixItems: [{ type: 'number' }, { type: 'string' }] } }]);
    expect(first.revision).not.toBe(next.revision);
  });

  it('excludes arbitrary call results, transport credentials, and metadata fields', () => {
    const tool = { name: 'read', inputSchema: { type: 'object' }, access_token: 'secret', result: { personal: 'response' }, _meta: { private: 'metadata' } };
    const snapshot = snapshotMcpCapabilities([tool]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/secret|response|metadata/);
    expect(snapshot.tools[0]?.inputSchema).toEqual({ type: 'object' });
    expect(snapshot.tools[0]?.fingerprint).toHaveLength(64);
  });

  it('rejects ambiguous duplicate tool names without creating an inventory', () => {
    expect(() => snapshotMcpCapabilities([{ name: 'duplicate' }, { name: 'duplicate' }])).toThrow('unique');
  });
});
