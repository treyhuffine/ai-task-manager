import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';
import { declaresDisplayModes, resourceDisplayModes } from './metadata';

export const MAX_HTML_BYTES = 12 * 1024 * 1024;
/**
 * How deeply an interface's elements may nest, and how many tags (opening
 * and closing) it may hold, for Ri to check it. Real interfaces are far
 * inside both: Bits & Bolts' 1.1 MB app nests 11 deep with 107 elements.
 * The parser's work per closing tag grows with depth, so both caps together
 * keep the worst 12 MiB interface to a fraction of a second.
 */
export const MAX_HTML_DEPTH = 256;
export const MAX_HTML_TAGS = 200_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// Compatibility is an adapter into the same MCP bridge, not another privileged host.
export const LEGACY_BRIDGE = `(()=>{
  let seq=0;const pending=new Map();const state={toolInput:{},toolOutput:null,toolResponseMetadata:{},widgetState:null,theme:'light',displayMode:'inline',maxHeight:900,locale:navigator.language};
const request=(method,params)=>new Promise((resolve,reject)=>{const id='openai-'+(++seq);pending.set(id,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');setTimeout(()=>{const p=pending.get(id);if(p){pending.delete(id);p.reject(new Error('The app request timed out'))}},60000)});
const notify=(method,params)=>parent.postMessage({jsonrpc:'2.0',method,params},'*');
const changed=()=>dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{...state}}}));
const api={...state,callTool:async(name,args)=>{const r=await request('tools/call',{name,arguments:args});return r},setWidgetState:value=>{state.widgetState=value;api.widgetState=value;return request('ui/update-model-context',{content:[{type:'text',text:JSON.stringify(value)}]})},sendFollowUpMessage:({prompt})=>request('ui/message',{role:'user',content:[{type:'text',text:prompt}]}),requestDisplayMode:({mode})=>request('ui/request-display-mode',{mode}),openExternal:({href})=>request('ui/open-link',{url:href}),notifyIntrinsicHeight:height=>notify('ui/notifications/size-changed',{height})};
Object.defineProperty(window,'openai',{value:api,writable:false});
addEventListener('message',e=>{if(e.source!==parent||e.data?.jsonrpc!=='2.0')return;const m=e.data;if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return}if(m.method==='ui/notifications/tool-input')state.toolInput=m.params.arguments;if(m.method==='ui/notifications/tool-result'){state.toolOutput=m.params.structuredContent??null;state.toolResponseMetadata=m.params._meta??{}}if(m.method==='ui/notifications/host-context-changed')Object.assign(state,m.params);if(m.method==='ri/view-state')state.widgetState=m.params.widgetState;Object.assign(api,state);changed()});
request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'OpenAI-compatible view',version:'1.0.0'},appCapabilities:{}}).then(r=>{Object.assign(state,r.hostContext);Object.assign(api,state);changed();notify('ui/notifications/initialized',{})});
addEventListener('DOMContentLoaded',()=>new ResizeObserver(()=>notify('ui/notifications/size-changed',{height:document.documentElement.scrollHeight})).observe(document.body));
})()`;

