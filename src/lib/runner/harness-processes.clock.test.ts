/** Real Node processes and real ps, with Linux /proc birth observations injected. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { _resetHarnessProcessState, recordHarnessProcess, stopTrackedHarness } from './harness-processes';
import { processIdentity } from '@/lib/worker/leftovers';
let dir: string | undefined, child: ChildProcess | undefined, other: ChildProcess | undefined;
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(async () => {
  vi.restoreAllMocks(); Object.defineProperty(process, 'platform', platform);
  for (const process of [child, other]) if (process && process.exitCode === null && process.signalCode === null) {
    const exited = once(process, 'exit'); process.kill('SIGKILL'); await exited;
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  _resetHarnessProcessState();
});
it('does not confirm a clock-shifted recorded process closed while its matching kernel birth is still alive', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-clock-birth-'));
  const marker = path.join(dir, 'term'), file = path.join(dir, 'harness.json');
  child = spawn(process.execPath, ['-e', `process.on('SIGTERM',()=>require('fs').writeFileSync(${JSON.stringify(marker)},'term')); console.log('ready'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'ignore'] });
  other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child.stdout!, 'data');
  const read = fs.readFileSync;
  const ticks = new Map([[process.pid, '100'], [child.pid!, '101'], [other.pid!, '102']]);
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
    if (file === '/proc/sys/kernel/random/boot_id') return 'injected-boot\n';
    const match = typeof file === 'string' ? /^\/proc\/(\d+)\/stat$/.exec(file) : null;
    if (match) {
      const tick = ticks.get(Number(match[1]));
      if (!tick) throw Object.assign(new Error('No injected process'), { code: 'ENOENT' });
      return `${match[1]} (node) S ${Array(18).fill('0').join(' ')} ${tick} 0`;
    }
    return (read as (...args: unknown[]) => unknown)(file, options);
  }) as typeof fs.readFileSync);
  _resetHarnessProcessState(); await recordHarnessProcess('clock-chat', child.pid!, file);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(record.entries[0].process.birthId).toBe('injected-boot:101');
  record.entries[0].process.started = 'before a wall-clock step';
  record.entries[0].process.ppid = 999999;
  fs.writeFileSync(file, JSON.stringify(record));
  let confirmed = false;
  const stopping = stopTrackedHarness('clock-chat', child.pid!, file).then(value => { confirmed = value; return value; });
  await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true));
  expect(confirmed).toBe(false);
  expect((await processIdentity(child.pid!))?.birthId).toBe('injected-boot:101');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toHaveLength(1);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  expect(await stopping).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toEqual([]);
  expect(() => process.kill(other!.pid!, 0)).not.toThrow();
}, 15_000);
