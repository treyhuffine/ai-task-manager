import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { it, expect, vi } from "vitest";
import { LocalAppsService } from "./service";
import {
  createHomeBackup,
  restoreHomeBackup,
  verifyHomeBackup,
} from "@/lib/home/backup";
import { AppStateStore } from "./state";
vi.mock("@/lib/service/maintenance", () => ({ beginActivity: () => () => {} }));
let service: LocalAppsService;
vi.mock("@/lib/orchestrator/server-client", () => ({
  serverFetch: async (
    _path: string,
    options: { method: string; body?: string },
  ) => {
    if (options.method === "POST") return service.beginSnapshot();
    await service.endSnapshot(JSON.parse(options.body!).lease);
    return {};
  },
}));
it("stops an app writer for a complete Home backup and restores records with authority disabled", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ri-app-backup-")),
    root = path.join(dir, "home"),
    backup = path.join(dir, "backup"),
    restored = path.join(dir, "restored");
  await fs.mkdir(root);
  process.env.RI_ROOT = root;
  process.env.RI_LOCAL_APPS = "1";
  service = new LocalAppsService();
  const homeDb = new Database(path.join(root, "data.db"));
  homeDb.exec("CREATE TABLE fixture (id TEXT PRIMARY KEY)");
  homeDb.close();
  const ownerLock = new Database(path.join(root, "data.db.owner.sqlite"));
  ownerLock.exec("BEGIN IMMEDIATE");
  try {
    await service.initialize();
    const draft = await service.createDraft("html");
    await service.build(draft.id);
    const app = await service.activate(draft.id, service.store.read().revision);
    await service.call(app.id, "add_record", {
      id: crypto.randomUUID(),
      title: "Durable backup fixture",
    });
    await service.setPanel("fixture-chat", app.id, { path: "/", query: {} });
    const manifest = await createHomeBackup({ root, outDir: backup });
    expect(verifyHomeBackup(backup)).toEqual({ ok: true, problems: [] });
    expect(
      manifest.files.some(
        (file) => file.path === `apps/${app.id}/data/records.db`,
      ),
    ).toBe(true);
    expect(
      manifest.files.some(
        (file) =>
          file.path.includes("/logs/") ||
          file.path.includes("/cache/") ||
          file.path.includes("/package/node_modules/"),
      ),
    ).toBe(false);
    expect(service.engine.condition(app.id).condition).toBe("stopped");
    expect(
      await service.call(app.id, "list_records", { limit: 20 }),
    ).toMatchObject({ records: [{ title: "Durable backup fixture" }] });
    restoreHomeBackup({ backupDir: backup, root: restored });
    const state = new AppStateStore(
      path.join(restored, ".config/local-apps/state.json"),
    ).read();
    expect(state.instances.every((instance) => !instance.enabled)).toBe(true);
    expect(state.grants.every((grant) => grant.revokedAt)).toBe(true);
    expect(state.panels).toEqual([]);
    expect(state.schedules.every((job) => !job.enabled)).toBe(true);
    const data = new Database(
      path.join(restored, "apps", app.id, "data/records.db"),
    );
    try {
      expect(data.prepare("SELECT title FROM records").all()).toEqual([
        { title: "Durable backup fixture" },
      ]);
    } finally {
      data.close();
    }
  } finally {
    await service.dispose();
    ownerLock.close();
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.RI_ROOT;
    delete process.env.RI_LOCAL_APPS;
  }
}, 180_000);
