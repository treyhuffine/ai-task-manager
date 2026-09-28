import { describe, expect, it, vi } from 'vitest';
import { CAPTURE_MAX_IMAGE_BYTES, CAPTURE_MAX_TEXT_LENGTH } from './capture-images';
import {
  CAPTURE_DRAFT_PREFIX, createCaptureStorage,
  type CaptureBlobStore, type CaptureDraftSession, type CaptureLocks,
} from './capture-storage';

class MemoryJournal {
  readonly values = new Map<string, string>();
  failWrite = false;
  failRemove = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrite) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemove) throw new Error('Storage denied');
    this.values.delete(key);
  }
}

class MemoryLocks implements CaptureLocks {
  readonly held = new Set<string>();
  readonly waiting = new Map<string, (() => void)[]>();
  async acquire(name: string, ifAvailable: boolean): Promise<(() => void) | null> {
    if (this.held.has(name)) {
      if (ifAvailable) return null;
      await new Promise<void>(resolve => {
        this.waiting.set(name, [...(this.waiting.get(name) ?? []), resolve]);
      });
    }
    this.held.add(name);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.get(name)?.shift();
      if (next) next();
      else this.held.delete(name);
    };
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const journal = new MemoryJournal();
  const locks = new MemoryLocks();
  const images = new Map<string, Blob>();
  const blobs: CaptureBlobStore = {
    read: vi.fn(async key => images.get(key)),
    write: vi.fn(async entries => { for (const entry of entries) images.set(entry.key, entry.file); }),
    prune: vi.fn(async (id, keep) => {
      for (const key of images.keys()) if (key.startsWith(`${id}:`) && !keep.includes(key)) images.delete(key);
    }),
  };
  let counter = 0;
  let time = 100;
  const options = { journal, locks, blobs, uuid: () => `test-id-${String(++counter).padStart(8, '0')}`, now: () => ++time };
  const storage = createCaptureStorage(options);
  const record = (id: string) => JSON.parse(journal.getItem(CAPTURE_DRAFT_PREFIX + id)!);
  return { ...options, images, storage, record, anotherTab: () => createCaptureStorage(options) };
}

const image = (name = 'Screenshot.png', content = 'pixels') => new File([content], name, { type: 'image/png', lastModified: 123 });
const value = (text: string, files: File[] = []) => ({ text, files, usedVoice: false });
async function release(session: CaptureDraftSession) {
  session.release();
  await Promise.resolve();
}

