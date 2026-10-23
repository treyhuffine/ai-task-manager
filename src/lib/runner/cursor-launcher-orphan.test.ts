/**
 * Probe: Home startup's orphan stop for a Cursor turn left by a crashed server. The record is
 * written the way recordHarnessProcess writes it (identity looked up right after spawn). The
 * installed Cursor CLI is a bash launcher that execs node (same pid/start, new command line).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { processIdentity } from '@/lib/worker/leftovers';
import { stopOrphanedHarnesses, _resetHarnessProcessState } from '@/lib/runner/harness-processes';

let dir: string; const kill: number[] = [];
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-probe-orphan-')); _resetHarnessProcessState(); });
afterEach(() => { for (const pid of kill.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* */ } } fs.rmSync(dir, { recursive: true, force: true }); });

it.each([['exec launcher', true], ['direct node (control)', false]] as const)('%s: an orphaned turn is stopped at startup', async (variant, launcher) => {
  fs.writeFileSync(path.join(dir, 'index.js'), "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n");
  fs.symlinkSync(process.execPath, path.join(dir, 'node'));
  const bin = path.join(dir, 'agent');
  if (launcher) fs.writeFileSync(bin, `#!/usr/bin/env bash\nset -euo pipefail\nSCRIPT_DIR="$(dirname "$(realpath "$0")")"\nwhile [ ! -f "$SCRIPT_DIR/release" ]; do sleep 0.02; done\nif "$SCRIPT_DIR/node" --version >/dev/null 2>&1; then exec -a "$0" "$SCRIPT_DIR/node" "$SCRIPT_DIR/index.js" "$@"; fi\n`, { mode: 0o755 });
  else fs.writeFileSync(bin, `#!${process.execPath}\nrequire(${JSON.stringify(path.join(dir, 'index.js'))});\n`, { mode: 0o755 });
  const parent = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');const child=spawn(${JSON.stringify(bin)},['-p','--output-format','stream-json'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'ignore'] });
  kill.push(parent.pid!);
  const child = { pid: await new Promise<number>(resolve => parent.stdout!.once('data', chunk => resolve(Number(chunk.toString().trim())))) };
  kill.push(child.pid);
  const recordedProcess = (await processIdentity(child.pid!))!;
  const owner = (await processIdentity(parent.pid!))!;
  const file = path.join(dir, 'harness-processes.json');
  fs.writeFileSync(file, JSON.stringify({ entries: [{ chatSessionId: 'chat', owner, process: recordedProcess }] }));
  fs.writeFileSync(path.join(dir, 'release'), '');
  await new Promise(resolve => setTimeout(resolve, 800));
  const parentExited = new Promise<void>(resolve => parent.once('exit', () => resolve()));
  parent.kill('SIGKILL'); await parentExited;
  const liveCommand = (await processIdentity(child.pid!))?.command ?? '(gone)';
  const stopped = await stopOrphanedHarnesses(file, 500);
  await new Promise(resolve => setTimeout(resolve, 300));
  const observed = { variant, recorded: recordedProcess.command.slice(0, 70), live: liveCommand.slice(0, 70), stopped, stillAlive: alive(child.pid!), recordAfter: JSON.parse(fs.readFileSync(file, 'utf8')).entries.length };
  expect(observed.stillAlive).toBe(false);
}, 30_000);
