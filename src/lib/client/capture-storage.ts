import { CAPTURE_MAX_IMAGES, CAPTURE_MAX_IMAGE_BYTES, CAPTURE_MAX_TEXT_LENGTH } from './capture-images';
import { isAllowedMime } from '@/lib/attachments/mime';

export const CAPTURE_DRAFT_PREFIX = 'ri:capture-draft:';
const JOURNAL_PREFIX = CAPTURE_DRAFT_PREFIX;
const LOCK_PREFIX = 'ri.capture.v1:';
const MAX_DRAFTS = 10;

export interface CaptureDraftValue {
  text: string;
  usedVoice: boolean;
  files: File[];
  submission?: 'editing' | 'uncertain';
}

export interface CaptureDraftSummary {
  id: string;
  text: string;
  updatedAt: number;
  imageCount: number;
  submission: 'editing' | 'uncertain';
}

export interface CaptureDraftSession {
  readonly id: string;
  /** The small text journal is written synchronously, before this method returns. */
  save(value: CaptureDraftValue): Promise<void>;
  discard(): Promise<void>;
  release(): void;
}

export interface CaptureStorage {
  create(): Promise<CaptureDraftSession>;
  recoverable(): Promise<CaptureDraftSummary[]>;
  restore(id: string): Promise<{ session: CaptureDraftSession; draft: CaptureDraftValue; missingFiles: string[] }>;
}

/** Deliberately small boundaries keep browser persistence testable without replacing IndexedDB. */
export interface CaptureBlobStore {
  read(key: string): Promise<Blob | undefined>;
  write(entries: { key: string; file: File }[]): Promise<void>;
  prune(draftId: string, keepKeys: string[]): Promise<void>;
}

export interface CaptureLocks {
  acquire(name: string, ifAvailable: boolean): Promise<(() => void) | null>;
}

