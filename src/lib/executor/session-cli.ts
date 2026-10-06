/**
 * `ri` in a harness session's shell runs the CLI of the server that started
 * the session, against that server's home.
 *
 * agentex spawns every harness with an allowlisted environment (PATH, HOME,
 * locale, provider keys), so the server's data-root variables never reach the
 * session. Left alone, `ri` there resolves the production home, runs whatever
 * checkout the global `ri` points at, and loads migrations from the shell's
 * working folder. A session the dev server started then wrote into
 * production, and a draft migration in a worktree reached the production
 * database (2026-10-05).
 *
 * So the server writes a small launcher, `<work dir>/bin/ri`, puts that
 * folder first on the PATH of each session it runs itself, and names it in
 * `RI_SESSION_CLI`. The PATH is enough for a plain shell (Claude Code's).
 * A login shell (Codex runs `zsh -lc`) rebuilds PATH with the system folders
 * first, where macOS's own `/usr/bin/ri` (Ruby's documentation tool) wins,
 * so the production `ri` installed in `~/.local/bin` hands off to
 * `RI_SESSION_CLI` when it's set (scripts/release/ri.sh). The launcher pins
 * this home (and this server's database, config and work folders when it
 * overrides them), this server's checkout for code and migrations, and its
 * Node. A shell that sets RI_ROOT itself still chooses its own home. A
 * development server's launcher runs the CLI from source, so a dev session
 * exercises the code under development rather than the last CLI build.
 *
 * Sessions on a connected device reach the home over HTTP and keep that
 * device's own `ri`, so this applies only to the home's own sessions.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  APP_ROOT_ENV,
  CONFIG_DIR_ENV,
  DB_PATH_ENV,
  WORK_DIR_ENV,
  getAppRoot,
  getWorkDir,
} from '@/lib/config/paths';
import { runtimeRepository } from '@/lib/releases/runtime-identity';

const LAUNCHER_NAME = 'ri';

/** Names the session's launcher, for an `ri` found first on a rebuilt PATH. */
export const SESSION_CLI_ENV = 'RI_SESSION_CLI';

export interface SessionCliPlan {
  /** Folder to put first on the session's PATH. */
  binDir: string;
  /** The launcher script inside it. */
  launcher: string;
  /** Exact script contents. */
  content: string;
}

/** Quote a value for a POSIX shell. */
function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The CLI this server hands its sessions, or null when its checkout has none.
 * A development server runs it from source through tsx's loader (`node
 * --import`), not the `tsx` command: that one opens an IPC socket in TMPDIR,
 * which Codex's sandbox refuses.
 */
function cliEntry(repo: string): { args: string[]; env: Record<string, string> } | null {
  const source = path.join(repo, 'src/cli/index.ts');
  const loader = path.join(repo, 'node_modules/tsx/dist/loader.mjs');
  if (process.env.NODE_ENV === 'development' && fs.existsSync(source) && fs.existsSync(loader)) {
    return { args: ['--import', loader, source], env: { TSX_TSCONFIG_PATH: path.join(repo, 'tsconfig.json') } };
  }
  const built = path.join(repo, 'dist/cli/index.mjs');
  return fs.existsSync(built) ? { args: [built], env: {} } : null;
}

/** What the launcher would contain for this server. Pure apart from reading the checkout. */
export function planSessionCli(): SessionCliPlan | null {
  const repo = path.resolve(runtimeRepository());
  const entry = cliEntry(repo);
  if (!entry) return null;

  const binDir = path.join(getWorkDir(), 'bin');
  // The home's own folders, pinned only when the shell hasn't chosen a home.
  // An override this server runs with goes along, so the CLI opens the same
  // database the server does.
  const pins: string[] = [`  ${APP_ROOT_ENV}=${shq(getAppRoot())}; export ${APP_ROOT_ENV}`];
  for (const name of [DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV]) {
    const value = process.env[name];
    if (value) pins.push(`  ${name}=${shq(value)}; export ${name}`);
  }
  const content = [
    '#!/bin/sh',
    '# Ri session launcher, written by the server for the harness sessions it',
    '# runs (src/lib/executor/session-cli.ts). `ri` here acts on the home that',
    '# started this session. Rewritten when a session starts.',
    `if [ -z "\${${APP_ROOT_ENV}:-}" ]; then`,
    ...pins,
    'fi',
    // Migrations come from the server's checkout, never the shell's folder.
    `repo=${shq(repo)}`,
    'RI_RUNTIME_REPO="${RI_RUNTIME_REPO:-$repo}"; export RI_RUNTIME_REPO',
    ...Object.entries(entry.env).map(([name, value]) => `${name}=${shq(value)}; export ${name}`),
    `exec ${[process.execPath, ...entry.args].map(shq).join(' ')} "$@"`,
    '',
  ].join('\n');
  return { binDir, launcher: path.join(binDir, LAUNCHER_NAME), content };
}

/**
 * Write the launcher when it is missing or stale, and return where it is.
 * Null when this server has no CLI to offer, in which case the session keeps
 * whatever `ri` its PATH finds.
 */
export function ensureSessionCli(): { binDir: string; launcher: string } | null {
  const plan = planSessionCli();
  if (!plan) return null;
  let current: string | null = null;
  try {
    current = fs.readFileSync(plan.launcher, 'utf8');
  } catch {
    // Missing: written below.
  }
  if (current !== plan.content) {
    fs.mkdirSync(plan.binDir, { recursive: true, mode: 0o700 });
    // Another session may be starting this launcher right now, so replace it
    // whole rather than truncating it in place.
    const tmp = `${plan.launcher}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, plan.content, { mode: 0o755 });
    fs.renameSync(tmp, plan.launcher);
  }
  return { binDir: plan.binDir, launcher: plan.launcher };
}

/** The session PATH with this server's launcher folder first. */
export function sessionPath(binDir: string, base = process.env.PATH ?? ''): string {
  const rest = base.split(path.delimiter).filter((part) => part && part !== binDir);
  return [binDir, ...rest].join(path.delimiter);
}
