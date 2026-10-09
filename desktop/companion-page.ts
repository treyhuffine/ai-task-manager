import { localPageStyle, type LocalPageStyleOptions } from './local-page-style';

export interface CompanionPageOptions extends LocalPageStyleOptions {
  view?: 'auto' | 'settings' | 'connect' | 'help' | 'create-team';
}

/** Trusted local UI. Dynamic values are rendered as text, never HTML. */
export function companionPage(nonce: string, options: CompanionPageOptions = {}) {
  const style = localPageStyle(nonce, options);
  const view = options.view ?? 'auto';
  if (!['auto', 'settings', 'connect', 'help', 'create-team'].includes(view)) throw new Error('Invalid companion view');
  return `<!doctype html><html ${style.attributes} data-ri-local-view="companion"><head><meta charset="utf-8">
${style.head}<title>Ri</title></head><body>${style.chrome}<main>
${style.brand}
<button id="back" class="link" hidden>‹ Back</button>
<button id="return-to-app" class="link" hidden>Back to Ri</button>
<h1 id="heading">Welcome to Ri</h1><p id="intro">A place for your tasks, notes and conversations.</p>
<p id="error" role="alert"></p><p id="progress" role="status" hidden></p>
<section id="starting" hidden><p id="startup-status" role="status" aria-live="polite">Starting Ri…</p><p>Your Ri will open as soon as it is ready.</p></section>
<section id="welcome" hidden>
  <div id="detected" class="card" hidden><h2>Ri is already set up on this computer</h2><p id="detected-description" class="hint">You can open the Ri you already use here.</p><button id="use-detected" class="secondary" hidden>Use existing Ri on this computer</button><button id="detected-recovery" class="link" hidden>Review this installation</button><details class="nested"><summary>Installation details</summary><p id="detected-details"></p></details></div>
  <p>Keep your data and run your agents on this computer. You can reach the same Ri from your other devices.</p>
  <div class="choices"><button id="create-home">Start a new Ri</button><button id="choose-connect" class="secondary">Connect to Ri</button></div>
  <button id="choose-create-team" class="link">Create a team</button>
  <div id="saved-teams" class="card" hidden><h2>Your teams</h2><p id="team-issue" class="hint" role="status" hidden></p><div id="team-list"></div></div>
  <div id="pending-team" class="card" hidden><p id="pending-team-text"></p><div class="actions"><button id="resume-team" class="secondary">Finish creating it</button><button id="cancel-team" class="link">Cancel</button></div></div>
</section>
<section id="connect" hidden>
  <label for="pairing">Ri link</label><input id="pairing" type="url" autocomplete="off" spellcheck="false" placeholder="https://…">
  <p id="pairing-hint" class="hint">Paste a pairing link or a team invitation.</p>
  <p id="link-destination" class="destination" role="status" aria-live="polite" hidden></p>
  <div id="run-work-label" class="card" hidden><label class="check"><input id="run-work" type="checkbox"><span>Run agents on this computer</span></label><p class="hint">Let your Ri run work in the agent folders you set up here, using this computer’s tools and sign-ins. You can enable this later.</p></div>
  <div id="join-name" hidden><label for="member-name">Your name</label><input id="member-name" type="text" autocomplete="name" maxlength="80"><p class="hint">What the team sees on your work. Nothing of yours is shared unless you add it to the team.</p></div>
  <p id="connect-note" class="hint">A pairing link comes from your own Ri’s Settings, Devices. A team invitation comes from someone in the team.</p>
  <div class="actions"><button id="connect-home">Continue</button></div>
</section>
<section id="create-team" hidden>
  <p>A separate place for shared tasks and notes. Nothing from your own Ri is copied into it, and people you invite see only what’s added to the team.</p>
  <label for="team-name">Team name</label><input id="team-name" type="text" maxlength="80" autocomplete="off">
  <label for="owner-name">Your name</label><input id="owner-name" type="text" maxlength="80" autocomplete="name">
  <div class="card"><p><strong>Hosted on this computer</strong></p><p class="hint">Keep this computer awake and online so your team can use Ri.</p></div>
  <details id="team-advanced" class="nested"><summary>Advanced</summary><label for="team-root">Folder</label><input id="team-root" type="text" spellcheck="false" placeholder="A new folder for this team"><label for="team-port">Port</label><input id="team-port" type="number" min="1024" max="65535" placeholder="Any free port"></details>
  <div class="actions"><button id="create-team-button">Create team</button></div>
  <button id="host-elsewhere" class="link">Host on another computer</button>
</section>
<section id="device" hidden>
  <p id="status" role="status" aria-live="polite"></p><p id="connection-message"></p><p id="home-name" class="hint"></p>
  <div class="actions"><button id="open">Open Ri</button><button id="reconnect" class="secondary" hidden>Change connection</button></div><details id="connection-details" class="nested" hidden><summary>Connection details</summary><p id="connection-error"></p></details>
  <button id="startup-settings" class="link" hidden>Desktop Settings</button>
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
  <h2>What about teams?</h2><p>A team is a separate place for shared tasks and notes. Choose <strong>Create a team</strong> to host one on this computer, or paste an invitation into <strong>Connect to Ri</strong> to join one. Your personal Ri can connect to team spaces so you can handle personal and shared work together. People who only use a team space can open it in a browser without setting up a personal Home.</p>
  <h2 id="host-elsewhere-help">Hosting a team on another computer</h2><p>A team is only reachable while the computer hosting it is awake and online. For a team that’s always available, set it up on a computer you leave on. Install Ri there and create the team on it, or on a server run <strong>ri team create</strong> and open the setup link it prints. Then connect to the team from here with an invitation.</p>
</section>
<footer id="footer" class="footer"><button id="help-link" class="link">Using Ri on multiple computers</button><button id="settings-link" class="link" hidden>Settings</button><button id="refresh" class="link" hidden>Refresh status</button></footer>
<details id="advanced" class="nested"><summary>Advanced</summary><p>Already have a local installation, or need help with its service?</p><button id="recovery" class="link">Existing installation and recovery</button></details>
</main><script nonce="${nonce}">
${style.script}
const $=id=>document.getElementById(id);
let view='${view}',returnView='auto',state=null,busy=false,captureEdited=false,connectionFailed=false,link=null,verifyTimer=null;
$('run-work').checked=false;
async function call(action,value){const result=await window.riCompanion.request(action,value);if(result.error)throw new Error(result.error);return result;}
function isRemote(){return state?.role==='worker'||state?.role==='viewer';}
// Whether this computer may change which personal Ri it uses. A team can be
// joined from any computer, so the link form opens either way.
function canConnect(){return ['first-run','retired','worker','viewer'].includes(state?.role);}
function navigate(next){returnView=view;view=next;$('error').textContent='';if(next==='connect'){$('run-work').checked=false;link=null;}if(next==='create-team'&&!$('owner-name').value)$('owner-name').value=state?.suggestedName||'';render();if(next==='connect')$('pairing').focus();else if(next==='create-team')$('team-name').focus();else $('heading').focus();}
// What a pasted link opens, verified before anything is saved (docs/homes-spec.md §3.1).
function linkFor(value){return link&&link.value===value.trim()?link.info:null;}
const REFUSED={expired:'This invitation has expired. Ask the team’s owner for a new link.',used:'This link was already used. Ask for a new one if you still need it.',revoked:'This invitation was withdrawn. Ask the team’s owner for a new link.',unknown:'This link isn’t valid. Ask the team’s owner for a new one.'};
function destination(info){
 if(!info)return '';
 if(info.kind==='personal')return canConnect()?'Pairing link for '+info.name+(info.hostName?', on '+info.hostName:''):'This is a pairing link for '+info.name+'. This computer already holds your own Ri, so use it on another computer.';
 if(info.state!=='valid')return REFUSED[info.state]||REFUSED.unknown;
 if(info.link==='invite')return 'Invitation to join '+(info.teamName||'a team');
 if(info.link==='sign-in')return 'Sign-in link for '+(info.teamName||'a team')+(info.memberName?', as '+info.memberName:'');
 return 'This link finishes setting up a team. Open it in a browser on the computer that hosts it.';
}
async function verify(){
 const value=$('pairing').value.trim();
 if(!value){link=null;render();return null;}
 try{const info=await call('inspect-link',{link:value});link={value,info};$('error').textContent='';}
 catch(error){link=null;$('error').textContent=error.message||'That link can’t be used.';}
 render();return linkFor(value);
}
function render(){
 const role=state?.role,remote=isRemote(),fresh=role==='first-run',homeChosen=fresh&&state?.homeSelected,configured=homeChosen||['home','worker','viewer'].includes(role);
 const failed=!!state?.connectionError;
 const issue=state?.connection?.issue;
 const notice=state?.connection?.showNotice??failed;
 const reconnecting=!!state?.connecting&&!failed;
 const pending=state?.connecting||homeChosen||failed;
 const current=view==='auto'?(pending?(notice?'recovery':'starting'):fresh&&!homeChosen?'welcome':'settings'):view;
 const starting=current==='starting',recovery=current==='recovery',welcome=current==='welcome',connecting=current==='connect',help=current==='help',settings=current==='settings',creatingTeam=current==='create-team';
 if(failed&&!connectionFailed)document.querySelectorAll('#settings details').forEach(el=>el.removeAttribute('open'));
 connectionFailed=failed;
 $('starting').hidden=!starting;$('startup-status').textContent=remote?'Connecting to your Ri…':'Starting Ri…';
 $('welcome').hidden=!welcome;$('connect').hidden=!connecting;$('help').hidden=!help;$('settings').hidden=!settings;$('create-team').hidden=!creatingTeam;
 $('device').hidden=(!settings&&!recovery)||!state||(fresh&&!homeChosen&&!failed);// Opened from the menu over Ri, the way back is Back to Ri.
 const fromApp=!!state?.hasViewer&&returnView==='auto'&&(connecting||creatingTeam);
 $('back').hidden=fromApp||!(connecting||help||creatingTeam||(settings&&fresh&&!homeChosen&&!failed));
 $('return-to-app').hidden=!state?.hasViewer;
 $('heading').textContent=starting?(remote?'Connecting to your Ri':'Starting your Ri'):welcome?'Welcome to Ri':connecting?(canConnect()?'Connect to Ri':'Join a team'):creatingTeam?'Create a team':help?'Your Ri, on every computer':recovery?(issue?.message||'Taking longer to connect'):!configured&&!fresh&&state?'Ri needs your attention':'Ri on this device';
 $('heading').setAttribute('tabindex','-1');
 $('intro').textContent=starting||recovery||creatingTeam?'':welcome?'A place for your tasks, notes and conversations.':connecting?(canConnect()?'Open a Ri you already use, or join a team.':'Join with an invitation, or sign in with a link from the team.'):help?'One place for your work, wherever you are.':fresh?'Preferences for this computer.':configured?'Manage this computer’s connection and preferences.':'Review this installation to continue.';
 $('help-link').hidden=help;$('settings-link').hidden=!connecting||!configured;$('refresh').hidden=!settings;
 $('advanced').hidden=connecting||help||starting||recovery||creatingTeam;$('footer').hidden=help||starting||recovery;
 $('status').textContent=recovery?'':failed?(issue?.message||'The Ri connection needs attention.'):reconnecting?(remote?'Connecting to your Ri…':'Starting Ri…'):role==='home'?'Your Ri lives on this computer':homeChosen?'Your Ri starts on this computer':remote?'Connected to '+(state?.home?.name||'your Ri'):state?.reason||'This installation needs attention';
 $('connection-message').textContent=recovery||failed?(issue&&!issue.retryable?'Review the connection details to continue. Your saved connection stays in place.':'Ri is trying to reconnect automatically. Your saved connection stays in place.'):'';
 $('connection-details').hidden=!failed;$('connection-error').textContent=issue?.detail||state?.connectionError||'';
 $('startup-settings').hidden=!recovery;
 $('home-name').textContent=remote&&!failed?'Your data stays on '+(state?.home?.hostName||'your other computer')+'.':'';
 $('open').hidden=!configured;$('open').textContent=recovery?'Try again':reconnecting?'Connecting…':failed?'Try again':'Open Ri';$('reconnect').hidden=recovery?issue?.kind!=='sign_in':!remote&&role!=='retired';$('reconnect').textContent=issue?.kind==='sign_in'?'Sign in again':remote?'Change connection':'Connect to your Ri';
 const info=linkFor($('pairing').value);
 $('link-destination').hidden=!info;$('link-destination').textContent=destination(info);
 $('run-work-label').hidden=remote||info?.kind!=='personal';
 const joining=info?.kind==='team'&&info.state==='valid'&&info.link==='invite';
 $('join-name').hidden=!joining;$('connect-note').hidden=!!info;
 $('pairing-hint').textContent=canConnect()?'Paste a pairing link or a team invitation.':'Paste a team invitation or sign-in link.';
 $('connect-note').textContent=canConnect()?'A pairing link comes from your own Ri’s Settings, Devices. A team invitation comes from someone in the team.':'An invitation or sign-in link comes from someone in the team.';
 $('connect-home').textContent=!info?'Continue':info.kind==='personal'?'Connect':info.link==='invite'?'Join team':'Sign in';
 const teams=state?.teams||[];$('saved-teams').hidden=!welcome||teams.length===0;$('team-issue').hidden=!state?.teamIssue;$('team-issue').textContent=state?.teamIssue?.message||'';
 const list=$('team-list');list.replaceChildren(...teams.map(team=>{const b=document.createElement('button');b.className='secondary';b.textContent='Open '+team.name;b.onclick=()=>run(()=>call('open-team',{id:team.id}),'Opening '+team.name+'…');return b;}));
 const pendingTeam=state?.pendingTeam;$('pending-team').hidden=!(welcome||creatingTeam)||!pendingTeam;
 $('pending-team-text').textContent=pendingTeam?'Creating '+pendingTeam.teamName+' didn’t finish. Nothing was lost.':'';
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
 const info=linkFor($('pairing').value);
 if(info?.kind==='team')$('connect-home').disabled=busy||info.state!=='valid'||info.link==='setup'||(info.link==='invite'&&!$('member-name').value.trim());
 if(info?.kind==='personal'&&!canConnect())$('connect-home').disabled=true;
 $('create-team-button').disabled=busy||!$('team-name').value.trim()||!$('owner-name').value.trim();
 $('open').disabled=busy||!!state?.connecting&&!state?.connectionError&&!state?.connection?.showNotice;
 $('desktop-login').disabled=busy||!prefs?.login.supported;$('login').disabled=busy||!state?.service;
 $('native-notifications').disabled=busy||state?.notifications?.supported===false;$('notification-test').disabled=busy||state?.notifications?.supported===false;
}
async function refresh(){state=await call('status');render();}
async function run(fn,progress=''){
 if(busy)return;busy=true;$('error').textContent='';$('progress').textContent=progress;$('progress').hidden=!progress;updateDisabled();
 try{await fn();}catch(error){$('error').textContent=error.message||'Something went wrong. Try again.';}
 // Usable again at once: the follow-up status check can take a while.
 finally{busy=false;$('progress').hidden=true;updateDisabled();try{await refresh();}catch(error){if(!$('error').textContent)$('error').textContent=error.message||'Could not check this computer. Try again.';render();}}
}
$('choose-connect').onclick=()=>navigate('connect');$('reconnect').onclick=()=>navigate('connect');$('help-link').onclick=()=>navigate('help');$('settings-link').onclick=()=>navigate('settings');
$('startup-settings').onclick=()=>navigate('settings');
$('return-to-app').onclick=()=>run(()=>call('return-to-app'));
$('back').onclick=()=>{const previous=view==='help'?returnView:'auto';view=previous==='help'?'auto':previous;$('error').textContent='';render();$('heading').focus();};
$('create-home').onclick=()=>run(()=>call('create-home'),'Starting your new Ri…');
$('use-detected').onclick=()=>run(()=>call('use-detected'),'Opening your existing Ri…');
$('detected-recovery').onclick=()=>run(()=>call('recovery'));
$('pairing').oninput=()=>{link=null;clearTimeout(verifyTimer);verifyTimer=setTimeout(()=>{if(!busy)verify();},400);render();};
$('member-name').oninput=()=>updateDisabled();
['team-name','owner-name'].forEach(id=>$(id).oninput=()=>updateDisabled());
$('connect-home').onclick=()=>run(async()=>{
 clearTimeout(verifyTimer);
 const value=$('pairing').value.trim();
 // Paste, see where it leads, then confirm: a click on a link not yet
 // checked only checks it and shows its destination.
 const info=linkFor(value);
 if(!info){await verify();return;}
 if(info.kind==='team'){
  if(info.state!=='valid')return;
  await call('join-team',{link:value,name:$('member-name').value});
  $('pairing').value='';$('member-name').value='';link=null;view='auto';return;
 }
 if(!canConnect())return;
 const result=await call('connect',{pairingLink:value,runWork:!$('run-work-label').hidden&&$('run-work').checked});
 $('pairing').value='';link=null;
 if(result.executionError){
  view='settings';$('execution').setAttribute('open','');
  $('error').textContent='Connected to your Ri, but local agents could not be enabled. '+result.executionError+' You can retry below or open Ri without local agents.';
 }else view='auto';
},'Checking the link…');
$('choose-create-team').onclick=()=>navigate('create-team');
$('host-elsewhere').onclick=()=>{navigate('help');$('host-elsewhere-help').scrollIntoView?.();};
$('create-team-button').onclick=()=>run(async()=>{
 const port=Number($('team-port').value)||undefined;
 await call('create-team',{teamName:$('team-name').value,ownerName:$('owner-name').value,root:$('team-root').value.trim()||undefined,port});
 $('team-name').value='';$('team-root').value='';$('team-port').value='';view='auto';
},'Creating your team. Its service starts on this computer…');
$('resume-team').onclick=()=>run(async()=>{await call('create-team',{resume:true});view='auto';},'Finishing your team…');
$('cancel-team').onclick=()=>run(()=>call('cancel-team-creation'));
$('open').onclick=()=>{if(state?.connecting&&!state?.connectionError&&!state?.connection?.showNotice)return;return run(()=>call('open'));};
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
