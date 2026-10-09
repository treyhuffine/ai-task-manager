/** The independent packed kit and the official MCP Apps reference bridge. */
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {it,expect} from 'vitest';
import {fixtureHost,createFixtureMcpServer,standardFixtureClient} from '@ri/app-kit/testing';
import {prepareHtml} from '@ri/app-kit/build';
it.skipIf(!process.env.FINANCE_KIT_FIXTURE)('renders Finance through the official reference bridge with the packed kit and isolated manual authority',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'finance-reference-host-')),host=fixtureHost(process.execPath,root),instance=host.install(process.env.FINANCE_KIT_FIXTURE!,crypto.randomUUID());
 const projected=await standardFixtureClient(createFixtureMcpServer(host.engine,instance,'user'));
 const request=async(name:string,args:Record<string,unknown>={})=>{const result=await projected.client.callTool({name,arguments:args}).catch(error=>{throw new Error('Reference operation '+name+': '+error.message,{cause:error});});if(result.isError)throw new Error('Fixture action failed');return result.structuredContent as Record<string,unknown>;};
 let server:http.Server|null=null;let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
 try{
  await request('finance_setup',{enabled:true,currency:'USD',timezone:'UTC',restoreReviewed:true});
  const account=await request('finance_create_account',{name:'Reference fixture',kind:'cash',provider:'manual',currency:'USD',connectionId:null,sourceId:'reference',balanceMinor:100000,balanceIncludesPending:false,historyStart:null,asOf:new Date().toISOString()});
  await request('finance_import_csv',{accountId:account.id,text:'date,merchant,amount,category\n2026-10-01,Reference Shop,24.00,shopping',positiveMeansSpending:true});
  const saved=await request('finance_create_default_view',{name:'Activity',accountIds:[account.id],startOn:'2026-01-01',endOn:'2027-01-01',budgetId:null,mutationKey:crypto.randomUUID()});
  const opened=await request('finance_open_app',{path:'/views/'+saved.id,query:{}}) as {resource:string;data:Record<string,unknown>;scope:{bindings:Record<string,unknown>}};
  const resource=await projected.client.readResource({uri:opened.resource});const prepared=prepareHtml((resource.contents[0] as {text:string}).text);
  const policy=`default-src 'none'; script-src ${prepared.scriptHashes.join(' ')}; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'`;
  const guest=prepared.html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+policy+'">');
  const resolve=createRequire(import.meta.url).resolve;
  const source=`import {AppBridge,PostMessageTransport} from ${JSON.stringify(resolve('@modelcontextprotocol/ext-apps/app-bridge'))};
   (async()=>{const frame=document.getElementById('guest');const bridge=new AppBridge(null,{name:'Official reference fixture',version:'1'},{serverTools:{},updateModelContext:{}},{hostContext:{theme:'dark',displayMode:'inline',availableDisplayModes:['inline']}});
   bridge.oncalltool=async(params)=>{const response=await fetch('/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});return response.json();};
   bridge.onupdatemodelcontext=async(params)=>{window.receivedContext=params;return {};};
   bridge.oninitialized=()=>bridge.sendToolResult({content:[{type:'text',text:'Synthetic manual records'}],structuredContent:${JSON.stringify(opened.data)}});
   await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));frame.srcdoc=${JSON.stringify(guest)};window.bridge=bridge;})();`;
  const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,format:'iife',write:false,platform:'browser',target:'es2023'});
  const html='<html><body><iframe id="guest" sandbox="allow-scripts" style="width:100%;height:650px;border:0"></iframe><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>';
  server=http.createServer((req,res)=>{void(async()=>{res.setHeader('Content-Type',req.url==='/call'?'application/json':'text/html');if(req.url==='/call'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const params=JSON.parse(Buffer.concat(chunks).toString());const result=await request(params.name,{...params.arguments,...opened.scope.bindings});res.end(JSON.stringify({content:[{type:'text',text:'Fixture result'}],structuredContent:result}));}else res.end(html);})().catch(()=>{res.writeHead(500);res.end();});});await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync)});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+(server.address() as {port:number}).port);
  const frame=page.frameLocator('#guest');await frame.getByRole('heading',{name:'Activity',exact:true}).waitFor();await frame.getByLabel('Select Reference Shop').check();await page.waitForFunction(()=>!!(window as unknown as {receivedContext:unknown}).receivedContext);expect(await frame.getByText('Reference Shop',{exact:true}).count()).toBe(1);await frame.getByRole('button',{name:'Update view filter',exact:true}).first().click();await frame.getByText('Reference Shop',{exact:true}).waitFor();
 }finally{await browser?.close();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await projected.close();await host.engine.dispose();await fs.rm(root,{recursive:true,force:true});}
},120000);
