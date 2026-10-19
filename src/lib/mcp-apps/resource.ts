import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { resourceDisplayModes } from './metadata';

export const MAX_HTML_BYTES = 12 * 1024 * 1024;
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
  const {document} = parseHTML(html);
  for (const el of document.querySelectorAll('[src], link[href], iframe, object, embed, base, meta[http-equiv]')) {
    const url = el.getAttribute('src') ?? el.getAttribute('href');
    if (['IFRAME','OBJECT','EMBED','BASE','LINK'].includes(el.tagName) || (el.tagName === 'SCRIPT' && url) || (url && !url.startsWith('data:')) || el.tagName === 'META')
      throw new Error('This interface requires resources outside its self-contained HTML. Its tools and text results remain available.');
  }
  const scripts = [...document.querySelectorAll('script')].map(el => el.textContent ?? '');
  const prepared = legacy ? `<script>${LEGACY_BRIDGE}</script>${html}` : html;
  const scriptHashes = [...(legacy ? [LEGACY_BRIDGE] : []), ...scripts].map(script => `'sha256-${createHash('sha256').update(script).digest('base64')}'`);
  if (Buffer.byteLength(prepared) > MAX_HTML_BYTES) throw new Error('The prepared app interface exceeds 12 MiB');
  // OpenAI's display modes ride on the content item, so Ri can choose one before the app initializes.
  const declared = !!resource._meta && typeof resource._meta['openai/ui'] === 'object' && resource._meta['openai/ui'] !== null;
  return { html: prepared, scriptHashes, digest: digest(prepared), displayModes: { ...resourceDisplayModes(resource._meta), declared } };
}
