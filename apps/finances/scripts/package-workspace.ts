/** Export the workspace app into a portable project, then qualify that project. */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { appKitToolchain } from "@ri/app-kit/build";
import { assertTarget, inspectNode } from "@ri/app-kit/runtime";

const run = promisify(execFile);

export async function packageWorkspace(ownPackage: {
  dependencies: Record<string, string>;
}) {
  const root = process.cwd(),
    require = createRequire(path.join(root, "package.json")),
    kit = appKitToolchain();
  assertTarget(
    { platform: "darwin", arch: "arm64", nodeVersion: "26.5.0", nodeAbi: "147" },
    await inspectNode(process.execPath),
  );
  const Database = require("better-sqlite3");
  const probe = new Database(":memory:");
  probe.close();
  await fs.mkdir(path.join(root, ".ri-build"), { recursive: true });
  const lock = new Database(path.join(root, ".ri-build/package.owner.sqlite"), { timeout: 0 });
  try { lock.exec("BEGIN IMMEDIATE"); }
  catch { lock.close(); throw new Error("Finances is already being packaged. Wait for that build to finish"); }
  let project: string | undefined;
  const env: NodeJS.ProcessEnv = { ...process.env, FINANCE_BUILD: "1" };
  // Always qualify the portable project. A workspace Next output is not reusable here.
  delete env.FINANCE_SKIP_NEXT_BUILD;
  delete env.FINANCE_ARTIFACT_DIR;
  try {
    project = await fs.mkdtemp(path.join(root, ".ri-build/portable-"));
    for (const name of [
      "src", "scripts", "drizzle", "docs", "next.config.ts",
      "tsconfig.json", "postcss.config.mjs", "README.md", "AGENTS.md",
    ]) await fs.cp(path.join(root, name), path.join(project, name), { recursive: true });
    if (await fs.stat(path.join(root, "public")).catch(() => null))
      await fs.cp(path.join(root, "public"), path.join(project, "public"), { recursive: true });
    else await fs.mkdir(path.join(project, "public"));
    const sdkPackage = JSON.parse(await fs.readFile(path.join(kit.packageDir, "package.json"), "utf8"));
    const vendor = path.join(project, "vendor");
    await fs.mkdir(vendor);
    await run(process.execPath, [kit.pnpm, "pack", "--pack-destination", vendor],
      { cwd: kit.packageDir, env, maxBuffer: 2 * 1024 * 1024 });
    const sdk = `file:vendor/ri-app-kit-${sdkPackage.version}.tgz`;
    await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
      ...ownPackage, dependencies: { ...ownPackage.dependencies, "@ri/app-kit": sdk },
    }, null, 2));
    await fs.copyFile(path.join(root, "pnpm-standalone-lock.yaml"), path.join(project, "pnpm-lock.yaml"));
    // The reviewed standalone resolution remains pinned. Only the new local SDK
    // tarball's integrity is refreshed. No lifecycle script runs during install.
    await run(process.execPath, [kit.pnpm, "add", `@ri/app-kit@${sdk}`, "--lockfile-only", "--ignore-scripts", "--ignore-workspace", "--prefer-offline"],
      { cwd: project, env, maxBuffer: 2 * 1024 * 1024 });
    await run(process.execPath, [kit.pnpm, "install", "--frozen-lockfile", "--ignore-scripts", "--ignore-workspace", "--prefer-offline"],
      { cwd: project, env, maxBuffer: 2 * 1024 * 1024 });
    const portableRequire = createRequire(path.join(project, "package.json")),
      source = require.resolve("better-sqlite3/package.json"),
      target = portableRequire.resolve("better-sqlite3/package.json");
    if (JSON.parse(await fs.readFile(source, "utf8")).version !== JSON.parse(await fs.readFile(target, "utf8")).version)
      throw new Error("Qualify the updated native SQLite dependency before packaging Finance");
    const native = "build/Release/better_sqlite3.node";
    await fs.mkdir(path.dirname(path.join(path.dirname(target), native)), { recursive: true });
    await fs.copyFile(path.join(path.dirname(source), native), path.join(path.dirname(target), native));
    const sqlite = new (portableRequire("better-sqlite3"))(":memory:");
    sqlite.close();
    // This project has file dependencies and its own lockfile, so the ordinary
    // package recipe runs with no workspace discovery or repository imports.
    const result = await run(process.execPath, [portableRequire.resolve("tsx/cli"), "scripts/package-local-app.ts"],
      { cwd: project, env, maxBuffer: 8 * 1024 * 1024 });
    await fs.mkdir(path.join(root, "release"), { recursive: true });
    for (const name of ["local-app", "ri-finance-0.1.0.tar.gz", "catalog-entry.json"]) {
      const destination = path.join(root, "release", name);
      await fs.rm(destination, { recursive: true, force: true });
      await fs.cp(path.join(project, "release", name), destination, { recursive: true });
    }
    const summary = JSON.parse(result.stdout.trim());
    process.stdout.write(JSON.stringify({ ...summary, directory: path.join(root, "release/local-app") }) + "\n");
    if (result.stderr) process.stderr.write(result.stderr);
  } finally {
    try { if (project) await fs.rm(project, { recursive: true, force: true }); }
    finally { lock.close(); }
  }
}
