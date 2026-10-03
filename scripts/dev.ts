/**
 * `pnpm dev`: Next development mode on the dev home (`~/ri-dev`, or `RI_ROOT`), as that
 * home's one owner. The desktop app in development (`pnpm desktop:dev`) and
 * `ri start --dev` open the same home and take the same lock
 * (`src/lib/service/owner.ts`), so two servers never run one database, its
 * scheduler, heartbeat and deck, twice. Whichever starts second says so and
 * stops. Extra arguments select the port, hostname or bundler.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { APP_ROOT_ENV, getDevAppRoot } from '@/lib/config/paths';
import { DEV_PORT } from '@/lib/auth/port';
import { acquireServiceOwner } from '@/lib/service/owner';

process.env[APP_ROOT_ENV] ||= getDevAppRoot();
const root = process.env[APP_ROOT_ENV];

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

const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const child = spawn(process.execPath, [tsx, path.resolve('scripts/serve.ts'), 'dev', '--port', process.env.PORT || String(DEV_PORT), ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  release();
  // Stopped by a signal (Ctrl-C) is a normal stop, not a failure.
  process.exit(signal ? 0 : (code ?? 1));
});
