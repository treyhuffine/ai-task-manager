import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, serverEnv } from './config.mjs'
const config=JSON.parse(readFileSync(join(root,'remote.json'),'utf8'))
const { chromium }=createRequire(join(root,'host/package.json'))('playwright-core')
const { readAuthConfig }=createRequire(import.meta.url)('../../src/lib/auth/config-file.ts')
const token=readAuthConfig()?.localToken,isolated=process.env.RI_MCP_APPS_TEST_HOME_ORIGIN
if(!token || !isolated && !process.argv.includes('--live')) throw new Error('Use a synthetic Home or explicitly qualify the public examples on the live Home')
const executablePath=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync)
const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true,env:serverEnv()})
const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage(),checks=[],calls=[],canvasResponses=[],limitations=[]
page.setDefaultTimeout(60000)
const pass=name=>{checks.push(name);console.log('PASS '+name)}
async function until(fn,message,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error(message)}
context.on('request',request=>{if(request.url().startsWith(config.hostOrigin)&&request.method()==='POST')try{const rpc=request.postDataJSON();if(rpc.method==='tools/call')calls.push(rpc.params.name)}catch{}})
context.on('response',async response=>{const request=response.request();if(!request.url().startsWith(config.hostOrigin)||request.method()!=='POST')return;try{const rpc=request.postDataJSON();if(['_get_canvas_state','read_checkpoint','_exec_callback','save_checkpoint'].includes(rpc.params?.name))canvasResponses.push({name:rpc.params.name,result:await response.json()})}catch{}})
await page.addInitScript(({parent,host})=>{if(location.origin!==parent)return;window.__viewContext=null;window.__viewHistory=[];window.addEventListener('message',e=>{if(e.origin===host&&e.data?.kind==='ri-evaluation-context'){window.__viewContext=e.data.context;window.__viewHistory.push(e.data.context)}})},{parent:config.parentOrigin,host:config.hostOrigin})
if(isolated){const local=new URL(isolated);if(local.protocol!=='http:'||!['127.0.0.1','localhost'].includes(local.hostname))throw new Error('Use a local synthetic Home');await context.route(config.parentOrigin+'/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/api/live')return route.fulfill({contentType:'text/event-stream',body:''});try{const response=await route.fetch({url:local.origin+u.pathname+u.search,timeout:120000});await route.fulfill({response})}catch{await route.abort().catch(()=>{})}});await page.addInitScript(origin=>{if(location.origin===origin)localStorage.setItem('ri.client.apiTransport','http')},config.parentOrigin)}
let stage='Open library'
try{
 await page.goto(config.parentOrigin+'/?settings=plugins#token='+encodeURIComponent(token))
 for(const demo of [{name:'Microsoft Flint',app:'Flint charts',title:'flint-chart-mcp',permission:'Allow updates to this chart',prompt:'Change this to a Line Chart. Keep all sample revenue data unchanged and use title Revenue trend.',expected:'Revenue trend',status:'chart'},{name:'Building explorer',app:'Building explorer',title:'metadata-demo-best',permission:'Allow changes to this building view',prompt:'Show Gustav Mahlerlaan 10 in a table.',expected:'1999',status:'view'},{name:'tldraw',app:'tldraw',title:'tldraw',permission:'Allow updates to this canvas',prompt:'Add a green rectangle labelled Done to the right of the current shape at x 550 y 100, width 220 height 120. Preserve the existing shape.',expected:'Done',status:'canvas'}]){
  if (process.argv.includes('--tldraw') && demo.app !== 'tldraw') continue;
  stage='Open '+demo.name
  const row=page.getByRole('row').filter({has:page.getByRole('link',{name:demo.name,exact:true})});await row.getByRole('button',{name:'Open demo',exact:true}).click()
  const host=await(await page.getByTitle('Interactive plugin examples',{exact:true}).elementHandle()).contentFrame()
  const attached=()=>page.evaluate(()=>window.__viewContext)
  await until(async()=>{const c=await attached();return c?.app===demo.app&&(!!c.update||demo.app==='tldraw'&&await host.getByRole('alert').filter({hasText:'SDK license check'}).count()>0)},'No owned update capability for '+demo.name)
  if(demo.app==='tldraw') assert(await page.evaluate(()=>window.__viewHistory.filter(c=>c.app==='tldraw'&&c.update).every(c=>c.update.version>=1)), 'Canvas editing must wait for its first completed checkpoint')
  if(demo.app==='tldraw'&&!((await attached()).update)){
   await host.getByRole('alert').filter({hasText:'SDK license check'}).waitFor();
   assert((await attached()).text.includes('Ri sample workflow'));
   limitations.push('tldraw hosted SDK license gate blocks the HTTPS sandbox');
   pass('tldraw reports its hosted SDK license failure and retains bounded captured canvas data');
   await page.getByRole('button',{name:'Chat about result',exact:true}).click();
   const chat=page.getByRole('region',{name:'Temporary demo chat'});
   assert.equal(await chat.getByRole('checkbox').count(),0);
   await chat.getByRole('textbox',{name:'Message the demo agent'}).fill('What text is in the captured canvas? Do not change anything.');
   await chat.getByRole('button',{name:'Send demo message'}).click();
   await chat.getByText('Read the attached third-party context. No new server call.',{exact:true}).waitFor({timeout:120000});
   assert((await chat.getByRole('log').innerText()).includes('Ri sample workflow'));
   pass('Read-only Claude can discuss the captured tldraw data without a hidden edit grant');
   const before=calls.length;await host.evaluate(()=>location.reload());await host.getByRole('status').filter({hasText:'Session ended.'}).waitFor();await page.waitForTimeout(500);assert.equal(calls.length,before);
   pass('Reload of the blocked tldraw result ends its session without replay');
   await page.getByRole('button',{name:'Return to Plugins',exact:true}).click();continue;
  }
  const original=(await attached()).invocationId
  const frames=host.locator('iframe');async function view(){const proxy=await(await frames.last().elementHandle()).contentFrame();await proxy.locator('iframe').waitFor();return(await proxy.locator('iframe').elementHandle()).contentFrame()}
  pass(demo.name+' explicitly opens a real public result with its own update capability')
  await page.getByRole('button',{name:'Chat about result',exact:true}).click()
  const chat=page.getByRole('region',{name:'Temporary demo chat'}),editor=chat.getByRole('textbox',{name:'Message the demo agent'}),updates=chat.getByRole('checkbox',{name:demo.permission,exact:true})
  assert.equal(await updates.isChecked(),false);await updates.check();await editor.fill(demo.prompt);await chat.getByRole('button',{name:'Send demo message'}).click();await editor.fill('Preserve this next draft')
  stage='Agent updates '+demo.name
  await chat.getByText('Applied to this '+demo.status+' through MCP',{exact:true}).waitFor({timeout:120000})
  assert.equal(await editor.inputValue(),'Preserve this next draft');assert.equal((await attached()).invocationId,original)
  await until(async()=>(await attached()).text.includes(demo.expected),'Updated data did not reach the attached context')
  await frames.last().scrollIntoViewIfNeeded();
  const guest=await view()
  if(demo.app==='tldraw') await guest.getByText('Done',{exact:true}).first().waitFor()
  else await guest.getByText(demo.expected,{exact:true}).first().waitFor()
  pass('Real Claude updates '+demo.name+' through MCP, the actual UI changes, and the next draft is preserved')
  await updates.uncheck();await editor.fill(demo.app==='Building explorer'?'Which address and construction year are in the attached table?':'Describe the current labels and title in the attached view. Do not change it.');await chat.getByRole('button',{name:'Send demo message'}).click();await chat.getByText('Read the attached third-party context. No new server call.',{exact:true}).waitFor({timeout:120000})
  assert((await chat.getByRole('log').innerText()).includes(demo.expected))
  pass('Read-only Claude sees the updated '+demo.name+' context')
  const before=calls.length;await host.evaluate(()=>location.reload());await host.getByRole('status').filter({hasText:'Session ended.'}).waitFor();await page.waitForTimeout(500);assert.equal(calls.length,before)
  pass(demo.name+' reload ends its session without replaying the original call')
  await page.getByRole('button',{name:'Return to Plugins',exact:true}).click()
 }
 writeFileSync(join(root,'evidence/view-chat-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,syntheticHome:!!isolated,realPublicServers:true,realClaudeHarness:true,limitations,calls},null,2)+'\n')
}catch(error){console.error('FAIL '+stage+': '+String(error.message).replace(/\/s\/[a-f0-9]{64}/g,'/s/[session]').split('Call log:')[0]);await page.screenshot({path:join(root,'evidence/view-chat-failure.png')}).catch(()=>{}); writeFileSync(join(root,'evidence/view-chat-diagnostic.json'),JSON.stringify({stage,canvasResponses,history:await page.evaluate(()=>window.__viewHistory),chat:await page.getByRole('region',{name:'Temporary demo chat'}).innerText({timeout:1000}).catch(()=>''),context:await page.evaluate(()=>window.__viewContext),frames:await Promise.all(page.frames().filter(f=>f!==page.mainFrame()&&(f.url().startsWith(config.hostOrigin)||f.url().startsWith(config.sandboxOrigin)||f.parentFrame()?.url().startsWith(config.sandboxOrigin))).map(async f=>({dom:await f.evaluate(()=>({bodyChildren:document.body.childElementCount,rootChildren:document.querySelector('#root')?.childElementCount,bodyHeight:document.body.getBoundingClientRect().height,bodyWidth:document.body.getBoundingClientRect().width,rootText:document.querySelector('#root')?.textContent?.slice(-1000),canvas:document.querySelector('.tl-container')?.getBoundingClientRect().toJSON(),iframes:[...document.querySelectorAll('iframe')].map(i=>({height:i.getBoundingClientRect().height,width:i.getBoundingClientRect().width}))})).catch(()=>null),body:await f.locator('body').innerText().catch(()=>''),done:await f.getByText('Done',{exact:true}).count().catch(()=>0)})))},null,2));throw new Error('Multi-app qualification failed at '+stage)}finally{await browser.close()}
