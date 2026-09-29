import { afterEach, expect, it } from 'vitest';
import { flushCaptureDrafts, hasPendingCapture, registerCaptureWriter, retainCaptureDraft } from './capture-draft';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(remove => remove()); });
it('waits for an image writer before permitting navigation', async () => {
  const owner = {}; let finish!: () => void;
  const write = new Promise<void>(resolve => { finish = () => { retainCaptureDraft(owner, false); resolve(); }; });
  cleanup.push(registerCaptureWriter(owner, () => write)); retainCaptureDraft(owner, true);
  let completed = false; const flushed = flushCaptureDrafts().then(() => { completed = true; });
  await Promise.resolve(); expect(completed).toBe(false); expect(hasPendingCapture()).toBe(true);
  finish(); await flushed; expect(hasPendingCapture()).toBe(false);
});
it('keeps navigation guarded on storage failure and permits retry', async () => {
  const owner = {}; let broken = true;
  cleanup.push(registerCaptureWriter(owner, async () => { if (broken) throw new Error('Quota'); retainCaptureDraft(owner, false); }));
  retainCaptureDraft(owner, true);
  await expect(flushCaptureDrafts()).rejects.toThrow('could not be saved');
  expect(hasPendingCapture()).toBe(true); broken = false;
  await expect(flushCaptureDrafts()).resolves.toBeUndefined(); expect(hasPendingCapture()).toBe(false);
});
it('does not mistake a durable journal for an acknowledged image upload', async () => {
  const writer = {}; const upload = {};
  cleanup.push(registerCaptureWriter(writer, async () => {}));
  cleanup.push(() => retainCaptureDraft(upload, false)); retainCaptureDraft(upload, true);
  await expect(flushCaptureDrafts()).rejects.toThrow('could not be saved');
});
it('unregistering an unmounted writer removes only its own guard', () => {
  const first = {}; const second = {};
  const remove = registerCaptureWriter(first, async () => {}); cleanup.push(remove);
  cleanup.push(registerCaptureWriter(second, async () => {}));
  retainCaptureDraft(first, true); retainCaptureDraft(second, true); remove();
  expect(hasPendingCapture()).toBe(true); retainCaptureDraft(second, false); expect(hasPendingCapture()).toBe(false);
});
