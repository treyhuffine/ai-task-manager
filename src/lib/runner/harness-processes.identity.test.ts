/** Real stop operations over fixture records and synthetic process observations. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProcessIdentity } from '@/lib/worker/leftovers';
const h = vi.hoisted(() => ({ failSelf: false, live: new Map<number, ProcessIdentity>(), children: [] as ProcessIdentity[] }));
vi.mock('@/lib/worker/leftovers', async original => ({ ...await original<typeof import('@/lib/worker/leftovers')>(),
  processIdentity: async (pid: number) => { if (pid === process.pid && h.failSelf) { h.failSelf = false; throw new Error('Transient ps failure'); } return h.live.get(pid) ?? null; },
  ownProcesses: async (pid: number) => h.live.has(pid) ? { worker: h.live.get(pid)!, children: h.children.filter(child => child.ppid === pid) } : null,
}));
import { _resetHarnessProcessState, captureTrackedHarness, recordHarnessProcess, stopOrphanedHarnesses, stopStrayHarness, stopTrackedHarness } from './harness-processes';
let dir: string, file: string;
const owner: ProcessIdentity = { pid: process.pid, ppid: 1, started: 'owner-birth', command: 'owner' };
const original: ProcessIdentity = { pid: 987654, ppid: 123, started: 'process-birth', command: 'launcher', birthId: 'boot:1200' };
beforeEach(() => {
  _resetHarnessProcessState(); h.live.clear(); h.children = []; h.live.set(process.pid, owner);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-lifetime-')); file = path.join(dir, 'harness.json');
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => { if (signal) h.live.delete(pid); return true; });
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
const write = (identity: ProcessIdentity, orphan = false) => fs.writeFileSync(file, JSON.stringify({ entries: [{ chatSessionId: 'chat', owner: orphan ? { ...owner, pid: 998877 } : owner, process: identity }] }));
const entries = () => JSON.parse(fs.readFileSync(file, 'utf8')).entries;
it.each(['startup', 'start', 'close'] as const)('%s stops an exact recorded birth after subreaper adoption and leaves bystanders alone', async control => {
  write(original, control === 'startup');
  h.live.set(original.pid, { ...original, started: 'after a clock step', ppid: 4567, command: 'exec harness' });
  h.live.set(876543, { ...original, pid: 876543 });
  if (control === 'startup') expect(await stopOrphanedHarnesses(file, 0)).toEqual([original.pid]);
  else if (control === 'start') expect(await stopStrayHarness('chat', file, 0)).toEqual([original.pid]);
  else expect(await stopTrackedHarness('chat', original.pid, file)).toBe(true);
  expect(process.kill).toHaveBeenCalledWith(original.pid, 'SIGTERM');
  expect(h.live.has(876543)).toBe(true); expect(entries()).toEqual([]);
});
it.each(['startup', 'start', 'close'] as const)('%s preserves ambiguous legacy records and refuses confirmation without signalling', async control => {
  write({ ...original, birthId: undefined }, control === 'startup');
  h.live.set(original.pid, { ...original, ppid: 4567 });
  if (control === 'startup') await expect(stopOrphanedHarnesses(file, 0)).rejects.toMatchObject({ code: 'already_running' });
  else if (control === 'start') await expect(stopStrayHarness('chat', file, 0)).rejects.toMatchObject({ code: 'already_running' });
  else expect(await stopTrackedHarness('chat', original.pid, file)).toBe(false);
  expect(process.kill).not.toHaveBeenCalled(); expect(entries()).toHaveLength(1);
});
it('does not signal a reused PID with the same coarse start time and a different kernel birth', async () => {
  write(original, true); h.live.set(original.pid, { ...original, birthId: 'boot:1201' });
  expect(await stopOrphanedHarnesses(file, 0)).toEqual([]);
  expect(process.kill).not.toHaveBeenCalled(); expect(entries()).toEqual([]);
});
it('does not mistake another live owner for a dead server after a wall-clock step', async () => {
  const otherOwner = { ...owner, pid: 876543, started: 'before clock step', birthId: 'boot:10' };
  h.live.set(otherOwner.pid, { ...otherOwner, started: 'after clock step' }); h.live.set(original.pid, original);
  fs.writeFileSync(file, JSON.stringify({ entries: [{ chatSessionId: 'chat', owner: otherOwner, process: original }] }));
  expect(await stopOrphanedHarnesses(file, 0)).toEqual([]);
  await expect(stopStrayHarness('chat', file, 0)).rejects.toThrow(/another Ri process/);
  expect(process.kill).not.toHaveBeenCalled(); expect(entries()).toHaveLength(1);
});
it('keeps a known signal failure scoped to its chat without deleting the record', async () => {
  write(original, true); h.live.set(original.pid, original);
  vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error('Denied'), { code: 'EPERM' }); });
  await expect(stopOrphanedHarnesses(file, 0)).rejects.toMatchObject({ problems: [{ chatId: 'chat', message: expect.stringContaining(`pid ${original.pid}`) }] });
  expect(entries()).toHaveLength(1); expect(h.live.has(original.pid)).toBe(true);
});
it('accepts independently confirmed exit even if a signal raced a process finishing', async () => {
  write(original, true); h.live.set(original.pid, original);
  vi.mocked(process.kill).mockImplementation(pid => { h.live.delete(pid); throw Object.assign(new Error('Denied'), { code: 'EPERM' }); });
  expect(await stopOrphanedHarnesses(file, 0)).toEqual([original.pid]); expect(entries()).toEqual([]);
});
it('does not confirm cleanup or delete a newer descendant snapshot written while it waited', async () => {
  write(original); h.live.set(original.pid, original);
  const entered = Promise.withResolvers<void>();
  vi.mocked(process.kill).mockImplementation(pid => { if (pid === original.pid) entered.resolve(); else h.live.delete(pid); return true; });
  const closing = stopTrackedHarness('chat', original.pid, file);
  await entered.promise;
  const child = { ...original, pid: 876543, ppid: original.pid, birthId: 'boot:1300' };
  h.children = [child]; h.live.set(child.pid, child);
  await captureTrackedHarness('chat', original.pid, file);
  h.live.delete(original.pid);
  expect(await closing).toBe(false); expect(h.live.has(child.pid)).toBe(true);
  expect(entries()).toMatchObject([{ descendants: [{ pid: child.pid }] }]);
  expect(await stopTrackedHarness('chat', original.pid, file)).toBe(true);
  expect(entries()).toEqual([]); expect(h.live.has(child.pid)).toBe(false);
});
it.each(['startup', 'start'] as const)('%s waits outside the shared record queue and retains unrelated writes', async control => {
  write({ ...original, birthId: undefined }, control === 'startup');
  h.live.set(original.pid, { ...original, ppid: 4567 });
  const bystander = { ...original, pid: 876543 };
  h.live.set(bystander.pid, bystander);
  let finished = false;
  const stopping = (control === 'startup' ? stopOrphanedHarnesses(file, 500) : stopStrayHarness('chat', file, 500))
    .catch(error => { expect(error).toMatchObject({ code: 'already_running' }); }).finally(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  await recordHarnessProcess('independent', bystander.pid, file);
  expect(finished).toBe(false);
  await stopping;
  expect(entries().map((entry: { chatSessionId: string }) => entry.chatSessionId).sort()).toEqual(['chat', 'independent']);
  expect(process.kill).not.toHaveBeenCalled();
});
it('reports an actual surviving descendant rather than its dead root, without command arguments', async () => {
  const descendant = { ...original, pid: 765432, birthId: undefined, ppid: 987, command: '/usr/bin/node --secret=do-not-display' };
  h.live.set(descendant.pid, { ...descendant, ppid: 4567 });
  fs.writeFileSync(file, JSON.stringify({ entries: [{ chatSessionId: 'chat', owner: { ...owner, pid: 998877 }, process: original, descendants: [descendant] }] }));
  await expect(stopOrphanedHarnesses(file, 0)).rejects.toMatchObject({ problems: [{ chatId: 'chat', message: expect.stringContaining(`pid ${descendant.pid} (node)`) }] });
  await expect(stopStrayHarness('chat', file, 0)).rejects.not.toThrow('do-not-display');
  expect(process.kill).not.toHaveBeenCalled();
});

it('retries a rejected self identity lookup without restarting the Home', async () => {
  h.live.set(original.pid, original);
  h.failSelf = true;
  await expect(recordHarnessProcess('chat', original.pid, file)).rejects.toThrow('Transient ps failure');
  await recordHarnessProcess('chat', original.pid, file);
  expect(entries()).toEqual([expect.objectContaining({ chatSessionId: 'chat', owner, process: original })]);
});
