#!/usr/bin/env tsx
/**
 * Level 3 smoke test — programmatic Claude via agentex.
 *
 * Runs the full end-to-end loop:
 *   1. Wipes the isolated test data root.
 *   2. Boots the CLI bootstrap (auth, skills install, dev server).
 *   3. Writes a `.mcp.json` at the test root pointing Claude at the
 *      orchestrator HTTP MCP with the freshly-minted bearer token.
 *   4. Spawns Claude headlessly via agentex's getProvider('claude'),
 *      cwd = test root, with a deterministic prompt.
 *   5. After Claude exits, queries the DB via orchestrator actions
 *      (in-process — skips the CLI path) and asserts the expected
 *      task was created.
 *   6. Tears down the server.
 *
 * Skips with a clear message if Claude auth isn't available (checked via
 * `getProvider('claude').checkAuth()`). Exit codes: 0 = pass, 1 = fail,
 * 2 = skipped.
 *
 * Usage:
 *   pnpm smoke:agent
 *   FLOW_ROOT=~/my-custom-test pnpm smoke:agent
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import pc from 'picocolors';

import { APP_ROOT_ENV, getTestAppRoot } from '../src/lib/config/paths';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_ROOT = process.env[APP_ROOT_ENV] ?? getTestAppRoot();
process.env[APP_ROOT_ENV] = TEST_ROOT;

// Unique marker the prompt will ask Claude to use as the task title — lets
// us assert-by-equality instead of fuzzy-match.
const MARKER = `smoke-test-${Date.now()}`;

const PROMPT = `Create a task titled exactly "${MARKER}" using the orchestrator tools. No description or other fields needed. Just the title. Confirm when done.`;

async function main() {
  console.log(pc.bold(`Level 3 smoke: programmatic Claude via agentex`));
  console.log(pc.dim(`  data root: ${TEST_ROOT}`));
  console.log(pc.dim(`  marker:    ${MARKER}`));

  // Check Claude auth before burning a server boot.
  const { getProvider } = await import('@agentex/agent');
  const claude = getProvider('claude');
  try {
    const auth = await claude.resolveAuth({ fresh: true });
    if (!auth.binary.installed) {
      console.log(pc.yellow(`  skip: Claude CLI not installed (${auth.binary.error ?? 'unknown reason'})`));
      process.exit(2);
    }
    const hasAuth = auth.options.some((o) => o.present);
    if (!hasAuth) {
      console.log(pc.yellow(`  skip: Claude CLI installed but no auth path is present`));
      process.exit(2);
    }
  } catch (err) {
    console.log(pc.yellow(`  skip: auth check failed (${err instanceof Error ? err.message : String(err)})`));
    process.exit(2);
  }

  console.log(pc.dim(`  wiping ${TEST_ROOT}…`));
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });

  const port = await pickPort();
  console.log(pc.dim(`  booting server on :${port}…`));

  const repoRoot = path.resolve(__dirname, '..');
  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const child = spawn(
    tsxBin,
    ['src/cli/index.ts', 'start', '--dev', '--no-open', '--no-voice', '--port', String(port)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        [APP_ROOT_ENV]: TEST_ROOT,
        // Isolate Next's build/dev state so we don't fight the main dev server's lock.
        NEXT_DIST_DIR: '.next-smoke',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  child.stdout.on('data', (c) => stdoutBuf.push(String(c)));
  child.stderr.on('data', (c) => stderrBuf.push(String(c)));

  try {
    const healthy = await waitForHealth(port, 30_000);
    if (!healthy) throw new Error(`server never came up on :${port}`);

    const token = readLocalToken(TEST_ROOT);
    writeMcpConfig(TEST_ROOT, port, token);
    console.log(pc.dim(`  .mcp.json written`));

    console.log(pc.dim(`  spawning Claude (cwd=${TEST_ROOT}, maxTurns=6)…`));
    const result = await claude.execute({
      prompt: PROMPT,
      cwd: TEST_ROOT,
      env: { [APP_ROOT_ENV]: TEST_ROOT },
      config: { skipPermissions: true, maxTurns: 6 },
      onEvent: (e) => {
        if (e.type === 'assistant' && 'text' in e && typeof e.text === 'string') {
          process.stdout.write(pc.dim(e.text));
        }
      },
    });
    if (result && 'exitCode' in result && result.exitCode !== 0) {
      console.log(pc.yellow(`\n  Claude exited with ${result.exitCode}`));
    }
    console.log(); // newline after streamed output

    // Query the test DB in-process. Uses FLOW_ROOT which is already set.
    const { listTasks } = await import('../src/lib/db/queries');
    const tasks = listTasks({ q: 'smoke-test-' });
    const match = tasks.find((t) => t.title === MARKER);

    if (match) {
      console.log(pc.green(`  ✓ task created`));
      console.log(pc.dim(`    id:     ${match.id}`));
      console.log(pc.dim(`    title:  ${match.title}`));
      console.log(pc.dim(`    status: ${match.status}`));
      console.log();
      console.log(pc.green(pc.bold('✓ Level 3 passed')));
      process.exit(0);
    } else {
      console.log(pc.red(`  ✗ expected task with title "${MARKER}" not found`));
      console.log(pc.dim(`  tasks in DB matching "smoke-test-":`));
      for (const t of tasks) console.log(pc.dim(`    - ${t.title}`));
      console.log(pc.red(pc.bold('\n✗ Level 3 failed')));
      process.exit(1);
    }
  } catch (err) {
    console.log(pc.red(`\n  error: ${err instanceof Error ? err.message : String(err)}`));
    if (stderrBuf.length) {
      console.log(pc.dim(`\n--- server stderr ---`));
      console.log(pc.dim(stderrBuf.join('').trim()));
    }
    process.exit(1);
  } finally {
    child.kill('SIGTERM');
    await sleep(300);
    if (!child.killed) child.kill('SIGKILL');
  }
}

function readLocalToken(root: string): string {
  const configPath = path.join(root, 'config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw) as { localToken?: string };
  if (!cfg.localToken) throw new Error(`localToken missing from ${configPath}`);
  return cfg.localToken;
}

function writeMcpConfig(root: string, port: number, token: string) {
  const config = {
    mcpServers: {
      orchestrator: {
        type: 'http',
        url: `http://localhost:${port}/api/orchestrator/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(config, null, 2));
}

async function pickPort(): Promise<number> {
  const getPort = (await import('get-port')).default;
  return getPort({ port: 4226 });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(500);
  }
  return false;
}

main().catch((err) => {
  console.error(pc.red(`smoke:agent failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
