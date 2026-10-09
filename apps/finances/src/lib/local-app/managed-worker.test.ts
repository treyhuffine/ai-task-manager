import http from 'node:http';
import fs from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {createTestHome,type TestHome} from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import {initializeManaged,shutdownManaged} from './managed';
import {toolsDefinition} from './definition';
import {runFinanceCatchup,startFinanceWorker,stopFinanceWorker,financeWorkerHealth} from '@/lib/finance/worker';
import {getRawDb} from '@/lib/db';
import {connectorCallSchema} from '@/lib/connectors/contracts';
let home:TestHome,server:http.Server;
afterEach(async()=>{stopFinanceWorker();shutdownManaged();await new Promise<void>(resolve=>server?server.close(()=>resolve()):resolve());await home?.cleanup();});
it('runs the managed Gmail worker with no open view, retains its cursor and fails closed after broker revocation',async()=>{
  home=await createTestHome({prefix:'finance-managed-worker-'});
  const credential=crypto.randomUUID()+crypto.randomUUID(),modes:string[]=[];let revoked=false;
  server=http.createServer((req,res)=>{void(async()=>{
    expect(req.headers.authorization).toBe('Bearer '+credential);
    expect(req.headers['x-app-invocation-ticket']).toBeUndefined();
    res.setHeader('Content-Type','application/json');
    if(revoked){res.writeHead(403);res.end(JSON.stringify({version:1,ok:false,code:'auth_required',message:'Fixture account permission was revoked'}));return;}
    if(req.url==='/capabilities'){res.end(JSON.stringify({version:1,principal:{id:'fixture-worker',kind:'plugin'},operations:['gmail.messages.read'],connections:[{id:'fixture-mailbox',provider:'google',label:'Fictional mailbox',status:'active',scopes:['https://www.googleapis.com/auth/gmail.readonly']}]}));return;}
    expect(req.url).toBe('/call');const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const call=connectorCallSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));expect(call.connectionId).toBe('fixture-mailbox');expect(call.operation).toBe('gmail.messages.read');
    const mode=String(call.input.mode);modes.push(mode);
    const result=mode==='profile'?{historyId:'fixture-history-1'}:mode==='list'?{messages:[]}:mode==='history'?{history:[],historyId:'fixture-history-2'}:null;
    assertResult(result);res.end(JSON.stringify({version:1,ok:true,result}));
  })().catch(error=>{res.writeHead(500);res.end(JSON.stringify({version:1,ok:false,code:'fixture_failed',message:String(error)}));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
  initializeManaged(crypto.randomUUID(),{url:'http://127.0.0.1:'+port,credential});
  const tools=toolsDefinition(),call=(name:string,input:unknown)=>tools.find(tool=>tool.name===name)!.run(q.financeOwner,input);
  await call('finance_setup',{enabled:true,currency:'USD',timezone:'UTC',restoreReviewed:true});
  await call('finance_connect_mailbox',{connectionId:'fixture-mailbox',provider:'google',initialStartOn:'2026-01-01',query:'receipt',monitoring:true,acknowledgeBroadMailboxRead:true});
  startFinanceWorker();await expect.poll(()=>financeWorkerHealth().lastFinishedAt).not.toBeNull();
  expect(modes).toEqual(['profile','list']);expect(financeWorkerHealth()).toMatchObject({started:true,running:false});
  const account=q.listFinanceAccounts(q.financeOwner)[0];const first=getRawDb().prepare('SELECT cursor FROM finance_sync').get() as {cursor:string};expect(JSON.parse(first.cursor)).toEqual({phase:'history',historyId:'fixture-history-1'});
  q.queueFinanceSync(q.financeOwner,account.id);await runFinanceCatchup();expect(modes).toEqual(['profile','list','history']);
  revoked=true;q.queueFinanceSync(q.financeOwner,account.id);await runFinanceCatchup();expect(getRawDb().prepare('SELECT state FROM finance_sync').get()).toMatchObject({state:'disabled'});
  expect(q.listFinanceAccounts(q.financeOwner)[0]).toMatchObject({syncStatus:'reconnect'});
  expect(q.financeJobSummary()).toMatchObject({states:{disabled:1},hasMore:false});
  const configFiles=fs.readdirSync(home.root,{recursive:true});expect(configFiles.some(file=>String(file).endsWith('connector-broker.json'))).toBe(false);
  stopFinanceWorker();expect(financeWorkerHealth().started).toBe(false);
});
function assertResult(value:unknown):asserts value {if(!value)throw new Error('Unexpected worker operation');}
