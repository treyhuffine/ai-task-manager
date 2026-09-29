import { PassThrough, Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { ServiceControlCoordination } from './control-coordination';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const body = (action = 'apply') => Readable.from([Buffer.from(JSON.stringify({ action }))]);

it('rejects a streamed update whose final bytes arrive after a handoff reserved admission', async () => {
  const coordination = new ServiceControlCoordination(() => false);
  const dispatch = vi.fn();
  const request = new PassThrough();
  const update = coordination.dispatchUpdate(request, dispatch).catch(error => error);
  request.write('{"action":');
  await new Promise<void>(resolve => setImmediate(resolve));
  const activity = deferred();
  const handoff = coordination.handoff(() => activity.promise);
  request.end('"apply"}');
  expect(await update).toMatchObject({ message: 'Login supervision is being installed' });
  expect(dispatch).not.toHaveBeenCalled();
  activity.resolve(); await handoff;
});

it('reserves before waiting for activity and blocks a second handoff', async () => {
  const coordination = new ServiceControlCoordination(() => false);
  const activity = deferred();
  const handoff = coordination.handoff(() => activity.promise);
  expect(coordination.handingOff).toBe(true);
  const dispatch = vi.fn();
  await expect(coordination.dispatchUpdate(body(), dispatch)).rejects.toThrow('Login supervision');
  const second = vi.fn(async () => {});
  await expect(coordination.handoff(second)).rejects.toThrow('already in progress');
  expect(second).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  activity.resolve(); await handoff;
});

it('blocks queued immediate and timer activation throughout a successful handoff and shutdown gap', async () => {
  const coordination = new ServiceControlCoordination(() => false);
  const activate = vi.fn(async () => {});
  const immediate = new Promise<void>(resolve => setImmediate(() => { void coordination.tick(activate).then(resolve); }));
  const timer = new Promise<void>(resolve => setTimeout(() => { void coordination.tick(activate).then(resolve); }, 0));
  const activity = deferred();
  const handoff = coordination.handoff(() => activity.promise);
  await Promise.all([immediate, timer]);
  expect(activate).not.toHaveBeenCalled();
  activity.resolve(); await handoff;
  await coordination.tick(activate);
  expect(activate).not.toHaveBeenCalled();
  expect(coordination.handingOff).toBe(true);
});

it('reopens admission only after a rejected handoff finishes its cleanup', async () => {
  const coordination = new ServiceControlCoordination(() => false);
  const activity = deferred(); const cleanup = deferred(); const cleanupStarted = deferred();
  const handoff = coordination.handoff(async () => {
    try { await activity.promise; throw new Error('Execution still active'); }
    finally { cleanupStarted.resolve(); await cleanup.promise; }
  }).catch(error => error);
  activity.resolve(); await cleanupStarted.promise;
  const activate = vi.fn(async () => {});
  await coordination.tick(activate);
  expect(activate).not.toHaveBeenCalled();
  cleanup.resolve();
  expect(await handoff).toMatchObject({ message: 'Execution still active' });
  await coordination.tick(activate);
  expect(activate).toHaveBeenCalledOnce();
  const dispatch = vi.fn();
  await coordination.dispatchUpdate(body('later'), dispatch);
  expect(dispatch).toHaveBeenCalledWith({ action: 'later' });
});

it('lets an update that started first exclude handoff through its existing updater lock', async () => {
  let updateBusy = false;
  const coordination = new ServiceControlCoordination(() => updateBusy);
  await coordination.dispatchUpdate(body('download'), () => { updateBusy = true; });
  const handoff = vi.fn(async () => {});
  await expect(coordination.handoff(handoff)).rejects.toThrow('already in progress');
  expect(handoff).not.toHaveBeenCalled();
  expect(coordination.handingOff).toBe(false);
  updateBusy = false;
  await coordination.handoff(handoff);
  expect(handoff).toHaveBeenCalledOnce();
});

it('keeps request size and schema checks before any dispatch', async () => {
  const coordination = new ServiceControlCoordination(() => false);
  const dispatch = vi.fn();
  await expect(coordination.dispatchUpdate(Readable.from([Buffer.alloc(8193)]), dispatch)).rejects.toThrow('too large');
  await expect(coordination.dispatchUpdate(body('run-command'), dispatch)).rejects.toThrow();
  expect(dispatch).not.toHaveBeenCalled();
});
