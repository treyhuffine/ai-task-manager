/** Native Linux qualification. macOS runs the identity fixtures, not this kernel probe. */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, expect, it } from 'vitest';
import { processIdentity, sameProcessLifetime, type ProcessIdentity } from '@/lib/worker/leftovers';
import { _resetHarnessProcessState, stopOrphanedHarnesses, stopTrackedHarness } from './harness-processes';
let wrapper: ChildProcess | undefined, harness: ProcessIdentity | undefined, worker: ProcessIdentity | undefined, dir: string | undefined;
afterEach(async () => {
  if (harness && sameProcessLifetime(await processIdentity(harness.pid), harness) === true) {
    try { process.kill(harness.pid, 'SIGKILL'); } catch { /* exited */ }
  }
  if (worker && sameProcessLifetime(await processIdentity(worker.pid), worker) === true) {
    try { process.kill(worker.pid, 'SIGKILL'); } catch { /* exited */ }
  }
  wrapper?.kill('SIGKILL');
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  wrapper = undefined; harness = undefined; worker = undefined; dir = undefined;
});
it.skipIf(process.platform !== 'linux').each(['startup', 'tracked-close'] as const)('%s stops a harness adopted by a real PR_SET_CHILD_SUBREAPER process', async control => {
  _resetHarnessProcessState();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-subreaper-'));
  const file = path.join(dir, 'harness.json');
  const workerCode = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000);`;
  wrapper = spawn('python3', ['-u', '-c', `
import ctypes, json, os, subprocess, sys
assert ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0
worker = subprocess.Popen([sys.argv[1], '-e', sys.argv[2]], stdout=subprocess.PIPE, text=True)
print(json.dumps({'worker': worker.pid, 'harness': int(worker.stdout.readline())}), flush=True)
sys.stdin.readline()
worker.kill()
worker.wait()
print('adopted', flush=True)
try:
    while True: os.wait()
except ChildProcessError: pass
`, process.execPath, workerCode], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: wrapper.stdout! })[Symbol.asyncIterator]();
  const ids = JSON.parse((await lines.next()).value!);
  const owner = worker = (await processIdentity(ids.worker))!;
  harness = (await processIdentity(ids.harness))!;
  expect(harness.birthId).toBeTruthy(); expect(harness.ppid).toBe(ids.worker);
  fs.writeFileSync(file, JSON.stringify({ entries: [{ chatSessionId: 'chat', owner: control === 'startup' ? owner : await processIdentity(process.pid), process: control === 'startup' ? harness : owner, ...(control === 'tracked-close' ? { descendants: [harness] } : {}) }] }));
  wrapper.stdin!.write('crash\n'); expect((await lines.next()).value).toBe('adopted');
  const adopted = (await processIdentity(harness.pid))!;
  expect(adopted.ppid).toBe(wrapper.pid); expect(adopted.ppid).not.toBe(1);
  expect(sameProcessLifetime(adopted, harness)).toBe(true);
  if (control === 'startup') expect(await stopOrphanedHarnesses(file, 500)).toEqual([harness.pid]);
  else expect(await stopTrackedHarness('chat', owner.pid, file)).toBe(true);
  expect(await processIdentity(harness.pid)).toBeNull();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toEqual([]);
}, 15_000);
