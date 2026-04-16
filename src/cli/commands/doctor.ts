/**
 * Lightweight diagnostic command.
 *
 * Each check is a function returning `{ ok, detail }`. Adding more checks =
 * append to the `checks` array — no restructuring.
 */

import fs from 'node:fs';
import net from 'node:net';
import pc from 'picocolors';
import { readAuthConfig } from '@/lib/auth/config-file';
import { getDbPath, getUserDataDir } from '@/lib/config/paths';
import { getVoiceEnabled } from '@/lib/config/voice';
import { isDockerAvailable, isVoiceReady } from '../lib/voice';

interface CheckResult {
  ok: boolean;
  detail?: string;
}

type Check = {
  name: string;
  run: () => Promise<CheckResult> | CheckResult;
};

const defaultPort = Number(process.env.PORT ?? 4224);

const checks: Check[] = [
  {
    name: 'User data directory',
    run: () => {
      const dir = getUserDataDir();
      const exists = fs.existsSync(dir);
      return { ok: exists || true, detail: dir };
    },
  },
  {
    name: 'Database file',
    run: () => {
      const p = getDbPath();
      return {
        ok: fs.existsSync(p),
        detail: fs.existsSync(p) ? p : `missing — will be created on first start (${p})`,
      };
    },
  },
  {
    name: 'Pairing token',
    run: () => {
      const config = readAuthConfig();
      return {
        ok: !!config?.localToken,
        detail: config?.localToken ? 'present' : 'missing — run the `pair` command',
      };
    },
  },
  {
    name: `Default port available (${defaultPort})`,
    run: async () => {
      const free = await isPortFree(defaultPort);
      return {
        ok: free,
        detail: free ? 'free' : `port ${defaultPort} is in use`,
      };
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
];

export async function doctorCommand() {
  let allOk = true;

  for (const check of checks) {
    const result = await run(check);
    if (!result.ok) allOk = false;

    const icon = result.ok ? pc.green('✓') : pc.red('✗');
    const detail = result.detail ? pc.dim(` — ${result.detail}`) : '';
    console.log(`${icon} ${check.name}${detail}`);
  }

  process.exit(allOk ? 0 : 1);
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
