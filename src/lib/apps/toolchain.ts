/**
 * What Ri brings so a person needs no developer tools for personal apps (docs/personal-apps.md
 * "What Ri brings", shared spec §2 "What Ri brings").
 *
 * - **Node** is the one running Ri. It runs every kit command, and the kit's installs write the
 *   Node that ran them into the app's background service, so each app runs on Ri's Node too.
 * - **pnpm** is carried in `@ri/app-toolchain`, at the version the carried kit writes into every
 *   app's `packageManager`, so pnpm never has to fetch another one. It lives in that package rather
 *   than in Ri's own dependencies, so Ri's own scripts keep the developer's pnpm.
 * - **The kit** is a pinned copy in `@ri/app-toolchain` (`scripts/pin-app-kit.ts`). It runs
 *   `create` for New app. Inside an app, Ri runs the app's own copy of the kit, the version the
 *   app was built with. The app kit command setting is a developer override for a kit checkout.
 * - **git** is the computer's own. Ri never runs macOS's placeholder git, which opens Apple's
 *   installer, and says how to get git when there's none.
 *
 * Ri puts these first on the PATH of every kit command it runs and of the builder chat, through a
 * small bin folder in its work folder, the way it hands sessions its CLI (session-cli.ts).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import nodeModule from 'node:module';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import { runtimeRequire } from '@/lib/releases/runtime-identity';

/** The pinned kit Ri carries, for New app. */
export interface CarriedKit {
  version: string;
  /** The kit commit it was built from, when the pin recorded it. */
  commit: string | null;
  /** The kit's command, run with Ri's Node. */
  bin: string;
}

export interface AppToolchain {
  /** Ri's own Node. */
  node: string;
  /** The folder Ri puts first on the PATH: `pnpm`, and `git` when the computer has one. */
  binDir: string;
  /** The carried pnpm, run through `binDir/pnpm`. Null when this copy of Ri doesn't carry one. */
  pnpm: { version: string; command: string } | null;
  kit: CarriedKit | null;
  /** The computer's git, or null when it has none Ri can use. */
  git: string | null;
  /** What to add to a kit command's environment. */
  env: { PATH: string };
}

const shq = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Resolve from the installation, not the bundle (runtime-identity.ts says why). */
function requireFrom(file: string): NodeJS.Require {
  const create: typeof nodeModule.createRequire = Reflect.get(nodeModule, 'createRequire');
  return create(file);
}

/**
 * A dependency's package.json, found the way Node looks for the package from `from`. Packages that
 * don't export their package.json (pnpm, the kit) can't be resolved by name, so this walks Node's
 * own lookup folders, which follow pnpm's layout in a checkout and in a release.
 */
function dependencyManifest(from: string, name: string): string | null {
  for (const dir of requireFrom(from).resolve.paths(name) ?? []) {
    const manifest = path.join(/* turbopackIgnore: true */ dir, name, 'package.json');
    if (fs.existsSync(/* turbopackIgnore: true */ manifest)) return manifest;
  }
  return null;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8')) as Record<string, unknown>;
}

/** `@ri/app-toolchain`'s package.json, or null in a copy of Ri without it. */
function toolchainPackage(): string | null {
  try { return runtimeRequire().resolve('@ri/app-toolchain/package.json'); } catch { return null; }
}

function carriedPnpm(toolchain: string): { version: string; script: string } | null {
  try {
    const manifest = dependencyManifest(toolchain, 'pnpm');
    if (!manifest) return null;
    const pkg = readJson(manifest) as { version?: string; bin?: Record<string, string> };
    const script = pkg.bin?.pnpm;
    if (!pkg.version || !script) return null;
    return { version: pkg.version, script: path.join(/* turbopackIgnore: true */ path.dirname(manifest), script) };
  } catch { return null; }
}

/** The kit's one command, as its package.json names it. Ri never assumes the kit's name. */
export function kitCommandPath(manifest: string, pkg: { bin?: string | Record<string, string> }): string | null {
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
  if (bins.length !== 1) return null;
  return path.join(/* turbopackIgnore: true */ path.dirname(manifest), bins[0]!);
}

function carriedKit(toolchain: string): CarriedKit | null {
  try {
    const manifest = dependencyManifest(toolchain, 'kit');
    if (!manifest) return null;
    const pkg = readJson(manifest) as { version?: string; bin?: string | Record<string, string> };
    const bin = kitCommandPath(manifest, pkg);
    if (!pkg.version || !bin || !fs.existsSync(/* turbopackIgnore: true */ bin)) return null;
    let commit: string | null = null;
    try { commit = (readJson(path.join(/* turbopackIgnore: true */ path.dirname(toolchain), 'kit', 'source.json')).commit as string) || null; } catch { /* Not recorded. */ }
    return { version: pkg.version, commit, bin };
  } catch { return null; }
}

