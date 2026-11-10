import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { processIdentity, sameProcessLifetime } from '@/lib/worker/leftovers';
import { stopWorkerDescendants, workerDescendants } from './worker-processes';
const children: ChildProcess[] = [];
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
afterEach(() => { for (const child of children.splice(0)) if (child.pid && alive(child.pid)) child.kill('SIGKILL'); });
async function fixture(source: string) {
  const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'ignore'] }); children.push(child);
  await new Promise<void>((resolve, reject) => { child.stdout!.once('data', () => resolve()); child.once('error', reject); child.once('exit', () => reject(new Error('Fixture exited early'))); });
  return child;
}
it('closes verified descendants of one worker and leaves its parent and unrelated processes alone', async () => {
  const parent = await fixture(`const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); child.once('spawn',()=>process.stdout.write('ready')); setInterval(()=>{},1000);`);
  const unrelated = await fixture(`process.stdout.write('ready'); setInterval(()=>{},1000);`);
  const descendants = await workerDescendants(parent.pid!);
  expect(descendants).toHaveLength(1);
  expect(await stopWorkerDescendants(descendants, 100)).toEqual([]);
  expect(alive(descendants[0].pid)).toBe(false);
  expect(alive(parent.pid!)).toBe(true); expect(alive(unrelated.pid!)).toBe(true);
});
it('never signals a reused or otherwise changed process identity', async () => {
  const unrelated = await fixture(`process.stdout.write('ready'); setInterval(()=>{},1000);`);
  const identity = await processIdentity(unrelated.pid!);
  expect(identity).not.toBeNull();
  expect(await stopWorkerDescendants([{ ...identity!, started: 'not this process' }], 0)).toEqual([]);
  expect(alive(unrelated.pid!)).toBe(true);
});
/** A process the kernel still lists after it exited: `sh` backgrounds a short
 * sleep, then becomes a long one that never collects it. */
async function zombie() {
  const parent = spawn('/bin/sh', ['-c', 'sleep 0.05 & exec sleep 30'], { stdio: 'ignore' }); children.push(parent);
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    const [child] = await workerDescendants(parent.pid!);
    if (child && child.command.includes('defunct')) return { parent, child };
  }
  throw new Error('The zombie fixture never appeared');
}
it('counts a process it SIGKILLed as stopped while the kernel still lists it', async () => {
  // As a stuck lsof's zombie child was, and the lsof itself, blocked in the kernel.
  const { parent, child } = await zombie();
  expect(await stopWorkerDescendants([child], 100, sameProcessLifetime)).toEqual([]);
  // Still listed, so this is the case that used to report it as running.
  expect(sameProcessLifetime(await processIdentity(child.pid), child)).toBe(true);
  expect(alive(parent.pid!)).toBe(true);
});
