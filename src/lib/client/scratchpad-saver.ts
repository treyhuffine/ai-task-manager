import { apiErrorStatus } from '@/lib/api/error-status';
import { apiErrorText } from '@/lib/api/client';
import { mergeScratchpad } from '@/lib/scratchpad/merge';

/**
 * Saves the scratchpad from one open editor (docs/scratchpad.md). Typing is
 * kept in the browser the moment it happens and sent after a short pause,
 * one save at a time. Each save names the text it started from, so when
 * another device wrote in between, the server merges the two and this
 * editor shows the merged text. Text another device saved while this one
 * had nothing unsent replaces what's shown here.
 */

export interface StoredScratchpad {
  body: string;
  updatedAt: string;
}

export interface ScratchpadSaveResult {
  record: StoredScratchpad;
  merged: boolean;
}

export interface ScratchpadSnapshot {
  /** The server's text has arrived at least once. */
  ready: boolean;
  /** What the editor shows. */
  draft: string;
  saving: boolean;
  /** Why the last save failed. Null once one succeeds. */
  error: string | null;
  /** When the stored text last changed. */
  updatedAt: string | null;
  /** Counts the times the text changed from outside the editor (another
   *  device, a merge), so the editor shows `draft` again. */
  revision: number;
}

type Write = (input: { body: string; base: string }) => Promise<ScratchpadSaveResult>;
type Store = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Retained { draft: string; base: string }

export const SCRATCHPAD_DRAFT_KEY = 'ri:scratchpad-draft:v1';
const SAVE_DELAY_MS = 600;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/** An unreachable home, a gateway or a server error can pass. A refusal (4xx) waits for the next edit. */
function retryable(error: unknown) {
  const status = apiErrorStatus(error);
  return typeof status !== 'number' || status >= 500 || status === 408 || status === 429;
}

export class ScratchpadSaver {
  /** The server's text as this editor last knew it: the base of the next save. Null until loaded. */
  private saved: string | null = null;
  private value: ScratchpadSnapshot = { ready: false, draft: '', saving: false, error: null, updatedAt: null, revision: 0 };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private running: Promise<void> | null = null;
  private failures = 0;
  private disposed = false;

  constructor(private write: Write, private storage: Store, private key = SCRATCHPAD_DRAFT_KEY, private delayMs = SAVE_DELAY_MS) {}

  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private changed(patch: Partial<ScratchpadSnapshot>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener();
  }

  hasUnsaved = () => this.saved !== null && this.value.draft !== this.saved;

  /** The stored scratchpad, from the first load or a later refetch. */
  observe(record: StoredScratchpad | null) {
    if (this.disposed) return;
    const body = record?.body ?? '';
    const updatedAt = record?.updatedAt ?? null;
    if (this.saved === null) {
      // Typing a closed page never sent comes back, saved against the text it
      // was typed on, so the server merges it with anything written since.
      const retained = this.readRetained();
      if (retained && retained.draft !== body) {
        this.saved = retained.base;
        this.changed({ ready: true, draft: retained.draft, updatedAt, revision: this.value.revision + 1 });
        this.schedule(0);
        return;
      }
      this.clearRetained();
      this.saved = body;
      this.changed({ ready: true, draft: body, updatedAt, revision: this.value.revision + 1 });
      return;
    }
    if (body === this.saved) {
      if (updatedAt !== this.value.updatedAt) this.changed({ updatedAt });
      return;
    }
    // Unsent typing here is saved against the text it was typed on, and the
    // server merges the two, so nothing is replaced under it.
    if (this.running || this.hasUnsaved()) return;
    this.saved = body;
    this.changed({ draft: body, updatedAt, revision: this.value.revision + 1 });
  }

  /** The editor's text after a keystroke. */
  edit(text: string) {
    if (this.disposed || !this.value.ready || text === this.value.draft) return;
    this.changed({ draft: text });
    this.retainDraft();
    this.schedule(this.delayMs);
  }

  /** Keep unsent typing in the browser, so closing the page never loses it. */
  retainDraft = () => {
    const base = this.saved;
    // Before the first load, a draft kept from an earlier page is still waiting to be sent.
    if (base === null) return;
    if (!this.hasUnsaved()) { this.clearRetained(); return; }
    try {
      this.storage().setItem(this.key, JSON.stringify({ draft: this.value.draft, base } satisfies Retained));
    } catch { /* Storage can be full or off. The save itself still runs. */ }
  };

  /** Send what's unsent now, and resolve once the server has all of it. */
  flush = (): Promise<void> => {
    clearTimeout(this.timer);
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  };

  /** While an editor shows this saver. Detaching sends what's unsent and
   *  stops retrying, and attaching again (a remount) picks up where it was. */
  attach(): () => void {
    this.disposed = false;
    return () => {
      void this.flush().catch(() => {});
      this.disposed = true;
      clearTimeout(this.timer);
    };
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, delay);
  }

  private async run() {
    while (this.hasUnsaved()) {
      const body = this.value.draft;
      const base = this.saved!;
      this.changed({ saving: true });
      let result: ScratchpadSaveResult;
      try {
        result = await this.write({ body, base });
      } catch (error) {
        this.failures += 1;
        const again = retryable(error) && !this.disposed;
        this.changed({ saving: false, error: again ? 'Not saved yet. Trying again.' : `Not saved. ${apiErrorText(error)}` });
        if (again) this.schedule(RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length) - 1]);
        throw error;
      }
      this.failures = 0;
      this.saved = result.record.body;
      if (result.merged) {
        // Another device wrote first. The server kept both, and typing here
        // since this save began is merged in the same way, then sent next.
        const draft = this.value.draft === body ? this.saved : mergeScratchpad(body, this.value.draft, this.saved);
        this.changed({ draft, saving: false, error: null, updatedAt: result.record.updatedAt, revision: this.value.revision + 1 });
      } else {
        this.changed({ saving: false, error: null, updatedAt: result.record.updatedAt });
      }
      this.retainDraft();
    }
  }

  private readRetained(): Retained | null {
    try {
      const text = this.storage().getItem(this.key);
      if (!text) return null;
      const value = JSON.parse(text) as Retained;
      return typeof value.draft === 'string' && typeof value.base === 'string' ? value : null;
    } catch { return null; }
  }

  private clearRetained() {
    try { this.storage().removeItem(this.key); } catch { /* Nothing to keep. */ }
  }
}
