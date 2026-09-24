/**
 * Run a command against an isolated Ri root, after proving where it will read
 * and write.
 *
 *   pnpm iso <root> [--init] [--port <n>] [--tunnel <name>] [--check] [-- <command...>]
 *
 *   pnpm iso ~/ri-homes --init --check
 *   pnpm iso ~/ri-homes --check
 *   pnpm iso ~/ri-homes --port 42251 -- pnpm cli:dev start --dev
 *   pnpm iso ~/ri-homes -- pnpm cli:dev agent list_tasks
 *
 * Before running anything it:
 *   1. builds a clean environment (`isolatedEnv`): inherited app variables,
 *      the caller credential, and the running Claude Code session's variables
 *      are removed, then RI_ROOT, RI_DB_PATH, RI_CONFIG_DIR and RI_WORK_DIR are
 *      set under <root>
 *   2. resolves every data path through the app's own path helpers and refuses
 *      if one lands in the production, default dev, or test home
 *   3. refuses a root whose config carries production's token or tunnel, or
 *      would install the machine-wide skill
 *   4. refuses a port something else is listening on. It never stops another
 *      instance to take its port.
 *
 * `--init` creates the root (0700) and, when it has no config yet, seeds one
 * with `globalSkillEnabled: false` and `onboardedAt` set. The terminal
 * onboarding wizard otherwise runs on the first interactive `start` and
 * installs the shipped skill machine-wide, replacing production's copy.
 *
 * Stop an isolated server by stopping this process (Ctrl-C, or kill its pid).
 * Never use `ri stop` for it: without a runtime record, `stop` falls back to
 * the default port, which belongs to a different instance.
 *
 * With `--check`, or with no command, it prints the resolved paths and exits.
 * The command runs with the clean environment. Signals are forwarded and its
 * exit code is returned.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  APP_ROOT_ENV,
  CONFIG_DIR_ENV,
  DB_PATH_ENV,
  WORK_DIR_ENV,
  getAppRoot,
  getAttachmentsDir,
  getConfigDir,
  getDbPath,
  getDevAppRoot,
  getTestAppRoot,
  getWorkDir,
} from '../src/lib/config/paths';
import {
  checkResolvedPaths,
  checkRootConfig,
  isolatedEnv,
  type EnvMap,
  type ResolvedPaths,
  type RootConfigView,
} from '../src/lib/config/dev-isolation';

interface Args {
  root: string;
  init: boolean;
  port?: number;
  tunnel?: string;
  check: boolean;
  command: string[];
}

function usage(message?: string): never {
  if (message) console.error(`iso: ${message}\n`);
  console.error(
    'usage: pnpm iso <root> [--init] [--port <n>] [--tunnel <name>] [--check] [-- <command...>]',
  );
  process.exit(2);
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function parseArgs(argv: string[]): Args {
  const dash = argv.indexOf('--');
  const own = dash === -1 ? argv : argv.slice(0, dash);
  const command = dash === -1 ? [] : argv.slice(dash + 1);
  let root: string | undefined;
  let port: number | undefined;
  let tunnel: string | undefined;
  let check = false;
  let init = false;
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (a === '--check') check = true;
    else if (a === '--init') init = true;
    else if (a === '--port') {
      const n = Number(own[++i]);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) usage(`invalid --port ${own[i]}`);
      port = n;
    } else if (a === '--tunnel') {
      tunnel = own[++i];
      if (!tunnel) usage('--tunnel needs a name');
    } else if (a.startsWith('-')) usage(`unknown flag ${a}`);
    else if (!root) root = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!root) usage('a root is required');
  return { root: path.resolve(expandHome(root)), init, port, tunnel, check, command };
}

function readConfig(configDir: string): RootConfigView | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Resolve through the real helpers with `env`'s path overrides in place. */
function resolveWith(env: EnvMap): ResolvedPaths {
  const keys = [APP_ROOT_ENV, DB_PATH_ENV, CONFIG_DIR_ENV, WORK_DIR_ENV];
  const saved = keys.map((k) => [k, process.env[k]] as const);
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return {
      appRoot: getAppRoot(),
      dbPath: getDbPath(),
      configDir: getConfigDir(),
      workDir: getWorkDir(),
      attachmentsDir: getAttachmentsDir(),
    };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** The roots other instances and tools own, resolved with no overrides. */
function sharedRoots(): string[] {
  const production = resolveWith({});
  return [production.appRoot, getDevAppRoot(), getTestAppRoot()];
}

/** Create the root and seed a config that keeps the instance off machine-wide state. */
function initRoot(resolved: ResolvedPaths): string[] {
  const done: string[] = [];
  if (!fs.existsSync(resolved.appRoot)) {
    fs.mkdirSync(resolved.appRoot, { recursive: true, mode: 0o700 });
    done.push(`created ${resolved.appRoot}`);
  }
  const configFile = path.join(resolved.configDir, 'config.json');
  if (!fs.existsSync(configFile)) {
    fs.mkdirSync(resolved.configDir, { recursive: true, mode: 0o700 });
    const seed = { version: 1, globalSkillEnabled: false, onboardedAt: new Date().toISOString() };
    fs.writeFileSync(configFile, JSON.stringify(seed, null, 2) + '\n', { mode: 0o600 });
    done.push(`seeded ${configFile}`);
  }
  return done;
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { env, removed } = isolatedEnv(process.env, {
    root: args.root,
    port: args.port,
    tunnelName: args.tunnel,
  });
  const resolved = resolveWith(env);
  const shared = sharedRoots();
  const productionConfig = readConfig(resolveWith({}).configDir);

  const problems = [
    ...checkResolvedPaths(resolved, args.root, shared),
    ...checkRootConfig(readConfig(resolved.configDir), productionConfig, args.tunnel),
  ];
  if (args.port !== undefined && (await portInUse(args.port))) {
    problems.push(`Port ${args.port} is already in use. Pick a free one. iso never stops another instance.`);
  }

  console.error('iso: isolated Ri instance');
  for (const [label, p] of Object.entries(resolved)) console.error(`  ${label.padEnd(15)} ${p}`);
  console.error(`  ${'port'.padEnd(15)} ${args.port ?? '(none)'}`);
  if (args.tunnel) console.error(`  ${'tunnel'.padEnd(15)} ${args.tunnel}`);
  if (removed.length) console.error(`  ${'removed env'.padEnd(15)} ${removed.join(', ')}`);

  if (problems.length) {
    console.error('\niso: refusing to run:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  if (args.init) {
    for (const line of initRoot(resolved)) console.error(`iso: ${line}`);
  }
  if (args.check || args.command.length === 0) {
    console.error('\niso: checks passed');
    return;
  }

  const [cmd, ...rest] = args.command;
  const child = spawn(cmd, rest, { env: env as NodeJS.ProcessEnv, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

void main();
