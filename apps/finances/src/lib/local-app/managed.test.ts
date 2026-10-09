import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, it, expect } from "vitest";
import { initializeDatabase, resetDb } from "@/lib/db";
import { financeOwner,grantFinance } from "@/lib/db/finance-queries";
import {
  initializeManaged,
  authorizeManagedPrincipal,
  authenticateManaged,
  revokeManagedPrincipal,
  shutdownManaged,
} from "./managed";
import { toolsDefinition } from "./definition";
import {outputSchemas} from "./schemas";
let root: string;
afterEach(() => {
  shutdownManaged();
  resetDb();
  delete process.env.FINANCE_ROOT;
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
it("sets up manual records, imports CSV, opens saved views and isolates two actor leases", async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "finance-local-app-"));
  process.env.FINANCE_ROOT = root;
  initializeManaged("00000000-0000-4000-8000-000000000001", null);
  initializeDatabase();
  const tools = toolsDefinition(),
    call = (name: string, input: unknown = {}, principal = financeOwner) =>
      tools.find((action) => action.name === name)!.run(principal, input);
  const initial = (await call("finance_open_app", {
    path: "/",
    query: {},
  })) as { data: { accounts: unknown[] } };
  expect(initial.data.accounts).toEqual([]);
  expect((initial as unknown as {scope:{actions:string[]}}).scope.actions).toEqual(expect.arrayContaining(['finance_transactions','finance_change_budget']));
  await call("finance_setup", {
    enabled: true,
    currency: "USD",
    timezone: "UTC",
    restoreReviewed: true,
  });
  const create = async (name: string) =>
    (await call("finance_create_account", {
      name,
      kind: "cash",
      provider: "manual",
      currency: "USD",
      connectionId: null,
      sourceId: crypto.randomUUID(),
      balanceMinor: 100000,
      balanceIncludesPending: false,
      historyStart: null,
      asOf: new Date().toISOString(),
    })) as { id: string };
  const a = await create("Account A"),
    b = await create("Account B");
  const access=await call('finance_open_app',{path:'/access',query:{hostActor:'chat:fixture-one'}});expect(outputSchemas.finance_open_app.parse(access)).toMatchObject({data:{accessSetup:{actorId:'chat:fixture-one'}},scope:{actions:['finance_create_scope'],bindings:{actorId:'chat:fixture-one'}}});
  await call("finance_import_csv", {
    accountId: a.id,
    text: "date,merchant,amount,category\n2026-10-01,Sample Shop,24.00,shopping",
    positiveMeansSpending: true,
  });
  const view = (await call("finance_create_default_view", {
    name: "Activity",
    accountIds: [a.id],
    startOn: "2026-01-01",
    endOn: "2027-01-01",
    budgetId: null,
    mutationKey: crypto.randomUUID(),
  })) as { id: string; revision: number };
  const opened = (await call("finance_open_app", {
    path: "/views/" + view.id,
    query: {},
  })) as { data: { data: { transactions: { id:string; amountMinor: number }[] } } };
  expect(opened.data.data.transactions[0].amountMinor).toBe(2400);
  const transaction=opened.data.data.transactions[0];
  expect(await call('finance_open_app',{path:'/records/transaction/'+transaction.id,query:{}})).toMatchObject({data:{inspection:{type:'transaction',record:{id:transaction.id,amountMinor:2400}}},scope:{actions:[]}});
  expect(await call('finance_describe_view_context',{path:'/records/transaction/'+transaction.id,query:{},state:{selected:[{type:'transaction',id:transaction.id}]}})).toMatchObject({recordRefs:[{entityType:'transaction',recordId:transaction.id}]});
  await expect(call('finance_describe_view_context',{path:'/records/transaction/'+transaction.id,query:{},state:{selected:[{type:'transaction',id:crypto.randomUUID()}]}})).rejects.toThrow(/only its opened record/);
  const proposal = (await call("finance_propose_budget", {
    accountIds: [a.id],
    incomeMinor: 300000,
    startDay: 1,
    mutationKey: crypto.randomUUID(),
  })) as {
    budget: {
      id: string;
      revision: number;
      state: string;
      plan: { categories: { id: string; limitMinor: number }[] };
    };
    views: { id: string; revision: number }[];
  };
  expect(proposal.budget.state).toBe("proposal");
  const before = (await call("finance_budget", { id: proposal.budget.id })) as {
    budget: { revision: number; plan: unknown };
  };
  const category = proposal.budget.plan.categories[0],
    budgetView = proposal.views[0];
  const preview = (await call("finance_scenario_preview", {
    viewId: budgetView.id,
    viewRevision: budgetView.revision,
    budgetRevision: proposal.budget.revision,
    changes: { categoryLimits: { [category.id]: category.limitMinor + 1000 }, goalContributions: {}, obligationAmounts: {} },
    mutationKey: crypto.randomUUID(),
  })) as { view: { revision: number } };
  expect(preview.view.revision).toBe(budgetView.revision);
  expect(
    await call("finance_budget", { id: proposal.budget.id }),
  ).toMatchObject({ budget: before.budget });
  const context = (await call("finance_describe_view_context", {
    path: "/views/" + budgetView.id,
    query: {},
    state: {
      selected: [],
      viewRevision: budgetView.revision,
      budgetRevision: proposal.budget.revision,
      changes: {
        categoryLimits: { [category.id]: category.limitMinor + 1000 }, goalContributions: {}, obligationAmounts: {},
      },
    },
  })) as { modelContent: string };
  expect(JSON.parse(context.modelContent).proposedChanges).toEqual({
    categoryLimits: { [category.id]: category.limitMinor + 1000 }, goalContributions: {}, obligationAmounts: {},
  });
  await call("finance_view_apply_scenario", {
    viewId: budgetView.id,
    viewRevision: budgetView.revision,
    budgetRevision: proposal.budget.revision,
    changes: { categoryLimits: { [category.id]: category.limitMinor + 1000 }, goalContributions: {}, obligationAmounts: {} },
    mutationKey: crypto.randomUUID(),
  });
  expect(
    await call("finance_budget", { id: proposal.budget.id }),
  ).toMatchObject({ budget: { revision: proposal.budget.revision + 1 } });
  const twoScope=(await call('finance_create_scope',{actorId:'chat:two-accounts',accountIds:[a.id,b.id],operations:['read']})) as {scopeRef:string};
  const twoLease=authorizeManagedPrincipal({actorId:'chat:two-accounts',role:'agent',scopeRef:twoScope.scopeRef,ticket:'two',expiresAt:Date.now()+30000});
  expect(authenticateManaged(twoLease.credential,'two')).not.toBeNull();
  grantFinance(financeOwner,'client:'+twoScope.scopeRef,[a.id],['read'],true);
  expect(authenticateManaged(twoLease.credential,'two')).toBeNull();
  await call('finance_revoke_scope',{scopeRef:twoScope.scopeRef});
  const scope = (await call("finance_create_scope", {
    actorId: "chat:actor-a",
    accountIds: [a.id],
    operations: ["read"],
  })) as { scopeRef: string };
  const lease = authorizeManagedPrincipal({
      actorId: "chat:actor-a",
      role: "agent",
      scopeRef: scope.scopeRef,
      ticket: "ticket-a",
      expiresAt: Date.now() + 30000,
    }),
    principal = authenticateManaged(lease.credential, "ticket-a")!;
  expect(authenticateManaged(lease.credential, "ticket-b")).toBeNull();
  const another = authorizeManagedPrincipal({
    actorId: "chat:actor-a",
    role: "agent",
    scopeRef: scope.scopeRef,
    ticket: "ticket-a",
    expiresAt: Date.now() + 30000,
  });
  await expect(
    call(
      "finance_transactions",
      { accountIds: [b.id], startOn: "2026-01-01", endOn: "2027-01-01" },
      principal,
    ),
  ).rejects.toThrow(/permission/);
  expect(() =>
    authorizeManagedPrincipal({
      actorId: "chat:actor-b",
      role: "agent",
      scopeRef: scope.scopeRef,
      ticket: "ticket-b",
      expiresAt: Date.now() + 30000,
    }),
  ).toThrow(/scope/);
  revokeManagedPrincipal({ credential: another.credential });
  expect(authenticateManaged(another.credential)).toBeNull();
  expect(await call('finance_list_scopes')).toMatchObject({scopes:[{scopeRef:scope.scopeRef,actorId:'chat:actor-a'}]});
  await call('finance_revoke_scope',{scopeRef:scope.scopeRef});expect(authenticateManaged(lease.credential)).toBeNull();
  expect(()=>authorizeManagedPrincipal({actorId:'chat:actor-a',role:'agent',scopeRef:scope.scopeRef,ticket:'ticket-a',expiresAt:Date.now()+30000})).toThrow(/scope/);
  expect(await call('finance_source_connections')).toMatchObject({unavailable:true,connections:[],operations:[]});
  expect(await call('finance_list_scopes')).toEqual({scopes:[]});
});
it('withholds a completed MCP result when one account grant changes during the callback',async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'finance-inflight-'));process.env.FINANCE_ROOT=root;initializeManaged(crypto.randomUUID(),null);initializeDatabase();
  const tools=toolsDefinition(),call=(name:string,input:unknown)=>tools.find(tool=>tool.name===name)!.run(financeOwner,input);
  await call('finance_setup',{enabled:true,currency:'USD',timezone:'UTC',restoreReviewed:true});
  const accounts:{id:string}[]=[];for(const name of ['Protected account A','Protected account B'])accounts.push(await call('finance_create_account',{name,kind:'cash',provider:'manual',currency:'USD',connectionId:null,sourceId:crypto.randomUUID(),balanceMinor:100000,balanceIncludesPending:false,historyStart:null,asOf:new Date().toISOString()}) as {id:string});
  const scope=await call('finance_create_scope',{actorId:'chat:inflight',accountIds:accounts.map(a=>a.id),operations:['read']}) as {scopeRef:string};const lease=authorizeManagedPrincipal({actorId:'chat:inflight',role:'agent',scopeRef:scope.scopeRef,ticket:null,expiresAt:Date.now()+30000});
  const {createFinanceMcpServer}=await import('@/lib/mcp/server'),{AppError}=await import('@ri/app-kit/contract'),{InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js'),{Client}=await import('@modelcontextprotocol/sdk/client/index.js');let first=true;
  const server=createFinanceMcpServer(()=>{const principal=authenticateManaged(lease.credential);if(!principal)throw new AppError('revoked','The Finance permission changed');if(first){first=false;queueMicrotask(()=>grantFinance(financeOwner,principal.id,[accounts[0].id],['read'],true));}return principal;});
  const [host,consumer]=InMemoryTransport.createLinkedPair(),client=new Client({name:'Fixture caller',version:'1'});
  try{await Promise.all([server.connect(host),client.connect(consumer)]);const result=await client.callTool({name:'finance_status',arguments:{}});expect(result.isError).toBe(true);expect(result._meta?.['com.ri/errorCode']).toBe('revoked');expect(JSON.stringify(result)).not.toContain('Protected account');}finally{await client.close();await server.close();}
});
