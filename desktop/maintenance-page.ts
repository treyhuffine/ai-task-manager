import { localPageStyle, type LocalPageStyleOptions } from './local-page-style';

export interface MaintenancePageOptions extends LocalPageStyleOptions { chooseInstallation?: boolean }

/** Static, local-only UI. All runtime values are assigned with textContent. */
export function maintenancePage(nonce: string, options: MaintenancePageOptions = {}) {
  const style = localPageStyle(nonce, options);
  return `<!doctype html><html ${style.attributes} data-ri-local-view="maintenance"><head><meta charset="utf-8">
${style.head}<title>Ri</title></head><body>${style.chrome}<main class="maintenance">
${style.brand}<button id="back" class="link">‹ Back</button>
<h1>Local installation</h1><p>Manage this computer’s service or choose an existing Ri.</p>
<p id="error" role="alert"></p>
<section aria-labelledby="service-title"><h2 id="service-title">Service and recovery</h2>
<p id="status" role="status" aria-live="polite">Checking the service…</p><p id="reason"></p><details><summary>Current installation details</summary><pre id="details"></pre></details>
<div class="actions"><button id="retry">Connect or retry startup</button><button id="recover" class="secondary" hidden>Recover service</button><button id="refresh" class="secondary">Refresh status</button><button id="logs" class="secondary">Open log folder</button><button id="copy" class="secondary">Copy diagnostics</button></div>
<p>Recovery follows the saved update record. A version that already accepted new writes is never silently rolled back.</p></section>
<section aria-labelledby="installation-title"><details id="choose-installation"${options.chooseInstallation ? ' open' : ''}><summary id="installation-title">Choose an existing installation</summary>
<p>Select the same data folder used by your CLI. Advanced paths must match that installation. Switching restarts only this desktop window. Existing background services keep running.</p>
<label for="root">Data folder</label><div class="field"><input id="root" autocomplete="off" spellcheck="false"><button class="secondary" data-browse="root">Choose…</button></div>
<details><summary>Separate database, configuration or work folders</summary>
<label for="database">Database file</label><div class="field"><input id="database" autocomplete="off" spellcheck="false" placeholder="Default inside data folder"><button class="secondary" data-browse="database">Choose…</button></div>
<label for="config">Configuration folder</label><div class="field"><input id="config" autocomplete="off" spellcheck="false" placeholder="Default inside data folder"><button class="secondary" data-browse="config">Choose…</button></div>
<label for="work">Work folder</label><div class="field"><input id="work" autocomplete="off" spellcheck="false" placeholder="Default inside data folder"><button class="secondary" data-browse="work">Choose…</button></div></details>
<div class="actions"><button id="inspect" class="secondary">Verify installation</button><button id="use" disabled>Use verified installation</button><button id="default" class="secondary">Use default desktop installation</button></div>
<pre id="inspection" hidden></pre><p>No files are moved or merged. A stopped installation requiring migrations must first use its matching service and verified update flow.</p></details></section>
</main><script nonce="${nonce}">
${style.script}
const byId = id => document.getElementById(id);
let verified = false;
let busy = false;
let current;
const fields = ['root','database','config','work'];
const values = () => Object.fromEntries(fields.map(key => [key,byId(key).value]));
function invalidate(){verified=false;byId('use').disabled=true;byId('inspection').hidden=true;}
fields.forEach(key=>byId(key).addEventListener('input',()=>{invalidate();if(key==='root')fields.slice(1).forEach(k=>byId(k).value='');}));
async function call(action,value){const result=await window.riMaintenance.request(action,value);if(result.error)throw new Error(result.error);return result;}
async function refresh(fill=false){
 const value=await call('status');current=value;
 byId('status').textContent=value.phase==='running'?'Service running':value.phase==='failed'?'Service needs attention':value.phase==='stopped'?'Service stopped':'Service '+value.phase;
 byId('reason').textContent=value.failure||value.update?.reason||value.update?.error||'';
 byId('details').textContent=['Data: '+value.identity.root,'Database: '+value.identity.database,'Configuration: '+value.identity.config,'Work: '+value.identity.work,...(value.version?['Version: '+value.version]:[]),...(value.update?['Update: '+value.update.phase]:[])].join('\\n');
 byId('recover').hidden=value.phase!=='failed';
 if(fill){fields.forEach(key=>byId(key).value=value.identity[key]);}
}
async function run(fn,quiet=false){if(busy)return;busy=true;if(!quiet)byId('error').textContent='';document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(error){byId('error').textContent=error.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);byId('use').disabled=!verified;}}
byId('back').onclick=()=>run(()=>call('back'));
byId('refresh').onclick=()=>run(()=>refresh());
byId('retry').onclick=()=>run(async()=>{await call('retry');await refresh();});
byId('recover').onclick=()=>run(async()=>{await call('recover');await refresh();});
byId('logs').onclick=()=>run(()=>call('logs'));
byId('copy').onclick=()=>run(()=>call('copy'));
byId('inspect').onclick=()=>run(async()=>{invalidate();const result=await call('inspect',values());byId('inspection').hidden=false;byId('inspection').textContent=[result.canUse?'Ready to connect':'This installation needs attention',result.reason||'', 'Data: '+result.identity.root,'Database: '+result.identity.database,'Configuration: '+result.identity.config,'Work: '+result.identity.work].filter(Boolean).join('\\n');verified=result.canUse;});
byId('use').onclick=()=>run(()=>call('use',values()));
byId('default').onclick=()=>run(()=>call('default'));
document.querySelectorAll('[data-browse]').forEach(button=>button.onclick=()=>run(async()=>{const key=button.dataset.browse;const result=await call('browse',key);if(result.path){byId(key).value=result.path;invalidate();if(key==='root')fields.slice(1).forEach(k=>byId(k).value='');}}));
run(()=>refresh(true));
setInterval(()=>{if(!busy)run(()=>refresh(),true);},5000);
</script></body></html>`;
}
