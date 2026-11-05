/**
 * Lightweight diagnostic command.
 *
 * Each check is a function returning `{ ok, detail }`. Adding more checks =
 * append to the `checks` array — no restructuring.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pc from 'picocolors';
import { readAuthConfig } from '@/lib/auth/config-file';
import { getDbPath, getAppRoot } from '@/lib/config/paths';
import { getVoiceEnabled } from '@/lib/config/voice';
import { isDockerAvailable, isVoiceReady } from '../lib/voice';
import { runBrowserDoctor } from '@/lib/browser/doctor';
import { getInstallationRole } from '@/lib/config/role';
import { serviceStatus } from '@/lib/service/client';
import { hasLoginSupervision } from '@/lib/service/supervision-state';
import { readStopped } from '@/lib/service/stopped';
import { freeBytes } from '@/lib/service/snapshot';
import { commandLauncherPath } from '@/lib/service/runtime';
import { commandCheck, diskCheck, linuxChecks, macChecks, resolveCommand, type OsCheck } from '@/lib/service/os-checks';
import { readLiveServerRuntime } from '@/lib/server-runtime/record';
import { untraced } from '@/lib/utils/untraced';

interface CheckResult {
  ok: boolean;
  /** Worth knowing, but not a failure: `ri doctor` still passes. */
  warn?: boolean;
  detail?: string;
}

type Check = {
  name: string;
  run: () => Promise<CheckResult> | CheckResult;
};

export interface NamedCheckResult extends CheckResult {
  name: string;
}

const defaultPort = Number(process.env.PORT ?? 4224);

const checks: Check[] = [
  {
    name: 'App root directory',
    run: () => {
      const dir = getAppRoot();
      const exists = fs.existsSync(dir);
      return { ok: exists || true, detail: dir };
    },
  },
  {
    name: 'Database file',
    run: () => {
      const p = getDbPath();
      const exists = fs.existsSync(p);
      // Not a failure when missing — the schema is pushed on first server boot.
      return {
        ok: true,
        detail: exists ? p : `will be created on first start (${p})`,
      };
    },
  },
  {
    name: 'Pairing token',
    run: () => {
      const config = readAuthConfig();
      return {
        ok: !!config?.localToken,
        detail: config?.localToken ? 'present' : 'missing. Run the `pair` command',
      };
    },
  },
  {
    name: `Default port available (${defaultPort})`,
    run: async () => {
      const free = await isPortFree(defaultPort);
      if (free) return { ok: true, detail: 'free' };
      // This Home serving there is the port doing its job.
      const service = await serviceStatus().catch(() => null);
      const ours = (service?.origin && Number(new URL(service.origin).port) === defaultPort)
        || readLiveServerRuntime()?.publicPort === defaultPort;
      return { ok: !!ours, detail: ours ? 'used by this Home' : `port ${defaultPort} is in use` };
    },
  },
  {
    name: 'Voice (Parakeet STT)',
    run: async () => {
      const wanted = getVoiceEnabled();
      if (!wanted) return { ok: true, detail: 'disabled in config' };
      if (await isVoiceReady()) return { ok: true, detail: 'running' };
      if (!(await isDockerAvailable())) {
        return { ok: false, detail: 'enabled, but Docker daemon is not running' };
      }
      return { ok: true, detail: 'enabled, will start on server launch' };
    },
  },
  {
    name: 'Agent browser',
    run: async () => {
      const checks = await runBrowserDoctor();
      const browserCheck = checks.find((c) => c.name === 'Chromium-family browser');
      // Not a hard failure: the capability is optional and launches on demand.
      return { ok: true, detail: browserCheck?.detail ?? 'not configured' };
    },
  },
];

export async function doctorCommand() {
  const results = await runDoctorChecks();
  printDoctorChecks(results);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

/**
 * Run every check and return the results without printing or exiting.
 * Reusable from `start` so we can show a quick health snapshot without
 * making the user invoke `ri doctor` separately.
 */
export async function runDoctorChecks(): Promise<NamedCheckResult[]> {
  const out: NamedCheckResult[] = [];
  for (const check of checks) {
    const result = await run(check);
    out.push({ name: check.name, ...result });
  }
  try { out.push(...await keepRunningChecks()); }
  catch (err) { out.push({ name: 'Keeping Ri running', ok: true, warn: true, detail: err instanceof Error ? err.message : String(err) }); }
  return out;
}

/** Runs an OS command for a check, or null when it failed or doesn't exist. */
function runQuietly(command: string, args: string[]): string | null {
  try { return execFileSync(untraced(command), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }); }
  catch { return null; }
}

/**
 * Whether this Home comes back by itself, and what the OS decides about it
 * (docs/always-on-spec.md section 6.5), plus the disk and the `ri` command.
 */
async function keepRunningChecks(): Promise<OsCheck[]> {
  const out: OsCheck[] = [];
  if (getInstallationRole() === 'home') {
    const stopped = readStopped();
    out.push(hasLoginSupervision()
      ? { name: 'Kept running', ok: true, warn: !!stopped, detail: stopped ? `stopped by you on ${new Date(stopped.at).toLocaleString()}. \`ri start\` starts it again` : 'yes, by the OS, after crashes and restarts' }
      : { name: 'Kept running', ok: true, warn: true, detail: 'no. A crash or a restart leaves it down. `ri start` keeps it running' });
  }
  if (process.platform === 'darwin') out.push(...macChecks(runQuietly));
  else if (process.platform === 'linux') out.push(...linuxChecks(runQuietly));
  const database = getDbPath();
  out.push(diskCheck(freeBytes(fs.existsSync(database) ? path.dirname(database) : getAppRoot()), fs.existsSync(database) ? fs.statSync(database).size : 0));
  const launcher = commandLauncherPath();
  out.push(commandCheck(resolveCommand('ri'), launcher, fs.existsSync(launcher)));
  return out;
}

/**
 * Print check results. By default shows every line. With `compact: true`,
 * only failures are listed in detail and a one-line summary stands in for
 * a fully-green run — used by the `start` preflight to stay quiet on the
 * happy path.
 */
export function printDoctorChecks(
  results: NamedCheckResult[],
  options: { compact?: boolean } = {},
): void {
  const failures = results.filter((r) => !r.ok);

  if (options.compact && failures.length === 0) {
    console.log(pc.green('✓') + ` Diagnostics passed (${results.length} checks)`);
    return;
  }

  const toPrint = options.compact ? failures : results;
  for (const result of toPrint) {
    const icon = !result.ok ? pc.red('✗') : result.warn ? pc.yellow('!') : pc.green('✓');
    const detail = result.detail ? pc.dim(`: ${result.detail}`) : '';
    console.log(`${icon} ${result.name}${detail}`);
  }
}

async function run(check: Check): Promise<CheckResult> {
  try {
    return await check.run();
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}
