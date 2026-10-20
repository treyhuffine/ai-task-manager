import { expect, it } from 'vitest';
import { prepareResource, LEGACY_BRIDGE } from './resource';
import { initialDisplayMode, viewMetadata } from './metadata';
import { snapshotMcpCapabilities } from '@/lib/integrations/mcp-capabilities';
const uri = 'ui://fixture/index.html';
const resource = (text: string, extra = {}) => ({contents: [{uri, text, mimeType: 'text/html;profile=mcp-app', ...extra}]});
const noNetwork = {connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [], blocked: []};
it('takes an interface as it is, without reading its markup', () => {
  // Whatever it holds runs only inside the view's sandboxed frame.
  const html = '<html><body><script src="https://cdn.example/view.js"></script><iframe srcdoc="hello"></iframe><script>window.fixture=1</script></body></html>';
  const prepared = prepareResource(resource(html), uri, false);
  expect(prepared.html).toBe(html); expect(prepared.digest).toHaveLength(64);
  expect(prepared.csp).toEqual(noNetwork);
  expect(prepared).not.toHaveProperty('scriptHashes');
});
it('adapts legacy metadata without granting visibility or a launcher by name', () => {
  const tools = snapshotMcpCapabilities([{name: 'home', _meta: {'openai/outputTemplate': uri, 'openai/widgetAccessible': true, privateToken: 'drop me', 'openai/ui': {entrypoints: [{type: 'global'}]}}}]).tools;
  expect(viewMetadata(tools[0])).toMatchObject({legacy: true, global: true, resourceUri: uri});
  expect(tools[0]._meta).not.toHaveProperty('privateToken');
  expect(viewMetadata({ _meta: {ui: {resourceUri: uri}}})).toMatchObject({global: false});
  const prepared = prepareResource(resource('<h1>Legacy</h1>', {mimeType: 'text/html+skybridge'}), uri, true);
  expect(prepared.html).toBe(`<script>${LEGACY_BRIDGE}</script><h1>Legacy</h1>`);
});
it('rejects substituted resources, unsupported MIME and oversized interfaces', () => {
  expect(() => prepareResource(resource('x'), 'ui://other/index.html', false)).toThrow('different');
  expect(() => prepareResource(resource('x', {mimeType: 'text/html'}), uri, false)).toThrow('supported');
  expect(() => prepareResource(resource('x'.repeat(12*1024*1024+1)), uri, false)).toThrow('12 MiB');
  expect(() => prepareResource(resource(''), uri, false)).toThrow('empty');
});
it('opens interfaces that declare network domains, and carries the domains to their view', () => {
  // Excalidraw, as its server returns it: its code comes from esm.sh.
  const excalidraw = prepareResource(resource('<div id="root"></div>', {_meta: {ui: {csp: {resourceDomains: ['https://esm.sh'], connectDomains: ['https://esm.sh']}, prefersBorder: true, permissions: {clipboardWrite: {}}}}}), uri, false);
  expect(excalidraw.csp).toEqual({...noNetwork, connectDomains: ['https://esm.sh'], resourceDomains: ['https://esm.sh']});
  // Bits & Bolts' remote build declares its own origin in both specs. Its server runs on this computer (a loopback URL), so it keeps it.
  const ownOrigin = {_meta: {'openai/widgetCSP': {connect_domains: ['http://localhost:3916'], resource_domains: ['http://localhost:3916']},
    ui: {csp: {connectDomains: ['http://localhost:3916'], resourceDomains: ['http://localhost:3916']}}}};
  const remote = prepareResource(resource('<div></div>', ownOrigin), uri, false, {serverIsLocal: true});
  expect(remote.csp).toEqual({...noNetwork, connectDomains: ['http://localhost:3916'], resourceDomains: ['http://localhost:3916']});
  // The same declaration from a server elsewhere reaches nothing on the person's computer, and says what it left out.
  expect(prepareResource(resource('<div></div>', ownOrigin), uri, false).csp).toEqual({...noNetwork, blocked: ['http://localhost:3916']});
  // Todoist's task list names ChatGPT's dedicated origin and no network: it renders on Ri's own sandbox origin.
  const todoist = {ui: {prefersBorder: true, csp: {connectDomains: [], resourceDomains: []}}, 'openai/widgetCSP': {connect_domains: [], resource_domains: []}, 'openai/widgetDomain': 'https://ai.todoist.net'};
  expect(prepareResource(resource('<script>window.list=1</script>', {_meta: todoist}), uri, false).csp).toEqual(noNetwork);
  // Requested permissions are granted by no Ri frame, and don't stop the view.
  expect(prepareResource(resource('<p>Chart</p>', {_meta: {ui: {permissions: {camera: {}}}}}), uri, false).html).toBe('<p>Chart</p>');
});

it('treats only a list of display modes Ri has as declaring them, as OpenAI\'s spec reads an omitted list', () => {
  const modes = (meta: Record<string, unknown>) => prepareResource(resource('<p>x</p>', {_meta: meta}), uri, false).displayModes;
  expect(modes({'openai/ui': {}})).toEqual({available: ['inline', 'fullscreen'], declared: false});
  expect(modes({'openai/ui': {preferredDisplayMode: 'fullscreen'}})).toEqual({available: ['inline', 'fullscreen'], preferred: 'fullscreen', declared: false});
  expect(modes({'openai/ui': {availableDisplayModes: ['pip']}})).toMatchObject({declared: false});
  expect(modes({'openai/ui': {availableDisplayModes: ['inline', 'fullscreen']}})).toMatchObject({declared: true});
  expect(initialDisplayMode(modes({'openai/ui': {}}), modes({'openai/ui': {}}).declared)).toBe('inline');
  expect(initialDisplayMode(modes({'openai/ui': {availableDisplayModes: ['inline', 'fullscreen']}}), true)).toBe('fullscreen');
});
