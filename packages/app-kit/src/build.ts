import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Script } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget, DiagnosticCategory } from 'typescript';
import { createRequire } from "node:module";
import * as tar from "tar";
import { parseHTML } from "linkedom";
import {
  AppError,
  ContractValidator,
  LIMITS,
  relativePathSchema,
  type AppContract,
} from "./contract.js";
import type { Artifact, ExecutionDriver } from "./runtime.js";
import {kitAsset} from './assets.js';

export interface PackageFile {
  name: string;
  bytes: number;
  sha256: string;
}
export interface ValidatedArtifact extends Artifact {
  files: PackageFile[];
  sourceDigest: string;
  contractDigest: string;
}
export interface PreparedHtml {
  html: string;
  scriptHashes: string[];
}
export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
const PRIVATE = new Set([
  "data",
  "cache",
  "logs",
  "node_modules",
  ".git",
  ".work",
  ".config",
  ".agents",
  ".claude",
  "creation-chats",
  "backups",
]);
export function inventory(
  packageDir: string,
  limit: number = LIMITS.sourceBytes,
  forExport = false,
): PackageFile[] {
  const root = fs.realpathSync(packageDir),
    files: PackageFile[] = [];
  let total = 0;
  function walk(relative: string) {
    for (const entry of fs
      .readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        (!relative && [".ri-build", ".next", "release"].includes(entry.name)) ||
        (PRIVATE.has(entry.name) &&
          !(
            entry.name === "node_modules" &&
            (relative === "dist" || relative.startsWith("dist/"))
          )) ||
        entry.name.startsWith(".env") ||
        /\.(?:key|pem|p12|db|sqlite|sqlite3)(?:-|$)/i.test(entry.name) ||
        entry.name === "inventory.json"
      )
        continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relativePathSchema.safeParse(name).success)
        throw new AppError(
          "invalid_input",
          "An artifact contains an unsafe path",
        );
      if (entry.isSymbolicLink())
        throw new AppError(
          "invalid_input",
          "Artifact symbolic links are unsupported",
        );
      if (entry.isDirectory()) {
        walk(name);
        continue;
      }
      if (!entry.isFile())
        throw new AppError(
          "invalid_input",
          "Artifacts contain only ordinary files",
        );
      const file = path.join(root, name),
        size = fs.statSync(file).size;
      total += size;
      if (total > limit || files.length >= 20000)
        throw new AppError(
          "invalid_input",
          "The package exceeds its inventory limit",
        );
      const contents = fs.readFileSync(file);
      if (
        forExport &&
        /\.(?:json|[cm]?js|tsx?|jsx|md|ya?ml|html|txt)$/i.test(name)
      ) {
        const text = contents.toString("utf8");
        if (
          /(?:sk-(?:proj-)?[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:access_token|api_key|client_secret|RI_SESSION_CREDENTIAL)\s*["']?\s*[:=]\s*["'][a-zA-Z0-9_-]{16,})/.test(
            text,
          )
        )
          throw new AppError(
            "forbidden",
            "Export found a possible credential in source. Review and remove it before exporting",
          );
      }
      files.push({ name, bytes: size, sha256: sha256(contents) });
    }
  }
  walk("");
  return files;
}
export function packagePath(packageDir: string, relative: string): string {
  relativePathSchema.parse(relative);
  const root = fs.realpathSync(packageDir),
    file = path.join(root, relative);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new AppError(
        "invalid_input",
        "A package path contains a symbolic link",
      );
  }
  const canonical = fs.realpathSync(file);
  if (!canonical.startsWith(`${root}${path.sep}`))
    throw new AppError("invalid_input", "A package path escapes its directory");
  return canonical;
}
export function prepareHtml(source: string): PreparedHtml {
  if (Buffer.byteLength(source) > LIMITS.outputBytes)
    throw new AppError("invalid_input", "The app view is too large");
  const { document } = parseHTML(source);
  if (
    document.querySelector(
      'base,iframe,frame,frameset,object,embed,link[rel="stylesheet"],meta[http-equiv="refresh" i]',
    )
  )
    throw new AppError(
      "unsupported",
      "Views must be self-contained HTML without frames, refresh or external styles",
    );
  const hashes: string[] = [];
  for (const script of document.querySelectorAll("script")) {
    if (script.hasAttribute("src"))
      throw new AppError("unsupported", "Views cannot load external scripts");
    if (
      ![
        "",
        "text/javascript",
        "application/javascript",
        "module",
        "application/json",
      ].includes(script.getAttribute("type") ?? "")
    )
      throw new AppError("unsupported", "Unsupported script type");
    const scriptType = script.getAttribute('type');
    if (scriptType === 'module') {
      const parsed = transpileModule(script.textContent ?? '', {fileName: 'view.js', reportDiagnostics: true, compilerOptions: {module: ModuleKind.ESNext, target: ScriptTarget.ESNext, allowJs: true}});
      if (parsed.diagnostics?.some(item => item.category === DiagnosticCategory.Error))
        throw new AppError('invalid_input', 'A view contains invalid JavaScript');
    } else if (scriptType !== 'application/json') {
      try { new Script(script.textContent ?? ''); }
      catch { throw new AppError('invalid_input', 'A view contains invalid JavaScript'); }
    }
    if (scriptType !== "application/json")
      hashes.push(
        `'sha256-${createHash("sha256")
          .update(script.textContent ?? "")
          .digest("base64")}'`,
      );
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name))
        throw new AppError(
          "unsupported",
          "Inline event handlers must use addEventListener",
        );
      if (
        [
          "src",
          "srcset",
          "poster",
          "data",
          "background",
          "href",
          "xlink:href",
        ].includes(attribute.name)
      ) {
        const value = attribute.value.trim();
        if (
          element.tagName === "A" &&
          ["href", "xlink:href"].includes(attribute.name)
        ) {
          if (value && !/^(?:https:\/\/|\/|#)/.test(value))
            throw new AppError(
              "unsupported",
              "Links must use HTTPS or an internal path",
            );
          element.removeAttribute(attribute.name);
          element.setAttribute("data-ri-link", value);
          continue;
        }
        if (
          value &&
          !/^data:(?:image\/(?:png|jpeg|gif|webp|avif)|font\/|application\/(?:font|x-font))/i.test(
            value,
          )
        )
          throw new AppError(
            "unsupported",
            "Embed images and fonts in the HTML resource",
          );
      }
    }
  }
  for (const element of document.querySelectorAll("style,[style]")) {
    const css =
      element.tagName === "STYLE"
        ? (element.textContent ?? "")
        : (element.getAttribute("style") ?? "");
    if (/@import\b|url\(\s*['"]?(?!data:)/i.test(css))
      throw new AppError("unsupported", "Styles cannot fetch network assets");
  }
  // The serialized source preserves exact script contents for CSP hashes.
  return { html: document.toString(), scriptHashes: [...new Set(hashes)] };
}
export function validateArtifact(packageDir: string): ValidatedArtifact {
  const validator = new ContractValidator();
  const manifest = validator.manifest(
    JSON.parse(fs.readFileSync(packagePath(packageDir, "plugin.json"), "utf8")),
  );
  const extension = manifest.extensions["com.ri"];
  const contract = validator.contract(
    JSON.parse(
      fs.readFileSync(packagePath(packageDir, extension.contract), "utf8"),
    ),
    manifest,
  );
  const files = inventory(
    packageDir,
    extension.runtime.protocol === "mcp-http-v1"
      ? LIMITS.serviceBytes
      : LIMITS.sourceBytes,
  );
  if (
    extension.runtime.protocol !== "mcp-http-v1" &&
    files.some(
      (file) =>
        file.name.endsWith(".node") || file.name.includes("/node_modules/"),
    )
  )
    throw new AppError(
      "unsupported",
      "Only qualified service artifacts can carry native modules or runtime dependency trees",
    );
  for (const required of ["README.md", "AGENTS.md"])
    packagePath(packageDir, required);
  if (extension.runtime.entry) packagePath(packageDir, extension.runtime.entry);
  for (const resource of extension.ui?.resources ?? [])
    if (resource.file)
      prepareHtml(
        fs.readFileSync(packagePath(packageDir, resource.file), "utf8"),
      );
  for (const workflow of contract.workflows)
    packagePath(packageDir, workflow.file);
  const contractDigest = sha256(JSON.stringify(contract));
  const digest = sha256(JSON.stringify(files));
  const sourceDigest = sha256(
    JSON.stringify(
      files.filter(
        (file) =>
          !file.name.startsWith("dist/") && file.name !== extension.contract,
      ),
    ),
  );
  return {
    manifest,
    contract,
    digest,
    packageDir: fs.realpathSync(packageDir),
    files,
    sourceDigest,
    contractDigest,
  };
}
export async function exportPackage(
  artifact: Artifact,
  destination: string,
): Promise<PackageFile[]> {
  const limit =
    artifact.manifest.extensions["com.ri"].runtime.protocol === "mcp-http-v1"
      ? LIMITS.serviceBytes
      : LIMITS.sourceBytes;
  const files = inventory(artifact.packageDir, limit, true);
  if (sha256(JSON.stringify(files)) !== artifact.digest)
    throw new AppError(
      "conflict",
      "The installed package changed. Validate it again before export",
    );
  await tar.c(
    {
      gzip: true,
      file: destination,
      cwd: artifact.packageDir,
      portable: true,
      noMtime: true,
      follow: false,
    },
    files.map((file) => file.name),
  );
  return files;
}
export async function importPackage(
  archive: string,
  destination: string,
): Promise<ValidatedArtifact> {
  if (fs.statSync(archive).size > LIMITS.serviceBytes)
    throw new AppError("invalid_input", "The archive is too large");
  const names = new Set<string>();
  let expanded = 0;
  let problem: string | undefined;
  await tar.t({
    file: archive,
    strict: true,
    onReadEntry: (entry) => {
      const name = entry.path.endsWith("/")
        ? entry.path.slice(0, -1)
        : entry.path;
      if (
        !relativePathSchema.safeParse(name).success ||
        names.has(name) ||
        !["File", "Directory"].includes(entry.type)
      )
        problem =
          "The archive contains an unsafe, duplicate or unsupported entry";
      if (
        name
          .split("/")
          .some(
            (part) =>
              (PRIVATE.has(part) &&
                !(part === "node_modules" && name.startsWith("dist/"))) ||
              part.startsWith(".env"),
          )
      )
        problem = "The archive contains private data or generated dependencies";
      names.add(name);
      expanded += entry.size;
      if (expanded > LIMITS.serviceBytes || names.size > 20000)
        problem = "The archive exceeds its expanded size limit";
    },
  });
  if (problem) throw new AppError("invalid_input", problem);
  if (fs.existsSync(destination))
    throw new AppError("conflict", "The import destination already exists");
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  try {
    await tar.x({
      file: archive,
      cwd: destination,
      strict: true,
      preservePaths: false,
      noChmod: true,
    });
    return validateArtifact(destination);
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
export async function stoppedSnapshot(
  source: string,
  destination: string,
  stop: () => Promise<void>,
): Promise<void> {
  await stop();
  if (fs.existsSync(destination))
    throw new AppError("conflict", "The snapshot destination already exists");
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(source)) {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    return;
  }
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (file) => {
      if (fs.lstatSync(file).isSymbolicLink())
        throw new AppError(
          "invalid_input",
          "App data snapshots cannot follow symbolic links",
        );
      return true;
    },
  });
}
export interface BuildOptions {
  packageDir: string;
  driver: ExecutionDriver;
  signal?: AbortSignal;
  workflows?: AppContract["workflows"];
  onOutput?: (text: string) => void;
}

/** Resolve pinned build assets within the installed kit, including external
 * server bundles whose caller has a synthetic import.meta URL. */
export function appKitToolchain() {
  const require = createRequire(import.meta.url);
  const resolve = require.resolve.bind(require);
  const kitDir = path.resolve(path.dirname(resolve(['@ri/app-kit', 'build'].join('/'))), '..');
  return { packageDir: kitDir, pnpm: path.join(path.dirname(require.resolve('pnpm')), 'bin/pnpm.cjs'), validationWorker: path.join(kitDir, 'dist/validation-worker.js') };
}
/** Run supported build operations with the kit's own pinned tools. No package
 * lifecycle scripts or arbitrary shell build commands are executed. */
export async function buildPackage(
  options: BuildOptions,
): Promise<ValidatedArtifact> {
  const validator = new ContractValidator();
  const manifest = validator.manifest(
    JSON.parse(
      fs.readFileSync(path.join(options.packageDir, "plugin.json"), "utf8"),
    ),
  );
  const artifact: Artifact = {
    manifest,
    contract: {
      formatVersion: 1,
      packageId: manifest.name,
      version: manifest.version,
      actions: [],
      entities: [],
      contexts: {},
      workflows: [],
    },
    digest: "",
    packageDir: options.packageDir,
  };
  await options.driver.prepare(artifact, options.signal);
  if (manifest.extensions["com.ri"].build.adapter === "none")
    return validateArtifact(options.packageDir);
  const require = createRequire(import.meta.url);
  const executable = (options.driver as { nodeExecutable?: string })
    .nodeExecutable;
  if (!executable)
    throw new AppError(
      "unsupported",
      "This build driver does not supply its pinned Node runtime",
    );
  const node: string = executable;
  const lockfile = manifest.extensions["com.ri"].build.lockfile!;
  packagePath(options.packageDir, lockfile);
  const toolHome = path.join(
    path.dirname(options.packageDir),
    "cache",
    "toolchain-home",
  );
  fs.mkdirSync(toolHome, { recursive: true, mode: 0o700 });
  async function run(args: string[]) {
    if (options.signal?.aborted)
      throw new AppError("interrupted", "Build cancelled");
    const generation = randomUUID();
    const child = spawn(node, [kitAsset('owned-runner.cjs'), args[0], '--build-args', Buffer.from(JSON.stringify(args.slice(1))).toString('base64url'), '--ownership', generation], {
      cwd: options.packageDir,
      shell: false,
      detached: true,
      env: {
        PATH: `${path.dirname(node)}:/usr/bin:/bin`,
        LANG: "en_US.UTF-8",
        RI_APP_BUILD: "1",
        HOME: toolHome,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const ownership = path.join(path.dirname(options.packageDir),'cache','ownership.json');
    fs.writeFileSync(ownership, JSON.stringify({version:1,pid:child.pid,generation}), {mode:0o600});
    let reportedCode: number | null | undefined;
    child.on('message', value => {const message = value as {type?:string;code?:number|null};if(message.type === 'owned-exit') reportedCode = message.code;});
    let output = 0;
    const capture = (chunk: Buffer) => {
      output += chunk.byteLength;
      if (output <= 1048576) options.onOutput?.(chunk.toString());
    };
    child.stdout!.on("data", capture);
    child.stderr!.on("data", capture);
    const kill = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    };
    options.signal?.addEventListener("abort", kill, { once: true });
    const timer = setTimeout(kill, 300000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("exit", code => resolve(reportedCode ?? code));
        child.once("error", reject);
      });
      if (code !== 0 || options.signal?.aborted)
        throw new AppError(
          options.signal?.aborted ? "interrupted" : "app_failed",
          "The build failed. Check the draft build log and retry",
        );
    } finally {
      fs.rmSync(ownership,{force:true});
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", kill);
    }
  }
  try {
    await run([
      path.join(path.dirname(require.resolve("pnpm")), "bin/pnpm.cjs"),
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--config.node-linker=isolated",
      "--config.verify-store-integrity=true",
      "--config.package-import-method=copy",
    ]);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AppError(
      "app_failed",
      "Dependency installation failed. Check network access and the draft log, then retry",
    );
  }
  await run([
    kitAsset(manifest.extensions['com.ri'].build.adapter==='next-standalone-v1'?'service-build-worker.js':'build-worker.js'),
    options.packageDir,
    JSON.stringify(options.workflows ?? []),
  ]);
  return validateArtifact(options.packageDir);
}
export {createAppTemplate} from './templates.js';
