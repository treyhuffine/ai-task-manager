/** Fresh builder maintenance with synthetic records and the public build action. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {createTestHome} from '@/test/fixtures/home';
import {localApps} from '@/lib/local-apps/service';
import {appAvailabilityBrief} from '@/lib/local-apps/brief';
import {dispatchAppAction} from '@/lib/local-apps/actions';
import {runHarnessText} from '@/lib/harness/one-shot';
import * as q from '@/lib/db/queries';
async function main(){
 const home=await createTestHome({prefix:'ri-app-maintenance-'});process.env.RI_LOCAL_APPS='1';const apps=localApps();let server:http.Server|undefined;
 try{
  q.updateUserState({defaultHarness:'claude',defaultModel:null});await apps.initialize();
  const initial=await apps.createDraft('react');await apps.build(initial.id);const installed=await apps.activate(initial.id,apps.store.read().revision);
  await apps.call(installed.id,'add_record',{id:crypto.randomUUID(),title:'Preserve this fixture record'});
  const draft=await apps.createDraft('react',installed.id),cwd=apps.draftDir(draft.id);
  const chat=q.createChatSession({label:'Fresh maintenance fixture',type:'content',harness:'claude',surfaceKind:'app-builder',surfaceRef:draft.id});
  let builds=0;
  server=http.createServer((req,res)=>{void(async()=>{
   const sdk=new McpServer({name:'fixture-builder',version:'1'});
   sdk.tool('build_app_draft','Build and validate the current app draft',{draft_id:z.string().uuid()},async input=>{
    builds++;const result=await dispatchAppAction({remote:true,actor:{sessionId:chat.id}} as never,'build',input) as {digest:string};
    return {content:[{type:'text',text:JSON.stringify({validated:true,digest:result.digest})}]};
   });
   const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await sdk.connect(transport);
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const request=new Request('http://fixture/mcp',{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),body:new Uint8Array(Buffer.concat(chunks))});
   try{const response=await transport.handleRequest(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}finally{await sdk.close();}
  })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});});await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  await runHarnessText({label:'local-app-fresh-maintenance',requiredHarness:'claude',tier:'standard',cwd,system:await appAvailabilityBrief(chat.id),prompt:'You are a fresh builder with no creation transcript. Read AGENTS.md, README.md, plugin.json and src/ui.tsx in this draft. Change its display name and visible heading to Weekend tracker, and document the purpose in README.md. Preserve action names, record storage and existing records. Edit source only. Use build_app_draft to verify the exact draft. Do not activate it or change grants. Finish after a successful build.',timeoutSec:120,maxTurns:16,skipPermissions:true,allowedTools:['Read','Write','Edit','mcp__fixture-builder__build_app_draft'],disallowedTools:['Bash','Agent','WebFetch','WebSearch'],mcpServers:[{name:'fixture-builder',type:'http',url:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/mcp'}],extraArgs:['--tools','Read,Write,Edit,mcp__fixture-builder__build_app_draft','--setting-sources','','--disable-slash-commands','--no-session-persistence']});
  assert(builds>0,'Fresh builder did not build its change');assert.equal(apps.draft(draft.id).buildStatus,'validated');
  assert.equal(JSON.parse(await fs.readFile(path.join(cwd,'plugin.json'),'utf8')).extensions['com.ri'].displayName,'Weekend tracker');
  assert.match(await fs.readFile(path.join(cwd,'src/ui.tsx'),'utf8'),/Weekend tracker/);assert.match(await fs.readFile(path.join(cwd,'README.md'),'utf8'),/Weekend tracker/i);
  await apps.activate(draft.id,apps.store.read().revision);
  assert.deepEqual((await apps.call(installed.id,'list_records',{limit:20}) as {records:{title:string}[]}).records.map(record=>record.title),['Preserve this fixture record']);
  console.log('PASS: fresh maintenance chat reads installed guides/source, edits and validates through the public build action, preserves stable actions and installed records');
 }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await apps.dispose();delete process.env.RI_LOCAL_APPS;await home.cleanup();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
