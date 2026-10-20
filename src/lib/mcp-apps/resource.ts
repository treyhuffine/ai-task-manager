import { createHash } from 'node:crypto';
import { declaredCsp } from '@ri/mcp-apps-host/csp';
import { declaresDisplayModes, resourceDisplayModes } from './metadata';

/** The largest interface Ri takes, before the legacy bridge is added. */
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

/**
 * An app's UI resource, ready for a view. Ri doesn't read the markup: the
 * view runs in an opaque, sandboxed frame, which is what keeps it apart from
 * Ri, and its network is only the domains its `_meta` declares (`csp`, see
 * `@ri/mcp-apps-host/csp`), less local addresses for an app whose server
 * isn't on this computer (`serverIsLocal`). A dedicated origin (`ui.domain`, ChatGPT's
 * `openai/widgetDomain`) is host-specific, so the view renders on Ri's own
 * sandbox origin. Requested permissions (camera, microphone, geolocation,
 * clipboard write) are requests a host may decline, and Ri grants none.
 */
export function prepareResource(result: unknown, uri: string, legacy: boolean, options: { serverIsLocal?: boolean } = {}) {
  const contents = (result as {contents?: {uri?: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown>}[]})?.contents;
  if (!Array.isArray(contents) || contents.length !== 1 || contents[0].uri !== uri) throw new Error('The app returned a different UI resource');
  const resource = contents[0];
  if (resource.mimeType !== 'text/html;profile=mcp-app' && !(legacy && resource.mimeType === 'text/html+skybridge')) throw new Error('This app does not provide a supported MCP interface');
  const html = resource.text ?? (resource.blob ? Buffer.from(resource.blob, 'base64').toString('utf8') : '');
  if (!html || Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('This app interface is empty or exceeds 12 MiB');
  const prepared = legacy ? `<script>${LEGACY_BRIDGE}</script>${html}` : html;
  // OpenAI's display modes ride on the content item, so Ri can choose one before the app initializes.
  // A remote app's screen never reaches the person's local network, whatever it declares (`declaredCsp`).
  return { html: prepared, csp: declaredCsp(resource._meta, options), digest: digest(prepared),
    displayModes: { ...resourceDisplayModes(resource._meta), declared: declaresDisplayModes(resource._meta) } };
}
