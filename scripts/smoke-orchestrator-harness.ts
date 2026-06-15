#!/usr/bin/env tsx
/**
 * Level 4 smoke test — the harness-backed orchestrator chat, end to end.
 *
 * Boots an isolated server against the test data root, then drives the
 * REAL pipeline the dashboard Chat tab uses in harness modes:
 *
 *   1. `harness_mcp`  — ensure the interactive orchestration session via
 *      `/api/orchestrator-chat`, send a deterministic prompt through
 *      `/api/sessions/:id/messages`, and assert: the task landed in the DB,
 *      the transcript carries an `mcp__orchestrator__*` tool call, and the
 *      surface files (CLAUDE.md / AGENTS.md managed block, MCP config)
 *      were installed at the data root.
 *   2. `harness_skills` — switch mode (fresh session), same prompt shape,
 *      and assert: task landed, the session used Bash/CLI (no MCP tool
 *      calls in its transcript).
 *   3. Scheduled orchestrator fire — `create_schedule` with
 *      `targetKind='orchestrator'` + `run_schedule`, assert the run
 *      completes and its task landed (this path used to die with
 *      "Session has no resolvable cwd").
 *
 * Skips (exit 2) when the Claude CLI or its auth isn't available — same
 * contract as the level-3 smoke. Exit 0 = pass, 1 = fail.
 *
 * NOTE: all smoke levels share the test data root and wipe it on start —
 * never run two smoke scripts concurrently.
 *
 * Usage:
 *   pnpm smoke:harness
 *   FLOW_ROOT=~/my-custom-test pnpm smoke:harness
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

const STAMP = Date.now();
const MARKER_MCP = `harness-smoke-mcp-${STAMP}`;
const MARKER_SKILLS = `harness-smoke-skills-${STAMP}`;
const MARKER_SCHEDULED = `harness-smoke-scheduled-${STAMP}`;

const TURN_TIMEOUT_MS = 180_000;

/** Deterministic, single-action prompt — keeps the agent on rails. */
function prompt(marker: string): string {
  return (
    `Create a task titled exactly "${marker}" using your orchestrator tools. ` +
    `No description or other fields. Do not create anything else. Confirm when done.`
  );
}

interface Ctx {
  port: number;
  token: string;
}

async function apiFetch<T>(ctx: Ctx, pathName: string, init: RequestInit = {}): Promise<T> {
  // `Connection: close` — undici's keep-alive pool reuses sockets the Next
  // dev server has already closed, which surfaces as a bare "fetch failed"
  // mid-run. Fresh socket per request + a bounded retry for the connection-
  // level failures that slip through anyway.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`http://localhost:${ctx.port}/api${pathName}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.token}`,
          Connection: 'close',
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      if (attempt < 2) {
        await sleep(750);
        continue;
      }
      throw err;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${init.method ?? 'GET'} ${pathName} → ${res.status} ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}

interface SessionEvent {
  source: string;
  toolName: string | null;
  content: string | null;
}

/** Poll the session's events until a `result` row lands (turn ended). */
async function waitForTurn(ctx: Ctx, sessionId: string, sinceCount: number): Promise<SessionEvent[]> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  for (;;) {
    const events = await apiFetch<SessionEvent[]>(ctx, `/sessions/${sessionId}/events`);
    const fresh = events.slice(sinceCount);
    if (fresh.some((e) => e.source === 'result')) return events;
    if (Date.now() > deadline) {
      throw new Error(
        `turn did not complete within ${TURN_TIMEOUT_MS / 1000}s ` +
          `(events: ${events.map((e) => e.source).join(',')})`,
      );
    }
    await sleep(1500);
  }
}

