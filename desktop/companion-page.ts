export interface CompanionPageOptions {
  view?: 'auto' | 'settings' | 'connect' | 'help';
  logoDataUrl?: string;
}

/** Trusted local UI. Dynamic values are rendered as text, never HTML. */
export function companionPage(nonce: string, options: CompanionPageOptions = {}) {
  if (!/^[a-zA-Z0-9]+$/.test(nonce)) throw new Error('Invalid page nonce');
  const view = options.view ?? 'auto';
  if (!['auto', 'settings', 'connect', 'help'].includes(view)) throw new Error('Invalid companion view');
  const logo = options.logoDataUrl;
  if (logo && (logo.length > 200_000 || !/^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo))) throw new Error('Invalid logo image');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Ri on this device</title>
<style nonce="${nonce}">
:root{color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#181a18;color:#f5f2ea;font:14px/1.6 system-ui;-webkit-font-smoothing:antialiased}main{max-width:620px;margin:auto;padding:40px 36px 28px}.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px;font-weight:650;font-size:19px}.brand img{width:32px;height:32px}h1{font-size:29px;line-height:1.2;font-weight:600;letter-spacing:-.6px;margin:0 0 12px}h2{font-size:17px;line-height:1.4;margin:0 0 8px}p{color:#bdc5bb;margin:8px 0 16px}button,input{font:inherit}button{border:1px solid transparent;border-radius:8px;background:#e3ead9;color:#20261e;padding:11px 16px;cursor:pointer;font-weight:550}button.secondary{background:transparent;border-color:#50574c;color:#f5f2ea}button.link{border:0;background:none;color:#bdc5bb;padding:5px 0;font-size:13px;font-weight:400;text-decoration:underline;text-underline-offset:4px}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #b9d998;outline-offset:4px}.choices{display:grid;gap:10px;margin:24px 0 18px}.choices button{text-align:center}.hint{font-size:13px;line-height:1.6}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}label{display:block;margin-top:14px}input[type=url],input[type=text]{display:block;width:100%;padding:11px 12px;margin-top:7px;background:#22271f;border:1px solid #50574c;border-radius:7px;color:inherit}input[type=checkbox]{margin:4px 10px 0 0;accent-color:#b9d998}.check{display:flex;align-items:flex-start;line-height:1.5}.check span{flex:1}.card{border:1px solid #434a40;border-radius:12px;padding:20px;margin:24px 0}.card p:last-child{margin-bottom:0}.help p{margin-bottom:18px}.help h2{margin-top:24px}.help ol{color:#bdc5bb;padding-left:22px}.help li{padding:3px 0}details{border-top:1px solid #343b30;padding:16px 0}summary{cursor:pointer;font-weight:550}details>p:first-of-type{margin-top:12px}.nested{border-top:0;padding:8px 0 0}.nested summary{font-size:13px;color:#bdc5bb;font-weight:400}.nested p{font-size:12px;overflow-wrap:anywhere}.footer{margin-top:26px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}#back{margin:0 0 20px;text-decoration:none}#error{color:#ffb7ad;white-space:pre-wrap;overflow-wrap:anywhere}#error:empty{display:none}#status{font-weight:550;margin:0 0 8px}#connection-message,#worker-reason{overflow-wrap:anywhere}#progress{color:#bdc5bb}#detected{padding:16px;background:#20261e}.muted{color:#bdc5bb}.compact{margin-top:12px}@media(max-width:540px){main{padding:30px 24px}h1{font-size:27px}}
</style></head><body><main>
<div class="brand">${logo ? `<img src="${logo}" alt="">` : ''}<span>Ri</span></div>
<button id="back" class="link" hidden>‹ Back</button>
<h1 id="heading">Welcome to Ri</h1><p id="intro">A place for your tasks, notes and conversations.</p>
<p id="error" role="alert"></p><p id="progress" role="status" hidden></p>
<section id="starting" hidden><p id="startup-status" role="status" aria-live="polite">Starting Ri…</p><p>Your Ri will open as soon as it is ready.</p></section>
<section id="welcome" hidden>
  <div id="detected" class="card" hidden><h2>Ri is already set up on this computer</h2><p id="detected-description" class="hint">You can open the Ri you already use here.</p><button id="use-detected" class="secondary" hidden>Use existing Ri on this computer</button><button id="detected-recovery" class="link" hidden>Review this installation</button><details class="nested"><summary>Installation details</summary><p id="detected-details"></p></details></div>
  <p>Keep your data and run your agents on this computer. You can reach the same Ri from your other devices.</p>
  <div class="choices"><button id="create-home">Start a new Ri</button><button id="choose-connect" class="secondary">Connect to an existing remote Ri</button></div>
  <p class="hint">Already use Ri on another computer? Connect to it to pick up where you left off.</p>
</section>
<section id="connect" hidden>
  <p>On the computer where your Ri lives, open Settings, then Devices, and create a pairing link for this computer.</p>
  <label for="pairing">Pairing link</label><input id="pairing" type="url" autocomplete="off" spellcheck="false" placeholder="https://your-ri/…">
  <div id="run-work-label" class="card"><label class="check"><input id="run-work" type="checkbox"><span>Run agents on this computer</span></label><p class="hint">Let your Ri run work in the agent folders you set up here, using this computer’s tools and sign-ins. You can enable this later.</p></div>
  <p class="hint">Your tasks, notes and conversations stay on the other computer. You can view and manage them here without enabling local agents.</p>
  <div class="actions"><button id="connect-home">Connect</button></div>
</section>
<section id="device" hidden>
  <p id="status" role="status" aria-live="polite"></p><p id="connection-message"></p><p id="home-name" class="hint"></p>
  <div class="actions"><button id="open">Open Ri</button><button id="reconnect" class="secondary" hidden>Change connection</button></div><details id="connection-details" class="nested" hidden><summary>Connection details</summary><p id="connection-error"></p></details>
</section>
<section id="settings" hidden>
  <details id="execution" hidden><summary>Agents on this computer</summary><p id="worker-status"></p><p id="worker-reason"></p><p class="hint">Local agents use the folders, tools and sign-ins on this computer.</p><div class="actions"><button id="enable-worker" class="secondary" hidden>Enable local execution</button><button id="stop-worker" class="secondary" hidden>Stop local execution</button><button id="resume-worker" class="secondary" hidden>Resume local execution</button></div></details>
  <details id="preferences" hidden><summary>Desktop preferences</summary><label class="check"><input id="desktop-login" type="checkbox"><span>Open Ri quietly when I log in</span></label><p id="desktop-login-detail" class="hint"></p><label class="check"><input id="capture-enabled" type="checkbox"><span>Enable a global Quick Capture shortcut</span></label><label for="capture-shortcut">Shortcut</label><input id="capture-shortcut" type="text" autocomplete="off" spellcheck="false" placeholder="CommandOrControl+Shift+Space"><p id="capture-detail" class="hint"></p><button id="capture-save" class="secondary">Save shortcut</button></details>
  <details id="notifications" hidden><summary>Notifications on this computer</summary><label class="check"><input id="native-notifications" type="checkbox"><span>Show native notifications from your Ri</span></label><p id="notification-detail" class="hint"></p><button id="notification-test" class="secondary">Send test notification</button><p class="hint">Keep Ri open in the menu bar to receive alerts.</p></details>
  <details id="service" hidden><summary>Background service</summary><label class="check"><input id="login" type="checkbox"><span>Start this computer’s service when I log in</span></label><p id="login-detail" class="hint"></p><p class="hint">Quitting Ri leaves this service running. This computer must stay awake to run work or serve your data to other devices.</p></details>
  <details id="updates" hidden><summary>Updates</summary><p id="version"></p><p id="update-status"></p><div class="actions"><button id="update-check" class="secondary">Check for updates</button><button id="update-download" class="secondary" hidden>Download update</button><button id="update-apply" class="secondary" hidden>Update when idle</button><button id="update-later" class="secondary" hidden>Later</button></div><p class="hint">Local updates wait for a safe time. Updating this viewer does not restart your remote Ri.</p></details>
</section>
<section id="help" class="help" hidden>
  <p>Keep your work together and pick it up from your laptop, desktop or phone. Every connected device opens the same tasks, notes and conversations.</p>
  <h2>Start on one computer</h2><p>Choose <strong>Start a new Ri</strong> on the computer that will hold your data and run your agents. Ri calls this computer your Home. A desktop you usually leave on is a good choice if you want access from other devices.</p>
  <h2>Connect your other computers</h2><ol><li>On your Home, open Settings, then Devices.</li><li>Create a pairing link for the computer you want to add.</li><li>On that computer, choose <strong>Connect to an existing remote Ri</strong> and paste the link.</li></ol><p>Connecting opens the same Ri. It does not create or copy a tasks database on the new computer.</p>
  <h2>Choose where agents can work</h2><p>Your Home runs agents locally. A connected computer can also run agents in the folders you set up there, using its own tools and sign-ins. <strong>Run agents on this computer</strong> starts unchecked. Leave it off to view and manage work only, or enable it later in Desktop Settings.</p>
  <h2>When a computer is offline</h2><p>Your Home must be awake and reachable to open its Ri from another device. If the connection drops, Ri keeps your connection and gives you a way to retry. It never starts a replacement Home.</p>
  <h2>Already have Ri on this computer?</h2><p>Use the existing Ri when it is offered, or open Advanced to choose an existing installation. Starting a new Ri creates a separate place for your data. It does not merge an older installation.</p>
  <h2>What about teams?</h2><p>Your personal Ri can connect to team spaces so you can handle personal and shared work together. People who only use a team space can open it in a browser without setting up a personal Home.</p>
</section>
<footer id="footer" class="footer"><button id="help-link" class="link">Using Ri on multiple computers</button><button id="settings-link" class="link" hidden>Settings</button><button id="refresh" class="link" hidden>Refresh status</button></footer>
<details id="advanced" class="nested"><summary>Advanced</summary><p>Already have a local installation, or need help with its service?</p><button id="recovery" class="link">Existing installation and recovery</button></details>
</main><script nonce="${nonce}">
const $=id=>document.getElementById(id);
let view='${view}',returnView='auto',state=null,busy=false,captureEdited=false,connectionFailed=false;
$('run-work').checked=false;
async function call(action,value){const result=await window.riCompanion.request(action,value);if(result.error)throw new Error(result.error);return result;}
function isRemote(){return state?.role==='worker'||state?.role==='viewer';}
function canConnect(){return ['first-run','retired','worker','viewer'].includes(state?.role);}
function navigate(next){returnView=view;view=next;$('error').textContent='';if(next==='connect')$('run-work').checked=false;render();if(next==='connect')$('pairing').focus();else $('heading').focus();}
function render(){
 const role=state?.role,remote=isRemote(),fresh=role==='first-run',homeChosen=fresh&&state?.homeSelected,configured=homeChosen||['home','worker','viewer'].includes(role);
 const failed=!!state?.connectionError;
 const reconnecting=!!state?.connecting&&!failed;
 const starting=view==='auto'&&!failed&&(state?.connecting||homeChosen);
 const current=starting?'starting':view==='auto'?(fresh&&!homeChosen&&!failed?'welcome':'settings'):view==='connect'&&!canConnect()?'settings':view;
 const welcome=current==='welcome',connecting=current==='connect',help=current==='help',settings=current==='settings';
 if(failed&&!connectionFailed)document.querySelectorAll('#settings details').forEach(el=>el.removeAttribute('open'));
 connectionFailed=failed;
 $('starting').hidden=!starting;$('startup-status').textContent=remote?'Connecting to your Ri…':'Starting Ri…';
 $('welcome').hidden=!welcome;$('connect').hidden=!connecting;$('help').hidden=!help;$('settings').hidden=!settings;
 $('device').hidden=!settings||!state||(fresh&&!homeChosen&&!failed);$('back').hidden=!(connecting||help||(settings&&fresh&&!homeChosen&&!failed));
 $('heading').textContent=starting?(remote?'Connecting to your Ri':'Starting your Ri'):welcome?'Welcome to Ri':connecting?'Connect to your Ri':help?'Your Ri, on every computer':failed?(remote?'Your Ri is unreachable':'Ri could not start'):!configured&&!fresh&&state?'Ri needs your attention':'Ri on this device';
 $('heading').setAttribute('tabindex','-1');
 $('intro').textContent=starting?'':welcome?'A place for your tasks, notes and conversations.':connecting?'Bring your existing work to this computer.':help?'One place for your work, wherever you are.':fresh?'Preferences for this computer.':configured?'Manage this computer’s connection and preferences.':'Review this installation to continue.';
 $('help-link').hidden=help;$('settings-link').hidden=!connecting||!configured;$('refresh').hidden=!settings;
 $('advanced').hidden=connecting||help||starting;$('footer').hidden=help||starting;
 $('status').textContent=reconnecting?(remote?'Connecting to your Ri…':'Starting Ri…'):failed&&remote?'We could not connect to '+(state?.home?.name||'your Ri')+'.':role==='home'?'Your Ri lives on this computer':homeChosen?'Your Ri starts on this computer':remote?'Connected to '+(state?.home?.name||'your Ri'):state?.reason||'This installation needs attention';
 $('connection-message').textContent=failed?(remote?'Check that the other computer is awake and reachable, then try again. Your saved connection stays in place.':state.connectionError):'';
 $('connection-details').hidden=!failed;$('connection-error').textContent=state?.connectionError||'';
 $('home-name').textContent=remote&&!failed?'Your data stays on '+(state?.home?.hostName||'your other computer')+'.':'';
 $('open').hidden=!configured;$('open').textContent=reconnecting?'Connecting…':failed?'Try again':'Open Ri';$('reconnect').hidden=!remote&&role!=='retired';$('reconnect').textContent=remote?'Change connection':'Connect to your Ri';
 $('run-work-label').hidden=remote;
 const detected=state?.detectedInstallation;$('detected').hidden=!detected;
 $('detected-description').textContent=detected?.canUse?'You can open the Ri you already use here.':'Review its setup before opening it.';
 $('use-detected').hidden=!detected?.canUse;$('detected-recovery').hidden=!detected||detected.canUse;
 $('detected-details').textContent=detected?[detected.root,detected.reason].filter(Boolean).join('\\n'):'';
 $('execution').hidden=!configured;$('worker-status').textContent=role==='home'?'Your agents run here.':role==='viewer'?'Local agents are off.':'Local execution: '+(state?.worker?.state||'starting');
 $('worker-reason').textContent=state?.worker?.error||state?.worker?.reason||'';
 $('enable-worker').hidden=role!=='viewer';$('stop-worker').hidden=role!=='worker'||state?.worker?.enabled===false;$('resume-worker').hidden=role!=='worker'||state?.worker?.enabled!==false;
 $('service').hidden=!configured;$('login').checked=!!state?.login?.enabled;$('login-detail').textContent=state?.login?.detail||'This starts the background service after login, independently of the Ri window.';
 const prefs=state?.preferences;$('preferences').hidden=!prefs;
 if(prefs){$('desktop-login').checked=prefs.login.enabled;$('desktop-login-detail').textContent=prefs.login.detail||'Keep notifications and Quick Capture available from the menu bar.';if(!captureEdited){$('capture-enabled').checked=prefs.shortcut.enabled;$('capture-shortcut').value=prefs.shortcut.accelerator;}$('capture-detail').textContent=prefs.shortcut.detail||('Shortcut '+prefs.shortcut.state);}
 $('notifications').hidden=!state?.notifications;$('native-notifications').checked=!!state?.notifications?.enabled;$('notification-detail').textContent=state?.notifications?.error||'Only this computer can enable its native notifications.';
 $('updates').hidden=!state?.service;$('version').textContent='Desktop '+(state?.desktop||'')+(state?.service?.version?' · Runtime '+state.service.version:'');
 const update=state?.update;$('update-status').textContent=update?.reason||update?.error||(update?'Update '+update.phase:'No pending update');
 $('update-download').hidden=update?.phase!=='available';$('update-apply').hidden=!['ready','waiting'].includes(update?.phase);$('update-later').hidden=!update||['idle','committed'].includes(update.phase);
 updateDisabled();
}
function updateDisabled(){
 const prefs=state?.preferences;document.querySelectorAll('button,input').forEach(el=>el.disabled=busy);
 $('open').disabled=busy||!!state?.connecting&&!state?.connectionError;
 $('desktop-login').disabled=busy||!prefs?.login.supported;$('login').disabled=busy||!state?.service;
 $('native-notifications').disabled=busy||state?.notifications?.supported===false;$('notification-test').disabled=busy||state?.notifications?.supported===false;
}
async function refresh(){state=await call('status');render();}
async function run(fn,progress=''){
 if(busy)return;busy=true;$('error').textContent='';$('progress').textContent=progress;$('progress').hidden=!progress;updateDisabled();
 try{await fn();}catch(error){$('error').textContent=error.message||'Something went wrong. Try again.';}
 finally{busy=false;$('progress').hidden=true;try{await refresh();}catch(error){if(!$('error').textContent)$('error').textContent=error.message||'Could not check this computer. Try again.';render();}}
}
$('choose-connect').onclick=()=>navigate('connect');$('reconnect').onclick=()=>navigate('connect');$('help-link').onclick=()=>navigate('help');$('settings-link').onclick=()=>navigate('settings');
$('back').onclick=()=>{const previous=view==='help'?returnView:'auto';view=previous==='help'?'auto':previous;$('error').textContent='';render();$('heading').focus();};
$('create-home').onclick=()=>run(()=>call('create-home'),'Starting your new Ri…');
$('use-detected').onclick=()=>run(()=>call('use-detected'),'Opening your existing Ri…');
$('detected-recovery').onclick=()=>run(()=>call('recovery'));
$('connect-home').onclick=()=>run(async()=>{
 const result=await call('connect',{pairingLink:$('pairing').value,runWork:!$('run-work-label').hidden&&$('run-work').checked});
 $('pairing').value='';
 if(result.executionError){
  view='settings';$('execution').setAttribute('open','');
  $('error').textContent='Connected to your Ri, but local agents could not be enabled. '+result.executionError+' You can retry below or open Ri without local agents.';
 }else view='auto';
},'Connecting to your Ri…');
$('open').onclick=()=>{if(state?.connecting&&!state?.connectionError)return;return run(()=>call('open'),'Connecting to your Ri…');};
['stop-worker','resume-worker','recovery','update-check','update-download','update-apply','update-later','notification-test','enable-worker'].forEach(id=>$(id).onclick=()=>run(()=>call(id)));
$('login').onchange=()=>run(()=>call('login',{enabled:$('login').checked}));
$('native-notifications').onchange=()=>run(()=>call($('native-notifications').checked?'notification-enable':'notification-disable'));
$('desktop-login').onchange=()=>run(()=>call('preferences',{type:'login',enabled:$('desktop-login').checked}));
['capture-enabled','capture-shortcut'].forEach(id=>$(id).oninput=()=>{captureEdited=true;});
$('capture-save').onclick=()=>run(async()=>{await call('preferences',{type:'shortcut',enabled:$('capture-enabled').checked,accelerator:$('capture-shortcut').value});captureEdited=false;});
$('refresh').onclick=()=>run(refresh);
// Help stays available even if reading local state fails.
if(view==='help')render();
run(refresh);setInterval(()=>{if(!busy)refresh().catch(()=>{});},5000);
</script></body></html>`;
}
