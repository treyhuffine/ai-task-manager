import { describe, expect, it } from 'vitest';
import { snapshotMcpCapabilities, diffMcpCapabilities } from './mcp-capabilities';

describe('MCP capability snapshots', () => {
  it('reviews UI URI and visibility changes while excluding unrelated private metadata', () => {
    const first = snapshotMcpCapabilities([{ name: 'view', _meta: { ui: { resourceUri: 'ui://old', visibility: ['model'] }, secret: 'never persisted' } }]);
    expect(first.tools[0]?._meta).toEqual({ ui: { resourceUri: 'ui://old', visibility: ['model'] } });
    const next = snapshotMcpCapabilities([{ name: 'view', _meta: { ui: { resourceUri: 'ui://new', visibility: ['app'] } } }]);
    expect(diffMcpCapabilities(first, next)?.changed).toEqual([{ name: 'view', fields: ['_meta'] }]);
  });
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

  it('keeps safe tool icons for display without counting them as a change to review', () => {
    const plain = snapshotMcpCapabilities([{ name: 'browse', title: 'Library' }]);
    const iconic = snapshotMcpCapabilities([{ name: 'browse', title: 'Library', icons: [
      { src: 'data:image/svg+xml,%3Csvg%2F%3E', mimeType: 'image/svg+xml', theme: 'dark' },
      { src: 'javascript:alert(1)' }, { src: 'http://insecure.example/icon.png' },
    ] } as never]);
    expect(iconic.revision).toBe(plain.revision);
    expect(iconic.tools[0]?.fingerprint).toBe(plain.tools[0]?.fingerprint);
    expect(iconic.tools[0]?.icons).toEqual([{ src: 'data:image/svg+xml,%3Csvg%2F%3E', mimeType: 'image/svg+xml', theme: 'dark' }]);
    expect(diffMcpCapabilities(plain, iconic)).toBeUndefined();
  });

  it('reviews the deprecated mention search marker, since it changes what a tool is used for', () => {
    const plain = snapshotMcpCapabilities([{ name: 'search' }]);
    const marked = snapshotMcpCapabilities([{ name: 'search', _meta: { 'openai/extensions': { 'mentions/search': {} } } }]);
    expect(diffMcpCapabilities(plain, marked)?.changed).toEqual([{ name: 'search', fields: ['_meta'] }]);
  });

  it('rejects ambiguous duplicate tool names without creating an inventory', () => {
    expect(() => snapshotMcpCapabilities([{ name: 'duplicate' }, { name: 'duplicate' }])).toThrow('unique');
  });
});
