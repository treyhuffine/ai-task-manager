/** Build the app sources in this checkout and stage the qualified catalog. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import Database from "better-sqlite3";
import { hasIncludedArtifact, includedAppIds, INCLUDED_NODE_APP_IDS } from "../src/lib/local-apps/included-catalog";

export const repository = fileURLToPath(new URL("../", import.meta.url));
export async function runCommand(command: string, args: string[], cwd = repository) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...process.env, RI_RUNTIME_REPO: repository } });
    const stop = (signal: NodeJS.Signals) => child.kill(signal);
    const interrupt = () => stop("SIGINT"), terminate = () => stop("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}
export async function stageLocalApps({ onlyMissing = false, compatibleOnly = false } = {}) {
  const directory = path.join(repository, "release/local-apps");
  await fs.mkdir(directory, { recursive: true });
  const lock = new Database(path.join(directory, "catalog.owner.sqlite"), { timeout: 0 });
  try { lock.exec("BEGIN IMMEDIATE"); }
  catch { lock.close(); throw new Error("The included apps are already being built. Wait for that build to finish"); }
  try {
    for (const id of includedAppIds(compatibleOnly)) {
      if (onlyMissing && await hasIncludedArtifact(id, process.env.RI_LOCAL_APPS_CATALOG_DIR ? path.resolve(process.env.RI_LOCAL_APPS_CATALOG_DIR) : path.join(directory, "catalog"))) continue;
      if (id === "ri-finance") {
        await runCommand("pnpm", ["finances:package"]);
        const finance = path.join(repository, "apps/finances/release");
        await runCommand("pnpm", ["exec", "tsx", "scripts/local-apps-catalog.ts",
          path.join(finance, "ri-finance-0.1.0.tar.gz"), path.join(finance, "catalog-entry.json")]);
      } else if ((INCLUDED_NODE_APP_IDS as readonly string[]).includes(id)) {
        try {
          await runCommand("pnpm", ["exec", "tsx", "scripts/local-apps-catalog.ts", "--included", id]);
        } catch (error) {
          // A development start keeps going without an app that does not build yet.
          // The library simply does not offer it. Release builds still fail loudly.
          if (!onlyMissing) throw error;
          console.error(`${id} could not be built, so the library will not offer it until it does: ${error instanceof Error ? error.message : error}`);
        }
      } else {
        await runCommand("pnpm", ["exec", "tsx", "scripts/local-apps-catalog.ts", "--tracker"]);
      }
    }
  } finally { lock.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--if-missing', '--compatible'].includes(arg))) {
    console.error("Use --if-missing to reuse staged packages, or --compatible to select packages qualified for this runtime");
    process.exitCode = 1;
  } else {
    void stageLocalApps({ onlyMissing: args.includes('--if-missing'), compatibleOnly: args.includes('--compatible') })
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
