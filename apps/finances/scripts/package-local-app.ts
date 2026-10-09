import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {createHash} from 'node:crypto';
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { financeAppContract, financeWorkflows } from "@/lib/local-app/definition";
import { inspectNode, assertTarget } from "@ri/app-kit/runtime";
import { validateArtifact, exportPackage } from "@ri/app-kit/build";
import { HOME_RESOURCE, VIEW_RESOURCE } from "@/lib/local-app/actions";
const run = promisify(execFile),
  require = createRequire(import.meta.url);
const ownPackage = JSON.parse(await fs.readFile("package.json", "utf8"));
if (ownPackage.dependencies["@ri/app-kit"].startsWith("workspace:")) {
  const { packageWorkspace } = await import("./package-workspace");
  await packageWorkspace(ownPackage);
  process.exit(0);
}
const target = {
  platform: "darwin" as const,
  arch: "arm64" as const,
  nodeVersion: "26.5.0",
  nodeAbi: "147",
};
assertTarget(target, await inspectNode(process.execPath));
// Verify the actual native addon before building or initializing app storage.
const Database = require("better-sqlite3");
const probe = new Database(":memory:");
probe.close();
const out = path.resolve(
  process.env.FINANCE_ARTIFACT_DIR ?? "release/local-app",
);
if (out === process.cwd() || !out.startsWith(process.cwd() + path.sep))
  throw new Error("Build the artifact inside this repository release folder");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "dist/node_modules"), { recursive: true });
await run(
  process.execPath,
  [require.resolve("tsx/cli"), "scripts/build-renderer.ts"],
  { env: { ...process.env, FINANCE_BUILD: "1" }, maxBuffer: 2 * 1024 * 1024 },
);
if (process.env.FINANCE_SKIP_NEXT_BUILD !== "1")
  await run(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "build"],
    { env: { ...process.env, FINANCE_BUILD: "1" }, maxBuffer: 8 * 1024 * 1024 },
  );
await fs.cp(".next/standalone", path.join(out, "dist/standalone"), {
  recursive: true,
  dereference: true,
  filter: async (file) => {
    const relative=path.relative('.next/standalone',file);
    if(relative && !['.next','node_modules','public','drizzle','server.js','package.json'].includes(relative.split(path.sep)[0]))return false;
    if(relative.split(path.sep).some(component=>['release','.git','.env','.env.local','.env.production','.env.development'].includes(component)))return false;
    // A contributor may have optional binaries for several platforms installed.
    // This artifact is qualified for one target and never ships those binaries.
    for(const component of file.split(path.sep)) {
      const native=/^(?:@next\+)?swc-((?:darwin|linux|linuxmusl|win32|freebsd|android)-[^@]+)(?:@|$)/.exec(component)
        ?? /^(?:@img\+)?sharp-(?:libvips-)?((?:darwin|linux|linuxmusl|win32|freebsd|android|wasm32)-?[^@]*)(?:@|$)/.exec(component);
      if(native && native[1]!==`${target.platform}-${target.arch}`)return false;
    }
    if (/\.(test|spec)\.[cm]?[tj]sx?$/.test(file)) return false;
    const entry = await fs.lstat(file);
    if (!entry.isSymbolicLink()) return true;
    return !!(await fs.stat(file).catch(() => null));
  },
});
await fs.cp(".next/static", path.join(out, "dist/standalone/.next/static"), {
  recursive: true,
});
await fs.cp("public", path.join(out, "public"), { recursive: true });
await fs.cp("drizzle", path.join(out, "drizzle"), { recursive: true });
await fs.cp("src", path.join(out, "src"), {
  recursive: true,
  filter: (file) => !/\.(test|spec)\.[cm]?[tj]sx?$/.test(file),
});
await fs.cp("scripts", path.join(out, "scripts"), { recursive: true });
for (const file of [
  "package.json",
  "pnpm-lock.yaml",
  "next.config.ts",
  "tsconfig.json",
  "README.md",
  "AGENTS.md",
])
  await fs.copyFile(file, path.join(out, file));
