/**
 * Build a Travel archive with the kit's offline fixture builder: the same
 * compiler and adapter as packaging, with checkout dependencies instead of a
 * frozen install. Used only while the real packaging command is unavailable.
 * Usage: tsx test/support/offline-archive.ts <output.tar.gz>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOfflineAppFixture } from "@ri/app-kit/testing";
import { exportPackage } from "@ri/app-kit/build";
import { NativeNodeDriver } from "@ri/app-kit/runtime";

const source = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "ri-travel-offline.tar.gz"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-travel-offline-"));
try {
  const target = path.join(dir, "package");
  const skip = (relative: string) => /(^|\/)(node_modules|dist|artifacts|release|\.ri-build|coverage|test)(\/|$)/.test(relative) || /(^|\/)\.[^/]+$/.test(relative) || ["catalog.json", "tsconfig.json", "vitest.config.ts", "contract.json"].includes(relative);
  const copy = (relative: string) => {
    for (const entry of fs.readdirSync(path.join(source, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (skip(name)) continue;
      if (entry.isDirectory()) { fs.mkdirSync(path.join(target, name), { recursive: true }); copy(name); }
      else if (entry.isFile()) fs.copyFileSync(path.join(source, name), path.join(target, name));
    }
  };
  fs.mkdirSync(target, { recursive: true });
  copy("");
  const workflows = fs.readdirSync(path.join(target, "skills")).map((name) => {
    const text = fs.readFileSync(path.join(target, "skills", name, "SKILL.md"), "utf8");
    return { name: /^name:\s*(.+)$/m.exec(text)![1].trim(), description: /^description:\s*(.+)$/m.exec(text)![1].trim(), file: `skills/${name}/SKILL.md` };
  });
  const artifact = await buildOfflineAppFixture({ packageDir: target, driver: new NativeNodeDriver(process.execPath), workflows } as never);
  fs.rmSync(path.join(target, "node_modules"), { recursive: true, force: true });
  await exportPackage(artifact, output);
  process.stdout.write(`${output}\n`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
