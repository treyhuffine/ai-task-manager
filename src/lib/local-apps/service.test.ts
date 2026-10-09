import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LocalAppsService } from "./service";
vi.mock("@/lib/service/maintenance", () => ({ beginActivity: () => () => {} }));
let root: string, service: LocalAppsService;
afterEach(async () => {
  await service?.dispose();
  if (root) await fs.rm(root, { recursive: true, force: true });
  delete process.env.RI_LOCAL_APPS;
  delete process.env.RI_ROOT;
});
it("builds, activates and restarts a portable generated tracker with separate preview records", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ri-local-apps-"));
  process.env.RI_ROOT = root;
  delete process.env.RI_LOCAL_APPS;
  service = new LocalAppsService();
  await service.initialize();
  const draft = await service.createDraft("react");
  const result = await service.build(draft.id).catch(async (error) => {
    const log = await fs.readFile(
      path.join(root, "app-drafts", draft.id, "logs/build.log"),
      "utf8",
    );
    throw new Error(error.message + "\n" + log);
  });
  expect(result.contract.actions.map((action) => action.name)).toContain(
    "add_record",
  );
  const view = await service.openView(
    { id: draft.id, draft: true, path: "/", query: {} },
    "viewer",
  );
  await service.viewCall(
    view.viewId,
    "viewer",
    "add_record",
    { id: crypto.randomUUID(), title: "Fixture only" },
    crypto.randomUUID(),
  );
  const installed = await service.activate(
    draft.id,
    service.store.read().revision,
  );
  expect(
    await service.call(installed.id, "list_records", { limit: 20 }),
  ).toEqual({ records: [], nextCursor: null });
  const invocationId = crypto.randomUUID(),
    input = { id: crypto.randomUUID(), title: "Keep this record" };
  await service.call(
    installed.id,
    "add_record",
    input,
    undefined,
    invocationId,
  );
  await service.engine.stop(installed.id);
  await service.call(
    installed.id,
    "add_record",
    input,
    undefined,
    invocationId,
  );
  const rows = (await service.call(installed.id, "list_records", {
    limit: 20,
  })) as { records: { title: string }[] };
  expect(rows.records).toHaveLength(1);
  // The scheduler runs an actual SDK action without an installed app view.
  await service.engine.stop(installed.id);
  const jobId = crypto.randomUUID();
  const jobGrant = await service.saveGrant({instanceId:installed.id,principal:{kind:'job',id:jobId},actions:['list_records'],riActions:[],connections:[],serviceScopeRef:null},service.store.read().revision);
  await service.schedule({instanceId:installed.id,action:'list_records',input:{limit:20},cron:'* * * * *',timezone:'UTC',activeHours:null,enabled:true,grantId:jobGrant.id},service.store.read().revision);
  const tickAt = new Date();
  await service.store.activity(state => {state.schedules.find(job=>job.id===jobId)!.nextRunAt = new Date(tickAt.getTime()-86400000).toISOString();});
  await service.tick(tickAt);
  await expect.poll(()=>service.store.read().invocations.find(item=>item.scheduleId===jobId)?.outcome,{timeout:10000}).toBe('success');
  await service.tick(tickAt);
  expect(service.store.read().invocations.filter(item=>item.scheduleId===jobId)).toHaveLength(1);
  expect(service.engine.condition(installed.id).condition).toBe('running');
  const exported = await service.export(installed.id);
  expect(
    exported.inventory.some((file) => file.name.includes("records.db")),
  ).toBe(false);
  const changed = await service.createDraft("react", installed.id);
  const manifestFile = path.join(service.draftDir(changed.id), "plugin.json"),
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  manifest.extensions["com.ri"].displayName = "Updated tracker";
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  await service.build(changed.id);
  await service.activate(changed.id, service.store.read().revision);
  expect(service.list().instances.find(item => item.id === installed.id)).toMatchObject({
    slug: installed.slug,
    displayName: "Updated tracker",
  });
  expect(
    await service.call(installed.id, "list_records", { limit: 20 }),
  ).toMatchObject({ records: [{ title: "Keep this record" }] });
  const broken = await service.createDraft("react", installed.id);
  await fs.writeFile(
    path.join(service.draftDir(broken.id), "src/server.ts"),
    "import fs from 'node:fs';import path from 'node:path';import {serveApp} from '@ri/app-kit/sdk';import {definition,initialize,shutdown} from './actions';serveApp(definition,{initialize:async boot=>{await initialize(boot.dataDir,boot.instanceId);fs.writeFileSync(path.join(boot.dataDir,'migration-marker.txt'),'fixture migration');throw new Error('Fixture readiness failure');},shutdown});",
  );
  await service.build(broken.id);
  await expect(
    service.activate(broken.id, service.store.read().revision),
  ).rejects.toThrow();
  expect(service.instance(installed.id, false)).toMatchObject({
    enabled: false,
    activation: { phase: "failed" },
  });
  expect(
    await fs.readFile(
      path.join(root, "apps", installed.id, "data/migration-marker.txt"),
      "utf8",
    ),
  ).toBe("fixture migration");
  expect(
    await fs.stat(
      path.join(root, "apps", installed.id, "previous-package/plugin.json"),
    ),
  ).toBeTruthy();
  expect(
    await fs.stat(
      path.join(root, "apps", installed.id, "previous-data/records.db"),
    ),
  ).toBeTruthy();
  const interruptedId = crypto.randomUUID();
  await service.store.activity(state => {
    const previous = state.invocations.find(item=>item.scheduleId===jobId)!;
    state.invocations.push({...previous,id:interruptedId,finishedAt:null,outcome:'running'});
    state.schedules.find(job=>job.id===jobId)!.runningInvocationId=interruptedId;
  });
  await service.dispose();
  service = new LocalAppsService();
  await service.initialize();
  expect(service.store.read().invocations.find(item=>item.id===interruptedId)).toMatchObject({outcome:'interrupted'});
  expect(service.store.read().schedules.find(job=>job.id===jobId)?.runningInvocationId).toBeNull();
  expect(service.engine.condition(installed.id).condition).toBe("stopped");
  await service.repair(installed.id, "previous", service.store.read().revision);
  expect(
    await service.call(installed.id, "list_records", { limit: 20 }),
  ).toMatchObject({ records: [{ title: "Keep this record" }] });
  const opened = await service.openView(
    { id: installed.id, path: "/", query: {} },
    "viewer",
  );
  await service.configure(
    installed.id,
    { enabled: false },
    service.store.read().revision,
  );
  await expect(
    service.viewCall(
      opened.viewId,
      "viewer",
      "list_records",
      { limit: 20 },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "revoked" });
}, 180_000);
it("feature off has no metadata or process side effects", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ri-local-apps-off-"));
  process.env.RI_ROOT = root;
  process.env.RI_LOCAL_APPS = "0";
  service = new LocalAppsService();
  expect(() => service.initialize()).toThrowError(/not enabled/);
  expect(await fs.readdir(root)).toEqual([]);
});
