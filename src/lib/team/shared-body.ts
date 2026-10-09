/**
 * Autosave for a shared body (docs/homes-spec.md §9.3, P6.4).
 *
 * One serial writer per document. Each save names the body revision it
 * edited, so the client's own earlier save can never overwrite a newer one,
 * and another member's change is never overwritten either: when the shared
 * version moved on, the save is refused with the current text. Then this
 * editor's automatic saves stop, the local text is kept (and keeps what is
 * typed next), and the person chooses: use the shared version, or keep
 * theirs, written against the revision just learned. Nothing retries a stale
 * body on its own, and a server echo never replaces text being edited.
 *
 * The unsaved text is also kept in local storage, keyed by team, member and
 * document, so a reload or a crash keeps it, and a draft in one space never
 * turns into a draft in another.
 */

export interface SharedBody {
  body: string;
  bodyRevision: number;
}

export type SharedBodyStatus =
  | { status: 'saved' }
  | { status: 'pending' }
  | { status: 'saving' }
  | { status: 'offline'; retryInMs: number }
  /** The shared version changed. Saves are stopped until the person chooses. */
  | { status: 'conflict'; theirs: SharedBody; mine: string }
  /** Refused for another reason. The text is kept. */
  | { status: 'failed'; message: string };

export type SharedBodyWriter = (input: { body: string; expectedBodyRevision: number }) => Promise<SharedBody>;

/** How a failed write is read: a conflict carries the current shared body. */
export interface WriteFailure {
  status?: number;
  conflict?: SharedBody;
  message?: string;
}

export interface SharedBodyDraft {
  body: string;
  baseRevision: number;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'ri:shared-draft:v1:';
const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000];

export function sharedDraftKey(scope: { teamId: string; memberId: string }, kind: 'task' | 'note', id: string): string {
  return `${PREFIX}${scope.teamId}:${scope.memberId}:${kind}:${id}`;
}

