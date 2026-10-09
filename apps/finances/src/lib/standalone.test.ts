import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {createTestHome,type TestHome} from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import {seedSyntheticFinance} from '@/lib/finance/synthetic';
import {authenticateToken,ownerToken,createClientKey,revokeClientKey,requestPrincipal} from './auth';
import {saveBrokerConfig} from './connectors/config';
import {callConnector,connectorCapabilities} from './connectors/client';
import {runViewOperation} from './mcp/view-operations';
import {backupFinance,restoreFinance} from './backup';
import {resetDb,getRawDb} from './db';
import {boundedRequestBody} from './http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createFinanceMcpServer,FINANCE_RESOURCE} from './mcp/server';
let home:TestHome;
beforeEach(async()=>{home=await createTestHome();});
afterEach(async()=>{vi.unstubAllGlobals();await home.cleanup();});
describe('independent app permissions and persistence',()=>{
 it('bounds requests without a Content-Length header before JSON parsing',async()=>{
  const small=new Request('http://localhost/test',{method:'POST',body:'hello'});expect(new TextDecoder().decode(await boundedRequestBody(small,5))).toBe('hello');
  const large=new Request('http://localhost/test',{method:'POST',body:'x'.repeat(1025)});expect(large.headers.get('content-length')).toBeNull();await expect(boundedRequestBody(large,1024)).rejects.toThrow('byte limit');
 });
 it('refuses a modified applied migration ledger on reopening',()=>{
  seedSyntheticFinance(q.financeOwner);getRawDb().prepare('UPDATE finance_migrations SET digest=? WHERE id=?').run('tampered','0000_finance.sql');resetDb();expect(()=>q.getFinanceSettings()).toThrow('applied finance migration changed');
 });
 it('stores hashed client keys, limits their accounts and revokes active clients',()=>{
  const f=seedSyntheticFinance(q.financeOwner),key=createClientKey({label:'Test client',accountIds:[f.accounts[0].id],operations:['read']});
  const p=authenticateToken(key.token)!;expect(p.owner).toBe(false);expect(q.listFinanceAccounts(p)).toHaveLength(1);
  expect(()=>q.requireFinance(p,[f.accounts[1].id])).toThrow();expect(()=>q.requireFinance(p,[f.accounts[0].id],'write')).toThrow();
  revokeClientKey(key.id);expect(authenticateToken(key.token)).toBeNull();expect(()=>q.requireFinance(p,[f.accounts[0].id])).toThrow();
  expect(fs.statSync(path.join(home.configDir,'owner.key')).mode&0o777).toBe(0o600);
 });
 it('rejects unconfigured hosts and cross-origin browser mutations',()=>{
  const token=ownerToken();expect(()=>requestPrincipal(new Request('http://localhost:42301/mcp',{headers:{authorization:'Bearer '+token,origin:'https://evil.example'}}))).toThrow();
  expect(()=>requestPrincipal(new Request('http://evil.example/mcp',{headers:{authorization:'Bearer '+token}}))).toThrow();
  expect(requestPrincipal(new Request('http://[::1]:42301/mcp',{headers:{authorization:'Bearer '+token}}))).toEqual(q.financeOwner);
 });
 it('rejects stale financial actions and applies and undoes each click once',()=>{
  const f=seedSyntheticFinance(q.financeOwner),view=f.views.find(v=>v.scope.budgetId)!;
  const input={viewId:view.id,viewRevision:view.revision,budgetRevision:f.budget.revision,mutationKey:'widget-change-001',changes:{categoryLimits:{dining:30000},goalContributions:{},obligationAmounts:{}}};
  runViewOperation(q.financeOwner,'finance_view_apply_scenario',input);runViewOperation(q.financeOwner,'finance_view_apply_scenario',input);
  const changed=q.getFinanceBudget(q.financeOwner,f.budget.id);expect(changed.revision).toBe(f.budget.revision+1);
  expect(()=>runViewOperation(q.financeOwner,'finance_view_apply_scenario',{...input,mutationKey:'widget-change-002'})).toThrow('budget changed');
  const undo={viewId:view.id,viewRevision:view.revision,budgetRevision:changed.revision,mutationKey:'widget-undo-001'};
  runViewOperation(q.financeOwner,'finance_view_undo_budget',undo);runViewOperation(q.financeOwner,'finance_view_undo_budget',undo);
  expect(q.getFinanceBudget(q.financeOwner,f.budget.id).plan).toEqual(f.budget.plan);
  expect(()=>runViewOperation(q.financeOwner,'finance_view_undo_budget',{...undo,budgetRevision:0})).toThrow('different change');
 });
 it('preserves a running lease, queues another delivery and blocks an obsolete worker',()=>{
  const f=seedSyntheticFinance(q.financeOwner),id=f.accounts[0].id;getRawDb().prepare('UPDATE finance_accounts SET access=? WHERE id=?').run('connected',id);q.queueFinanceSync(q.financeOwner,id);
  const job=q.claimFinanceJobs(new Date(Date.now()+1000).toISOString(),1)[0];expect(job.leaseToken).toBeTruthy();q.queueFinanceSync(q.financeOwner,id);
  q.finishFinanceJob(job.id,{generation:job.generation,leaseToken:job.leaseToken,cursor:'finished'});
  const next=q.claimFinanceJobs(new Date(Date.now()+1000).toISOString(),1)[0];expect(next).toBeTruthy();expect(next.leaseToken).not.toBe(job.leaseToken);
  expect(()=>q.applyFinanceSync(q.financeOwner,{accountIds:[id],generation:job.generation,added:[],removed:[],asOf:new Date().toISOString(),jobId:job.id,leaseToken:job.leaseToken})).toThrow('lease changed');
 });
 it('resumes disabled sync jobs without waiting for a new webhook',()=>{
  const f=seedSyntheticFinance(q.financeOwner),id=f.accounts[0].id;getRawDb().prepare('UPDATE finance_accounts SET access=? WHERE id=?').run('connected',id);q.queueFinanceSync(q.financeOwner,id);
  q.configureFinance(q.financeOwner,{enabled:false});expect(q.claimFinanceJobs(new Date(Date.now()+1000).toISOString(),1)).toEqual([]);q.configureFinance(q.financeOwner,{enabled:true});
  const job=q.claimFinanceJobs(new Date(Date.now()+1000).toISOString(),1)[0];expect(job.accountId).toBe(id);expect(job.generation).toBe(q.getFinanceSettings()!.generation);
 });
 it('restores backups with access blocked until owner review',async()=>{
  const f=seedSyntheticFinance(q.financeOwner),backup=home.root+'-backup',restore=home.root+'-restore';
  try{await backupFinance(backup);resetDb();process.env.FINANCE_ROOT=restore;restoreFinance(backup);expect(()=>q.getFinanceBudget(q.financeOwner,f.budget.id)).toThrow('Review restored');q.configureFinance(q.financeOwner,{enabled:true,restoreReviewed:true});expect(q.getFinanceBudget(q.financeOwner,f.budget.id).plan).toEqual(f.budget.plan);}
  finally{resetDb();process.env.FINANCE_ROOT=home.root;fs.rmSync(backup,{recursive:true,force:true});fs.rmSync(restore,{recursive:true,force:true});}
 });
 it('publishes a stable MCP resource and enforces grants at tool execution',async()=>{
  const f=seedSyntheticFinance(q.financeOwner),key=createClientKey({label:'MCP',accountIds:f.accounts.map(a=>a.id),operations:['read']});
  const server=createFinanceMcpServer(()=>{const p=authenticateToken(key.token);if(!p)throw new Error('Client revoked');return p;});
  const client=new Client({name:'standalone-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{const listed=await client.listTools();expect(listed.tools.find(t=>t.name==='finance_open_view')?._meta).toMatchObject({ui:{resourceUri:FINANCE_RESOURCE}});const resource=await client.readResource({uri:FINANCE_RESOURCE});expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app');expect('text' in resource.contents[0]&&resource.contents[0].text).toContain('standardApp');
   const opened=await client.callTool({name:'finance_open_view',arguments:{id:f.views[0].id}});expect(opened.isError).not.toBe(true);revokeClientKey(key.id);expect((await client.callTool({name:'finance_status',arguments:{}})).isError).toBe(true);
  }finally{await client.close();await server.close();}
 });
});
describe('versioned connector broker boundary',()=>{
 const caps={version:1,principal:{id:'finance-plugin',kind:'plugin'},operations:['plaid.transactions.sync'],connections:[{id:'bank-1',provider:'plaid',label:'Fictional bank',status:'active',scopes:['transactions']}]};
 it('reports a missing broker without a Ri credential fallback',async()=>{await expect(connectorCapabilities()).rejects.toThrow('not been configured');});
 it('seals its plugin credential and sends only granted typed calls',async()=>{
  const token='scoped-plugin-token-0001';saveBrokerConfig({url:'http://127.0.0.1:12345/broker/v1',token});expect(fs.readFileSync(path.join(home.configDir,'connector-broker.json'),'utf8')).not.toContain(token);
  const fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{expect(new Headers(init?.headers).get('authorization')).toBe('Bearer '+token);if(url.endsWith('/capabilities'))return Response.json(caps);const body=JSON.parse(init?.body as string);expect(body.operation).toBe('plaid.transactions.sync');expect(body.connectionId).toBe('bank-1');return Response.json({version:1,ok:true,result:{added:[],next_cursor:'next'}});});vi.stubGlobal('fetch',fetchMock);
  expect(await callConnector('bank-1','plaid.transactions.sync',{cursor:'old'})).toEqual({added:[],next_cursor:'next'});await expect(callConnector('bank-2','plaid.transactions.sync',{})).rejects.toThrow('outside the plugin grant');expect(fetchMock).toHaveBeenCalledTimes(3);
 });
 it('rejects credentials returned by the broker and revoked connections',async()=>{
  saveBrokerConfig({url:'http://localhost:12345/broker',token:'scoped-plugin-token-0002'});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...caps,connections:[{...caps.connections[0],status:'revoked'}]})));await expect(callConnector('bank-1','plaid.transactions.sync',{})).rejects.toThrow('outside the plugin grant');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...caps,access_token:'must-never-arrive'})));await expect(connectorCapabilities()).rejects.toThrow('credential');
 });
});