describe('capture storage durability', () => {
  it('journals text synchronously before pending image storage and reports durability only after completion', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const gate = deferred();
    vi.mocked(f.blobs.write).mockImplementationOnce(async entries => {
      await gate.promise;
      for (const entry of entries) f.images.set(entry.key, entry.file);
    });
    let saved = false;
    const pending = session.save(value('Keep this thought', [image()])).then(() => { saved = true; });
    expect(f.record(session.id).text).toBe('Keep this thought');
    expect(f.images.size).toBe(0);
    await Promise.resolve();
    expect(saved).toBe(false);
    expect(await f.anotherTab().recoverable()).toEqual([]);
    gate.resolve();
    await pending;
    expect(saved).toBe(true);
    expect(f.images.size).toBe(1);
  });

  it('recovers exact image bytes and metadata, text and voice without submitting', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save({ text: 'Spoken idea', usedVoice: true, files: [image('actual.png', 'original bytes')] });
    await release(session);
    const summaries = await f.anotherTab().recoverable();
    expect(summaries).toEqual([{ id: session.id, text: 'Spoken idea', imageCount: 1, updatedAt: 102, submission: 'editing' }]);
    const restored = await f.anotherTab().restore(session.id);
    expect(restored.missingFiles).toEqual([]);
    expect(restored.draft).toMatchObject({ text: 'Spoken idea', usedVoice: true, submission: 'editing' });
    expect(restored.draft.files[0]).toMatchObject({ name: 'actual.png', type: 'image/png', size: 14, lastModified: 123 });
    expect(await restored.draft.files[0].text()).toBe('original bytes');
    await restored.session.save(restored.draft);
    expect(f.blobs.write).toHaveBeenCalledTimes(1);
  });

  it('retains an uncertain submission even when its content is empty', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save({ ...value(''), submission: 'uncertain' });
    await release(session);
    expect(await f.storage.recoverable()).toMatchObject([{ id: session.id, submission: 'uncertain' }]);
    expect((await f.storage.restore(session.id)).draft.submission).toBe('uncertain');
  });

  it('serializes image snapshots while the latest text journal wins immediately', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const gate = deferred();
    const write = f.blobs.write;
    vi.mocked(write).mockImplementationOnce(async entries => {
      await gate.promise;
      for (const entry of entries) f.images.set(entry.key, entry.file);
    });
    const first = session.save(value('Before', [image('old.png')]));
    await Promise.resolve();
    const second = session.save(value('After', [image('new.png')]));
    expect(f.record(session.id).text).toBe('After');
    gate.resolve();
    await Promise.all([first, second]);
    expect([...f.images.values()].map(blob => (blob as File).name)).toEqual(['new.png']);
    await release(session);
    expect((await f.storage.restore(session.id)).draft.files.map(file => file.name)).toEqual(['new.png']);
  });

  it('writes unchanged File references once and restores an intentionally re-added file after pruning', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const file = image();
    await session.save(value('One', [file]));
    await session.save(value('Two', [file]));
    expect(f.blobs.write).toHaveBeenCalledTimes(1);
    await session.save(value('Removed'));
    expect(f.images.size).toBe(0);
    await session.save(value('Returned', [file]));
    expect(f.blobs.write).toHaveBeenCalledTimes(2);
    expect(f.images.size).toBe(1);
  });

  it('keeps repeated intentional occurrences of the same File as distinct recoverable images', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const file = image();
    await session.save(value('Two copies', [file, file]));
    const before = f.record(session.id).files.map((entry: { key: string }) => entry.key);
    expect(new Set(before).size).toBe(2);
    await session.save(value('Still two', [file, file]));
    expect(f.blobs.write).toHaveBeenCalledTimes(1);
    expect(f.record(session.id).files.map((entry: { key: string }) => entry.key)).toEqual(before);
    await release(session);
    const restored = await f.storage.restore(session.id);
    expect(restored.draft.files.map(file => file.name)).toEqual(['Screenshot.png', 'Screenshot.png']);
    expect(restored.missingFiles).toEqual([]);
  });

  it('does not enqueue IndexedDB transactions for text-only typing', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await Promise.all(Array.from({ length: 100 }, (_, index) => session.save(value(`Thought ${index}`))));
    expect(f.record(session.id).text).toBe('Thought 99');
    expect(f.blobs.write).not.toHaveBeenCalled();
    expect(f.blobs.prune).not.toHaveBeenCalled();
  });

  it('coalesces typing around one pending image transaction without losing the final text', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const file = image();
    const gate = deferred();
    vi.mocked(f.blobs.write).mockImplementationOnce(async entries => {
      await gate.promise;
      for (const entry of entries) f.images.set(entry.key, entry.file);
    });
    const saves = Array.from({ length: 100 }, (_, index) => session.save(value(`Thought ${index}`, [file])));
    expect(new Set(saves).size).toBe(1);
    expect(f.record(session.id).text).toBe('Thought 99');
    gate.resolve();
    await Promise.all(saves);
    expect(f.blobs.write).toHaveBeenCalledTimes(1);
    expect(f.blobs.prune).not.toHaveBeenCalled();
  });

  it('holds ownership until queued writes settle after release', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const gate = deferred();
    vi.mocked(f.blobs.write).mockImplementationOnce(async () => { await gate.promise; });
    const save = session.save(value('Still saving', [image()]));
    session.release();
    await expect(session.save(value('Too late'))).rejects.toThrow('no longer open');
    await expect(f.anotherTab().restore(session.id)).rejects.toThrow('already open');
    gate.resolve();
    await save;
    await Promise.resolve();
    expect(await f.anotherTab().recoverable()).toHaveLength(1);
  });
});

