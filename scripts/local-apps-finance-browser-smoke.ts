/** Synthetic records only, against the disposable Home named by `pnpm iso`. */
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {chromium,type Page,type Frame} from 'playwright-core';
async function main(){
 const root=process.env.RI_ROOT;assert(root&&!['ri','ri-dev','ri-test'].some(name=>path.resolve(root)===path.join(os.homedir(),name)),'Use a disposable Home');
 const config=JSON.parse(await fs.readFile(path.join(root,'.config/config.json'),'utf8'));assert.equal(config.globalSkillEnabled,false);
 const base=process.env.RI_LOCAL_APPS_BROWSER_URL??'http://127.0.0.1:42251';
 const browser=await chromium.launch({headless:true,executablePath:['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync)});
 async function guest(page:Page,text:string):Promise<Frame>{for(let i=0;i<600;i++){for(const frame of page.frames()){try{if(frame.parentFrame()&&await frame.getByRole('heading',{name:text,exact:true}).count())return frame;}catch{if(!frame.isDetached())throw new Error('Finance guest lookup failed');}}await page.waitForTimeout(100);}throw new Error('Missing Finance guest '+text+' '+await page.locator('[role=alert]').allTextContents());}
 async function rpc(name:string,input:unknown={},mutation=false){const response=await fetch(base+'/api/trpc/'+name+(mutation?'':'?input='+encodeURIComponent(JSON.stringify(input))),{method:mutation?'POST':'GET',headers:{Authorization:'Bearer '+config.localToken,'Content-Type':'application/json'},...(mutation?{body:JSON.stringify(input)}:{})});const result=await response.json();assert(response.ok&&!result.error,name+': '+(result.error?.message??'Request failed'));return result.result.data;}
 const page=await browser.newPage();page.on('pageerror',error=>console.error(error.message));
 try{
  await page.goto(base+'/apps#token='+encodeURIComponent(config.localToken));
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Finances',exact:true})});
  await card.getByRole('button',{name:'Fictional demo'}).click();await page.getByRole('dialog').getByRole('heading',{name:'Fictional monthly review'}).waitFor();await page.keyboard.press('Escape');
  if(process.env.RI_FINANCE_PREVIOUS_FIXTURE){
   assert(!(await rpc('localApps.list')).instances.length,'Update fixture needs a clean Home');
   const form=new FormData();form.append('package',new Blob([await fs.readFile(process.env.RI_FINANCE_PREVIOUS_FIXTURE)]),'previous-finance.tar.gz');
   const response=await fetch(base+'/api/local-apps/import',{method:'POST',headers:{Authorization:'Bearer '+config.localToken},body:form});const draft=await response.json();assert(response.ok,draft.error);
   const installed=await rpc('localApps.activate',{id:draft.id,revision:(await rpc('localApps.list')).revision},true);
   const invoke=(action:string,input:unknown={})=>rpc('localApps.invoke',{id:installed.id,action,input,invocationId:crypto.randomUUID()},true);
   await invoke('finance_setup',{enabled:true,currency:'USD',timezone:'UTC',restoreReviewed:true});
   const account=await invoke('finance_create_account',{name:'Preserved update account',kind:'cash',provider:'manual',currency:'USD',connectionId:null,sourceId:'catalog-update-fixture',balanceMinor:50000,balanceIncludesPending:false,historyStart:null,asOf:new Date().toISOString()});
   await invoke('finance_import_csv',{accountId:account.id,text:'date,merchant,amount,category\n2026-10-01,Preserved update purchase,24.00,shopping',positiveMeansSpending:true});
   const transaction=(await invoke('finance_transactions',{accountIds:[account.id],startOn:'2026-01-01',endOn:'2027-01-01'})).rows[0];assert(transaction);
   await page.reload();await card.getByRole('button',{name:'Review update',exact:true}).click();await page.getByRole('button',{name:'Use app',exact:true}).waitFor();
   assert.equal((await rpc('localApps.list')).instances.find((item:{id:string})=>item.id===installed.id).digest,installed.digest,'Preview activated without review');
   await guest(page,'Finances');await page.getByRole('button',{name:'Use app',exact:true}).click();await page.getByRole('button',{name:'Change app',exact:true}).waitFor();
   assert.equal((await rpc('localApps.list')).instances.find((item:{packageId:string})=>item.packageId==='ri-finance').id,installed.id,'Update replaced the installed identity');
   assert.equal((await invoke('finance_home')).accounts[0].id,account.id,'Update lost the account');
   const preserved=(await invoke('finance_transactions',{accountIds:[account.id],startOn:'2026-01-01',endOn:'2027-01-01'})).rows[0];
   assert.equal(preserved.id,transaction.id,'Update replaced the financial record');
   assert.equal(preserved.merchant,'Preserved update purchase','Update lost financial records');
   assert.equal((await rpc('localApps.list')).instances.find((item:{id:string})=>item.id===installed.id).displayName,'Finances');
   console.log('PASS: native catalog update from the previous Finance package preserves instance, account and transaction after explicit activation');
   await page.goto(base+'/apps');
  }
  if(await card.getByRole('button',{name:'Add to Ri'}).isDisabled()){await page.goto(base+'/apps/finance');await page.locator('header').getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Archive',exact:true}).click();await page.getByRole('button',{name:'Remove app and records',exact:true}).click();await page.goto(base+'/apps');}
  await card.getByRole('button',{name:'Add to Ri'}).click();await page.getByRole('button',{name:'Use app'}).waitFor({timeout:120000});
  await guest(page,'Finances');await page.locator('[contenteditable=true]').first().waitFor();await page.waitForTimeout(2500);await page.getByRole('button',{name:'Use app'}).click();await page.getByRole('button',{name:'Change app'}).waitFor({timeout:60000});
  let frame=await guest(page,'Finances');await frame.getByRole('button',{name:'Enable finances'}).click();await frame.getByRole('button',{name:'Create account'}).waitFor();
  await page.locator('header').getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('region',{name:'Service status'}).getByText('Ready · Worker ready',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await frame.getByLabel('Name',{exact:true}).fill('Browser fixture checking');await frame.getByLabel('Balance in minor units',{exact:true}).fill('50000');await frame.getByRole('button',{name:'Create account'}).click();await frame.getByRole('heading',{name:'Browser fixture checking'}).waitFor();
  await frame.getByRole('button',{name:'Choose CSV file'}).click();await page.getByLabel('Select app file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('date,merchant,amount,category\n2026-10-01,Fixture Shop,24.00,shopping\n2026-10-02,Fixture Market,31.00,groceries')});
  await page.getByRole('dialog').waitFor({state:'hidden'});await frame.waitForFunction(()=>document.querySelector('textarea')?.value.includes('Fixture Shop'));assert.match(await frame.getByLabel('CSV records').inputValue(),/Fixture Shop/);await frame.getByRole('button',{name:'Import CSV records'}).click();await frame.getByRole('status').filter({hasText:'Imported 2 records'}).waitFor();
  await frame.getByLabel('Name',{exact:true}).fill('Keep unsaved Finance input');await page.waitForTimeout(6500);assert.equal(await frame.getByLabel('Name',{exact:true}).inputValue(),'Keep unsaved Finance input');
  page.once('dialog',dialog=>dialog.accept());const downloading=page.waitForEvent('download');await frame.getByRole('button',{name:'Download account records'}).click();const download=await downloading;assert.equal(download.suggestedFilename(),'finance-records.json');assert.match(await fs.readFile((await download.path())!,'utf8'),/Fixture Shop/);
  await frame.getByRole('button',{name:'Save activity view'}).click();await frame.getByRole('button',{name:'Activity',exact:true}).click();frame=await guest(page,'Activity');await frame.getByLabel('Select Fixture Shop').check();await frame.getByLabel('Select Fixture Market').check();
  const url=page.url();await page.reload();frame=await guest(page,'Activity');await frame.getByText('Fixture Shop',{exact:true}).waitFor();await page.locator('header').getByRole('button',{name:'Apps',exact:true}).click();await page.goBack();assert.equal(page.url(),url);await guest(page,'Activity');await page.goForward();await page.locator('article').filter({has:page.getByRole('heading',{name:'Finances',exact:true})}).waitFor();await page.goBack();await guest(page,'Activity');
  await page.goto(base+'/apps/finance');frame=await guest(page,'Finances');await frame.getByLabel('Monthly income in minor units').fill('200000');await frame.getByRole('button',{name:'Create budget proposal',exact:true}).click();await frame.getByRole('button',{name:'Adopt budget proposal',exact:true}).click();await frame.getByRole('button',{name:'Open budget view',exact:true}).click();frame=await guest(page,'Your monthly budget');
  const app=(await rpc('localApps.list')).instances.find((item:{packageId:string})=>item.packageId==='ri-finance');const invoke=(action:string,input:unknown={})=>rpc('localApps.invoke',{id:app.id,action,input,invocationId:crypto.randomUUID()},true);
  const before=(await invoke('finance_home')).budgets[0],slider=frame.getByLabel('Try a dining limit');const staged=Number(await slider.inputValue())+5000;
  await slider.evaluate((input,value)=>{(input as HTMLInputElement).value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},staged);await page.waitForTimeout(1000);assert.equal((await invoke('finance_home')).budgets[0].revision,before.revision,'Staging changed the budget');
  await invoke('finance_change_budget',{id:before.id,expectedRevision:before.revision,mutationKey:crypto.randomUUID(),plan:{...before.plan,incomeMinor:before.plan.incomeMinor+1000}});await page.waitForTimeout(6500);assert.equal(Number(await slider.inputValue()),staged);await frame.getByRole('alert').filter({hasText:'Your edit is retained'}).waitFor();
  await frame.getByRole('button',{name:'Discard staged changes and refresh'}).click();await page.waitForTimeout(300);const ready=(await invoke('finance_home')).budgets[0];
  await slider.evaluate((input,value)=>{(input as HTMLInputElement).value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},staged);await page.waitForTimeout(500);await frame.getByRole('button',{name:'Apply to budget',exact:true}).click();
  for(let i=0;i<100&&(await invoke('finance_home')).budgets[0].revision===ready.revision;i++)await page.waitForTimeout(100);assert.equal((await invoke('finance_home')).budgets[0].revision,ready.revision+1);
  await frame.getByRole('button',{name:'Undo last budget change',exact:true}).click();for(let i=0;i<100&&(await invoke('finance_home')).budgets[0].revision===ready.revision+1;i++)await page.waitForTimeout(100);const undone=(await invoke('finance_home')).budgets[0];assert.equal(undone.revision,ready.revision+2);assert.deepEqual(undone.plan,ready.plan);
  await page.reload();await guest(page,'Your monthly budget');assert.equal((await invoke('finance_home')).budgets[0].revision,undone.revision,'Reopen replayed a budget write');
  await rpc('localApps.configure',{id:app.id,revision:(await rpc('localApps.list')).revision,patch:{enabled:true}},true);await page.getByRole('button',{name:'Reopen view',exact:true}).waitFor({timeout:15000});await page.getByRole('button',{name:'Reopen view',exact:true}).click();await guest(page,'Your monthly budget');assert.equal((await invoke('finance_home')).budgets[0].revision,undone.revision);
  await page.screenshot({path:path.join(root,'local-apps-finance-browser.png'),fullPage:true});console.log('PASS: optional catalog, native CSV, manual setup, two records, saved views, retained input, download, budget scenario, conflict retention, explicit apply/undo, native service health, expired-view recovery, read-only reopen and Back/Forward');
 }catch(error){await page.screenshot({path:path.join(root,'local-apps-finance-browser-failure.png'),fullPage:true});console.error(await Promise.all(page.frames().map(async f=>({frame:f.url().split('#')[0],text:(await f.locator('body').innerText()).slice(0,1800)}))));throw error;}finally{await browser.close();}
}
void main().catch(error=>{console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g,"[private fixture token]") : "Fixture failed");process.exitCode=1;});
