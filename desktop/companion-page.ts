/** Trusted local content. Never interpolate remote names, credentials or errors. */
export function companionPage(nonce: string) {
  if (!/^[a-zA-Z0-9]+$/.test(nonce)) throw new Error('Invalid page nonce');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Ri on this device</title>
<style nonce="${nonce}">
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#181a18;color:#f5f2ea;font:14px/1.6 system-ui;padding:32px;max-width:720px;margin:auto}h1{font-size:26px;margin:0}h2{font-size:17px;margin:0 0 8px}p{color:#bdc5bb;margin:8px 0}section{border:1px solid #434a40;border-radius:12px;padding:20px;margin-top:20px}button,input{font:inherit}button{background:#e3ead9;color:#20261e;border:0;border-radius:6px;padding:9px 13px;cursor:pointer}button.secondary{background:#333b30;color:#f5f2ea}button:disabled{opacity:.45;cursor:default}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}label{display:block;margin-top:12px}input[type=url],input[type=text]{width:100%;padding:9px;background:#242b22;border:1px solid #5c6757;color:inherit;border-radius:5px}input[type=checkbox]{margin-right:8px}#error{color:#ffb7ad;white-space:pre-wrap}#status{font-weight:600}small{color:#bdc5bb}button:focus-visible,input:focus-visible{outline:3px solid #b9d998;outline-offset:3px}[hidden]{display:none!important}
</style></head><body>
<h1>Ri on this device</h1><p id="intro">Choose where your work lives. Every device opens the same Ri.</p>
<p id="error" role="alert"></p><p id="status" role="status" aria-live="polite">Checking this device…</p>
<section id="create" hidden><h2>Make this your Home</h2><p>This device stores your tasks, notes and conversations. Keep it awake to reach Ri from your phone and other devices.</p><button id="create-home">Use this device as Home</button></section>
<section id="connect" hidden><h2 id="connect-title">Connect to your Home</h2><p>On your Home, open Settings, Devices and create a pairing link for this computer.</p>
<label for="pairing">Pairing link</label><input id="pairing" type="url" autocomplete="off" spellcheck="false" placeholder="https://your-home/…">
<label id="run-work-label"><input id="run-work" type="checkbox">Run agents on this device using its folders and tools</label>
<p>You can also use this computer only to view and manage work on your Home.</p><div class="actions"><button id="connect-home">Connect</button></div></section>
<section id="device" hidden><h2 id="home-name">Your Home</h2><p id="worker-status"></p><p id="worker-reason"></p>
<div class="actions"><button id="open">Open Ri</button><button id="reconnect" class="secondary" hidden>Update Home connection</button><button id="enable-worker" class="secondary" hidden>Enable local execution</button><button id="stop-worker" class="secondary" hidden>Stop local execution</button><button id="resume-worker" class="secondary" hidden>Resume local execution</button></div>
<label><input id="login" type="checkbox">Start this device's background service when I log in</label><p id="login-detail"></p>
<p>Closing or quitting the Ri window leaves the background service running. A sleeping device cannot run work.</p></section>
<section id="notifications" hidden><h2>Notifications on this device</h2><label><input id="native-notifications" type="checkbox">Show native notifications from your Home</label><p id="notification-detail"></p><button id="notification-test" class="secondary">Send test notification</button><p>Ri uses the same notification pipeline as your other destinations. Keep Ri open in the menu bar to receive native alerts.</p></section>
<section id="preferences" hidden><h2>Desktop preferences</h2><label><input id="desktop-login" type="checkbox">Open Ri quietly at login for notifications and Quick Capture</label><p id="desktop-login-detail"></p>
<label><input id="capture-enabled" type="checkbox">Enable a global Quick Capture shortcut</label><label for="capture-shortcut">Shortcut</label><input id="capture-shortcut" type="text" autocomplete="off" spellcheck="false" placeholder="CommandOrControl+Shift+Space"><p id="capture-detail"></p><button id="capture-save" class="secondary">Save shortcut</button></section>
<section id="updates" hidden><h2>Updates on this device</h2><p id="version"></p><p id="update-status"></p><div class="actions"><button id="update-check" class="secondary">Check for updates</button><button id="update-download" class="secondary" hidden>Download update</button><button id="update-apply" class="secondary" hidden>Update when idle</button><button id="update-later" class="secondary" hidden>Later</button></div><p>Local updates wait for a safe time. Updating this viewer does not restart your remote Home.</p></section>
<div class="actions"><button id="refresh" class="secondary">Refresh</button><button id="recovery" class="secondary">Existing installation and recovery</button></div>
<script nonce="${nonce}">
const $=id=>document.getElementById(id);let busy=false;let editingConnection=false;let captureEdited=false;
async function call(action,value){const result=await window.riCompanion.request(action,value);if(result.error)throw new Error(result.error);return result;}
async function refresh(){const s=await call('status');const role=s.role;const connected=role==='worker'||role==='viewer';
 $('create').hidden=role!=='first-run';$('connect').hidden=!['first-run','retired'].includes(role)&&!editingConnection;$('connect-title').textContent=connected?'Update Home connection':'Connect to your Home';$('run-work-label').hidden=connected;$('reconnect').hidden=!connected;$('device').hidden=!['home','worker','viewer'].includes(role);$('updates').hidden=!s.service;
 $('status').textContent=role==='first-run'?'Welcome to Ri':role==='home'?'This device is your Home':connected?'Connected to '+(s.home?.name||'your Home'):s.reason||'This installation needs attention';
 $('home-name').textContent=connected?s.home?.name||'Your Home':'Your Home is here';
 $('worker-status').textContent=role==='home'?'Your Home runs here.':role==='viewer'?'Viewing your Home. Local execution is off.':'Local execution: '+(s.worker?.state||'starting');
 $('worker-reason').textContent=s.connectionError||s.worker?.error||s.worker?.reason||s.service?.error||'';
 $('enable-worker').hidden=role!=='viewer';$('stop-worker').hidden=role!=='worker'||s.worker?.enabled===false;$('resume-worker').hidden=role!=='worker'||s.worker?.enabled!==false;
 $('login').checked=!!s.login?.enabled;$('login').disabled=!s.service;$('login-detail').textContent=s.login?.detail||'Service startup begins after login. Keep your Home awake for access from other devices.';
 const prefs=s.preferences;$('preferences').hidden=!prefs;if(prefs){$('desktop-login').checked=prefs.login.enabled;$('desktop-login').disabled=!prefs.login.supported;$('desktop-login-detail').textContent=prefs.login.detail||'This opens the menu bar app independently of the background service.';if(!captureEdited){$('capture-enabled').checked=prefs.shortcut.enabled;$('capture-shortcut').value=prefs.shortcut.accelerator;}$('capture-detail').textContent=prefs.shortcut.detail||('Shortcut '+prefs.shortcut.state);}
 $('version').textContent='Desktop '+s.desktop+(s.service?.version?' · Runtime '+s.service.version:'');
 $('notifications').hidden=!s.notifications;$('native-notifications').checked=!!s.notifications?.enabled;$('notification-detail').textContent=s.notifications?.error||'Only this device can enable native presentation here.';
 const u=s.update;$('update-status').textContent=u?.reason||u?.error||(u?'Update '+u.phase:'No pending update');
 $('update-download').hidden=u?.phase!=='available';$('update-apply').hidden=!['ready','waiting'].includes(u?.phase);$('update-later').hidden=!u||['idle','committed'].includes(u.phase);
}
async function run(fn){if(busy)return;busy=true;$('error').textContent='';document.querySelectorAll('button,input').forEach(e=>e.disabled=true);try{await fn();}catch(e){$('error').textContent=e.message;}finally{busy=false;document.querySelectorAll('button,input').forEach(e=>e.disabled=false);await refresh().catch(()=>{});}}
$('create-home').onclick=()=>run(async()=>{await call('create-home');await refresh();});
$('connect-home').onclick=()=>run(async()=>{await call('connect',{pairingLink:$('pairing').value,runWork:!$('run-work-label').hidden&&$('run-work').checked});$('pairing').value='';editingConnection=false;await refresh();});
['open','stop-worker','resume-worker','recovery','update-check','update-download','update-apply','update-later','notification-test'].forEach(id=>$(id).onclick=()=>run(async()=>{await call(id);await refresh();}));
$('enable-worker').onclick=()=>run(async()=>{await call('enable-worker');await refresh();});
$('login').onchange=()=>run(async()=>{await call('login',{enabled:$('login').checked});await refresh();});
$('native-notifications').onchange=()=>run(async()=>{await call($('native-notifications').checked?'notification-enable':'notification-disable');await refresh();});
$('desktop-login').onchange=()=>run(async()=>{await call('preferences',{type:'login',enabled:$('desktop-login').checked});await refresh();});
['capture-enabled','capture-shortcut'].forEach(id=>$(id).oninput=()=>{captureEdited=true;});
$('capture-save').onclick=()=>run(async()=>{await call('preferences',{type:'shortcut',enabled:$('capture-enabled').checked,accelerator:$('capture-shortcut').value});captureEdited=false;await refresh();});
$('reconnect').onclick=()=>{editingConnection=true;$('connect').hidden=false;$('pairing').focus();};
$('refresh').onclick=()=>run(refresh);run(refresh);setInterval(()=>{if(!busy)refresh().catch(()=>{});},5000);
</script></body></html>`;
}