describe('capture storage deletion and failures', () => {
  it('tombstones synchronously and prevents in-flight saves from resurrecting a discarded capture', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const gate = deferred();
    vi.mocked(f.blobs.write).mockImplementationOnce(async entries => {
      await gate.promise;
      for (const entry of entries) f.images.set(entry.key, entry.file);
    });
    const save = session.save(value('Do not return', [image()]));
    await Promise.resolve();
    const discard = session.discard();
    expect(f.record(session.id).deleted).toBe(true);
    await expect(session.save(value('Resurrection'))).rejects.toThrow('no longer open');
    gate.resolve();
    await Promise.all([save, discard]);
    await release(session);
    expect(f.images.size).toBe(0);
    expect(f.journal.length).toBe(0);
    expect(await f.storage.recoverable()).toEqual([]);
  });

  it('preserves the previous journal if quota prevents an edit and allows retry', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Previously saved'));
    f.journal.failWrite = true;
    await expect(session.save(value('Unsaved edit'))).rejects.toThrow('could not be saved');
    expect(f.record(session.id).text).toBe('Previously saved');
    f.journal.failWrite = false;
    await session.save(value('Retried edit'));
    expect(f.record(session.id).text).toBe('Retried edit');
  });

  it('does not destroy content if the discard tombstone cannot be written', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Still here', [image()]));
    f.journal.failWrite = true;
    await expect(session.discard()).rejects.toThrow('could not be saved');
    expect(f.record(session.id).deleted).toBeUndefined();
    expect(f.images.size).toBe(1);
    f.journal.failWrite = false;
    await session.save(value('Still editable'));
  });

  it('keeps a tombstone after failed cleanup and reaps it on recovery without offering the draft', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Submitted', [image()]));
    vi.mocked(f.blobs.prune).mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(session.discard()).rejects.toThrow('could not be saved');
    expect(f.record(session.id).deleted).toBe(true);
    await release(session);
    expect(await f.storage.recoverable()).toEqual([]);
    expect(f.images.size).toBe(0);
    expect(f.journal.length).toBe(0);
  });

  it('retains a tombstone when journal removal fails and supports explicit cleanup retry', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Done'));
    f.journal.failRemove = true;
    await expect(session.discard()).rejects.toThrow('could not be saved');
    expect(f.record(session.id).deleted).toBe(true);
    f.journal.failRemove = false;
    await session.discard();
    expect(f.journal.length).toBe(0);
  });

  it('surfaces missing images after an interrupted blob write while preserving the text', async () => {
    const f = fixture();
    const session = await f.storage.create();
    vi.mocked(f.blobs.write).mockRejectedValueOnce(new DOMException('Disk full', 'QuotaExceededError'));
    await expect(session.save(value('The text survived', [image('lost.png')]))).rejects.toThrow('could not be saved');
    await release(session);
    const recovered = await f.storage.restore(session.id);
    expect(recovered.draft.text).toBe('The text survived');
    expect(recovered.draft.files).toEqual([]);
    expect(recovered.missingFiles).toEqual(['lost.png']);
    expect(f.record(session.id).files).toHaveLength(1);
  });

  it('reports wrong-sized or wrong-typed blobs as missing, never as fully recovered', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Image', [image('bad.png')]));
    const key = f.record(session.id).files[0].key;
    f.images.set(key, new Blob(['wrong'], { type: 'text/plain' }));
    await release(session);
    expect((await f.storage.restore(session.id)).missingFiles).toEqual(['bad.png']);
  });

  it('preserves the draft and releases ownership after an IndexedDB read failure', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Recover later', [image()]));
    await release(session);
    vi.mocked(f.blobs.read).mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(f.storage.restore(session.id)).rejects.toThrow('could not be saved');
    expect((await f.storage.restore(session.id)).draft.text).toBe('Recover later');
  });

  it('retries a failed blob write without poisoning later saves', async () => {
    const f = fixture();
    const session = await f.storage.create();
    const file = image();
    vi.mocked(f.blobs.write).mockRejectedValueOnce(new Error('Temporary failure'));
    await expect(session.save(value('One', [file]))).rejects.toThrow();
    await session.save(value('Two', [file]));
    expect(f.images.size).toBe(1);
    await release(session);
    expect((await f.storage.restore(session.id)).missingFiles).toEqual([]);
  });

  it('cleans image blobs orphaned by a crash even when the recovered journal is now text-only', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Text only'));
    f.images.set(`${session.id}:orphan-key-12345`, image());
    await release(session);
    const restored = await f.storage.restore(session.id);
    await restored.session.save(restored.draft);
    expect(f.images.size).toBe(0);
  });
});

