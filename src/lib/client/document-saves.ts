type Patch = Record<string, unknown>;
export interface DocumentDraft { patch: Patch; base: Patch }
interface PendingSave extends DocumentDraft {
  writer: (patch: Patch) => Promise<unknown>;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
  inFlight?: Patch;
  visible: Readonly<Patch>;
}
const prefix = 'ri:document-draft:v1:';

/** One serial writer per document, shared across page and slideout mounts.
 * Drafts are retained synchronously before the network debounce begins. */
export class DocumentSaveQueue {
  private pending = new Map<string, PendingSave>();
  private listeners = new Map<string, Set<() => void>>();
  constructor(private storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  draft(key: string): DocumentDraft | null {
    const text = this.storage().getItem(prefix + key);
    if (!text) return null;
    const value = JSON.parse(text) as DocumentDraft;
    if (!value.patch || !value.base || typeof value.patch !== 'object' || typeof value.base !== 'object') throw new Error('Invalid retained draft');
    return value;
  }

  discard(key: string) { this.storage().removeItem(prefix + key); }
  has(key?: string) { return key ? this.pending.has(key) : this.pending.size > 0; }

  /** Only this session's unacknowledged edits belong in the active document.
   * Reading a retained draft must never silently restore an older session. */
  pendingPatch(key: string): Readonly<Patch> | undefined { return this.pending.get(key)?.visible; }
  subscribe(key: string, listener: () => void) {
    let listeners = this.listeners.get(key);
    if (!listeners) this.listeners.set(key, listeners = new Set());
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }
  private changed(key: string) { for (const listener of this.listeners.get(key) ?? []) listener(); }

  schedule(key: string, patch: Patch, base: Patch, writer: PendingSave['writer']) {
    let state = this.pending.get(key);
    if (!state) {
      state = { patch: {}, base: {}, writer, visible: {} };
      this.pending.set(key, state);
    }
    for (const field of Object.keys(patch)) {
      if (!(field in state.base)) state.base[field] = base[field] ?? null;
    }
    Object.assign(state.patch, patch);
    state.writer = writer;
    state.visible = { ...state.inFlight, ...state.patch };
    this.changed(key);
    this.persist(key, state);
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { void this.flush(key).catch(() => {}); }, 500);
  }

  private persist(key: string, state: PendingSave) {
    this.storage().setItem(prefix + key, JSON.stringify({ patch: { ...state.inFlight, ...state.patch }, base: state.base }));
  }

  async flush(key: string): Promise<void> {
    const state = this.pending.get(key);
    if (!state) return;
    clearTimeout(state.timer);
    if (state.running) return state.running;
    state.running = (async () => {
      while (Object.keys(state.patch).length) {
        const patch = state.patch;
        state.patch = {};
        state.inFlight = patch;
        try {
          await state.writer(patch);
        } catch (error) {
          state.patch = { ...patch, ...state.patch };
          state.inFlight = undefined;
          // The write error remains authoritative when local storage also
          // fails. Keep the in-memory patch available for the next retry.
          try { this.persist(key, state); } catch { /* Already retained in memory. */ }
          throw error;
        }
        state.inFlight = undefined;
        Object.assign(state.base, patch);
        if (Object.keys(state.patch).length) {
          state.visible = { ...state.patch };
          this.changed(key);
          // Storage restrictions must not prevent already-queued edits from
          // reaching the server. schedule() reports retention failures.
          try { this.persist(key, state); } catch { /* Continue the serial writer. */ }
        }
      }
      // All writes are acknowledged. A denied localStorage cleanup must not
      // leave a phantom pending save that blocks close or reload forever.
      try { this.discard(key); } catch { /* Recovery never silently replays retained drafts. */ }
      this.pending.delete(key);
      this.changed(key);
    })();
    try { await state.running; } finally { state.running = undefined; }
  }

  /** Explicit update recovery may reload only after every unsaved edit is
   * durably retained. A storage error must keep this view open. */
  retainAll() { for (const [key, state] of this.pending) this.persist(key, state); }

  async flushAll() {
    const results = await Promise.allSettled([...this.pending.keys()].map(key => this.flush(key)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Some edits could not be saved. Keep this window open and retry.');
  }
}

export const documentSaves = new DocumentSaveQueue(() => window.localStorage);

export function draftDisposition(draft: DocumentDraft, current: Patch): 'saved' | 'retry' | 'conflict' {
  const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const fields = Object.keys(draft.patch);
  if (fields.every(field => equal(current[field], draft.patch[field]))) return 'saved';
  if (fields.every(field => equal(current[field], draft.base[field]) || equal(current[field], draft.patch[field]))) return 'retry';
  return 'conflict';
}
