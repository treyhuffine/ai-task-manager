/** Native chat and navigation qualification, on synthetic Finance records only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {chromium,type Page,type Frame} from 'playwright-core';

async function main() {
  const root=process.env.RI_ROOT;
  assert(root&&!['ri','ri-dev','ri-test'].some(name=>path.resolve(root)===path.join(os.homedir(),name)),'Use a disposable Home');
  const config=JSON.parse(await fs.readFile(path.join(root,'.config/config.json'),'utf8'));
  assert.equal(config.globalSkillEnabled,false);
  const base=process.env.RI_LOCAL_APPS_BROWSER_URL??'http://127.0.0.1:42251';
  async function rpc(name:string,input:unknown={},mutation=false) {
    const response=await fetch(base+'/api/trpc/'+name+(mutation?'':'?input='+encodeURIComponent(JSON.stringify(input))),{method:mutation?'POST':'GET',headers:{Authorization:'Bearer '+config.localToken,'Content-Type':'application/json'},...(mutation?{body:JSON.stringify(input)}:{})});
    const result=await response.json();assert(response.ok&&!result.error,name+': '+(result.error?.message??'Request failed'));return result.result.data;
  }
  const session=(await rpc('orchestratorChat.list')).session;
  const finance=(await rpc('localApps.list')).instances.find((app:{packageId:string;enabled:boolean})=>app.packageId==='ri-finance'&&app.enabled);
  assert(finance,'Run the Finance browser fixture first');
  const state=await rpc('localApps.list'),oldGrant=state.grants.find((item:{instanceId:string;principal:{kind:string;id:string};revokedAt:string|null})=>item.instanceId===finance.id&&item.principal.kind==='chat'&&item.principal.id===session.id&&!item.revokedAt);if(oldGrant)await rpc('localApps.revoke',{id:oldGrant.id,revision:state.revision},true);
  const call=(action:string,input:unknown={})=>rpc('localApps.invoke',{id:finance.id,action,input,invocationId:crypto.randomUUID()},true);
  const home=await call('finance_home');assert(home.accounts.length&&home.views.length,'Manual records and a saved view are required');const activity=home.views.find((view:{definition:{title:string}})=>view.definition.title==='Activity');assert(activity);
  await rpc('localApps.panel',{chatId:session.id,instanceId:finance.id,path:'/views/'+activity.id,query:{}},true);
  const browser=await chromium.launch({headless:true,executablePath:['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync)});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  async function guest(page:Page,heading='Activity'):Promise<Frame> {
    for(let i=0;i<200;i++){for(const frame of page.frames()){try{if(frame.parentFrame()&&await frame.getByRole('heading',{name:heading,exact:true}).count())return frame;}catch{if(!frame.isDetached())throw new Error('Finance guest lookup failed');}}await page.waitForTimeout(100);}
    throw new Error('Missing Finance Activity guest');
  }
  try {
    await page.goto(base+'/#token='+encodeURIComponent(config.localToken));
    await page.getByLabel('App beside this chat').selectOption(finance.id);
    await page.getByRole('button',{name:'Chat access',exact:true}).click();
    await page.getByRole('button',{name:'Allow read actions',exact:true}).click();
    await page.getByRole('button',{name:'Choose account access',exact:true}).click();
    const setup=await guest(page,'Choose account access');await setup.getByLabel('Browser fixture checking',{exact:true}).check();await page.waitForTimeout(6500);assert(await setup.getByLabel('Browser fixture checking',{exact:true}).isChecked(),'Access selection was lost on refresh');await setup.getByRole('button',{name:'Use selected accounts',exact:true}).click();
    await page.getByText('Selected account access is ready to bind to this caller.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Allow selected access',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    const grant=(await rpc('localApps.list')).grants.find((item:{instanceId:string;principal:{kind:string;id:string};revokedAt:string|null})=>item.instanceId===finance.id&&item.principal.kind==='chat'&&item.principal.id===session.id&&!item.revokedAt);assert(grant?.serviceScopeRef,'Native setup did not bind account access');

    // Selecting the already-bound instance keeps its saved route intact.
    await rpc('localApps.panel',{chatId:session.id,instanceId:finance.id,path:'/views/'+activity.id,query:{}},true);
    await page.reload();
    let frame=await guest(page);
    const editor=page.locator('[contenteditable=true]').filter({visible:true}).first();
    await editor.fill('Keep this existing chat input');
    await frame.getByLabel('Select Fixture Shop').check();
    await page.waitForTimeout(600);
    // Apps is a place in the rail (docs/rail.md), and the collapsed strip's
    // Apps button opens your apps as a flyout. Opening the app from there
    // leaves the chat's unsent input where it was.
    const places=page.getByRole('navigation',{name:'Places'});
    if(!await places.count())await page.getByRole('button',{name:'Expand rail',exact:true}).click();
    await places.getByRole('button',{name:'Apps',exact:true}).waitFor();assert.equal(await editor.innerText(),'Keep this existing chat input');
    await page.getByRole('button',{name:'Collapse rail',exact:true}).click();await page.getByRole('button',{name:'Apps',exact:true}).click();
    const flyout=page.locator('[data-slot=popover-content], [role=dialog]').filter({has:page.getByRole('button',{name:'All apps',exact:true})});await flyout.getByRole('button',{name:finance.displayName,exact:true}).click();
    for(let i=0;i<200&&!page.url().includes('/apps/'+finance.slug);i++)await page.waitForTimeout(100);
    assert(page.url().includes('/apps/'+finance.slug));await page.goBack();frame=await guest(page);
    assert.equal(await page.locator('[contenteditable=true]').filter({visible:true}).first().innerText(),'Keep this existing chat input');
    await page.getByRole('button',{name:'Close '+finance.displayName,exact:true}).click();
    await page.getByRole('button',{name:'Open an app beside this chat',exact:true}).click();await page.getByRole('menuitem',{name:finance.displayName}).click();
    assert.equal(await page.locator('[contenteditable=true]').filter({visible:true}).first().innerText(),'Keep this existing chat input');
    await page.waitForTimeout(1500);
    await page.screenshot({path:path.join(root,'local-apps-chat-browser.png'),fullPage:true});
    console.log('PASS: native account selection/binding without copied IDs or credentials, scoped saved view beside existing chat, selection, rail places, collapsed strip, global open, Back and retained composer');
  } catch(error) {
    await page.screenshot({path:path.join(root,'local-apps-chat-browser-failure.png'),fullPage:true});
    console.error((await page.locator('body').innerText()).slice(0,2200));throw error;
  } finally {await browser.close();}
}
void main().catch(error=>{console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g,"[private fixture token]") : "Fixture failed");process.exitCode=1;});
