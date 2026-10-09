import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { getAppRoot } from "@/lib/config/paths";
import {
  serverFetch,
  ServerResponseError,
} from "@/lib/orchestrator/server-client";
import { appStateSchema, restoreAppState } from "./state";
import { atomicWriteFile } from "@/lib/config/atomic-file";

/** Hold the existing launcher lock offline, or ask its live Home to stop apps. */
export async function acquireAppBackup(
  root: string,
): Promise<() => Promise<void>> {
  if (
    !["apps", "app-drafts"].some((name) => fs.existsSync(path.join(root, name)))
  )
    return async () => {};
  const file = path.join(root, "data.db.owner.sqlite");
  const lock = new Database(file, { timeout: 0 });
  try {
    lock.exec("BEGIN IMMEDIATE");
    await verifyStoppedAppWriters(root);
    return async () => {
      lock.close();
    };
  } catch (error) {
    lock.close();
    if ((error as { code?: string }).code !== "SQLITE_BUSY") throw error;
  }
  if (path.resolve(root) !== path.resolve(getAppRoot()))
    throw new Error(
      "Back up a running app Home with RI_ROOT set to that Home, so its supervisor can stop its databases",
    );
  try {
    const result = await serverFetch<{ lease: string }>("/local-apps/backup", {
      method: "POST",
    });
    return async () => {
      await serverFetch("/local-apps/backup", {
        method: "DELETE",
        body: JSON.stringify({ lease: result.lease }),
      });
    };
  } catch (error) {
    if (
      error instanceof ServerResponseError &&
      error.status === 404 &&
      error.json()?.localAppsEnabled === false
    ) {
      await verifyStoppedAppWriters(root);
      return async () => {};
    }
    throw new Error(
      "App backup could not stop the running Home. Stop it or repair its local app supervisor before backing up",
    );
  }
}
export function restoreLocalApps(root: string) {
  const file = path.join(root, ".config/local-apps/state.json");
  if (!fs.existsSync(file)) return;
  const state = appStateSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  atomicWriteFile(file, JSON.stringify(restoreAppState(state)));
}
/** Source and durable data are backed up. Build caches and private logs are regenerable. */
export function appBackupFile(relative: string) {
  return (
    !relative
      .split(/[\\/]/)
      .some((part) =>
        ["cache", "logs", "node_modules", ".work", ".git", ".next", ".ri-build", "release"].includes(part),
      ) ||
    /\/(?:package|previous-package|replacement-[a-f0-9-]+|failed-package-[a-f0-9-]+)\/dist\//.test(
      relative,
    )
  );
}

/** A hard Home stop releases its lock before the guardian finishes draining. */
export async function verifyStoppedAppWriters(root: string) {
  const exec = promisify(execFile),
    files: string[] = [];
  for (const folder of ["apps", "app-drafts"]) {
    const directory = path.join(root, folder);
    if (!fs.existsSync(directory)) continue;
    for (const id of fs.readdirSync(directory)) {
      const file = path.join(directory, id, "cache/ownership.json");
      if (fs.existsSync(file)) files.push(file);
    }
  }
  for (const file of files) {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as {
      version: number;
      pid: number;
      generation: string;
    };
    if (
      record.version !== 1 ||
      !Number.isInteger(record.pid) ||
      record.pid < 2 ||
      !/^[a-f0-9-]{36}$/.test(record.generation)
    )
      throw new Error(
        "App ownership metadata needs repair before an offline backup",
      );
    const deadline = Date.now() + 7000;
    while (true) {
      let command = "";
      try {
        command = (
          await exec("/bin/ps", ["-p", String(record.pid), "-o", "command="], {
            maxBuffer: 16384,
          })
        ).stdout;
      } catch (error) {
        if ((error as { code?: number }).code !== 1) throw error;
      }
      if (!command.includes(`--ownership ${record.generation}`)) break;
      if (Date.now() >= deadline)
        throw new Error(
          "An app still owns a database writer. Stop its Home and wait for its supervisor before backing up",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
