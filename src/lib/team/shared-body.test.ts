/**
 * Shared-body autosave (src/lib/team/shared-body.ts, docs/homes-spec.md §9.3):
 * serial saves against the revision they edited, a conflict that stops
 * autosave and keeps the text, explicit resolution, and drafts that survive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedBodySaver, sharedDraftKey, type SharedBody, type WriteFailure } from './shared-body';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class Conflict extends Error {
  constructor(readonly current: SharedBody) { super('conflict'); }
}
class Status extends Error {
  constructor(readonly status: number) { super(`status ${status}`); }
}

const readFailure = (error: unknown): WriteFailure =>
  error instanceof Conflict ? { status: 409, conflict: error.current }
    : error instanceof Status ? { status: error.status, message: 'Refused' }
      : {};

/** A stand-in server holding the shared body, with the same revision check. */
function server(initial: SharedBody) {
  const state = { ...initial };
  const writes: Array<{ body: string; expectedBodyRevision: number }> = [];
  const write = vi.fn(async (input: { body: string; expectedBodyRevision: number }) => {
    writes.push(input);
    if (input.expectedBodyRevision !== state.bodyRevision) throw new Conflict({ ...state });
    state.body = input.body;
    state.bodyRevision += 1;
    return { ...state };
  });
  return { state, writes, write, otherEdits(body: string) { state.body = body; state.bodyRevision += 1; } };
}

const key = sharedDraftKey({ teamId: 'team', memberId: 'maya' }, 'note', 'n1');
let storage: MemoryStorage;

