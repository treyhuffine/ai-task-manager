import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {getAppRoot} from '../src/lib/config/paths';
import {ownerToken,createClientKey,revokeClientKey} from '../src/lib/auth';
import * as q from '../src/lib/db/queries';
import {resetDb} from '../src/lib/db';
import {financeRendererPolicy} from '../src/lib/finance/renderer';
import {FINANCE_RESOURCE} from '../src/lib/mcp/server';
const root=fs.realpathSync(getAppRoot());
if(process.env.FINANCE_SYNTHETIC!=='1'||![fs.realpathSync('/tmp'),fs.realpathSync(os.tmpdir())].some(p=>root.startsWith(p+path.sep)))throw new Error('Browser checks require an explicitly synthetic disposable data folder');
const base=process.env.FINANCE_TEST_URL??'http://localhost:42301';
const view=q.listFinanceViews(q.financeOwner).find(v=>v.definition.title==='Your monthly budget')!;
const budget=q.getFinanceBudget(q.financeOwner,view.scope.budgetId!);
const key=createClientKey({label:'Synthetic browser verification',accountIds:view.scope.accountIds,operations:['read','write','evidence']});
const client=new Client({name:'synthetic-browser-host',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+key.token}}}));
const resource=await client.readResource({uri:FINANCE_RESOURCE}),html=('text' in resource.contents[0]?resource.contents[0].text:'');
const opened=await client.callTool({name:'finance_open_view',arguments:{id:view.id}});if(opened.isError)throw new Error('MCP view failed to open');
const bundle=await build({stdin:{contents:`import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';const frame=document.querySelector('iframe');const bridge=new AppBridge(null,{name:'Independent SDK test host',version:'1'},{serverTools:{}});bridge.oncalltool=async params=>{const response=await fetch('/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});return response.json();};bridge.oninitialized=()=>fetch('/result').then(r=>r.json()).then(r=>bridge.sendToolResult(r));bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow)).then(()=>{frame.src='/resource';});`,resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife'});
const artifact=fs.readFileSync(path.resolve('src/lib/finance/fixtures/refund-experiment.html'),'utf8');
const artifactScript=artifact.match(/<script>([\s\S]*?)<\/script>/)?.[1]??'';
const artifactPolicy="sandbox allow-scripts; default-src 'none'; script-src 'sha256-"+createHash('sha256').update(artifactScript).digest('base64')+"'; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-ancestors 'self'";
const sdkCalls:string[]=[];
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/experiment'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':artifactPolicy});res.end(artifact);}
  else if(req.url==='/experiment-host'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><iframe title="Fictional artifact" sandbox="allow-scripts" src="/experiment" style="width:100%;height:900px"></iframe>');}
  else if(req.url==='/resource'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':financeRendererPolicy()});res.end(html);}
  else if(req.url==='/host.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle.outputFiles[0].contents);}
  else if(req.url==='/result'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(opened));}
  else if(req.url==='/call'&&req.method==='POST'){let body='';for await(const part of req){body+=part;if(body.length>100000)throw new Error('Test request too large');}const call=JSON.parse(body);sdkCalls.push(call.name);const result=await client.callTool(call);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}
  else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><body><iframe title="Standard MCP Apps view" sandbox="allow-scripts" style="width:100%;height:1800px;border:0"></iframe><script src="/host.js"></script></body></html>');}
 }catch{res.writeHead(400);res.end();}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as {port:number}).port;
const executablePath=process.env.FINANCE_TEST_BROWSER??path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const browser=await chromium.launch({executablePath,headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);};
try{
 const response=await page.request.post(base+'/api/auth/login',{data:{token:ownerToken()}});assert(response.ok(),'Owner sign-in failed');
 await page.goto(base+'/finance');const own=page.frameLocator('iframe').first();await own.getByRole('heading',{name:'Your monthly budget',exact:true}).waitFor();
 await page.screenshot({path:path.join(root,'standalone-desktop.png'),fullPage:false});
 assert(await own.locator('body').evaluate(()=>{try{return document.cookie==='';}catch{return true;}}),'Iframe has cookie access');
 const slider=own.getByRole('slider');await slider.fill('30000');await slider.dispatchEvent('input');await own.getByRole('button',{name:'Apply to budget',exact:true}).click();
 await page.waitForFunction(()=>true);await own.getByText('Loading your finance view...', {exact:true}).waitFor({state:'hidden'});
 await new Promise(resolve=>setTimeout(resolve,500));assert(q.getFinanceBudget(q.financeOwner,budget.id).plan.categories.find(c=>c.id==='dining')?.limitMinor===30000,'Standalone slider apply failed');
 const revision=q.getFinanceBudget(q.financeOwner,budget.id).revision;await page.reload();await own.getByRole('heading',{name:'Your monthly budget',exact:true}).waitFor();assert(q.getFinanceBudget(q.financeOwner,budget.id).revision===revision,'Reload repeated a mutation');
 await own.getByRole('button',{name:'Undo last budget change'}).click();await new Promise(resolve=>setTimeout(resolve,500));assert(q.getFinanceBudget(q.financeOwner,budget.id).plan.categories.find(c=>c.id==='dining')?.limitMinor===budget.plan.categories.find(c=>c.id==='dining')?.limitMinor,'Undo failed');
 const generated=q.listFinanceViews(q.financeOwner).filter(v=>v.revision>0&&v.id!==view.id).slice(0,3);
 for(const saved of generated){await page.goto(base+'/finance?view='+saved.id);await page.frameLocator('iframe').getByRole('heading',{name:saved.definition.title,exact:true}).waitFor();}
 await page.goto(base+'/finance?view='+view.id);await own.getByRole('heading',{name:'Your monthly budget',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await new Promise(resolve=>setTimeout(resolve,300));await page.screenshot({path:path.join(root,'standalone-mobile.png'),fullPage:false});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Standalone page overflows a narrow screen');
 await page.goto(`http://127.0.0.1:${port}/`);const standard=page.frameLocator('iframe');await standard.getByRole('heading',{name:'Your monthly budget',exact:true}).waitFor();
 await standard.getByRole('slider').focus();await page.keyboard.press('ArrowLeft');await new Promise(resolve=>setTimeout(resolve,400));assert(sdkCalls.includes('finance_scenario_preview'),'Standard SDK did not forward the scenario callback');assert(await standard.getByRole('heading',{name:'Scenario compared with your plan'}).isVisible(),'Standard SDK scenario callback failed');
 await page.screenshot({path:path.join(root,'standard-mcp-host.png'),fullPage:false});
 await page.goto(`http://127.0.0.1:${port}/experiment-host`);const experiment=page.frameLocator('iframe');await experiment.locator('#gap').waitFor();assert(await experiment.locator('#gap').innerText()==='$16.00','Artifact settlement gap mismatch');await experiment.locator('#settlement').fill('9600');await experiment.locator('#settlement').dispatchEvent('input');assert(await experiment.locator('#gap').innerText()==='$0.00','Artifact scenario mismatch');
 assert(errors.length===0,'Browser errors: '+errors.join(', '));console.log(JSON.stringify({synthetic:true,standalone:true,narrowScreen:true,applyUndoReload:true,standardMcpAppsSdk:true,cookieIsolation:true,customArtifactExperiment:true,errors}));
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await client.close();revokeClientKey(key.id);resetDb();}