await fs.cp("vendor", path.join(out, "vendor"), { recursive: true });
let dependencyResolver=require;
for (const name of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  const packageFile=dependencyResolver.resolve(`${name}/package.json`);
  const dir = path.dirname(packageFile);
  await fs.cp(dir, path.join(out, "dist/node_modules", name), {
    recursive: true,
    dereference: true,
  });
  dependencyResolver=createRequire(packageFile);
}
await build({
  entryPoints: ["scripts/local-app-service.ts"],
  outfile: path.join(out, "dist/service.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  external: ["better-sqlite3"],
  banner: {
    js: 'import {createRequire as __riRequire} from "node:module";const require=__riRequire(import.meta.url);',
  },
});
for (const {name, description, body} of financeWorkflows) {
  const dir = path.join(out, "skills", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}
const manifest = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "ri-finance",
  version: "0.1.0",
  description:
    "Independent personal finance records, saved views and budget scenarios",
  license: "UNLICENSED",
  extensions: {
    "com.ri": {
      formatVersion: 1,
      displayName: "Finances",
      hostApi: 1,
      suggestedSlug: "finance",
      runtime: {
        kind: "node",
        protocol: "mcp-http-v1",
        entry: "dist/service.mjs",
        start: "on-home-start",
        executionProfile: "trusted-native",
        mcpPath: "/mcp",
        target,
      },
      build: {
        adapter: "next-standalone-v1",
        lockfile: "pnpm-lock.yaml",
        executionProfile: "trusted-native",
        recipe:'scripts/package-local-app.ts',
        output:'release/local-app',
      },
      ui: {
        resources: [{ uri: HOME_RESOURCE }, { uri: VIEW_RESOURCE }],
        entrypoints: ["global", "thread"],
        resolveAction: "finance_open_app",
        contextAction: "finance_describe_view_context",
        access: {path:"/access",action:"finance_create_scope"},
      },
      contract: "contract.json",
      requests: {
        integrations: [
          {
            binding: "mailbox",
            toolkit: "gmail",
            actions: [
              "gmail.search_messages",
              "gmail.read_message",
              "gmail.get_attachment",
              "gmail.list_history",
              "gmail.get_profile",
            ],
          },
          {
            binding: "bank",
            toolkit: "plaid",
            actions: [
              "plaid.create_link_token",
              "plaid.exchange_public_token",
              "plaid.sync_transactions",
              "plaid.get_accounts",
              "plaid.get_liabilities",
              "plaid.remove_item",
              "plaid.get_webhook_key",
            ],
          },
        ],
        riActions: [],
        files: {select:{mimeTypes:['text/csv','text/plain'],maxBytes:512*1024},download:{mimeTypes:['text/csv','application/json','text/plain'],maxBytes:512*1024}},
      },
      source: { kind: "starter", version: "0.1.0" },
    },
  },
};
await fs.writeFile(
  path.join(out, "plugin.json"),
  JSON.stringify(manifest, null, 2),
);
await fs.writeFile(
  path.join(out, "contract.json"),
  JSON.stringify(financeAppContract(), null, 2),
);
const artifact = validateArtifact(out);
await exportPackage(
  artifact,
  path.join(path.dirname(out), "ri-finance-0.1.0.tar.gz"),
);
const archive=path.join(path.dirname(out),'ri-finance-0.1.0.tar.gz');
await fs.writeFile(path.join(path.dirname(out),'catalog-entry.json'),JSON.stringify({formatVersion:1,packageId:manifest.name,version:manifest.version,name:'Finances',description:'Manual accounts, CSV records, saved views and explicit budget scenarios. Mailbox reads are available only after access setup.',source:'Independent Finance app maintained for Ri',license:manifest.license,hostApi:1,runtime:'mcp-http-v1',target,artifactDigest:artifact.digest,archiveDigest:createHash('sha256').update(await fs.readFile(archive)).digest('hex'),capabilities:manifest.extensions['com.ri'].requests.integrations.flatMap(binding=>binding.actions),demo:{heading:'Fictional monthly review',caption:'Synthetic examples only. Opening this demo runs no app and connects no accounts. Receipt and bank monitoring require separate qualification.',columns:['Record','Amount','State'],rows:[['Fixture Shop purchase','$24.00','Posted'],['Dining budget','$300.00','Proposed'],['Expected refund','$24.00','Needs evidence']]}},null,2));
process.stdout.write(
  JSON.stringify({
    directory: out,
    digest: artifact.digest,
    files: artifact.files.length,
    target,
  }) + "\n",
);