beforeEach(() => {
  vi.useFakeTimers();
  storage = new MemoryStorage();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('shared body autosave', () => {
  it('saves one edit at a time, each against the revision the last one left', async () => {
    const remote = server({ body: 'v0', bodyRevision: 0 });
    const saver = new SharedBodySaver(key, { body: 'v0', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    saver.edit('a');
    await vi.advanceTimersByTimeAsync(500);
    saver.edit('ab');
    saver.edit('abc');
    await vi.advanceTimersByTimeAsync(500);
    expect(remote.writes).toEqual([
      { body: 'a', expectedBodyRevision: 0 },
      { body: 'abc', expectedBodyRevision: 1 },
    ]);
    expect(remote.state).toEqual({ body: 'abc', bodyRevision: 2 });
    expect(saver.status()).toEqual({ status: 'saved' });
    expect(storage.getItem(key)).toBeNull();
  });

  it("never lets its own earlier save overwrite a newer one, even while one is in flight", async () => {
    const remote = server({ body: '', bodyRevision: 0 });
    let release: () => void = () => {};
    remote.write.mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => { release = resolve; });
      remote.state.body = input.body;
      remote.state.bodyRevision += 1;
      return { ...remote.state };
    });
    const saver = new SharedBodySaver(key, { body: '', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    saver.edit('first');
    await vi.advanceTimersByTimeAsync(500);
    saver.edit('second');
    await vi.advanceTimersByTimeAsync(500);
    release();
    await vi.runAllTimersAsync();
    expect(remote.state).toEqual({ body: 'second', bodyRevision: 2 });
  });

  it('stops on a conflict, keeps the text and what is typed next, and retries nothing on its own', async () => {
    const remote = server({ body: 'shared', bodyRevision: 0 });
    const saver = new SharedBodySaver(key, { body: 'shared', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    remote.otherEdits('Trey changed it');
    saver.edit('Maya edit');
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.status()).toEqual({ status: 'conflict', theirs: { body: 'Trey changed it', bodyRevision: 1 }, mine: 'Maya edit' });
    saver.edit('Maya edit, more');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(remote.write).toHaveBeenCalledTimes(1);
    expect(remote.state.body).toBe('Trey changed it');
    expect(saver.status()).toMatchObject({ status: 'conflict', mine: 'Maya edit, more' });
    expect(JSON.parse(storage.getItem(key)!)).toEqual({ body: 'Maya edit, more', baseRevision: 0 });
  });

  it('keeps mine by writing it against the revision it just learned', async () => {
    const remote = server({ body: 'shared', bodyRevision: 0 });
    const saver = new SharedBodySaver(key, { body: 'shared', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    remote.otherEdits('theirs');
    saver.edit('mine');
    await vi.advanceTimersByTimeAsync(500);
    await saver.keepMine();
    expect(remote.writes.at(-1)).toEqual({ body: 'mine', expectedBodyRevision: 1 });
    expect(remote.state).toEqual({ body: 'mine', bodyRevision: 2 });
    expect(saver.status()).toEqual({ status: 'saved' });
  });

  it('uses theirs by dropping the local text', async () => {
    const remote = server({ body: 'shared', bodyRevision: 0 });
    const saver = new SharedBodySaver(key, { body: 'shared', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    remote.otherEdits('theirs');
    saver.edit('mine');
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.useTheirs()).toBe('theirs');
    expect(saver.revision()).toBe(1);
    expect(storage.getItem(key)).toBeNull();
    saver.edit('theirs, then mine');
    await vi.advanceTimersByTimeAsync(500);
    expect(remote.state).toEqual({ body: 'theirs, then mine', bodyRevision: 2 });
  });

  it('waits out an unreachable team, then saves once it answers', async () => {
    const remote = server({ body: '', bodyRevision: 0 });
    remote.write.mockRejectedValueOnce(new TypeError('fetch failed'));
    const saver = new SharedBodySaver(key, { body: '', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    saver.edit('offline edit');
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.status()).toEqual({ status: 'offline', retryInMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(remote.state).toEqual({ body: 'offline edit', bodyRevision: 1 });
    expect(saver.status()).toEqual({ status: 'saved' });
  });

  it('keeps the text on a refusal that is not a conflict', async () => {
    const remote = server({ body: '', bodyRevision: 0 });
    remote.write.mockRejectedValueOnce(new Status(403));
    const saver = new SharedBodySaver(key, { body: '', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    saver.edit('kept');
    await vi.advanceTimersByTimeAsync(500);
    expect(saver.status()).toEqual({ status: 'failed', message: 'Refused' });
    expect(saver.text()).toBe('kept');
    expect(saver.hasUnsaved()).toBe(true);
    await saver.retry();
    expect(remote.state.body).toBe('kept');
  });

  it("recovers a draft: saved when nothing moved, a conflict when the shared text did", async () => {
    storage.setItem(key, JSON.stringify({ body: 'unsaved', baseRevision: 3 }));
    const same = server({ body: 'saved', bodyRevision: 3 });
    const saver = new SharedBodySaver(key, { body: 'saved', bodyRevision: 3 }, same.write, readFailure, () => storage);
    saver.recover(saver.draft()!);
    await vi.advanceTimersByTimeAsync(0);
    expect(same.state).toEqual({ body: 'unsaved', bodyRevision: 4 });

    storage.setItem(key, JSON.stringify({ body: 'old draft', baseRevision: 1 }));
    const moved = server({ body: 'newer', bodyRevision: 2 });
    const behind = new SharedBodySaver(key, { body: 'newer', bodyRevision: 2 }, moved.write, readFailure, () => storage);
    behind.recover(behind.draft()!);
    expect(behind.status()).toEqual({ status: 'conflict', theirs: { body: 'newer', bodyRevision: 2 }, mine: 'old draft' });
    expect(moved.write).not.toHaveBeenCalled();
  });

  it('follows the shared record only while nothing is unsaved', () => {
    const remote = server({ body: 'a', bodyRevision: 0 });
    const saver = new SharedBodySaver(key, { body: 'a', bodyRevision: 0 }, remote.write, readFailure, () => storage);
    const apply = vi.fn();
    expect(saver.observe({ body: 'b', bodyRevision: 1 }, apply)).toBe(true);
    expect(apply).toHaveBeenCalledOnce();
    expect(saver.text()).toBe('b');
    saver.edit('typing');
    expect(saver.observe({ body: 'c', bodyRevision: 2 }, apply)).toBe(false);
    expect(apply).toHaveBeenCalledOnce();
    expect(saver.text()).toBe('typing');
  });

  it('keeps drafts apart by team and member', () => {
    expect(sharedDraftKey({ teamId: 't1', memberId: 'm' }, 'task', 'x')).not.toBe(sharedDraftKey({ teamId: 't2', memberId: 'm' }, 'task', 'x'));
    expect(sharedDraftKey({ teamId: 't1', memberId: 'a' }, 'task', 'x')).not.toBe(sharedDraftKey({ teamId: 't1', memberId: 'b' }, 'task', 'x'));
  });

  it('retains the original draft base through repeated reopenings and edits in conflict', async () => {
    storage.setItem(key, JSON.stringify({ body: 'old draft', baseRevision: 0 }));
    const remote = server({ body: 'their newer text', bodyRevision: 1 });
    for (let i = 0; i < 3; i++) {
      const saver = new SharedBodySaver(key, { ...remote.state }, remote.write, readFailure, () => storage);
      saver.recover(saver.draft()!);
      expect(saver.status()).toMatchObject({ status: 'conflict' });
      saver.edit(`draft ${i}`);
      await saver.flush();
      expect(saver.draft()?.baseRevision).toBe(0);
      saver.dispose();
    }
    expect(remote.write).not.toHaveBeenCalled();
    expect(remote.state.body).toBe('their newer text');
  });

  it('does not advance the revision when an editor fails to apply external text', async () => {
    const remote = server({ body: 'original', bodyRevision: 0 });
    const saver = new SharedBodySaver(key, { ...remote.state }, remote.write, readFailure, () => storage);
    remote.otherEdits('theirs');
    expect(() => saver.observe({ ...remote.state }, () => { throw new Error('not applied'); })).toThrow('not applied');
    expect(saver.revision()).toBe(0);
    saver.edit('original plus mine');
    await saver.flush();
    expect(saver.status()).toMatchObject({ status: 'conflict' });
    expect(remote.state.body).toBe('theirs');
  });

  it('persists the chosen revision before Keep mine attempts a save', async () => {
    const remote = server({ body: 'theirs', bodyRevision: 1 });
    const saver = new SharedBodySaver(key, { ...remote.state }, remote.write, readFailure, () => storage);
    saver.recover({ body: 'mine', baseRevision: 0 });
    remote.write.mockRejectedValueOnce(new TypeError('offline'));
    await saver.keepMine();
    expect(saver.draft()).toEqual({ body: 'mine', baseRevision: 1 });
    saver.dispose();
  });
});
