/**
 * Checks for running Ri against an isolated development root.
 *
 * A git worktree isolates code, not data. Every path helper falls back to the
 * production home (`~/<APP_SHORT_ID>`) when `<APP>_ROOT` is unset, and a shell
 * started from inside a harness session inherits that session's environment,
 * including its caller credential and Claude Code's own session variables. So
 * isolation is established here, by paths, before anything boots:
 *
 * - `isolatedEnv` builds a clean environment: inherited app and harness-session
 *   variables are removed, then all four path overrides are set explicitly.
 * - `checkResolvedPaths` refuses when a resolved path lands in a shared root.
 * - `checkRootConfig` refuses a root whose machine config would reach outside
 *   it: a copied production token or tunnel, or a machine-wide skill install.
 *
 * `scripts/isolated.ts` wires these together. Paths are compared after
 * following symlinks, so a dev root, or a folder inside it, that links into
 * production is caught. Nothing here writes.
 */

import path from 'node:path';
import { canonicalPath } from '@/lib/config/canonical-path';

export { canonicalPath };
import {
  APP_ROOT_ENV,
  CONFIG_DIR_ENV,
  DB_PATH_ENV,
  WORK_DIR_ENV,
} from '@/lib/config/paths';
import { APP_SHORT_ID } from '@/constants/app';

const ENV_PREFIX = `${APP_SHORT_ID.toUpperCase()}_`;

/**
 * Env var the server reads for a fixed Beamd tunnel name. Same value as
 * `TUNNEL_NAME_ENV` in `beamd-base-url.ts`, which can't be imported here
 * without pulling the auth bootstrap into a pure module.
 */
export const TUNNEL_NAME_ENV = `${ENV_PREFIX}TUNNEL_NAME`;

/**
 * Claude Code variables that configure which model backend to use. They carry
 * no session identity, so a dev server may inherit them.
 */
const KEPT_CLAUDE_VARS = new Set([
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
]);

/**
 * Whether an inherited variable must not reach an isolated instance.
 *
 * - `<APP>_*`: every app override, and the caller credential of the session
 *   this shell runs under. A dev server that inherits the credential labels
 *   its harness sessions with a production chat's identity.
 * - `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID`, `CLAUDE_EFFORT`: the running
 *   Claude Code session's identity, messaging socket and token. A harness the
 *   dev server spawns would otherwise start as that session's child.
 */
export function isScrubbedVar(name: string): boolean {
  if (name.startsWith(ENV_PREFIX)) return true;
  if (KEPT_CLAUDE_VARS.has(name)) return false;
  if (name === 'CLAUDECODE' || name === 'CLAUDE_PID' || name === 'CLAUDE_EFFORT') return true;
  return name.startsWith('CLAUDE_CODE_');
}

/** An environment as a plain map. `NodeJS.ProcessEnv` requires `NODE_ENV` here. */
export type EnvMap = Record<string, string | undefined>;

export interface IsolatedEnvOptions {
  /** Absolute root for the isolated instance. */
  root: string;
  /** Server port. Omitted for commands that don't listen. */
  port?: number;
  /** Fixed Beamd tunnel name for this instance, when it needs an address. */
  tunnelName?: string;
}

export interface IsolatedEnv {
  env: EnvMap;
  /** Names of inherited variables that were removed, for the printed summary. */
  removed: string[];
}

/** A clean environment with every data path pinned under `root`. */
export function isolatedEnv(base: EnvMap, opts: IsolatedEnvOptions): IsolatedEnv {
  if (!path.isAbsolute(opts.root)) {
    throw new Error(`Isolated root must be absolute: ${opts.root}`);
  }
  const env: EnvMap = {};
  const removed: string[] = [];
  for (const [name, value] of Object.entries(base)) {
    if (isScrubbedVar(name)) {
      removed.push(name);
      continue;
    }
    env[name] = value;
  }
  env[APP_ROOT_ENV] = opts.root;
  env[DB_PATH_ENV] = path.join(opts.root, 'data.db');
  env[CONFIG_DIR_ENV] = path.join(opts.root, '.config');
  env[WORK_DIR_ENV] = path.join(opts.root, '.work');
  if (opts.port !== undefined) env.PORT = String(opts.port);
  if (opts.tunnelName) env[TUNNEL_NAME_ENV] = opts.tunnelName;
  return { env, removed: removed.sort() };
}

export interface ResolvedPaths {
  appRoot: string;
  dbPath: string;
  configDir: string;
  workDir: string;
  attachmentsDir: string;
}

/** Whether `child` is `parent` or somewhere below it, after following symlinks. */
export function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(canonicalPath(parent), canonicalPath(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Problems with where an isolated instance would read and write. `shared` is
 * every root another instance or tool owns: the production home, the default
 * dev home other sessions run on, and the test home the smokes wipe.
 */
export function checkResolvedPaths(
  resolved: ResolvedPaths,
  expectedRoot: string,
  shared: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const [label, p] of Object.entries(resolved)) {
    if (!isWithin(p, expectedRoot)) {
      problems.push(`${label} resolves outside the isolated root: ${p}`);
    }
    for (const s of shared) {
      if (isWithin(p, s)) problems.push(`${label} resolves inside the shared root ${s}: ${p}`);
    }
  }
  for (const s of shared) {
    if (isWithin(s, expectedRoot)) {
      problems.push(`The isolated root ${expectedRoot} contains the shared root ${s}`);
    }
  }
  return problems;
}

/** The fields of `config.json` these checks read. */
export interface RootConfigView {
  localToken?: string | null;
  tunnelUrl?: string | null;
  tunnelName?: string | null;
  globalSkillEnabled?: boolean | null;
}

/** The single DNS label a Beamd URL was opened under, e.g. `ri-trey`. */
export function tunnelLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

/**
 * Problems with an isolated root's machine config, compared with production's.
 * A root restored from a production backup carries production's token and
 * tunnel, and booting it would answer on production's address or accept
 * production's paired devices.
 */
export function checkRootConfig(
  root: RootConfigView | null,
  production: RootConfigView | null,
  tunnelNameOverride?: string,
): string[] {
  const problems: string[] = [];
  if (root?.globalSkillEnabled === true) {
    problems.push(
      'globalSkillEnabled is on. Starting would replace the machine-wide Ri skill that production installed. Set it to false in this root\'s .config/config.json.',
    );
  }
  if (!production) return problems;
  if (root?.localToken && production.localToken && root.localToken === production.localToken) {
    problems.push('This root uses production\'s local token. Give it fresh credentials before starting it.');
  }
  const prodLabels = new Set(
    [production.tunnelName, tunnelLabel(production.tunnelUrl)].filter(
      (v): v is string => Boolean(v),
    ),
  );
  const rootLabels = [
    tunnelNameOverride,
    root?.tunnelName,
    tunnelLabel(root?.tunnelUrl),
  ].filter((v): v is string => Boolean(v));
  for (const label of rootLabels) {
    if (prodLabels.has(label)) {
      problems.push(`The tunnel name "${label}" is production's address. Use a separate dev name.`);
    }
  }
  return problems;
}
