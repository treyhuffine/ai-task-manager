import { describe, it, expect, afterEach } from 'vitest';
import {
  registerPreviewProvider,
  getProvider,
  tryGetProvider,
  listProviders,
  listProviderIds,
  unregisterPreviewProvider,
} from './registry';
import type { PreviewProvider, PreviewContext } from './types';

const ctx: PreviewContext = {
  cwd: '/tmp/flow-a3f9',
  worktreeName: 'flow-a3f9',
  service: null,
  port: 3000,
  workspaceId: 'ws1',
  executionId: 'ex1',
  previewName: 'flow-a3f9',
};

function makePlugin(id: string, url: string): PreviewProvider {
  return {
    id,
    label: `Test ${id}`,
    kind: 'static',
    managesLocalServer: false,
    resolve: async () => ({ url }),
  };
}

afterEach(() => {
  unregisterPreviewProvider('test-plugin');
  unregisterPreviewProvider('test-plugin-2');
});

describe('provider registry', () => {
  it('registers a plugin and resolves it', async () => {
    registerPreviewProvider(makePlugin('test-plugin', 'https://example.test'));
    const provider = getProvider('test-plugin');
    expect(provider.id).toBe('test-plugin');
    const target = await provider.resolve(ctx);
    expect(target.url).toBe('https://example.test');
  });

  it('throws a clear error for an unknown id', () => {
    expect(() => getProvider('does-not-exist')).toThrow(/Unknown preview provider/);
  });

  it('tryGetProvider returns undefined for unknown id', () => {
    expect(tryGetProvider('nope')).toBeUndefined();
  });

  it('lists registered providers and ids', () => {
    registerPreviewProvider(makePlugin('test-plugin', 'https://a.test'));
    registerPreviewProvider(makePlugin('test-plugin-2', 'https://b.test'));
    expect(listProviderIds()).toEqual(expect.arrayContaining(['test-plugin', 'test-plugin-2']));
    expect(listProviders().some((p) => p.id === 'test-plugin')).toBe(true);
  });

  it('last registration for an id wins (plugin can override)', async () => {
    registerPreviewProvider(makePlugin('test-plugin', 'https://first.test'));
    registerPreviewProvider(makePlugin('test-plugin', 'https://second.test'));
    const target = await getProvider('test-plugin').resolve(ctx);
    expect(target.url).toBe('https://second.test');
  });

  it('rejects invalid ids', () => {
    expect(() => registerPreviewProvider(makePlugin('Bad_ID', 'x'))).toThrow(/invalid id/);
  });
});
