#!/usr/bin/env node
/**
 * `next build`, guarded against server code that traces the whole checkout.
 *
 * The build traces every path server code joins, reads or runs ("Traced paths"
 * in AGENTS.md). One it can only partly work out can match every file in the
 * checkout, and memory then grows with the files there times the routes that
 * reach it. One such line took a build past 150 GB, and the computer froze
 * before the build could name the line. So the build runs under a memory
 * limit, and afterwards it fails if any server trace lists the canary files in
 * scripts/trace-canary, which no code reads. A pattern that matches every file
 * in the checkout, or every file with a common extension, lists them too. It
 * also fails on a narrower pattern, one that lists a source or docs file
 * because a runtime folder was joined to a name a checkout folder shares.
 *
 *   node scripts/next-build.mjs [next build options]
 *
 * RI_BUILD_MEMORY_LIMIT_GB sets the limit (default 64 GB, 0 turns it off). A
 * failed memory sample never stops a build.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CANARY_DIR = path.join(repo, 'scripts', 'trace-canary');
const GB = 2 ** 30;
const formatGb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;

/**
 * Bytes resident in `root` and every process below it.
 * @param {string} psOutput `ps -A -o pid=,ppid=,rss=` output, RSS in KiB
 * @param {number} root
 */
export function treeResidentBytes(psOutput, root) {
  const rows = psOutput.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number)).filter((row) => row.length >= 3 && row.every(Number.isFinite));
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows) if (!tree.has(pid) && tree.has(ppid)) { tree.add(pid); grew = true; }
  }
  return rows.reduce((sum, [pid, , rss]) => tree.has(pid) ? sum + rss * 1024 : sum, 0);
}

/**
 * Memory the system holds aside from resident pages: what macOS compressed
 * plus swap in use, or swap in use on Linux. A build that outgrows memory
 * shows up here once its own resident size stops growing.
 * @param {{ vmStat?: string, swapUsage?: string, meminfo?: string }} sources
 */
export function reservedBytes({ vmStat, swapUsage, meminfo }) {
  let bytes = 0;
  if (vmStat) {
    const page = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1] ?? 4096);
    bytes += Number(/Pages stored in compressor:\s+(\d+)/.exec(vmStat)?.[1] ?? 0) * page;
  }
  if (swapUsage) {
    const [, amount, unit] = /used = ([\d.]+)([KMG])/.exec(swapUsage) ?? [];
    if (amount) bytes += Number(amount) * { K: 2 ** 10, M: 2 ** 20, G: 2 ** 30 }[unit];
  }
  if (meminfo) {
    const kib = (name) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0);
    bytes += (kib('SwapTotal') - kib('SwapFree')) * 1024;
  }
  return bytes;
}

async function systemReservedBytes() {
  if (process.platform === 'darwin') {
    const [vmStat, swapUsage] = await Promise.all([run('vm_stat'), run('sysctl', ['-n', 'vm.swapusage'])]);
    return reservedBytes({ vmStat: vmStat.stdout, swapUsage: swapUsage.stdout });
  }
  if (process.platform === 'linux') return reservedBytes({ meminfo: fs.readFileSync('/proc/meminfo', 'utf8') });
  return 0;
}

/** What the build costs this computer: its processes' resident memory plus
 * everything the system compressed or swapped since it started.
 * @param {number} root @param {number} baseline */
async function sampleMemory(root, baseline) {
  const [{ stdout }, reserved] = await Promise.all([run('ps', ['-A', '-o', 'pid=,ppid=,rss='], { maxBuffer: 16 << 20 }), systemReservedBytes()]);
  return treeResidentBytes(stdout, root) + Math.max(0, reserved - baseline);
}

/** A healthy build peaks near 15 GB, and a runaway passes 150 GB. */
export const DEFAULT_MEMORY_LIMIT_GB = 64;

/** @param {Record<string, string | undefined>} env */
export function memoryLimitBytes(env = process.env) {
  const configured = env.RI_BUILD_MEMORY_LIMIT_GB;
  if (configured !== undefined && configured.trim() !== '') {
    const gb = Number(configured);
    if (!Number.isFinite(gb) || gb < 0) throw new Error(`RI_BUILD_MEMORY_LIMIT_GB must be a number of GB, or 0 for no limit. It is "${configured}".`);
    return gb * GB;
  }
  return DEFAULT_MEMORY_LIMIT_GB * GB;
}

/**
 * Runs a command in its own process group and kills the group once
 * `sample` reports more than `limit` bytes.
 * @param {string} command @param {string[]} args
 * @param {{ limit: number, env?: NodeJS.ProcessEnv, intervalMs?: number,
 *   sample?: (pid: number, baseline: number) => Promise<number>, baseline?: () => Promise<number> }} options
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, peak: number, stoppedAt: number | null }>}
 */
