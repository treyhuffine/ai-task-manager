import { createLocalAppSourceAdapter } from './source-adapter';
import { decodeSource } from '@/lib/chat-sources/reference';
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import {getLocalAppsWorkDir} from "@/lib/config/paths";
import { LocalAppsService } from "./service";
import {createTestHome} from "@/test/fixtures/home";
it.skipIf(!process.env.RI_FINANCE_FIXTURE)(
  "imports the independent qualified Finance artifact and runs manual records through authenticated MCP",
  async () => {
    const home=await createTestHome();
    const root=home.root;
    process.env.RI_ROOT = root;
    process.env.RI_LOCAL_APPS = "1";
    const chatA=crypto.randomUUID(),chatB=crypto.randomUUID();
    const service = new LocalAppsService(id=>[chatA,chatB].includes(id)?{status:'active',workspaceId:null}:null);
    try {
      await service.initialize();
      const draft = await service.import(process.env.RI_FINANCE_FIXTURE!);
      const instance = await service.activate(
        draft.id,
        service.store.read().revision,
      );
      expect(await service.serviceStatus(instance.id)).toMatchObject({ready:true,worker:{started:true},pendingSetup:true,jobs:{states:{}}});
      const opened = await service.openView(
        { id: instance.id, path: "/", query: {} },
        "fixture-owner",
      );
      expect(opened.prepared.html).toContain("Opening finances");
      await service.viewCall(
        opened.viewId,
        "fixture-owner",
        "finance_setup",
        {
          enabled: true,
          currency: "USD",
          timezone: "UTC",
          restoreReviewed: true,
        },
        crypto.randomUUID(),
      );
      expect(await service.serviceStatus(instance.id)).toMatchObject({ready:true,pendingSetup:false});
      const account = (await service.viewCall(
        opened.viewId,
        "fixture-owner",
        "finance_create_account",
        {
          name: "Fixture checking",
          kind: "cash",
          provider: "manual",
          currency: "USD",
          connectionId: null,
          sourceId: "fixture-checking",
          balanceMinor: 50000,
          balanceIncludesPending: false,
          historyStart: null,
          asOf: new Date().toISOString(),
        },
        crypto.randomUUID(),
      )) as { id: string; revision:number };
      const imported = await service.viewCall(
        opened.viewId,
        "fixture-owner",
        "finance_import_csv",
        {
          accountId: account.id,
          text: "date,merchant,amount,category\n2026-10-01,Fixture Shop,24.00,shopping",
          positiveMeansSpending: true,
        },
        crypto.randomUUID(),
      );
      expect(imported).toEqual({ imported: 1 });
      const access = await service.openView({id:instance.id,path:'/access',query:{hostActor:'chat:'+chatA}},'fixture-owner');
      expect(access.accessAction).toBe('finance_create_scope');
      await expect(service.viewCall(access.viewId,'fixture-owner','finance_transactions',{accountIds:[account.id]},crypto.randomUUID())).rejects.toMatchObject({code:'forbidden'});
      const chosen = await service.viewCall(access.viewId,'fixture-owner','finance_create_scope',{actorId:'chat:'+chatB,accountIds:[account.id],operations:['read']},crypto.randomUUID());
      expect(chosen).toMatchObject({actorId:'chat:'+chatA,accountIds:[account.id],operations:['read']});
      const saved = (await service.call(
        instance.id,
        "finance_create_default_view",
        {
          name: "Activity",
          accountIds: [account.id],
          startOn: "2026-01-01",
          endOn: "2027-01-01",
          budgetId: null,
          mutationKey: crypto.randomUUID(),
        },
      )) as { id: string };
      const view = await service.openView(
        { id: instance.id, path: "/views/" + saved.id, query: {} },
        "fixture-owner",
      );
      expect(view.result).toMatchObject({
        data: { transactions: [{ amountMinor: 2400 }] },
      });
      const changed=await service.createDraft('react',instance.id);
      const source=path.join(service.draftDir(changed.id),'src/lib/local-app/home-renderer.ts');
      await fs.writeFile(source,(await fs.readFile(source,'utf8')).replace('Your accounts, records and saved views.','Your updated accounts, records and saved views.'));
      await service.build(changed.id).catch(async error=>{throw new Error(error.message+'\n'+await fs.readFile(path.join(root,'app-drafts',changed.id,'logs/build.log'),'utf8'));});
      await service.activate(changed.id,service.store.read().revision);
      expect(await service.call(instance.id,'finance_home',{})).toMatchObject({accounts:[{id:account.id}],views:[{id:saved.id}]});
      const broken=await service.createDraft('react',instance.id);
      await fs.writeFile(path.join(service.draftDir(broken.id),'scripts/package-local-app.ts'),'This is invalid TypeScript');
      await expect(service.build(broken.id)).rejects.toThrow();
      expect(service.instance(instance.id)).toMatchObject({enabled:true,activation:{phase:'active'}});
      expect(await service.call(instance.id,'finance_home',{})).toMatchObject({accounts:[{id:account.id}]});
      const scope=await service.call(instance.id,'finance_create_scope',{actorId:'chat:'+chatA,accountIds:[account.id],operations:['read']}) as {scopeRef:string};
      await service.saveGrant({instanceId:instance.id,principal:{kind:'chat',id:chatA},actions:['finance_open_app','finance_describe_view_context','finance_transactions','finance_home'],riActions:[],connections:[],serviceScopeRef:scope.scopeRef},service.store.read().revision);
      const sourceAdapter = createLocalAppSourceAdapter(() => service);
      const sourceContext = { chatId: chatA, workspaceId: null, harnessReady: true };
      const mentioned = (await sourceAdapter.list(sourceContext)).find(source => decodeSource(source.sourceRef).kind === 'app')!;
      expect(mentioned).toMatchObject({ label: 'Finances', status: 'ready', view: 'available' });
      const financeRef = decodeSource(mentioned.sourceRef);
      expect((await sourceAdapter.actions(financeRef, sourceContext)).map(action => action.id)).toContain('finance_transactions');
      const mentionedResult = await sourceAdapter.call(financeRef, sourceContext, 'finance_transactions', { accountIds: [account.id], startOn: '2026-01-01', endOn: '2027-01-01' }, crypto.randomUUID());
      expect(mentionedResult).toHaveProperty('rows');
      const shared=await service.openView({id:instance.id,path:'/views/'+saved.id,query:{},chatId:chatA},'chat-a-viewer');
      const payload=shared.result as {view:{revision:number};data:{transactions:{id:string}[]}};
      const acknowledgement=await service.updateContext(shared.viewId,'chat-a-viewer',{formatVersion:1,revision:1,state:{viewRevision:payload.view.revision,selected:[{type:'transaction',id:payload.data.transactions[0].id}]}});
      expect(await service.freezeContext(chatA,{viewId:shared.viewId,revision:acknowledgement.revision},'chat-a-viewer')).toMatchObject({recordRefs:[{entityType:'transaction',recordId:payload.data.transactions[0].id}]});
      await expect(service.freezeContext(chatB,{viewId:shared.viewId,revision:1},'chat-a-viewer')).rejects.toThrow(/acknowledged/);
      await expect(service.updateContext(shared.viewId,'chat-a-viewer',{formatVersion:1,revision:2,state:{viewRevision:payload.view.revision,selected:[{type:'transaction',id:crypto.randomUUID()}]}})).rejects.toThrow();
      await service.call(instance.id,'finance_revoke_scope',{scopeRef:scope.scopeRef});
      await expect(service.freezeContext(chatA,{viewId:shared.viewId,revision:1},'chat-a-viewer')).rejects.toThrow();
      await expect(service.call(instance.id,'finance_transactions',{accountIds:[account.id],startOn:'2026-01-01',endOn:'2027-01-01'},{kind:'chat',id:chatA})).rejects.toThrow();
      const exported=await service.export(instance.id);
      const exportedFile=path.join(getLocalAppsWorkDir(),exported.name);
      expect(exported.inventory.some(file=>/managed-scopes\.json$|(^|\/)data\.db(?:-|$)|ownership\.json$/.test(file.name))).toBe(false);
      await service.configure(instance.id,{archived:true},service.store.read().revision);
      expect(service.engine.condition(instance.id).condition).toBe('stopped');
      expect(service.store.read().grants.every(grant=>grant.instanceId!==instance.id||grant.revokedAt)).toBe(true);
      await service.dispose();
      const freshRoot=await fs.mkdtemp(path.join(os.tmpdir(),'ri-finance-clean-import-'));
      const oldPaths={RI_CONFIG_DIR:process.env.RI_CONFIG_DIR,RI_WORK_DIR:process.env.RI_WORK_DIR,RI_DB_PATH:process.env.RI_DB_PATH};
      process.env.RI_ROOT=freshRoot;process.env.RI_CONFIG_DIR=path.join(freshRoot,'.config');process.env.RI_WORK_DIR=path.join(freshRoot,'.work');process.env.RI_DB_PATH=path.join(freshRoot,'data.db');
      const fresh=new LocalAppsService();
      try{await fresh.initialize();const cleanDraft=await fresh.import(exportedFile);const clean=await fresh.activate(cleanDraft.id,fresh.store.read().revision);expect(await fresh.call(clean.id,'finance_home',{})).toMatchObject({accounts:[],views:[],settings:null});}finally{await fresh.dispose();await fs.rm(freshRoot,{recursive:true,force:true});process.env.RI_ROOT=root;Object.assign(process.env,oldPaths);}
      await service.initialize();
      await service.resume();
      await service.configure(instance.id,{archived:false,enabled:true},service.store.read().revision);
      await service.saveGrant({instanceId:instance.id,principal:{kind:'owner-ui',id:'owner'},actions:(await service.describe(instance.id)).contract.actions.filter(action=>action.audience.includes('user')).map(action=>action.name),riActions:[],connections:[],serviceScopeRef:null},service.store.read().revision);
      await service.engine.stop(instance.id);
      expect(await service.call(instance.id, "finance_home", {})).toMatchObject(
        { accounts: [{ name: "Fixture checking" }] },
      );
    } catch (error) {
      const files = await fs.readdir(root, { recursive: true });
      const logs = await Promise.all(
        files
          .filter((file) => file.includes("/logs/") && file.endsWith(".log"))
          .map(
            async (file) =>
              file + "\n" + (await fs.readFile(path.join(root, file), "utf8")),
          ),
      );
      throw new Error(String(error) + "\n" + logs.join("\n"), { cause: error });
    } finally {
      await service.dispose();
      await home.cleanup();
      delete process.env.RI_ROOT;
      delete process.env.RI_LOCAL_APPS;
    }
  },
  240_000,
);