async function main() {
  console.log(pc.bold('Level 4 smoke: harness-backed orchestrator chat'));
  console.log(pc.dim(`  data root: ${TEST_ROOT}`));

  // Claude availability gate — same contract as level 3.
  const { getProvider } = await import('@agentex/agent');
  const claude = getProvider('claude');
  try {
    const auth = await claude.resolveAuth({ fresh: true });
    if (!auth.binary.installed) {
      console.log(pc.yellow(`  skip: Claude CLI not installed`));
      process.exit(2);
    }
    if (!auth.options.some((o) => o.present)) {
      console.log(pc.yellow(`  skip: Claude CLI installed but no auth present`));
      process.exit(2);
    }
  } catch (err) {
    console.log(pc.yellow(`  skip: auth check failed (${err instanceof Error ? err.message : String(err)})`));
    process.exit(2);
  }

  console.log(pc.dim(`  wiping ${TEST_ROOT}…`));
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });

  const getPort = (await import('get-port')).default;
  const port = await getPort({ port: 4231 });
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
        NEXT_DIST_DIR: '.next-smoke',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // Keep both streams — a dev-server crash logs to stdout, and losing it
  // turns a hard failure into an unexplained "fetch failed".
  const outputBuf: string[] = [];
  child.stdout.on('data', (c) => outputBuf.push(String(c)));
  child.stderr.on('data', (c) => outputBuf.push(String(c)));
  child.on('exit', (code, signal) => {
    outputBuf.push(`\n[smoke] server process exited code=${code} signal=${signal}\n`);
  });

  let failures = 0;
  const fail = (msg: string) => {
    failures += 1;
    console.log(pc.red(`  ✗ ${msg}`));
  };
  const ok = (msg: string) => console.log(pc.green(`  ✓ ${msg}`));

  try {
    const healthy = await waitForHealth(port, 60_000);
    if (!healthy) throw new Error(`server never came up on :${port}`);

    const token = readLocalToken(TEST_ROOT);
    const ctx: Ctx = { port, token };

    // ── Phase 1: harness_mcp ─────────────────────────────────────
    console.log(pc.bold('\n  Phase 1: harness_mcp'));
    await apiFetch(ctx, '/user-state', {
      method: 'PATCH',
      body: JSON.stringify({ orchestratorMode: 'harness_mcp' }),
    });

    const { session: mcpSession } = await apiFetch<{ session: { id: string } }>(ctx, '/orchestrator-chat');
    console.log(pc.dim(`  session: ${mcpSession.id.slice(0, 8)}…`));

    await apiFetch(ctx, `/sessions/${mcpSession.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: prompt(MARKER_MCP) }),
    });
    const mcpEvents = await waitForTurn(ctx, mcpSession.id, 0);

    const { listTasks } = await import('../src/lib/db/queries');
    if (listTasks({ q: MARKER_MCP }).some((t) => t.title === MARKER_MCP)) {
      ok(`task created via MCP mode`);
    } else {
      fail(`task "${MARKER_MCP}" not found`);
    }
    if (mcpEvents.some((e) => e.source === 'tool_call' && e.toolName?.startsWith('mcp__orchestrator__'))) {
      ok(`transcript shows mcp__orchestrator__* tool call`);
    } else {
      fail(`no mcp__orchestrator__* tool call in transcript (tools: ${toolNames(mcpEvents)})`);
    }

    // Surface files on disk.
    const claudeMd = fs.readFileSync(path.join(TEST_ROOT, 'CLAUDE.md'), 'utf8');
    const agentsMd = fs.readFileSync(path.join(TEST_ROOT, 'AGENTS.md'), 'utf8');
    if (claudeMd.includes(':managed:start') && claudeMd.includes('Your tools (MCP)')) {
      ok('CLAUDE.md carries the managed MCP brief');
    } else {
      fail('CLAUDE.md missing managed MCP brief');
    }
    if (agentsMd.includes(':managed:start')) {
      ok('AGENTS.md installed');
    } else {
      fail('AGENTS.md missing managed block');
    }
    // agentex ≥0.0.20 stages the MCP config itself (0600 temp file outside
    // the data root); the mcp__orchestrator__* tool-call assert above is the
    // end-to-end proof of attachment. Our old token-bearing staging file
    // must NOT reappear (and install cleans up stale copies).
    if (fs.existsSync(path.join(TEST_ROOT, 'tmp', 'orchestrator-mcp.json'))) {
      fail('tmp/orchestrator-mcp.json present — host-staged MCP config should be gone (agentex stages its own)');
    } else {
      ok('no host-staged MCP config (agentex owns staging)');
    }

    // ── Phase 2: harness_skills ──────────────────────────────────
    console.log(pc.bold('\n  Phase 2: harness_skills'));
    await apiFetch(ctx, '/user-state', {
      method: 'PATCH',
      body: JSON.stringify({ orchestratorMode: 'harness_skills' }),
    });
    const { session: skillsSession } = await apiFetch<{ session: { id: string } }>(ctx, '/orchestrator-chat', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    console.log(pc.dim(`  session: ${skillsSession.id.slice(0, 8)}…`));

    await apiFetch(ctx, `/sessions/${skillsSession.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: prompt(MARKER_SKILLS) }),
    });
    const skillsEvents = await waitForTurn(ctx, skillsSession.id, 0);

    if (listTasks({ q: MARKER_SKILLS }).some((t) => t.title === MARKER_SKILLS)) {
      ok('task created via skills/CLI mode');
    } else {
      fail(`task "${MARKER_SKILLS}" not found`);
    }
    if (skillsEvents.some((e) => e.source === 'tool_call' && e.toolName?.startsWith('mcp__'))) {
      fail(`skills session unexpectedly used MCP tools (tools: ${toolNames(skillsEvents)})`);
    } else {
      ok('skills session ran MCP-free (strict config held)');
    }
    if (skillsEvents.some((e) => e.source === 'tool_call' && e.toolName === 'Bash')) {
      ok('skills session drove the CLI through Bash');
    } else {
      fail(`no Bash tool call in skills transcript (tools: ${toolNames(skillsEvents)})`);
    }

    // ── Phase 3: scheduled orchestrator fire ─────────────────────
    // Fired through the server's HTTP routes — the same dispatch path the
    // scheduler tick and the UI's "Run now" use. (In-process dispatch from
    // this script is off the table: tsx compiles the static import chain
    // executor → @agentex/agent as CJS, and agentex ships ESM-only.)
    console.log(pc.bold('\n  Phase 3: scheduled orchestrator fire'));
    const { schedule } = await apiFetch<{ schedule: { id: string } }>(ctx, '/schedules', {
      method: 'POST',
      body: JSON.stringify({
        name: `harness-smoke-${STAMP}`,
        targetKind: 'orchestrator',
        kind: 'manual',
        prompt: prompt(MARKER_SCHEDULED),
      }),
    });

    const { run, chatSessionId } = await apiFetch<{
      run: { id: string };
      chatSessionId: string | null;
    }>(ctx, `/schedules/${schedule.id}?action=run`, { method: 'POST', body: '{}' });
    if (!chatSessionId) throw new Error('scheduled fire produced no chat session');
    console.log(pc.dim(`  run: ${run.id.slice(0, 8)}… chat: ${chatSessionId.slice(0, 8)}…`));

    interface RunRow {
      status: string;
      errorMessage?: string | null;
    }
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    let runRow: RunRow | null = null;
    for (;;) {
      runRow = await apiFetch<RunRow>(ctx, `/runs/${run.id}`).catch(() => null);
      if (runRow && runRow.status !== 'queued' && runRow.status !== 'running') break;
      if (Date.now() > deadline) break;
      await sleep(1500);
    }
    if (runRow?.status === 'completed') {
      ok('scheduled orchestrator run completed (no "no resolvable cwd")');
    } else {
      fail(`scheduled run ended ${runRow?.status ?? 'unknown'} ${runRow?.errorMessage ?? ''}`);
    }
    if (listTasks({ q: MARKER_SCHEDULED }).some((t) => t.title === MARKER_SCHEDULED)) {
      ok('scheduled fire created its task');
    } else {
      fail(`task "${MARKER_SCHEDULED}" not found`);
    }

    console.log();
    if (failures === 0) {
      console.log(pc.green(pc.bold('✓ Level 4 passed')));
    } else {
      console.log(pc.red(pc.bold(`✗ Level 4 failed (${failures} assertion${failures === 1 ? '' : 's'})`)));
    }
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (err) {
    console.log(pc.red(`\n  error: ${err instanceof Error ? err.message : String(err)}`));
    if (outputBuf.length) {
      console.log(pc.dim('\n--- server output (tail) ---'));
      console.log(pc.dim(outputBuf.join('').split('\n').slice(-60).join('\n')));
    }
    process.exitCode = 1;
  } finally {
    // Best-effort: archive the live orchestrator chat through the server so
    // its harness process is closed (executor.close) before we take the
    // server down — otherwise idle `claude` subprocesses can orphan.
    try {
      const token = readLocalToken(TEST_ROOT);
      await fetch(`http://localhost:${port}/api/orchestrator-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      });
    } catch {
      /* best-effort */
    }
    child.kill('SIGTERM');
    await sleep(500);
    if (!child.killed) child.kill('SIGKILL');
  }
}

function toolNames(events: SessionEvent[]): string {
  return (
    [...new Set(events.filter((e) => e.source === 'tool_call').map((e) => e.toolName))].join(', ') || 'none'
  );
}

function readLocalToken(root: string): string {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')) as {
    localToken?: string;
  };
  if (!cfg.localToken) throw new Error('localToken missing from config.json');
  return cfg.localToken;
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
  console.error(pc.red(`smoke:harness failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
