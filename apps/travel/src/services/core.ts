/**
 * The Travel instance: storage, settings and the shared helpers every action
 * uses. Opening it applies migrations and nothing else. No timers, no sync.
 */
import path from "node:path";
import { z } from "zod/v4";
import { openAppDatabase, type AppInvocation } from "@ri/app-kit/sdk";
import { actorOf, createBlobStore, createJobQueue, createScopeStore, createSettings, migrate, type AccessScope, type Operation, type SqlDatabase } from "@ri/app-kit/data";
import { createAccountStore, createMailIndex } from "@ri/app-kit/sources";
import { isValidZone, todayIn } from "@ri/app-kit/time";
import { MIGRATIONS } from "../db/migrations.js";
import { createRepo } from "../db/repo.js";
import { createIngest } from "./ingest.js";

export interface TravelSettings { homeZone: string | null; ownerNames: string[]; aiExtraction: boolean }
/** Policy defaults live here, not in SQL. */
export const DEFAULT_SETTINGS: TravelSettings = { homeZone: null, ownerNames: [], aiExtraction: false };
export const DEFAULT_HISTORY_DAYS = 90;
export const CALENDAR_PAST_DAYS = 30;
export const CALENDAR_FUTURE_DAYS = 365;

export interface OpenOptions { now?: () => Date }
export async function openTravel(dataDir: string, instanceId: string, options: OpenOptions = {}) {
  const store = await openAppDatabase(path.join(dataDir, "records.db"));
  const db = store.db as unknown as SqlDatabase;
  migrate(db, MIGRATIONS);
  return createTravel(store, db, path.join(dataDir, "blobs"), instanceId, options);
}

export function createTravel(store: Awaited<ReturnType<typeof openAppDatabase>>, db: SqlDatabase, blobDir: string, instanceId: string, options: OpenOptions = {}) {
  const now = options.now ?? (() => new Date());
  const repo = createRepo(db, now);
  const blobs = createBlobStore(blobDir);
  const settingsStore = createSettings(db);
  const scopes = createScopeStore(db, () => instanceId);
  const jobs = createJobQueue(db);
  const accounts = createAccountStore(db);
  const mailIndex = createMailIndex(db);

  const settings = {
    get(): TravelSettings {
      return {
        homeZone: settingsStore.get("travel.homeZone", z.string().nullable(), DEFAULT_SETTINGS.homeZone),
        ownerNames: settingsStore.get("travel.ownerNames", z.array(z.string()), DEFAULT_SETTINGS.ownerNames),
        aiExtraction: settingsStore.get("travel.aiExtraction", z.boolean(), DEFAULT_SETTINGS.aiExtraction),
      };
    },
    set(patch: Partial<TravelSettings>) {
      if (patch.homeZone !== undefined) settingsStore.set("travel.homeZone", patch.homeZone && isValidZone(patch.homeZone) ? patch.homeZone : null);
      if (patch.ownerNames !== undefined) settingsStore.set("travel.ownerNames", patch.ownerNames);
      if (patch.aiExtraction !== undefined) settingsStore.set("travel.aiExtraction", patch.aiExtraction);
    },
    lastTripId(): string | null {
      return settingsStore.get("view.lastTripId", z.string().nullable(), null);
    },
    setLastTripId(id: string | null) {
      settingsStore.set("view.lastTripId", id);
    },
    fixtureSeeded(): boolean {
      return settingsStore.get("fixture.seeded", z.boolean(), false);
    },
    markFixtureSeeded() {
      settingsStore.set("fixture.seeded", true);
    },
    raw: settingsStore,
  };

  const travel = {
    instanceId, store, db, repo, blobs, settings, scopes, jobs, accounts, mailIndex, now,
    /** The zone for "today" and date-only reasoning: the home zone, else the process zone. */
    zone(): string {
      const home = settings.get().homeZone;
      return home ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    },
    today(): string {
      return todayIn(travel.zone(), now());
    },
    ingest(actor: string) {
      const current = settings.get();
      return createIngest({ repo, settings: { ownerNames: current.ownerNames, homeZone: current.homeZone }, actor });
    },
    resolve(invocation: Pick<AppInvocation, "principal" | "access">, operation: Operation): AccessScope {
      return scopes.resolve(invocation, operation);
    },
    actor(invocation: Pick<AppInvocation, "principal">) {
      return actorOf(invocation);
    },
    close() {
      store.close();
    },
  };
  return travel;
}
export type Travel = ReturnType<typeof createTravel>;
