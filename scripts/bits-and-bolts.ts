#!/usr/bin/env tsx
/**
 * `pnpm bits-and-bolts [start|stop|status]`: OpenAI's Bits & Bolts sample app as a local MCP
 * server, the conformance fixture for MCP Apps and OpenAI's MCP extensions
 * (docs/connected-mcp-apps.md, "Bits & Bolts").
 *
 *   pnpm bits-and-bolts start    build it if needed, then serve http://localhost:3917/mcp
 *   pnpm bits-and-bolts stop     end the server
 *   pnpm bits-and-bolts status   the URL, and whether it is up
 *
 * It builds openai/mcp-extensions at a pinned commit into ~/.local/share/ri-bits-and-bolts
 * (BITS_AND_BOLTS_HOME), never inside this checkout, and keeps its CAD library there across
 * restarts. It serves Bits & Bolts' own local store on 127.0.0.1 only, without authentication,
 * and runs only while started: nothing starts it at login. Add it in Ri under Settings, Plugins,
 * Add MCP server, with the URL above and Auth None.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** openai/mcp-extensions main on 2026-10-19 ("docs: Consolidate changelog and refresh walkthrough screenshot"). */
const COMMIT = '0d606217705e0e71eb21fff009619b67b80611dc';
const REPOSITORY = 'https://github.com/openai/mcp-extensions.git';
const PORT = Number(process.env.BITS_AND_BOLTS_PORT ?? 3917);
const URL_ = `http://localhost:${PORT}/mcp`;
const home = process.env.BITS_AND_BOLTS_HOME ?? path.join(os.homedir(), '.local/share/ri-bits-and-bolts');
const source = path.join(home, 'mcp-extensions');
const plugin = path.join(source, 'plugins/bits-and-bolts');
const launcher = path.join(plugin, '.ri/launcher.js');
const launcherSource = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bits-and-bolts/launcher.mjs');
const library = path.join(home, 'library');
const logFile = path.join(home, 'server.log');
const pidFile = path.join(home, 'server.pid');
const stampFile = path.join(home, 'build.json');

/** A clean environment: neither the build nor the server needs Ri's session credentials or home paths. */
const cleanEnv = (extra: Record<string, string> = {}) =>
  ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir(), ...extra }) as unknown as NodeJS.ProcessEnv;