interface FileRecord {
  key: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

interface Journal {
  version: 1;
  id: string;
  text: string;
  usedVoice: boolean;
  updatedAt: number;
  submission: 'editing' | 'uncertain';
  files: FileRecord[];
  deleted?: true;
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
const finiteTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function parseJournal(raw: string, id: string): Journal {
  let value: Journal;
  try { value = JSON.parse(raw); } catch { throw new Error('A saved capture is unreadable. Its saved data has been kept.'); }
  if (!value || value.version !== 1 || value.id !== id || !validId(id)
    || typeof value.text !== 'string' || value.text.length > CAPTURE_MAX_TEXT_LENGTH
    || typeof value.usedVoice !== 'boolean' || !finiteTime(value.updatedAt)
    || !['editing', 'uncertain'].includes(value.submission)
    || (value.deleted !== undefined && value.deleted !== true)
    || !Array.isArray(value.files) || value.files.length > CAPTURE_MAX_IMAGES) {
    throw new Error('A saved capture has invalid metadata. Its saved data has been kept.');
  }
  let size = 0;
  const keys = new Set<string>();
  for (const file of value.files) {
    if (!file || typeof file.key !== 'string' || !file.key.startsWith(`${id}:`)
      || !validId(file.key.slice(id.length + 1)) || keys.has(file.key)
      || typeof file.name !== 'string' || file.name.length > 1024
      || typeof file.type !== 'string' || file.type.length > 256
      || !file.type.startsWith('image/') || !isAllowedMime(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0
      || !finiteTime(file.lastModified)) {
      throw new Error('A saved capture has invalid image metadata. Its saved data has been kept.');
    }
    keys.add(file.key);
    size += file.size;
  }
  if (size > CAPTURE_MAX_IMAGE_BYTES) throw new Error('A saved capture exceeds the image storage limit. Its saved data has been kept.');
  return value;
}

function persistenceError(error: unknown): Error {
  if (error instanceof Error && /saved capture|capture is|capture storage|capture draft|capture limit/i.test(error.message)) return error;
  return new Error('This capture could not be saved on this device. Keep it open and retry before leaving.', { cause: error });
}

export function createCaptureStorage(options: {
  journal: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  blobs: CaptureBlobStore;
  locks: CaptureLocks;
  uuid?: () => string;
  now?: () => number;
}): CaptureStorage {
  const { journal, blobs, locks } = options;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const now = options.now ?? Date.now;
  const read = (id: string) => {
    const raw = journal.getItem(JOURNAL_PREFIX + id);
    return raw === null ? undefined : parseJournal(raw, id);
  };
  const write = (record: Journal) => journal.setItem(JOURNAL_PREFIX + record.id, JSON.stringify(record));
  function records() {
    const found: Journal[] = [];
    for (let index = 0; index < journal.length; index++) {
      const key = journal.key(index);
      if (!key?.startsWith(JOURNAL_PREFIX)) continue;
      const record = read(key.slice(JOURNAL_PREFIX.length));
      if (record) found.push(record);
    }
    return found;
  }

  function session(initial: Journal, unlock: () => void, recovered?: Map<File, string>): CaptureDraftSession {
    let record = initial;
    let released = false;
    let tail: Promise<void> = Promise.resolve();
    const keys = new WeakMap<File, string[]>([...(recovered ?? [])].map(([file, key]) => [file, [key]]));
    const durable = new Set(recovered?.values());
    // A recovered draft may have orphaned blobs from a crash between journal and image commits.
    let needsPrune = recovered !== undefined;
    let imageWork: { signature: string; promise: Promise<void> } | undefined;
    const enqueue = (work: () => Promise<void>) => {
      const result = tail.then(work);
      tail = result.catch(() => {});
      return result.catch(error => { throw persistenceError(error); });
    };
    return {
      id: initial.id,
      save(value) {
        try {
          if (released || record.deleted) throw new Error('This capture is no longer open for editing.');
          if (!value || typeof value.text !== 'string' || typeof value.usedVoice !== 'boolean' || !Array.isArray(value.files)) {
            throw new Error('This capture draft is invalid.');
          }
          const occurrences = new Map<File, number>();
          const entries = value.files.map(file => {
            if (!(file instanceof File)) throw new Error('This capture draft contains an invalid image.');
            const index = occurrences.get(file) ?? 0;
            occurrences.set(file, index + 1);
            const fileKeys = keys.get(file) ?? [];
            let key = fileKeys[index];
            if (!key) {
              key = `${initial.id}:${uuid()}`;
              fileKeys[index] = key;
              keys.set(file, fileKeys);
            }
            return { key, file };
          });
          const next: Journal = {
            version: 1, id: initial.id, text: value.text, usedVoice: value.usedVoice,
            updatedAt: now(), submission: value.submission ?? 'editing',
            files: entries.map(({ key, file }) => ({ key, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified })),
          };
          parseJournal(JSON.stringify(next), next.id);
          // Text survives an immediate renderer crash even if the image transaction has not finished.
          write(next);
          record = next;
          const signature = JSON.stringify(entries.map(entry => entry.key));
          if (imageWork?.signature === signature) return imageWork.promise;
          const retained = new Set(entries.map(entry => entry.key));
          if (!imageWork && !needsPrune && retained.size === durable.size && [...retained].every(key => durable.has(key))) {
            return Promise.resolve();
          }
          const promise = enqueue(async () => {
            if (record.deleted) return;
            const pending = entries.filter(entry => !durable.has(entry.key));
            if (pending.length) {
              await blobs.write(pending);
              for (const entry of pending) durable.add(entry.key);
            }
            // A later synchronous save may already name different images. Keep its keys, not this snapshot's.
            const retained = new Set(record.files.map(file => file.key));
            if (!record.deleted && (needsPrune || [...durable].some(key => !retained.has(key)))) {
              await blobs.prune(initial.id, [...retained]);
              needsPrune = false;
              for (const key of durable) if (!retained.has(key)) durable.delete(key);
            }
          });
          imageWork = { signature, promise };
          void promise.then(
            () => { if (imageWork?.promise === promise) imageWork = undefined; },
            () => {
              needsPrune = true;
              if (imageWork?.promise === promise) imageWork = undefined;
            },
          );
          return promise;
        } catch (error) { return Promise.reject(persistenceError(error)); }
      },
      discard() {
        try {
          if (released) throw new Error('This capture is no longer open for editing.');
          if (!record.deleted) {
            const tombstone = { ...record, deleted: true as const, updatedAt: now() };
            // This must precede pending blob work, so a crash can never offer a submitted draft again.
            write(tombstone);
            record = tombstone;
          }
          return enqueue(async () => {
            await blobs.prune(initial.id, []);
            journal.removeItem(JOURNAL_PREFIX + initial.id);
          });
        } catch (error) { return Promise.reject(persistenceError(error)); }
      },
      release() {
        if (released) return;
        released = true;
        // Another window must not restore a journal while this session still changes its images.
        void tail.then(unlock);
      },
    };
  }

  async function reap(record: Journal): Promise<void> {
    // Reaping is only legal while holding this draft's exclusive lock.
    write({ ...record, deleted: true });
    await blobs.prune(record.id, []);
    journal.removeItem(JOURNAL_PREFIX + record.id);
  }
  const empty = (record: Journal) => record.submission === 'editing' && !record.text.trim() && !record.files.length;

  return {
    async create() {
      const registry = await locks.acquire(`${LOCK_PREFIX}registry`, false);
      if (!registry) throw new Error('Capture storage is busy. Retry in a moment.');
      let release: (() => void) | null = null;
      try {
        for (const record of records()) {
          if (!record.deleted && !empty(record)) continue;
          const available = await locks.acquire(LOCK_PREFIX + record.id, true);
          if (!available) continue;
          try {
            const current = read(record.id);
            if (current && (current.deleted || empty(current))) await reap(current);
          } finally { available(); }
        }
        if (records().filter(record => !record.deleted).length >= MAX_DRAFTS) {
          throw new Error('The saved capture limit is 10. Recover or discard an earlier capture before saving another.');
        }
        const id = uuid();
        if (!validId(id) || read(id)) throw new Error('A new capture draft could not be reserved. Retry in a moment.');
        release = await locks.acquire(LOCK_PREFIX + id, true);
        if (!release) throw new Error('A new capture draft could not be reserved. Retry in a moment.');
        const initial: Journal = { version: 1, id, text: '', files: [], usedVoice: false, submission: 'editing', updatedAt: now() };
        write(initial);
        return session(initial, release);
      } catch (error) {
        release?.();
        throw persistenceError(error);
      } finally { registry(); }
    },
    async recoverable() {
      try {
        const result: CaptureDraftSummary[] = [];
        for (const candidate of records()) {
          const release = await locks.acquire(LOCK_PREFIX + candidate.id, true);
          if (!release) continue;
          try {
            // Re-read after taking ownership, in case another tab just saved or discarded it.
            const record = read(candidate.id);
            if (!record) continue;
            if (record.deleted || empty(record)) { await reap(record); continue; }
            result.push({ id: record.id, text: record.text, updatedAt: record.updatedAt, imageCount: record.files.length, submission: record.submission });
          } finally { release(); }
        }
        return result.sort((a, b) => b.updatedAt - a.updatedAt);
      } catch (error) { throw persistenceError(error); }
    },
    async restore(id) {
      if (!validId(id)) throw new Error('This saved capture identifier is invalid.');
      const release = await locks.acquire(LOCK_PREFIX + id, true);
      if (!release) throw new Error('This capture is already open in another window.');
      try {
        const record = read(id);
        if (!record || record.deleted) throw new Error('This saved capture is no longer available.');
        const files: File[] = [];
        const missingFiles: string[] = [];
        const recovered = new Map<File, string>();
        for (const metadata of record.files) {
          const blob = await blobs.read(metadata.key);
          if (!(blob instanceof Blob) || blob.size !== metadata.size || blob.type !== metadata.type) {
            missingFiles.push(metadata.name);
            continue;
          }
          const file = new File([blob], metadata.name, { type: metadata.type, lastModified: metadata.lastModified });
          files.push(file);
          recovered.set(file, metadata.key);
        }
        return {
          session: session(record, release, recovered),
          draft: { text: record.text, usedVoice: record.usedVoice, files, submission: record.submission },
          missingFiles,
        };
      } catch (error) { release(); throw persistenceError(error); }
    },
  };
}

function browserLocks(): CaptureLocks {
  return {
    acquire(name, ifAvailable) {
      if (!navigator.locks) return Promise.reject(new Error('Capture storage needs browser lock support. Open Ri in a secure, current browser.'));
      return new Promise((resolve, reject) => {
        void navigator.locks.request(name, { mode: 'exclusive', ifAvailable }, async lock => {
          if (!lock) { resolve(null); return; }
          await new Promise<void>(unlock => resolve(unlock));
        }).catch(reject);
      });
    },
  };
}

function browserBlobs(): CaptureBlobStore {
  let connection: Promise<IDBDatabase> | undefined;
  function open() {
    if (connection) return connection;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      let finished = false;
      const request = indexedDB.open('ri-capture-drafts', 1);
      const timeout = setTimeout(() => fail(new Error('Capture storage did not open. Close older Ri windows and retry.')), 5000);
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        reject(error);
      };
      request.onupgradeneeded = () => {
        if (finished) { request.transaction?.abort(); return; }
        request.result.createObjectStore('images');
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('Capture storage is blocked by an older Ri window. Close it and retry.'));
      request.onsuccess = () => {
        if (finished) { request.result.close(); return; }
        finished = true;
        clearTimeout(timeout);
        const database = request.result;
        database.onversionchange = () => { database.close(); connection = undefined; };
        resolve(database);
      };
    });
    connection = attempt;
    void attempt.catch(() => { if (connection === attempt) connection = undefined; });
    return attempt;
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction('images', mode, { durability: 'strict' });
      let result: T;
      const timeout = setTimeout(() => {
        try { tx.abort(); } catch { /* It may have completed while this timer was queued. */ }
        reject(new Error('Capture storage did not finish saving images. Keep the capture open and retry.'));
      }, 5000);
      tx.oncomplete = () => { clearTimeout(timeout); resolve(result); };
      tx.onerror = () => { clearTimeout(timeout); reject(tx.error); };
      tx.onabort = () => { clearTimeout(timeout); reject(tx.error ?? new Error('Capture image transaction was interrupted.')); };
      try { operation(tx.objectStore('images'), value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    read: key => transaction<Blob | undefined>('readonly', (store, result) => {
      const request = store.get(key);
      request.onsuccess = () => result(request.result);
    }),
    write: entries => transaction<void>('readwrite', store => {
      for (const entry of entries) store.put(entry.file, entry.key);
    }),
    prune: (id, keepKeys) => transaction<void>('readwrite', store => {
      const keep = new Set(keepKeys);
      const request = store.openKeyCursor(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!keep.has(String(cursor.key))) store.delete(cursor.key);
        cursor.continue();
      };
    }),
  };
}

let browserStorage: CaptureStorage | undefined;
function storage() {
  if (!browserStorage) {
    if (typeof window === 'undefined' || !window.indexedDB || !window.navigator.locks) {
      throw new Error('Capture storage needs a secure, current browser with local storage and browser locks.');
    }
    browserStorage = createCaptureStorage({ journal: window.localStorage, blobs: browserBlobs(), locks: browserLocks() });
  }
  return browserStorage;
}

/** Lazily touches browser APIs, so importing the capture UI remains safe during server rendering. */
export const captureStorage: CaptureStorage = {
  async create() { try { return await storage().create(); } catch (error) { throw persistenceError(error); } },
  async recoverable() { try { return await storage().recoverable(); } catch (error) { throw persistenceError(error); } },
  async restore(id) { try { return await storage().restore(id); } catch (error) { throw persistenceError(error); } },
};
