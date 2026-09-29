import { afterEach, expect, it, vi } from 'vitest';
import { DocumentSaveQueue, draftDisposition } from './document-saves';
afterEach(() => vi.useRealTimers());
function queue() {
  const data = new Map<string, string>();
  return new DocumentSaveQueue(() => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } }));
}
it('retains keystrokes before the debounce and flushes title and body on close', async () => {
  vi.useFakeTimers();
  const saves = queue();
  const writer = vi.fn(async () => {});
  saves.schedule('notes:1', { title: 'latest' }, { title: 'old' }, writer);
  saves.schedule('notes:1', { body: 'text' }, { body: '' }, writer);
  expect(writer).not.toHaveBeenCalled();
  expect(saves.draft('notes:1')?.patch).toEqual({ title: 'latest', body: 'text' });
  await saves.flushAll();
  expect(writer).toHaveBeenCalledWith({ title: 'latest', body: 'text' });
  expect(saves.draft('notes:1')).toBeNull();
});
it('serializes a new edit behind an in-flight save and retains it until acknowledged', async () => {
  vi.useFakeTimers();
  const saves = queue();
  let acknowledge!: () => void;
  const writer = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; })).mockResolvedValue(undefined);
  saves.schedule('notes:1', { body: 'first' }, { body: '' }, writer);
  const pending = saves.flushAll();
  saves.schedule('notes:1', { body: 'second' }, { body: '' }, writer);
  expect(writer).toHaveBeenCalledTimes(1);
  expect(saves.draft('notes:1')?.patch.body).toBe('second');
  acknowledge();
  await pending;
  expect(writer.mock.calls).toEqual([[{ body: 'first' }], [{ body: 'second' }]]);
});
it('retains failed writes and detects an external edit before recovery', async () => {
  vi.useFakeTimers();
  const saves = queue();
  saves.schedule('notes:1', { body: 'draft' }, { body: 'old' }, async () => { throw new Error('offline'); });
  await expect(saves.flushAll()).rejects.toThrow('could not be saved');
  const draft = saves.draft('notes:1')!;
  expect(draftDisposition(draft, { body: 'old' })).toBe('retry');
  expect(draftDisposition(draft, { body: 'draft' })).toBe('saved');
  expect(draftDisposition(draft, { body: 'someone else' })).toBe('conflict');
});

it('does not block close after acknowledged writes when local storage is disabled', async () => {
  const saves = new DocumentSaveQueue(() => { throw new Error('storage is disabled'); });
  const writer = vi.fn(async () => {});
  expect(() => saves.schedule('notes:1', { body: 'latest' }, { body: '' }, writer)).toThrow('storage is disabled');
  expect(saves.has()).toBe(true);
  await expect(saves.flushAll()).resolves.toBeUndefined();
  expect(writer).toHaveBeenCalledExactlyOnceWith({ body: 'latest' });
  expect(saves.has()).toBe(false);
});

it('continues serial writes when storage becomes unavailable during a save', async () => {
  vi.useFakeTimers();
  let storageAvailable = true;
  const stored = new Map<string, string>();
  const saves = new DocumentSaveQueue(() => {
    if (!storageAvailable) throw new Error('storage is disabled');
    return {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => { stored.set(key, value); },
      removeItem: key => { stored.delete(key); },
    };
  });
  let acknowledge!: () => void;
  const writer = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; })).mockResolvedValue(undefined);
  saves.schedule('notes:1', { body: 'first' }, { body: '' }, writer);
  const pending = saves.flushAll();
  saves.schedule('notes:1', { body: 'second' }, { body: '' }, writer);
  storageAvailable = false;
  acknowledge();
  await expect(pending).resolves.toBeUndefined();
  expect(writer.mock.calls).toEqual([[{ body: 'first' }], [{ body: 'second' }]]);
  expect(saves.has()).toBe(false);
});

it('retains failed writes in memory even when draft persistence also fails', async () => {
  const saves = new DocumentSaveQueue(() => { throw new Error('storage is disabled'); });
  const writer = vi.fn().mockRejectedValueOnce(new Error('server unavailable')).mockResolvedValue(undefined);
  expect(() => saves.schedule('notes:1', { body: 'latest' }, { body: '' }, writer)).toThrow('storage is disabled');
  await expect(saves.flush('notes:1')).rejects.toThrow('server unavailable');
  expect(saves.has()).toBe(true);
  await saves.flushAll();
  expect(writer.mock.calls).toEqual([[{ body: 'latest' }], [{ body: 'latest' }]]);
  expect(saves.has()).toBe(false);
});
