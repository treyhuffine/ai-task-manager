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
it('renders a self-contained view that names another host\'s dedicated origin or asks for permissions, and still refuses one that needs the network', () => {
  // Todoist's task list, as its server returns it: ChatGPT's origin, and no network at all.
  const todoist = {ui: {prefersBorder: true, csp: {connectDomains: [], resourceDomains: []}}, 'openai/widgetDescription': 'Interactive task list widget', 'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': {connect_domains: [], resource_domains: []}, 'openai/widgetDomain': 'https://ai.todoist.net'};
  expect(prepareResource(resource('<script>window.list=1</script>', {_meta: todoist}), uri, false).scriptHashes).toHaveLength(1);
  expect(prepareResource(resource('<p>Board</p>', {_meta: {ui: {domain: 'a904794854a047f6.claudemcpcontent.com'}}}), uri, false).html).toBe('<p>Board</p>');
  expect(() => prepareResource(resource('x', {_meta: {ui: {domain: 'board.example', csp: {connectDomains: ['https://api.board.example']}}}}), uri, false)).toThrow('network');
  expect(() => prepareResource(resource('x', {_meta: {'openai/widgetDomain': 'https://board.example', 'openai/widgetCSP': {connect_domains: ['https://api.board.example']}}}), uri, true)).toThrow('network');
  // Flint's chart, as its server returns it: clipboard write requested, granted by no Ri frame.
  expect(prepareResource(resource('<p>Chart</p>', {_meta: {ui: {permissions: {clipboardWrite: {}}}}}), uri, false).html).toBe('<p>Chart</p>');
  expect(() => prepareResource(resource('x', {_meta: {ui: {permissions: {camera: {}}, csp: {resourceDomains: ['https://esm.sh']}}}}), uri, false)).toThrow('network');
});
