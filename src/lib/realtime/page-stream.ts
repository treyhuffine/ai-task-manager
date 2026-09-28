/**
 * The page's one stream (P3 review). Everything on screen that follows the
 * server live (the dashboard's signals, each chat, each visible terminal)
 * subscribes here, and this keeps one EventSource to `/api/stream` naming
 * them all. A browser keeps six HTTP/1.1 connections to a host: one stream
 * each used them up, and every ordinary request waited behind them.
 *
 * - Subscribing or leaving reconnects (coalesced, and only when the set of
 *   subscriptions changed), carrying where each left off: a chat's last
 *   event, a terminal's last offset. Nothing is lost across it.
 * - A page hidden for a few seconds lets go of its connection, and
 *   reconnects the same way when it's shown again, so background tabs hold
 *   none.
 * - An error reconnects with backoff, from the same cursors.
 */

type Listener = (event: string, data: unknown, id?: string) => void;

interface TerminalSubscription {
  base: string;
  terminalId: string;
  listeners: Set<Listener>;
}

const COALESCE_MS = 20;
const HIDDEN_RELEASE_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

export class PageStream {
  private readonly globals = new Set<Listener>();
  private readonly sessions = new Map<string, Set<Listener>>();
  private readonly terminals = new Map<string, TerminalSubscription>();
  private readonly sessionCursors = new Map<string, string>();
  private readonly terminalCursors = new Map<string, number>();
  private source: EventSource | null = null;
  private connectedKeys: string | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private released = false;
  /** A new screen for a terminal already followed: it needs the backlog, so reconnect. */
  private forced = false;
  private backoff = 1_000;
  private watchingVisibility = false;

  constructor(
    private readonly env: {
      open: (url: string) => EventSource;
      document?: Pick<Document, 'visibilityState' | 'addEventListener'>;
    },
  ) {}

  /** The dashboard's signals: `session_updated`, `computer_updated`, `ready`. */
  subscribeGlobal(listener: Listener): () => void {
    this.globals.add(listener);
    this.changed();
    return () => {
      this.globals.delete(listener);
      this.changed();
    };
  }

  /** A chat's frames: `chat_event`, `runtime`, `delivery`, ..., and `ready` ({ resumed }). */
  subscribeSession(sessionId: string, listener: Listener): () => void {
    let set = this.sessions.get(sessionId);
    if (!set) this.sessions.set(sessionId, (set = new Set()));
    set.add(listener);
    this.changed();
    return () => {
      const current = this.sessions.get(sessionId);
      current?.delete(listener);
      if (current && current.size === 0) {
        this.sessions.delete(sessionId);
        // Opened again later, it starts fresh, as its own queries do.
        this.sessionCursors.delete(sessionId);
      }
      this.changed();
    };
  }

  /**
   * A terminal's frames: `ready` ({ resumed }), `data`, `exit`, `unavailable`,
   * `error`. `fresh` for a screen that has none of its output yet; otherwise
   * it picks up from the last offset this page saw, so a tab hidden and
   * shown again gets only what it missed.
   */
  subscribeTerminal(base: string, terminalId: string, listener: Listener, fresh: boolean): () => void {
    const key = `${base}:${terminalId}`;
    if (fresh) {
      this.terminalCursors.delete(key);
      // Its old screen may leave in the same moment (a remount), leaving the
      // set as it was: the new one still needs the whole backlog.
      this.forced = true;
    }
    let sub = this.terminals.get(key);
    if (!sub) this.terminals.set(key, (sub = { base, terminalId, listeners: new Set() }));
    sub.listeners.add(listener);
    this.changed();
    return () => {
      const current = this.terminals.get(key);
      current?.listeners.delete(listener);
      if (current && current.listeners.size === 0) this.terminals.delete(key);
      this.changed();
    };
  }

  /** How many connections this page holds now: 0 or 1. For tests and diagnostics. */
  get connections(): number {
    return this.source ? 1 : 0;
  }