export class SharedBodySaver {
  private acknowledged: SharedBody;
  private draftBaseRevision: number;
  private latest: string;
  private current: SharedBodyStatus = { status: 'saved' };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private failures = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly key: string,
    initial: SharedBody,
    private readonly write: SharedBodyWriter,
    private readonly readFailure: (error: unknown) => WriteFailure,
    private readonly storage: () => DraftStorage,
    private readonly debounceMs = 500,
  ) {
    this.acknowledged = { ...initial };
    this.draftBaseRevision = initial.bodyRevision;
    this.latest = initial.body;
  }

  /** What this editor shows: the person's text, saved or not. */
  text(): string {
    return this.latest;
  }

  status(): SharedBodyStatus {
    return this.current;
  }

  /** The shared revision this editor's next save is written against. */
  revision(): number {
    return this.acknowledged.bodyRevision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: SharedBodyStatus) {
    this.current = next;
    for (const listener of this.listeners) listener();
  }

  /** A retained draft for this document, if one is left from before. */
  draft(): SharedBodyDraft | null {
    try {
      const text = this.storage().getItem(this.key);
      if (!text) return null;
      const value = JSON.parse(text) as SharedBodyDraft;
      return typeof value.body === 'string' && typeof value.baseRevision === 'number' ? value : null;
    } catch {
      return null;
    }
  }

  private retain() {
    try {
      this.storage().setItem(this.key, JSON.stringify({ body: this.latest, baseRevision: this.draftBaseRevision } satisfies SharedBodyDraft));
    } catch {
      // The edit stays in memory and the save still runs.
    }
  }

  private release() {
    try {
      this.storage().removeItem(this.key);
    } catch {
      // A leftover draft is offered for restore, never applied silently.
    }
  }

  /**
   * Recover a draft left by a reload or a crash. Same revision: it's this
   * person's unsaved text, saved now. Behind: the shared version moved on
   * meanwhile, so it's a conflict to resolve, never a silent overwrite.
   */
  recover(draft: SharedBodyDraft): void {
    if (draft.body === this.acknowledged.body) {
      this.release();
      return;
    }
    this.latest = draft.body;
    this.draftBaseRevision = draft.baseRevision;
    if (draft.baseRevision === this.acknowledged.bodyRevision) {
      this.retain();
      this.schedule(0);
      return;
    }
    this.retain();
    this.set({ status: 'conflict', theirs: { ...this.acknowledged }, mine: draft.body });
  }

  edit(body: string): void {
    this.latest = body;
    this.retain();
    const now = this.current;
    if (now.status === 'conflict') {
      this.set({ ...now, mine: body });
      return;
    }
    if (body === this.acknowledged.body && !this.running) {
      clearTimeout(this.timer);
      this.release();
      this.set({ status: 'saved' });
      return;
    }
    this.set({ status: 'pending' });
    this.schedule(this.debounceMs);
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, delay);
  }

  /**
   * The shared record as the server last reported it. Followed only while
   * this editor has nothing unsaved AND applies that text synchronously.
   * A focused editor that declines a replacement must keep its old revision.
   */
  observe(server: SharedBody, apply: () => void): boolean {
    if (server.bodyRevision <= this.acknowledged.bodyRevision) return false;
    if (this.current.status !== 'saved' || this.running || this.latest !== this.acknowledged.body) return false;
    apply();
    this.acknowledged = { ...server };
    this.draftBaseRevision = server.bodyRevision;
    this.latest = server.body;
    return true;
  }

  /** Write what's unsaved, one save at a time, each against the revision it edited. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.current.status === 'conflict' || this.current.status === 'failed') return;
    this.running = (async () => {
      while (this.latest !== this.acknowledged.body) {
        const sending = this.latest;
        this.set({ status: 'saving' });
        try {
          const saved = await this.write({ body: sending, expectedBodyRevision: this.acknowledged.bodyRevision });
          this.acknowledged = { body: saved.body ?? sending, bodyRevision: saved.bodyRevision };
          this.draftBaseRevision = saved.bodyRevision;
          // A newer local edit may already be waiting behind this save.
          if (this.latest !== this.acknowledged.body) this.retain();
          this.failures = 0;
        } catch (error) {
          const failure = this.readFailure(error);
          if (failure.conflict) {
            this.retain();
            this.set({ status: 'conflict', theirs: { ...failure.conflict }, mine: this.latest });
            return;
          }
          const status = failure.status;
          if (status === undefined || status >= 500 || status === 408 || status === 429) {
            const delay = RETRY_DELAYS[Math.min(this.failures++, RETRY_DELAYS.length - 1)];
            this.set({ status: 'offline', retryInMs: delay });
            this.schedule(delay);
            return;
          }
          this.set({ status: 'failed', message: failure.message ?? 'This change could not be saved. Your text is kept.' });
          return;
        }
      }
      this.release();
      this.set({ status: 'saved' });
    })();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  /** Drop this editor's text for the shared version. Returns the text to show. */
  useTheirs(): string {
    const now = this.current;
    if (now.status === 'conflict') this.acknowledged = { ...now.theirs };
    this.draftBaseRevision = this.acknowledged.bodyRevision;
    this.latest = this.acknowledged.body;
    clearTimeout(this.timer);
    this.release();
    this.set({ status: 'saved' });
    return this.latest;
  }

  /** Keep this editor's text: write it against the shared revision just learned. */
  async keepMine(): Promise<void> {
    const now = this.current;
    if (now.status !== 'conflict') return;
    this.acknowledged = { ...now.theirs };
    this.draftBaseRevision = now.theirs.bodyRevision;
    this.latest = now.mine;
    this.retain();
    this.set({ status: 'pending' });
    await this.flush();
  }

  /** After a refusal that isn't a conflict, try once more on request. */
  async retry(): Promise<void> {
    if (this.current.status !== 'failed' && this.current.status !== 'offline') return;
    this.set({ status: 'pending' });
    await this.flush();
  }

  /** Whether leaving now would lose anything not yet saved. */
  hasUnsaved(): boolean {
    return this.latest !== this.acknowledged.body;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}
