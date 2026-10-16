import { expect, it } from 'vitest';
import { prepareResource, LEGACY_BRIDGE } from './resource';
import { viewMetadata } from './metadata';
import { snapshotMcpCapabilities } from '@/lib/integrations/mcp-capabilities';
const uri = 'ui://fixture/index.html';
const resource = (text: string, extra = {}) => ({contents: [{uri, text, mimeType: 'text/html;profile=mcp-app', ...extra}]});
it('accepts a standard independent resource and hashes only its inline scripts', () => {
  const prepared = prepareResource(resource('<html><body><script>window.fixture=1</script></body></html>'), uri, false);
  expect(prepared.scriptHashes).toHaveLength(1); expect(prepared.digest).toHaveLength(64);
  expect(prepared.html).not.toContain('window.openai');
});
it('adapts legacy metadata without granting visibility or a launcher by name', () => {
  const tools = snapshotMcpCapabilities([{name: 'home', _meta: {'openai/outputTemplate': uri, 'openai/widgetAccessible': true, privateToken: 'drop me', 'openai/ui': {entrypoints: [{type: 'global'}]}}}]).tools;
  expect(viewMetadata(tools[0])).toMatchObject({legacy: true, global: true, resourceUri: uri});
  expect(tools[0]._meta).not.toHaveProperty('privateToken');
  expect(viewMetadata({ _meta: {ui: {resourceUri: uri}}})).toMatchObject({global: false});
  const prepared = prepareResource(resource('<h1>Legacy</h1>', {mimeType: 'text/html+skybridge'}), uri, true);
  expect(prepared.html).toContain(LEGACY_BRIDGE); expect(prepared.scriptHashes).toHaveLength(1);
});
it('rejects substituted resources, unsupported MIME, oversized and network-dependent views', () => {
  expect(() => prepareResource(resource('x'), 'ui://other/index.html', false)).toThrow('different');
  expect(() => prepareResource(resource('x', {mimeType: 'text/html'}), uri, false)).toThrow('supported');
  expect(() => prepareResource(resource('x'.repeat(12*1024*1024+1)), uri, false)).toThrow('12 MiB');
  expect(() => prepareResource(resource('<script src="https://cdn.example/view.js"></script>'), uri, false)).toThrow('outside');
  expect(() => prepareResource(resource('x', {_meta: {ui: {csp: {connectDomains: ['https://api.example']}}}}), uri, false)).toThrow('network');
  expect(() => prepareResource(resource('<iframe srcdoc="hello"></iframe>'), uri, false)).toThrow('outside');
});
