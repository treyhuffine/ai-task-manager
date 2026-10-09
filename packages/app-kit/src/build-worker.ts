import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { ContractValidator, type AppContract } from "./contract.js";
import { generateContract } from "./sdk.js";
const packageDir = process.argv[2];
const workflows = JSON.parse(
  process.argv[3] ?? "[]",
) as AppContract["workflows"];
const manifest = new ContractValidator().manifest(
  JSON.parse(fs.readFileSync(path.join(packageDir, "plugin.json"), "utf8")),
);
const extension = manifest.extensions["com.ri"];
fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
const require = createRequire(import.meta.url);
await build({
  entryPoints: [path.join(packageDir, "src/ui.tsx")],
  bundle: true,
  write: true,
  format: "iife",
  platform: "browser",
  target: "es2023",
  minify: true,
  define: {'process.env.NODE_ENV': '"production"'},
  outfile: path.join(packageDir, "dist/ui.js"),
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".woff2": "dataurl" },
  logLevel: "warning",
});
const source = fs.readFileSync(path.join(packageDir, "src/ui.html"), "utf8");
const script = fs
  .readFileSync(path.join(packageDir, "dist/ui.js"), "utf8")
  .replace(/<\/script/gi, "<\\/script");
if (!source.includes("<!-- RI_APP_SCRIPT -->"))
  throw new Error("The HTML template is missing its script placeholder");
fs.writeFileSync(
  path.join(packageDir, "dist/ui.html"),
  source.replace("<!-- RI_APP_SCRIPT -->", () => `<script>${script}</script>`),
);
if (extension.runtime.kind === "node") {
  await build({
    entryPoints: [path.join(packageDir, "src/actions.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node26",
    outfile: path.join(packageDir, "dist/definitions.mjs"),
    banner: {
      js: 'import { createRequire as __riCreateRequire } from "node:module"; const require = __riCreateRequire(import.meta.url);',
    },
    logLevel: "warning",
  });
  const { definition } = await import(
    pathToFileURL(path.join(packageDir, "dist/definitions.mjs")).href
  );
  fs.writeFileSync(
    path.join(packageDir, extension.contract),
    JSON.stringify(generateContract(definition, workflows), null, 2),
  );
  await build({
    entryPoints: [path.join(packageDir, "src/server.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node26",
    outfile: path.join(packageDir, extension.runtime.entry!),
    banner: {
      js: 'import { createRequire as __riCreateRequire } from "node:module"; const require = __riCreateRequire(import.meta.url);',
    },
    logLevel: "warning",
  });
} else {
  const context = fs.existsSync(path.join(packageDir, "src/context.json"))
    ? JSON.parse(
        fs.readFileSync(path.join(packageDir, "src/context.json"), "utf8"),
      )
    : {};
  const contract: AppContract = {
    formatVersion: 1,
    packageId: manifest.name,
    version: manifest.version,
    actions: [],
    entities: [],
    contexts: context,
    workflows,
  };
  fs.writeFileSync(
    path.join(packageDir, extension.contract),
    JSON.stringify(contract, null, 2),
  );
}
// Builds never accept app-installed native code. Service artifacts are qualified separately.
function check(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (entry.name.endsWith(".node"))
      throw new Error(
        "Unsupported native dependency. Use the pinned Node SQLite adapter.",
      );
  }
}
// The pinned kit includes pnpm's native tooling. Runtime artifacts, rather than unused compiler dependencies, must be JS-only.
check(path.join(packageDir, "dist"));
// Keep the compiler itself out of a generated runtime's private API.
void require;