function executable(file: string): boolean {
  try {
    const stat = fs.statSync(/* turbopackIgnore: true */ file);
    if (!stat.isFile()) return false;
    fs.accessSync(/* turbopackIgnore: true */ file, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

/** Whether a Mac has Apple's developer tools, without running anything that opens their installer. */
function macDeveloperToolsInstalled(): boolean {
  try {
    const dir = execFileSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    return !!dir && fs.existsSync(/* turbopackIgnore: true */ dir);
  } catch { return false; }
}

/**
 * The computer's git: the first on the PATH that works. On a Mac, `/usr/bin/git` is a placeholder
 * until Apple's command line tools are installed, and running it opens their installer, so Ri
 * checks for the tools instead of running it.
 */
export function findComputerGit(options: { pathEnv?: string; skip?: readonly string[]; platform?: NodeJS.Platform; macToolsInstalled?: () => boolean } = {}): string | null {
  const platform = options.platform ?? process.platform;
  const macTools = options.macToolsInstalled ?? macDeveloperToolsInstalled;
  for (const dir of (options.pathEnv ?? process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir || options.skip?.includes(dir)) continue;
    const candidate = path.join(/* turbopackIgnore: true */ dir, 'git');
    if (!executable(candidate)) continue;
    let real = candidate;
    try { real = fs.realpathSync(/* turbopackIgnore: true */ candidate); } catch { /* Use it as found. */ }
    if (platform === 'darwin' && real === '/usr/bin/git' && !macTools()) continue;
    return candidate;
  }
  return null;
}

/** What to tell the person when there's no git. */
export function gitHelp(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin'
    ? 'Apps keep their history in git, and this Mac doesn’t have it yet. Install Apple’s command line tools: open Terminal, run xcode-select --install and follow the prompt. Then try again.'
    : 'Apps keep their history in git, and this computer doesn’t have it yet. Install git with your system’s package manager, then try again.';
}

/** Write a launcher when it's missing or different, replacing it whole (a command may be starting it). */
function writeLauncher(file: string, content: string) {
  let current: string | null = null;
  try { current = fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8'); } catch { /* Missing. */ }
  if (current === content) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(/* turbopackIgnore: true */ tmp, content, { mode: 0o755 });
  fs.renameSync(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ file);
}

/** The launcher contents for the carried pnpm and the computer's git. Pure. */
export function planLaunchers(input: { node: string; pnpmScript: string | null; git: string | null }): Record<'pnpm' | 'git', string | null> {
  const header = (what: string) => ['#!/bin/sh', `# ${what} for personal apps, written by Ri (src/lib/apps/toolchain.ts). Rewritten when it changes.`];
  return {
    pnpm: input.pnpmScript ? [...header('The pnpm Ri carries'), `exec ${shq(input.node)} ${shq(input.pnpmScript)} "$@"`, ''].join('\n') : null,
    git: input.git ? [...header('This computer’s git'), `exec ${shq(input.git)} "$@"`, ''].join('\n') : null,
  };
}

/** A PATH with Ri's bin folder and Ri's Node first, and each folder once. */
export function toolchainPath(binDir: string, node: string, base: string): string {
  const first = [binDir, path.dirname(node)];
  return [...first, ...base.split(path.delimiter).filter((part) => part && !first.includes(part))].join(path.delimiter);
}

/**
 * Ri's toolchain for apps, with its bin folder written. Cheap enough to call before each kit command:
 * it reads two package manifests and, on a Mac whose first git is Apple's placeholder, asks
 * `xcode-select` where the developer tools are.
 */
export function appToolchain(): AppToolchain {
  const node = process.execPath;
  const binDir = path.join(/* turbopackIgnore: true */ getWorkDir(), 'app-tools', 'bin');
  const toolchain = toolchainPackage();
  const pnpm = toolchain ? carriedPnpm(toolchain) : null;
  const kit = toolchain ? carriedKit(toolchain) : null;
  // Never Ri's own launcher, which would only call itself.
  const git = findComputerGit({ skip: [binDir] });
  fs.mkdirSync(/* turbopackIgnore: true */ binDir, { recursive: true, mode: 0o700 });
  const launchers = planLaunchers({ node, pnpmScript: pnpm?.script ?? null, git });
  for (const name of ['pnpm', 'git'] as const) {
    const file = path.join(/* turbopackIgnore: true */ binDir, name);
    const content = launchers[name];
    if (content) writeLauncher(file, content);
    else fs.rmSync(/* turbopackIgnore: true */ file, { force: true });
  }
  return {
    node,
    binDir,
    pnpm: pnpm ? { version: pnpm.version, command: path.join(/* turbopackIgnore: true */ binDir, 'pnpm') } : null,
    kit,
    git,
    env: { PATH: toolchainPath(binDir, node, process.env.PATH ?? '') },
  };
}

/** The builder chat's PATH: Ri's toolchain first, then what the session already had. */
export function appBuilderSessionPath(base: string): string {
  const toolchain = appToolchain();
  return toolchainPath(toolchain.binDir, toolchain.node, base);
}