export function runWithMemoryLimit(command, args, { limit, env = process.env, intervalMs = 1000, sample = sampleMemory, baseline = systemReservedBytes }) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { stdio: 'inherit', env, detached: grouped });
    /** @param {NodeJS.Signals} signal */
    const signalGroup = (signal) => {
      try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
    };
    // The group is detached from the terminal, so pass on what it would have sent.
    const onSignal = (/** @type {NodeJS.Signals} */ signal) => signalGroup(signal);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    let peak = 0;
    /** @type {number | null} */
    let stoppedAt = null;
    let timer;
    if (grouped && limit > 0) {
      baseline().catch(() => 0).then((base) => {
        let busy = false;
        timer = setInterval(() => {
          if (busy || stoppedAt !== null) return;
          busy = true;
          sample(child.pid, base).then((bytes) => {
            peak = Math.max(peak, bytes);
            if (bytes > limit && stoppedAt === null) { stoppedAt = bytes; signalGroup('SIGKILL'); }
          }, () => { /* A failed sample is no evidence. */ }).finally(() => { busy = false; });
        }, intervalMs);
      });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearInterval(timer);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve({ code, signal, peak, stoppedAt });
    });
  });
}

/**
 * Server traces that list a canary file, as paths inside the build output.
 * @param {string} distDir @param {string} canaryDir
 */
export function tracesListingCanary(distDir, canaryDir = CANARY_DIR) {
  const canary = path.resolve(canaryDir) + path.sep;
  /** @type {string[]} */
  const swept = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'cache') walk(file); continue; }
      if (!entry.name.endsWith('.nft.json')) continue;
      const { files = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (files.some((/** @type {string} */ listed) => path.resolve(dir, listed).startsWith(canary))) swept.push(path.relative(distDir, file));
    }
  };
  walk(distDir);
  return swept.sort();
}

/** Source files the server really reads at runtime, so a server trace may list them. */
export const TRACED_SOURCE_ALLOWED = [
  // describe_schema returns the schema's source, read through require.resolve.
  'src/lib/db/schema.ts',
];

/**
 * Files under src/ or docs/ that server traces list, with how many traces
 * list each. The server bundles its source and never reads docs, so a listed
 * file means a path built from a runtime folder matched one with the same
 * name in the checkout.
 * @param {string} distDir @param {string} repoDir @param {string[]} allowed
 * @returns {Map<string, number>}
 */
export function tracedSourceFiles(distDir, repoDir = repo, allowed = TRACED_SOURCE_ALLOWED) {
  const root = path.resolve(repoDir) + path.sep;
  /** @type {Map<string, number>} */
  const found = new Map();
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'cache') walk(file); continue; }
      if (!entry.name.endsWith('.nft.json')) continue;
      const { files = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const listed of /** @type {string[]} */ (files)) {
        const absolute = path.resolve(dir, listed);
        if (!absolute.startsWith(root)) continue;
        const relative = absolute.slice(root.length).split(path.sep).join('/');
        if (!/^(src|docs)\//.test(relative) || allowed.includes(relative)) continue;
        found.set(relative, (found.get(relative) ?? 0) + 1);
      }
    }
  };
  walk(distDir);
  return found;
}

async function main() {
  const limit = memoryLimitBytes();
  const distDir = path.resolve(process.env.NEXT_DIST_DIR || '.next');
  const next = path.join(repo, 'node_modules', 'next', 'dist', 'bin', 'next');
  const result = await runWithMemoryLimit(process.execPath, [next, 'build', ...process.argv.slice(2)], { limit });
  if (result.stoppedAt !== null) {
    console.error(`\nThe build was stopped at ${formatGb(result.stoppedAt)}, past the ${formatGb(limit)} limit, before it could freeze this computer.`);
    console.error('This almost always means server code traces the whole checkout. "Traced paths" in AGENTS.md says how to find the line.');
    console.error('RI_BUILD_MEMORY_LIMIT_GB changes the limit.');
    process.exit(1);
  }
  if (result.code !== 0) process.exit(result.code ?? 1);
  if (!fs.existsSync(CANARY_DIR)) {
    console.warn(`Skipped the trace check: ${path.relative(repo, CANARY_DIR)} is missing.`);
    return;
  }
  const swept = tracesListingCanary(distDir);
  if (swept.length) {
    console.error(`\n${swept.length} server traces list ${path.relative(repo, CANARY_DIR)}/, which no code reads:`);
    for (const trace of swept.slice(0, 8)) console.error(`  ${trace}`);
    if (swept.length > 8) console.error(`  and ${swept.length - 8} more`);
    console.error('Some fs, path or spawn call in server code matches every file in the checkout. In a full checkout that');
    console.error('takes the build past 100 GB. "Traced paths" in AGENTS.md says how to find and mark it.');
    process.exit(1);
  }
  const source = [...tracedSourceFiles(distDir)].sort((a, b) => b[1] - a[1]);
  if (source.length) {
    console.error(`\nServer traces list ${source.length} source or docs files the server never reads:`);
    for (const [file, count] of source.slice(0, 12)) console.error(`  ${file} (${count} traces)`);
    if (source.length > 12) console.error(`  and ${source.length - 12} more`);
    console.error('A path built from a runtime folder matches files of the same name in the checkout. Mark the fs, path.join or');
    console.error('path.resolve call ("Traced paths" in AGENTS.md). A file the server really reads goes in TRACED_SOURCE_ALLOWED here.');
    process.exit(1);
  }
  console.info(`Build memory peaked at ${result.peak ? formatGb(result.peak) : 'an unmeasured amount'}${limit ? ` of the ${formatGb(limit)} limit` : ''}. No server trace sweeps the checkout.`);
}

const invoked = (() => {
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1] ?? '')).href; } catch { return false; }
})();
if (invoked) await main();