const run = (command: string, args: string[], cwd: string) => {
  console.log(`  ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: cleanEnv({ CI: '1' }) });
};
const git = (args: string[]) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The pid of the server this command started, if that process is still running it. */
function ownPid(): number | null {
  const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : NaN);
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return null;
  // A reused pid belongs to something else. Only claim the process running this launcher.
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    return command.includes(launcher) ? pid : null;
  } catch { return null; }
}

/** Whether Bits & Bolts answers an MCP handshake on the port. */
async function answers(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ri-bits-and-bolts-status', version: '1' } } }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok && (await response.text()).includes('"bits-and-bolts"');
  } catch { return false; }
}

/** Whether anything at all is listening on the port. */
async function portTaken(): Promise<boolean> {
  try { await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

function built(): boolean {
  if (!fs.existsSync(stampFile) || !fs.existsSync(launcher) || !fs.existsSync(path.join(plugin, 'dist/app.html'))) return false;
  const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8')) as { commit?: string; launcher?: string };
  return stamp.commit === COMMIT && stamp.launcher === digest(launcherSource);
}

async function build() {
  console.log(`Building Bits & Bolts (openai/mcp-extensions ${COMMIT.slice(0, 8)}) in ${home}`);
  fs.mkdirSync(home, { recursive: true });
  if (!fs.existsSync(path.join(source, '.git'))) {
    fs.mkdirSync(source, { recursive: true });
    run('git', ['init', '--quiet'], source);
    run('git', ['remote', 'add', 'origin', REPOSITORY], source);
  }
  if ((() => { try { return git(['rev-parse', 'HEAD']); } catch { return ''; } })() !== COMMIT) {
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', COMMIT], source);
    run('git', ['checkout', '--quiet', '--detach', COMMIT], source);
  }
  run('pnpm', ['install', '--frozen-lockfile'], source);
  run('pnpm', ['--filter', '@openai/mcp-extensions', 'build'], source);
  run('pnpm', ['--filter', 'bits-and-bolts', 'build'], source);
  // Bundle the launcher against the plugin's own sources and dependencies (MCP SDK v2, zod 4).
  // Copied into the plugin first: a bare import resolves from the importing file's folder, and
  // from this checkout it would find Ri's own zod 3 and mix two zod copies in one schema.
  const entry = path.join(plugin, '.ri/launcher.mjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.copyFileSync(launcherSource, entry);
  const { build: esbuild } = createRequire(path.join(plugin, 'package.json'))('esbuild') as typeof import('esbuild');
  await esbuild({
    entryPoints: [entry], outfile: launcher, bundle: true, platform: 'node', target: 'node22', format: 'esm',
    define: { __LOCAL_FILESYSTEM__: 'true' }, alias: { BNB: plugin },
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    logLevel: 'warning',
  });
  fs.writeFileSync(stampFile, JSON.stringify({ commit: COMMIT, launcher: digest(launcherSource), builtAt: new Date().toISOString() }, null, 2) + '\n');
}

async function status() {
  const pid = ownPid();
  if (pid && await answers()) {
    console.log(`Bits & Bolts is running at ${URL_} (pid ${pid}).`);
    console.log(`  Library: ${library}`);
    console.log(`  Log: ${logFile}`);
  } else if (pid) {
    console.log(`Bits & Bolts (pid ${pid}) is starting or not answering at ${URL_}. Log: ${logFile}`);
  } else if (await answers()) {
    console.log(`Bits & Bolts is answering at ${URL_}, but this command did not start it. Stop that process yourself.`);
  } else {
    console.log(`Bits & Bolts is not running. Start it with \`pnpm bits-and-bolts start\`. It would serve ${URL_}.`);
  }
}

async function start() {
  if (ownPid() && await answers()) return status();
  if (await portTaken()) throw new Error(`Port ${PORT} is already in use by another process. Stop it, or set BITS_AND_BOLTS_PORT.`);
  if (!built()) await build();
  fs.mkdirSync(library, { recursive: true });
  const log = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [launcher], {
    cwd: plugin,
    detached: true,
    stdio: ['ignore', log, log],
    env: cleanEnv({ PORT: String(PORT), CAD_LIBRARY_HOME: library }),
  });
  child.unref();
  fs.closeSync(log);
  fs.writeFileSync(pidFile, `${child.pid}\n`);
  for (let waited = 0; waited < 30_000; waited += 250) {
    if (await answers()) return status();
    if (!alive(child.pid!)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').slice(-15).join('\n') : '';
  throw new Error(`Bits & Bolts did not start. The end of ${logFile}:\n${tail}`);
}

async function stop() {
  const pid = ownPid();
  if (!pid) {
    fs.rmSync(pidFile, { force: true });
    console.log(await answers()
      ? `This command did not start the server answering at ${URL_}, so it was left running.`
      : 'Bits & Bolts is not running.');
    return;
  }
  process.kill(pid, 'SIGTERM');
  for (let waited = 0; waited < 5_000 && alive(pid); waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
  if (alive(pid)) process.kill(pid, 'SIGKILL');
  fs.rmSync(pidFile, { force: true });
  console.log(`Stopped Bits & Bolts (pid ${pid}). Its library stays in ${library}.`);
}

const command = process.argv[2] ?? 'status';
const commands: Record<string, () => Promise<void>> = { start, stop, status };
if (!commands[command]) {
  console.error('Usage: pnpm bits-and-bolts [start|stop|status]');
  process.exit(2);
}
commands[command]().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