describe('capture storage cross-window isolation and bounds', () => {
  it('does not offer or restore another window’s live draft', async () => {
    const f = fixture();
    const first = await f.storage.create();
    const second = await f.anotherTab().create();
    await first.save(value('Window one', [image()]));
    await second.save(value('Window two', [image()]));
    expect(first.id).not.toBe(second.id);
    await expect(f.anotherTab().restore(first.id)).rejects.toThrow('already open');
    await release(first);
    expect((await f.anotherTab().recoverable()).map(item => item.text)).toEqual(['Window one']);
    await second.discard();
    expect(f.images.size).toBe(1);
    expect((await f.storage.restore(first.id)).draft.text).toBe('Window one');
  });

  it('reserves at most ten drafts across concurrent windows without evicting any', async () => {
    const f = fixture();
    const sessions = await Promise.all(Array.from({ length: 10 }, () => f.anotherTab().create()));
    await Promise.all(sessions.map((session, index) => session.save(value(`Draft ${index}`))));
    await expect(f.anotherTab().create()).rejects.toThrow('limit is 10');
    expect(f.journal.length).toBe(10);
    await sessions[0].discard();
    await release(sessions[0]);
    const replacement = await f.storage.create();
    expect(f.journal.length).toBe(10);
    expect(replacement.id).not.toBe(sessions[0].id);
  });

  it('cleans abandoned empty reservations but not live empty drafts or uncertain submissions', async () => {
    const f = fixture();
    const abandoned = await f.storage.create();
    const live = await f.storage.create();
    const uncertain = await f.storage.create();
    await uncertain.save({ ...value(''), submission: 'uncertain' });
    await release(abandoned);
    await release(uncertain);
    expect(await f.storage.recoverable()).toHaveLength(1);
    expect(f.journal.getItem(CAPTURE_DRAFT_PREFIX + abandoned.id)).toBeNull();
    expect(f.journal.getItem(CAPTURE_DRAFT_PREFIX + live.id)).not.toBeNull();
  });

  it('refuses operation without cross-window locks before modifying data', async () => {
    const f = fixture();
    const storage = createCaptureStorage({ ...f, locks: { acquire: async () => { throw new Error('Capture storage needs browser lock support.'); } } });
    await expect(storage.create()).rejects.toThrow('browser lock support');
    expect(f.journal.length).toBe(0);
  });

  it.each([
    ['invalid JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2 })],
    ['incorrect field types', JSON.stringify({ version: 1, id: 'bad-id-12345', text: 99, files: [] })],
  ])('leaves %s journals untouched and reports a recovery error', async (_label, raw) => {
    const f = fixture();
    f.journal.setItem(CAPTURE_DRAFT_PREFIX + 'bad-id-12345', raw);
    await expect(f.storage.recoverable()).rejects.toThrow('saved capture');
    await expect(f.storage.create()).rejects.toThrow('saved capture');
    expect(f.journal.getItem(CAPTURE_DRAFT_PREFIX + 'bad-id-12345')).toBe(raw);
  });

  it('rejects metadata keys belonging to another draft before reading any blob', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Original', [image()]));
    await release(session);
    const record = f.record(session.id);
    record.files[0].key = 'different-draft:another-identifier';
    f.journal.setItem(CAPTURE_DRAFT_PREFIX + session.id, JSON.stringify(record));
    await expect(f.storage.restore(session.id)).rejects.toThrow('invalid image metadata');
    expect(f.blobs.read).not.toHaveBeenCalled();
  });

  it('rejects excessive text and images before changing the existing journal', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await session.save(value('Kept'));
    await expect(session.save(value('x'.repeat(CAPTURE_MAX_TEXT_LENGTH + 1)))).rejects.toThrow();
    await expect(session.save(value('Too many', Array.from({ length: 11 }, () => image())))).rejects.toThrow();
    const large = new File([new Uint8Array(CAPTURE_MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' });
    await expect(session.save(value('Too large', [large]))).rejects.toThrow('image storage limit');
    await expect(session.save(value('Not an image', [new File(['text'], 'text.txt', { type: 'text/plain' })]))).rejects.toThrow();
    expect(f.record(session.id).text).toBe('Kept');
    expect(f.blobs.write).not.toHaveBeenCalled();
  });

  it('re-reads a reservation after taking its lock before deciding whether to reap it', async () => {
    const f = fixture();
    const session = await f.storage.create();
    await release(session);
    const originalAcquire = f.locks.acquire.bind(f.locks);
    vi.spyOn(f.locks, 'acquire').mockImplementation(async (name, available) => {
      const release = await originalAcquire(name, available);
      if (name.endsWith(session.id)) {
        const record = f.record(session.id);
        record.text = 'Saved just before taking ownership';
        f.journal.setItem(CAPTURE_DRAFT_PREFIX + session.id, JSON.stringify(record));
      }
      return release;
    });
    await f.storage.create();
    expect(f.record(session.id).text).toBe('Saved just before taking ownership');
  });
});