  private changed(): void {
    this.watchVisibility();
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.sync();
    }, COALESCE_MS);
  }

  private keys(): string {
    return [
      this.globals.size > 0 ? 'g' : '',
      ...[...this.sessions.keys()].sort().map((id) => `s:${id}`),
      ...[...this.terminals.keys()].sort().map((key) => `t:${key}`),
    ]
      .filter(Boolean)
      .join('|');
  }

  private sync(): void {
    const keys = this.keys();
    if (!keys || this.released) {
      this.disconnect();
      return;
    }
    if (this.source && keys === this.connectedKeys && !this.forced) return;
    this.forced = false;
    this.connect(keys);
  }

  private url(): string {
    const sub = {
      s: [...this.sessions.keys()].map((id) => [id, this.sessionCursors.get(id) ?? null]),
      t: [...this.terminals.values()].map((t) => [t.base, t.terminalId, this.terminalCursors.get(`${t.base}:${t.terminalId}`) ?? null]),
    };
    return `/api/stream?sub=${encodeURIComponent(JSON.stringify(sub))}`;
  }

  private connect(keys: string): void {
    this.disconnect();
    const source = this.env.open(this.url());
    this.source = source;
    this.connectedKeys = keys;
    const parse = (raw: MessageEvent): unknown => {
      try {
        return JSON.parse(raw.data as string);
      } catch {
        return null;
      }
    };
    const toGlobals = (event: string) => (raw: Event) => {
      if (event === 'ready') this.backoff = 1_000;
      const data = parse(raw as MessageEvent);
      for (const listener of [...this.globals]) listener(event, data);
    };
    source.addEventListener('ready', toGlobals('ready'));
    source.addEventListener('session_updated', toGlobals('session_updated'));
    source.addEventListener('computer_updated', toGlobals('computer_updated'));
    source.addEventListener('session', (raw) => {
      const frame = parse(raw as MessageEvent) as { s: string; e: string; d: unknown; i?: string } | null;
      if (!frame) return;
      if (frame.e === 'chat_event' && frame.i) this.sessionCursors.set(frame.s, frame.i);
      for (const listener of [...(this.sessions.get(frame.s) ?? [])]) listener(frame.e, frame.d, frame.i);
    });
    source.addEventListener('terminal', (raw) => {
      const frame = parse(raw as MessageEvent) as { k: string; e: string; d: unknown; i?: string } | null;
      if (!frame) return;
      if (frame.i !== undefined && /^\d+$/.test(frame.i)) this.terminalCursors.set(frame.k, Number(frame.i));
      for (const listener of [...(this.terminals.get(frame.k)?.listeners ?? [])]) listener(frame.e, frame.d, frame.i);
    });
    source.onerror = () => {
      if (this.source !== source) return;
      // Reconnected by us, not the browser, so it carries the cursors as they are now.
      this.disconnect();
      const wait = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.sync();
      }, wait);
    };
  }

  private disconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!this.source) return;
    try {
      this.source.close();
    } catch {
      /* already closed */
    }
    this.source = null;
    this.connectedKeys = null;
  }

  private watchVisibility(): void {
    const doc = this.env.document;
    if (this.watchingVisibility || !doc) return;
    this.watchingVisibility = true;
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') {
        if (this.hiddenTimer) return;
        this.hiddenTimer = setTimeout(() => {
          this.hiddenTimer = null;
          this.released = true;
          this.sync();
        }, HIDDEN_RELEASE_MS);
      } else {
        if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
        this.hiddenTimer = null;
        if (this.released) {
          this.released = false;
          this.sync();
        }
      }
    });
  }
}

// On globalThis: a dev server reloading this module mustn't open a second connection.
const KEY = Symbol.for('@ri/page-stream');
const holder = globalThis as unknown as { [KEY]?: PageStream };

/** This page's stream. */
export function pageStream(): PageStream {
  return (holder[KEY] ??= new PageStream({
    open: (url) => new EventSource(url),
    document: typeof document === 'undefined' ? undefined : document,
  }));
}

/** For tests: forget this page's stream. */
export function _resetPageStream(): void {
  delete holder[KEY];
}