export function prepareResource(result: unknown, uri: string, legacy: boolean) {
  const contents = (result as {contents?: {uri?: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown>}[]})?.contents;
  if (!Array.isArray(contents) || contents.length !== 1 || contents[0].uri !== uri) throw new Error('The app returned a different UI resource');
  const resource = contents[0];
  if (resource.mimeType !== 'text/html;profile=mcp-app' && !(legacy && resource.mimeType === 'text/html+skybridge')) throw new Error('This app does not provide a supported MCP interface');
  const html = resource.text ?? (resource.blob ? Buffer.from(resource.blob, 'base64').toString('utf8') : '');
  if (!html || Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('This app interface is empty or exceeds 12 MiB');
  const ui = resource._meta?.ui as {csp?: Record<string, unknown>} | undefined;
  const csp = ui?.csp ?? resource._meta?.['openai/widgetCSP'] as Record<string, unknown> | undefined;
  // Only network domains refuse a view. A dedicated origin (`ui.domain`, ChatGPT's `openai/widgetDomain`)
  // is host-specific and matters only for network uses (OAuth callbacks, CORS, API key allowlists), which
  // the declared domains already rule out, so the view renders on Ri's own sandbox origin. Requested
  // permissions (camera, microphone, geolocation, clipboard write) are requests a host MAY grant, and apps
  // SHOULD NOT assume them, so Ri renders the view and grants none. Todoist's task list names ChatGPT's
  // domain, and Microsoft Flint's chart asks for clipboard write. Both are otherwise self-contained.
  if (csp && Object.values(csp).some(value => Array.isArray(value) && value.length))
    throw new Error('This interface needs external network access. Ri currently supports self-contained MCP interfaces. Its tools and text results remain available.');
  const scripts = scanInterface(html);
  const prepared = legacy ? `<script>${LEGACY_BRIDGE}</script>${html}` : html;
  const scriptHashes = [...(legacy ? [LEGACY_BRIDGE] : []), ...scripts].map(script => `'sha256-${createHash('sha256').update(script).digest('base64')}'`);
  if (Buffer.byteLength(prepared) > MAX_HTML_BYTES) throw new Error('The prepared app interface exceeds 12 MiB');
  // OpenAI's display modes ride on the content item, so Ri can choose one before the app initializes.
  return { html: prepared, scriptHashes, digest: digest(prepared), displayModes: { ...resourceDisplayModes(resource._meta), declared: declaresDisplayModes(resource._meta) } };
}

const EXTERNAL = 'This interface requires resources outside its self-contained HTML. Its tools and text results remain available.';
/**
 * Check an interface is self-contained and return its inline scripts' text,
 * in document order, for the CSP hashes. It streams the markup through the
 * same parser the HTML was always read with (htmlparser2, as linkedom uses
 * it) without building a document, so the work grows with the markup's size,
 * not with how it nests.
 *
 * Refused, as before: an iframe, object, embed, base or link with an `href`,
 * a script with a `src` or `href`, a `meta` with `http-equiv`, and any `src`
 * (or a matched element's `href`) that is not a `data:` URL. Attribute names
 * are matched in any case, as a browser reads them.
 */
export function scanInterface(html: string): string[] {
  const scripts: string[] = [];
  /** Indexes into `scripts` of the script elements still open: each takes all text inside it. */
  const open: number[] = [];
  /** Per open element, whether it is a script, so closing it ends that script's text. */
  const elements: boolean[] = [];
  let tags = 0;
  const counted = () => { if (++tags > MAX_HTML_TAGS) throw new InterfaceTooLarge(`This app interface has more than ${MAX_HTML_TAGS.toLocaleString('en-US')} tags, more than Ri can check. Its tools and text results remain available.`); };
  class Scanner extends Parser {
    // Every closing tag in the source, matched or not, costs the parser a look through its open elements.
    override onclosetag(start: number, endIndex: number) { counted(); super.onclosetag(start, endIndex); }
  }
  const parser = new Scanner({
    onopentag(name, attributes) {
      counted();
      if (elements.length >= MAX_HTML_DEPTH) throw new InterfaceTooLarge(`This app interface nests more than ${MAX_HTML_DEPTH} levels deep, more than Ri can check. Its tools and text results remain available.`);
      const tag = name.toUpperCase();
      const src = attributes.src, href = attributes.href, url = src ?? href;
      const matched = src !== undefined || ['IFRAME', 'OBJECT', 'EMBED', 'BASE'].includes(tag) || (tag === 'LINK' && href !== undefined) || (tag === 'META' && attributes['http-equiv'] !== undefined);
      if (matched && (['IFRAME', 'OBJECT', 'EMBED', 'BASE', 'LINK', 'META'].includes(tag) || (tag === 'SCRIPT' && url) || (url && !url.startsWith('data:'))))
        throw new Error(EXTERNAL);
      const script = tag === 'SCRIPT';
      if (script) { open.push(scripts.length); scripts.push(''); }
      elements.push(script);
    },
    ontext(text) { for (const index of open) scripts[index] += text; },
    onclosetag() { if (elements.pop()) open.pop(); },
  }, { lowerCaseAttributeNames: true, decodeEntities: true, xmlMode: false });
  parser.write(html);
  parser.end();
  return scripts;
}
class InterfaceTooLarge extends Error {}
