/** Fresh subscription-harness prompt qualification, with synthetic app records. */
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
 const artifact=process.argv[2];assert(artifact,'Supply a qualified Finance fixture archive');
 const home=await createTestHome({prefix:'ri-workflow-prompts-'});process.env.RI_LOCAL_APPS='1';const apps=localApps();
 try{
  q.updateUserState({defaultHarness:'claude',defaultModel:null});await apps.initialize();const draft=await apps.import(artifact),instance=await apps.activate(draft.id,apps.store.read().revision);
  const account=await apps.call(instance.id,'finance_create_account',{name:'Workflow fixture account',kind:'cash',provider:'manual',currency:'USD',connectionId:null,sourceId:'workflow-fixture',balanceMinor:100000,balanceIncludesPending:false,historyStart:null,asOf:new Date().toISOString()}).catch(async()=>{await apps.call(instance.id,'finance_setup',{enabled:true,currency:'USD',timezone:'UTC',restoreReviewed:true});return apps.call(instance.id,'finance_create_account',{name:'Workflow fixture account',kind:'cash',provider:'manual',currency:'USD',connectionId:null,sourceId:'workflow-fixture',balanceMinor:100000,balanceIncludesPending:false,historyStart:null,asOf:new Date().toISOString()});}) as {id:string};
  const cases=[
   {name:'direct',prompt:`Review my October 2026 finances for account ${account.id}.`,workflow:'monthly-review'},
   {name:'indirect',prompt:`Where did my October 2026 money go? Use the permitted account ${account.id}.`,workflow:'monthly-review'},
   {name:'follow-up',prompt:`Earlier I asked about a refund for Fixture Shop in account ${account.id}. We have no receipt evidence yet. Can you check whether I got that refund and tell me what is missing?`,workflow:'refund-investigation'},
   {name:'missing-input',prompt:'Help me review my money this month. I have not chosen accounts or a month yet.',workflow:'monthly-review'},
   {name:'negative',prompt:'Write a short poem about a pine tree.',workflow:null},
  ];
  for(const sample of cases){
   const chat=q.createChatSession({label:'Fixture '+sample.name,type:'content',harness:'claude',surfaceKind:'app',surfaceRef:instance.id});
   const scope=await apps.call(instance.id,'finance_create_scope',{actorId:'chat:'+chat.id,accountIds:[account.id],operations:['read']}) as {scopeRef:string};
   await apps.saveGrant({instanceId:instance.id,principal:{kind:'chat',id:chat.id},actions:['finance_status','finance_transactions','finance_budget','finance_findings'],riActions:[],connections:[],serviceScopeRef:scope.scopeRef},apps.store.read().revision);
   const calls:{name:string;workflow?:string}[]=[];
   const server=http.createServer((req,res)=>{void(async()=>{
    const sdk=new McpServer({name:'fixture-apps',version:'1'}),context={remote:true,actor:{sessionId:chat.id}};
    sdk.tool('describe_app','Read the authorized action contracts before using app tools',{instance_id:z.string().uuid()},async input=>{calls.push({name:'describe'});const result=await dispatchAppAction(context as never,'describe',input);return {content:[{type:'text',text:JSON.stringify(result)}]};});
    sdk.tool('get_app_workflow','Read the current authorized app workflow on demand',{instance_id:z.string().uuid(),name:z.string()},async input=>{calls.push({name:'workflow',workflow:input.name});const result=await dispatchAppAction(context as never,'workflow',input);return {content:[{type:'text',text:JSON.stringify(result)}]};});
    sdk.tool('call_app_action','Call an authorized app action',{instance_id:z.string().uuid(),action:z.string(),input:z.record(z.unknown())},async input=>{calls.push({name:input.action});const result=await dispatchAppAction(context as never,'call',input);return {content:[{type:'text',text:JSON.stringify(result)}]};});
    const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await sdk.connect(transport);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=new Request('http://fixture/mcp',{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),body:new Uint8Array(Buffer.concat(chunks))});
    try{const response=await transport.handleRequest(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}finally{await sdk.close();}
   })().catch(()=>{res.writeHead(500);res.end();});});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
   const cwd=path.join(home.root,'workflow-cases',sample.name);await fs.mkdir(cwd,{recursive:true});
   try{
    const result=await runHarnessText({label:'local-app-workflow-'+sample.name,requiredHarness:'claude',tier:'standard',cwd,system:await appAvailabilityBrief(chat.id),prompt:sample.prompt,timeoutSec:90,maxTurns:12,mcpServers:[{name:'fixture-apps',type:'http',url:'http://127.0.0.1:'+(server.address() as {port:number}).port+'/mcp'}],allowedTools:['mcp__fixture-apps__get_app_workflow','mcp__fixture-apps__call_app_action','mcp__fixture-apps__describe_app'],skipPermissions:false,disallowedTools:['Read','Write','Edit','Bash','Agent','WebFetch','WebSearch'],extraArgs:['--tools','mcp__fixture-apps__get_app_workflow,mcp__fixture-apps__call_app_action,mcp__fixture-apps__describe_app','--setting-sources','','--disable-slash-commands','--no-session-persistence']});
    if(sample.workflow)assert(calls.some(call=>call.name==='workflow'&&call.workflow===sample.workflow),sample.name+' did not load its workflow');else assert.equal(calls.length,0,'An unrelated prompt used Finance');
    if(sample.name==='missing-input')assert.match(result.text,/account|month/i);if(sample.name==='follow-up')assert.match(result.text,/missing|evidence|receipt|cannot|unable/i);
    console.log('PASS workflow prompt: '+sample.name);
   }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
   await apps.revokeGrant(apps.grant(instance.id,{kind:'chat',id:chat.id}).id,apps.store.read().revision);assert(! (await appAvailabilityBrief(chat.id)).includes(instance.id));
   await assert.rejects(dispatchAppAction({remote:true,actor:{sessionId:chat.id}} as never,'workflow',{instance_id:instance.id,name:'monthly-review'}));
  }
  await apps.configure(instance.id,{archived:true},apps.store.read().revision);console.log('PASS: per-turn revocation, archive, and no ambient skill install');
 }finally{await apps.dispose();delete process.env.RI_LOCAL_APPS;await home.cleanup();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
