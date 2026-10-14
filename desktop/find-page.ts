import { localPageBase, type LocalPageStyleOptions } from './local-page-style';

const icon = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** The find bar: a search box, where the search stands, Previous, Next and Close.
 * It floats over the top right of the page it searches, where a browser puts its own,
 * on a transparent view with room for its shadow (desktop/find-bar.ts). */
export function findBarPage(nonce: string, options: LocalPageStyleOptions = {}) {
  const base = localPageBase(nonce, options);
  return `<!doctype html><html ${base.attributes} data-ri-local-view="find"><head><meta charset="utf-8"><title>Find</title>${base.meta}
<style nonce="${nonce}">${base.css}
html,body{margin:0;height:100%;overflow:hidden;background:transparent}
body{padding:6px 8px 10px;font:13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
form{display:flex;align-items:center;gap:2px;height:40px;margin:0;padding:0 5px 0 12px;background:var(--popover,Canvas);color:var(--popover-foreground,CanvasText);border:1px solid var(--border,ButtonBorder);border-radius:calc(var(--radius,.75rem) - 2px);box-shadow:0 4px 14px rgb(0 0 0/.14),0 1px 3px rgb(0 0 0/.08)}
input{flex:1;min-width:0;height:28px;margin:0;padding:0;border:0;outline:0;background:transparent;color:inherit;font:inherit}
input::placeholder{color:var(--muted-foreground,GrayText)}
output{flex:none;padding:0 6px;font-size:12px;color:var(--muted-foreground,GrayText);font-variant-numeric:tabular-nums;white-space:nowrap;user-select:none}
output:empty{display:none}
.divider{flex:none;width:1px;height:18px;margin:0 3px;background:var(--border,ButtonBorder)}
button{flex:none;display:grid;place-items:center;width:28px;height:28px;margin:0;padding:0;border:0;border-radius:calc(var(--radius,.75rem) - 6px);background:transparent;color:var(--muted-foreground,GrayText)}
button:hover:not(:disabled){background:var(--accent,ButtonFace);color:var(--accent-foreground,ButtonText)}
button:disabled{opacity:.4}
button:focus-visible{outline:2px solid var(--ring,Highlight);outline-offset:-2px}
svg{width:16px;height:16px}
</style></head><body>
<form id="find" role="search" aria-label="Find in page">
<input id="query" type="text" placeholder="Find in page" aria-label="Find in page" autocomplete="off" spellcheck="false">
<output id="count" for="query" aria-live="polite"></output>
<span class="divider" aria-hidden="true"></span>
<button type="button" id="previous" aria-label="Previous match" disabled>${icon('<path d="m18 15-6-6-6 6"/>')}</button>
<button type="button" id="next" aria-label="Next match" disabled>${icon('<path d="m6 9 6 6 6-6"/>')}</button>
<button type="button" id="close" aria-label="Close find bar">${icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')}</button>
</form>
<script nonce="${nonce}">${base.script}
(()=>{const find=window.riFind;if(!find)return;
const form=document.getElementById('find'),input=document.getElementById('query'),count=document.getElementById('count'),previous=document.getElementById('previous'),next=document.getElementById('next'),close=document.getElementById('close');
const sync=()=>{previous.disabled=next.disabled=!input.value;};
const step=forward=>{if(input.value)forward?find.next():find.previous();};
form.addEventListener('submit',event=>event.preventDefault());
input.addEventListener('input',()=>{sync();if(!input.value)count.textContent='';find.query(input.value);});
document.addEventListener('keydown',event=>{
if(event.key==='Escape'){event.preventDefault();find.close();}
else if(event.target===input&&event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();step(!event.shiftKey);}
else if(event.key==='F3'){event.preventDefault();step(!event.shiftKey);}
});
// The buttons act without taking focus, so typing carries on in the box.
for(const button of [previous,next,close])button.addEventListener('mousedown',event=>event.preventDefault());
previous.addEventListener('click',()=>step(false));
next.addEventListener('click',()=>step(true));
close.addEventListener('click',()=>find.close());
find.onOpen(query=>{if(query!==input.value)input.value=query;sync();input.focus();input.select();});
find.onResult(label=>{count.textContent=label;});
})();</script></body></html>`;
}
