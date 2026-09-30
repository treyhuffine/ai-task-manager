import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { processIdentity } from '@/lib/worker/leftovers';
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
