import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeScratchpad } from '@/lib/scratchpad/merge';
import { ScratchpadSaver, type ScratchpadSaveResult } from './scratchpad-saver';

/** The scratchpad's saves from one open editor (docs/scratchpad.md, "Every device"). */

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

/** A server holding one text, saving the way saveScratchpad does. */
function server(initial = '') {
  const state = { body: initial, at: 0, calls: [] as { body: string; base: string }[], fail: null as unknown };
  const write = vi.fn(async ({ body, base }: { body: string; base: string }): Promise<ScratchpadSaveResult> => {
    state.calls.push({ body, base });
    if (state.fail) { const error = state.fail; state.fail = null; throw error; }
    const merged = state.body !== base;
    state.body = merged ? mergeScratchpad(base, body, state.body) : body;
    state.at += 1;
    return { record: { body: state.body, updatedAt: `t${state.at}` }, merged };
  });
  return { state, write, record: () => ({ body: state.body, updatedAt: `t${state.at}` }) };
}

let storage: MemoryStorage;
beforeEach(() => { vi.useFakeTimers(); storage = new MemoryStorage(); });
afterEach(() => { vi.useRealTimers(); });

describe('ScratchpadSaver', () => {
  it('shows the stored text, then saves typing after a pause', async () => {
    const remote = server('a');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.observe(remote.record());
    expect(saver.snapshot()).toMatchObject({ ready: true, draft: 'a', revision: 1 });
    saver.edit('a b');
    saver.edit('a b c');
    expect(remote.write).not.toHaveBeenCalled();
    expect(saver.hasUnsaved()).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(remote.state.calls).toEqual([{ body: 'a b c', base: 'a' }]);
    expect(saver.hasUnsaved()).toBe(false);
    expect(saver.snapshot()).toMatchObject({ saving: false, error: null, updatedAt: 't1', revision: 1 });
  });

  it('ignores typing before the stored text arrives', () => {
    const remote = server('a');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.edit('early');
    expect(saver.snapshot()).toMatchObject({ ready: false, draft: '' });
  });

  it('sends typing that arrived during a save next, based on what was saved', async () => {
    const remote = server('');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.observe(null);
    saver.edit('one');
    const flushing = saver.flush();
    saver.edit('one two');
    await flushing;
    expect(remote.state.calls).toEqual([{ body: 'one', base: '' }, { body: 'one two', base: 'one' }]);
    expect(remote.state.body).toBe('one two');
  });

  it('shows the merged text when another device wrote first', async () => {
    const remote = server('Quotes');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.observe(remote.record());
    remote.state.body = 'Quotes\n\nfrom the phone';
    saver.edit('Quotes\n\nfrom the desk');
    await saver.flush();
    expect(remote.state.body).toBe('Quotes\n\nfrom the phone\n\nfrom the desk');
    expect(saver.snapshot()).toMatchObject({ draft: remote.state.body, revision: 2 });
    expect(saver.hasUnsaved()).toBe(false);
  });

  it('merges typing made during a save that came back merged', async () => {
    const remote = server('a');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = vi.fn(async (input: { body: string; base: string }) => { await gate; return remote.write(input); });
    const saver = new ScratchpadSaver(write, () => storage);
    saver.observe(remote.record());
    remote.state.body = 'a\n\nphone';
    saver.edit('a\n\ndesk');
    const flushing = saver.flush();
    saver.edit('a\n\ndesk\n\nmore');
    release();
    await flushing;
    expect(remote.state.body).toBe('a\n\nphone\n\ndesk\n\nmore');
    expect(saver.snapshot().draft).toBe(remote.state.body);
  });

  it("takes another device's text when nothing here is unsent", () => {
    const remote = server('a');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.observe(remote.record());
    saver.observe({ body: 'a\n\nfrom the phone', updatedAt: 't9' });
    expect(saver.snapshot()).toMatchObject({ draft: 'a\n\nfrom the phone', updatedAt: 't9', revision: 2 });
  });

  it("never replaces unsent typing with another device's text", async () => {
    const remote = server('a');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.observe(remote.record());
    saver.edit('a\n\nmine');
    remote.state.body = 'a\n\ntheirs';
    saver.observe(remote.record());
    expect(saver.snapshot()).toMatchObject({ draft: 'a\n\nmine', revision: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(remote.state.body).toBe('a\n\ntheirs\n\nmine');
  });

  it('keeps unsent typing in the browser and sends it when the page comes back', async () => {
    const remote = server('a');
    // The page closed before the pause ended, and its last save never arrived.
    remote.state.fail = new Error('page closed');
    const closed = new ScratchpadSaver(remote.write, () => storage);
    const detach = closed.attach();
    closed.observe(remote.record());
    closed.edit('a\n\nunsent');
    detach();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(remote.state.calls).toEqual([{ body: 'a\n\nunsent', base: 'a' }]);
    expect(remote.state.body).toBe('a');
    remote.state.body = 'a\n\nphone';

    const reopened = new ScratchpadSaver(remote.write, () => storage);
    reopened.observe(remote.record());
    expect(reopened.snapshot().draft).toBe('a\n\nunsent');
    await vi.advanceTimersByTimeAsync(0);
    expect(remote.state.calls.at(-1)).toEqual({ body: 'a\n\nunsent', base: 'a' });
    expect(remote.state.calls).toHaveLength(2);
    expect(remote.state.body).toBe('a\n\nphone\n\nunsent');
    expect(reopened.snapshot().draft).toBe(remote.state.body);
    expect(storage.data.size).toBe(0);
  });

  it('keeps working after a remount detaches and attaches it again', async () => {
    const remote = server('a');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.attach()();
    saver.attach();
    saver.observe(remote.record());
    saver.edit('a b');
    await vi.advanceTimersByTimeAsync(600);
    expect(remote.state.body).toBe('a b');
  });

  it('drops a kept draft the server already has', () => {
    const remote = server('a b');
    storage.setItem('ri:scratchpad-draft:v1', JSON.stringify({ draft: 'a b', base: 'a' }));
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.observe(remote.record());
    expect(saver.hasUnsaved()).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it('retries a save the network lost, and stops for a refusal', async () => {
    const remote = server('');
    const saver = new ScratchpadSaver(remote.write, () => storage);
    saver.observe(null);
    remote.state.fail = new Error('offline');
    saver.edit('kept');
    await vi.advanceTimersByTimeAsync(600);
    expect(saver.snapshot().error).toBe('Not saved yet. Trying again.');
    expect(storage.data.size).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(remote.state.body).toBe('kept');
    expect(saver.snapshot().error).toBeNull();

    remote.state.fail = Object.assign(new Error('Too long'), { status: 400 });
    saver.edit('kept more');
    await vi.advanceTimersByTimeAsync(600);
    expect(saver.snapshot().error).toMatch(/^Not saved\./);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(remote.write).toHaveBeenCalledTimes(3);
  });
});
