/**
 * `pnpm dev`: Next development mode on the dev home (`~/ri-dev`, or `RI_ROOT`), as that
 * home's one owner. The desktop app in development (`pnpm desktop:dev`) and
 * `ri start --dev` open the same home and take the same lock
 * (`src/lib/service/owner.ts`), so two servers never run one database, its
 * scheduler, heartbeat and deck, twice. Whichever starts second says so and
 * stops. Extra arguments select the port, hostname or bundler.
 *
 * It never opens the production home: a development server applies draft
 * migrations as soon as they're generated. An inherited RI_ROOT naming
 * production means the dev home (resolveDevAppRoot), and a database, config
 * or work folder inside production is refused. Once the server answers, it
 * publishes the home's runtime record (as `ri start` does), so `ri` aimed at
 * this home, including from the sessions this server runs, reaches this
 * server rather than the default production port. See docs/environments.md.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  APP_ROOT_ENV,
  getAppRoot,
  getConfigDir,
  getDbPath,
  getProductionAppRoot,
  getWorkDir,
  resolveDevAppRoot,
} from '@/lib/config/paths';
import { isWithin } from '@/lib/config/dev-isolation';
import { DEV_PORT, setRunningPort } from '@/lib/auth/port';
import { acquireServiceOwner } from '@/lib/service/owner';
import { clearServerRuntimeIfOwned, newRunId, publishServerRuntime } from '@/lib/server-runtime/record';
import { waitForServer } from '@/cli/lib/server';

process.env[APP_ROOT_ENV] = resolveDevAppRoot();
const root = process.env[APP_ROOT_ENV];

const production = getProductionAppRoot();
const intoProduction = Object.entries({ root: getAppRoot(), database: getDbPath(), config: getConfigDir(), work: getWorkDir() })
  .filter(([, p]) => isWithin(p, production));
if (intoProduction.length > 0) {
  console.error(
    `pnpm dev never opens the production home (${production}), but these resolve inside it:\n` +
      intoProduction.map(([label, p]) => `  ${label}: ${p}`).join('\n') +
      '\nUnset RI_ROOT, RI_DB_PATH, RI_CONFIG_DIR and RI_WORK_DIR to use the dev home, or point them at another one.',
  );
  process.exit(1);
}

let release: () => void;
try {
  release = acquireServiceOwner();
} catch {
  console.error(
    `${root} is already open in another launcher: the desktop app, \`ri start --dev\` or another \`pnpm dev\`.\n` +
      'Stop that one first, or use it.',
  );
  process.exit(1);
}

/** The port serve.ts will bind: the last --port/-p argument, else PORT, else the dev default. */
function effectivePort(args: string[]): number {
  let port = process.env.PORT || String(DEV_PORT);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) port = args[++i];
  }
  return Number(port);
}

const args = process.argv.slice(2);
const port = effectivePort(args);
const runId = newRunId();
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const child = spawn(process.execPath, [tsx, path.resolve('scripts/serve.ts'), 'dev', '--port', String(port), ...args], {
  env: process.env,
  stdio: 'inherit',
});

// Publish where this home is served once it answers. Only this launcher owns
// the home (the lock above), so the record can't displace another instance.
const baseUrl = `http://localhost:${port}`;
void waitForServer(baseUrl, 10 * 60_000).then(
  () => {
    if (child.exitCode !== null) return;
    setRunningPort(port);
    publishServerRuntime({
      version: 1,
      runId,
      launcherPid: process.pid,
      startedAt: new Date().toISOString(),
      mode: 'http',
      http2: false,
      publicBaseUrl: baseUrl,
      publicPort: port,
      privateUpstreams: { next: baseUrl },
    });
  },
  (err: unknown) => console.error(`[dev] ${err instanceof Error ? err.message : String(err)}. \`ri\` for this home may not find this server.`),
);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  clearServerRuntimeIfOwned(runId);
  release();
  // Stopped by a signal (Ctrl-C) is a normal stop, not a failure.
  process.exit(signal ? 0 : (code ?? 1));
});
