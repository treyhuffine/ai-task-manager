import { expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { prepareResource, scanInterface, LEGACY_BRIDGE, MAX_HTML_DEPTH } from './resource';
import { initialDisplayMode, viewMetadata } from './metadata';
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

/** The check as it was, on linkedom's whole document, kept to prove the streaming scan reads markup the same way. */
function documentScan(html: string): {refused: boolean; scripts: string[]} {
  const {document} = parseHTML(html);
  for (const el of document.querySelectorAll('[src], link[href], iframe, object, embed, base, meta[http-equiv]')) {
    const url = el.getAttribute('src') ?? el.getAttribute('href');
    if (['IFRAME','OBJECT','EMBED','BASE','LINK'].includes(el.tagName) || (el.tagName === 'SCRIPT' && url) || (url && !url.startsWith('data:')) || el.tagName === 'META')
      return {refused: true, scripts: []};
  }
  return {refused: false, scripts: [...document.querySelectorAll('script')].map(el => el.textContent ?? '')};
}
function streamScan(html: string): {refused: boolean; scripts: string[]} {
  try { return {refused: false, scripts: scanInterface(html)}; }
  catch (error) { if ((error as Error).message.includes('outside its self-contained HTML')) return {refused: true, scripts: []}; throw error; }
}
// Markup that exercises the parser's corners: raw text, foreign content, implied and missing closing tags, entities.
const CORPUS = [
  '<!doctype html><html><head><meta charset="utf-8"><title>A &amp; B</title><style>body{color:red}</style></head><body><div id="root"></div><script type="module">import("./x");const a=1<2&&3>2;</script></body></html>',
  '<script>first()</script><p>text<script>second("</div>")</script>',
  '<script>const s = "&amp; &lt;b&gt;"; // entities stay raw</script>',
  '<script><!-- comment --> code()</script><!-- <script>not()</script> -->',
  '<script>unterminated at end',
  '<svg><script>svgScript()</script><circle r="1"/></svg><script>after()</script>',
  '<svg><script><![CDATA[ cdata() ]]></script></svg>',
  '<svg viewBox="0 0 1 1"><image href="https://img.example/a.png"/><use href="#x"/></svg>',
  '<noscript><script>inNoscript()</script></noscript>',
  '<textarea><script>notScript()</script></textarea><title><script>alsoText()</script></title>',
  '<style><script>styleText()</script></style>',
  '<script/>selfClosing()</script>',
  '<SCRIPT>upper()</SCRIPT><Script type=x>mixed()</Script>',
  '<p>one<p>two<table><tr><td>cell<script>inCell()</script></table>',
  '<ul><li>a<li>b<script>inList()</script></ul>',
  '<img src="data:image/png;base64,AAAA"><img src=""><a href="https://example.com">link</a><img>',
  '<img src="https://img.example/a.png">',
  '<script src="data:text/javascript,1"></script>',
  '<script src=""></script><script>afterEmpty()</script>',
  '<script href="https://x.example/a.js"></script>',
  '<link rel="stylesheet" href="https://x.example/a.css">',
  '<link rel="icon"><script>noHref()</script>',
  '<link src="data:x">',
  '<meta http-equiv="refresh" content="0;url=https://x.example">',
  '<meta name="viewport" content="width=device-width"><script>meta()</script>',
  '<base href="https://x.example/">',
  '<iframe></iframe>', '<object data="x"></object>', '<embed>',
  '<svg><iframe></iframe></svg>',
  '<video src="data:video/mp4;base64,AA"></video><audio src="https://a.example/x.mp3"></audio>',
  '<img src=" data:image/png;base64,AA">',
  '<img src=&quot;https://x.example&quot;>',
  '<div><span><b><i>' + '<script>deep()</script>' + '</i></b></span></div>',
  '<script>a()</script>\n<script>\n  b()\n</script>\n',
  '<math><mi>x</mi><script>math()</script></math>',
  'plain text only',
  '<script type="application/json">{"a":"</scr"+"ipt>"}</script>',
];

it('reads markup exactly as the document-based check did, with the same inline scripts', () => {
  for (const html of CORPUS) expect(streamScan(html), html).toEqual(documentScan(html));
});

it('reads two things more strictly than the document-based check: attribute names in any case, and template contents', () => {
  // A template's scripts run once the app clones them into the page, so they are checked and hashed too.
  expect(documentScan('<template><script>inTemplate()</script></template>')).toEqual({refused: false, scripts: []});
  expect(streamScan('<template><script>inTemplate()</script></template>')).toEqual({refused: false, scripts: ['inTemplate()']});
  expect(streamScan('<template><img src="https://img.example/a.png"></template>').refused).toBe(true);
  // A browser reads attribute names in any case.
  expect(documentScan('<img SRC="https://img.example/a.png">').refused).toBe(false);
  expect(streamScan('<img SRC="https://img.example/a.png">').refused).toBe(true);
  expect(streamScan('<script Src="https://cdn.example/a.js"></script>').refused).toBe(true);
  expect(streamScan('<meta HTTP-EQUIV="refresh">').refused).toBe(true);
});

it('checks a 12 MiB interface in a fraction of a second however it nests', () => {
  const MiB = 1024 * 1024;
  const timed = (html: string) => { const start = performance.now(); try { prepareResource(resource(html), uri, false); } catch { /* refused is fine */ } return performance.now() - start; };
  // Nesting this deep took minutes on a whole document.
  expect(() => prepareResource(resource('<div>'.repeat(Math.floor(12 * MiB / 5))), uri, false)).toThrow(`more than ${MAX_HTML_DEPTH} levels`);
  expect(timed('<div>'.repeat(Math.floor(12 * MiB / 5)))).toBeLessThan(250);
  // Unmatched closing tags at the deepest allowed level, the parser's slowest path.
  expect(() => prepareResource(resource('<b>'.repeat(MAX_HTML_DEPTH - 1) + '</x>'.repeat(3 * MiB - MAX_HTML_DEPTH)), uri, false)).toThrow('tags');
  expect(timed('<b>'.repeat(MAX_HTML_DEPTH - 1) + '</x>'.repeat(3 * MiB - MAX_HTML_DEPTH))).toBeLessThan(500);
  // A flat 12 MiB page of elements, and one of text.
  expect(timed('<i></i>'.repeat(Math.floor(12 * MiB / 7)))).toBeLessThan(500);
  expect(prepareResource(resource(`<script>${'a<b;'.repeat(3 * MiB - 10)}</script>`), uri, false).scriptHashes).toHaveLength(1);
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
