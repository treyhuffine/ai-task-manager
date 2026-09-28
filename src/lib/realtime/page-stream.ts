/**
 * The page's one stream (P3 review). Everything on screen that follows the
 * server live (the dashboard's signals, each chat, each visible terminal)
 * subscribes here, and this keeps one EventSource to `/api/live` naming
 * them all. A browser keeps six HTTP/1.1 connections to a host: one stream
 * each used them up, and every ordinary request waited behind them.
 *
 * - Subscribing or leaving reconnects (coalesced, and only when the set of
 *   subscriptions changed, or a new subscriber can't take the open
 *   connection's frames), carrying where each left off. Nothing is lost
 *   across it.
 * - Where each left off is what its subscriber was actually handed (P3
 *   re-check). A frame that reaches no one moves nothing, and a new
 *   subscriber takes frames only from a connection opened for it, never the
 *   tail of one opened before it.
 * - A page hidden for a few seconds lets go of its connection, and
 *   reconnects the same way when it's shown again, so background tabs hold
 *   none. A page opened hidden lets go the same way.
 * - An error reconnects with backoff, from the same positions.
 */

type Listener = (event: string, data: unknown, id?: string) => void;

/**
 * Where a terminal screen is: the offset of the last output it was handed,
 * null while it has none. The page stream moves it on as it hands the
 * screen output, so a later subscription with the same one picks up exactly
 * where that screen left off. A new screen brings a new one.
 */
export interface TerminalPosition {
  after: number | null;
}

interface TerminalScreen {
  listener: Listener;
  position: TerminalPosition;
  /** The first connection it takes frames from. */
  from: number;
}

interface TerminalSubscription {
  base: string;
  terminalId: string;
  screens: Set<TerminalScreen>;
}

interface SessionSubscription {
  listeners: Set<Listener>;
  /** The last chat event its listeners were handed. */
  after: string | null;
  /** The newest change among them (`updatedAt`, the home's clock): parts revised in place since are replayed too. */
  since: string | null;
  /** The first connection it takes frames from. */
  from: number;
}

const COALESCE_MS = 20;
const HIDDEN_RELEASE_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

export class PageStream {
  private readonly globals = new Set<Listener>();
  private readonly sessions = new Map<string, SessionSubscription>();
  private readonly terminals = new Map<string, TerminalSubscription>();
  private source: EventSource | null = null;
  /** Counts connections: each subscriber knows the first it may take frames from. */
  private epoch = 0;
  private connectedKeys: string | null = null;
  /** Where the open connection's stream for each terminal is: a screen there can join it. */
  private terminalAt = new Map<string, number | null>();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private released = false;
  /** A subscriber that can't take the open connection's frames: reconnect even if the set is as it was. */
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

  /**
   * A chat's frames: `chat_event`, `runtime`, `delivery`, ..., and `ready`
   * ({ resumed, position }). A chat new to the page starts fresh on a
   * connection opened for it, as its own queries do. Listeners that join a
   * chat already followed share its frames from then on.
   */
  subscribeSession(sessionId: string, listener: Listener): () => void {
    let sub = this.sessions.get(sessionId);
    if (!sub) {
      this.sessions.set(sessionId, (sub = { listeners: new Set(), after: null, since: null, from: this.epoch + 1 }));
      // Its last listener may have left a moment ago, leaving the set as it was.
      this.forced = true;
    }
    sub.listeners.add(listener);
    this.changed();
    return () => {
      const current = this.sessions.get(sessionId);
      current?.listeners.delete(listener);
      // Opened again later, it starts fresh.
      if (current && current.listeners.size === 0) this.sessions.delete(sessionId);
      this.changed();
    };
  }

  /**
   * A terminal's frames for one screen: `ready` ({ resumed }), `data`,
   * `exit`, `unavailable`, `error`. From where `position` says the screen
   * is: the whole backlog for a screen with nothing yet, or only what it
   * missed for one hidden and shown again. It joins the open connection
   * when that's exactly where the screen is, and waits for one opened for
   * it otherwise.
   */
  subscribeTerminal(base: string, terminalId: string, position: TerminalPosition, listener: Listener): () => void {
    const key = `${base}:${terminalId}`;
    let sub = this.terminals.get(key);
    if (!sub) this.terminals.set(key, (sub = { base, terminalId, screens: new Set() }));
    const inStep = position.after !== null && this.source !== null && this.terminalAt.has(key) && this.terminalAt.get(key) === position.after;
    if (!inStep) this.forced = true;
    const screen: TerminalScreen = { listener, position, from: inStep ? this.epoch : this.epoch + 1 };
    sub.screens.add(screen);
    this.changed();
    return () => {
      const current = this.terminals.get(key);
      current?.screens.delete(screen);
      if (current && current.screens.size === 0) this.terminals.delete(key);
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

  private connect(keys: string): void {
    this.disconnect();
    const epoch = ++this.epoch;
    const terminals = [...this.terminals.entries()].map(([key, t]) => ({ key, t, after: terminalCursor(t) }));
    const sub = {
      s: [...this.sessions.entries()].map(([id, s]) => [id, s.after, s.after === null ? null : s.since]),
      t: terminals.map(({ t, after }) => [t.base, t.terminalId, after]),
    };
    const source = this.env.open(`/api/live?sub=${encodeURIComponent(JSON.stringify(sub))}`);
    this.source = source;
    this.connectedKeys = keys;
    this.terminalAt = new Map(terminals.map(({ key, after }) => [key, after]));
    const parse = (raw: MessageEvent): unknown => {
      try {
        return JSON.parse(raw.data as string);
      } catch {
        return null;
      }
    };
    const toGlobals = (event: string) => (raw: Event) => {
      if (this.source !== source) return;
      if (event === 'ready') this.backoff = 1_000;
      const data = parse(raw as MessageEvent);
      for (const listener of [...this.globals]) listener(event, data);
    };
    source.addEventListener('ready', toGlobals('ready'));
    source.addEventListener('session_updated', toGlobals('session_updated'));
    source.addEventListener('computer_updated', toGlobals('computer_updated'));
    source.addEventListener('session', (raw) => {
      if (this.source !== source) return;
      const frame = parse(raw as MessageEvent) as { s: string; e: string; d: unknown; i?: string } | null;
      if (!frame) return;
      const session = this.sessions.get(frame.s);
      if (!session || session.from > epoch) return;
      if (frame.e === 'chat_event' && frame.i) {
        session.after = frame.i;
        advanceSince(session, (frame.d as { updatedAt?: unknown } | null)?.updatedAt);
      } else if (frame.e === 'ready') {
        // Where the transcript stands: its listeners read it afresh unless this resumed.
        const position = (frame.d as { position?: { after?: unknown; since?: unknown } } | null)?.position;
        if (typeof position?.after === 'string') session.after = position.after;
        advanceSince(session, position?.since);
      }
      for (const listener of [...session.listeners]) listener(frame.e, frame.d, frame.i);
    });
    source.addEventListener('terminal', (raw) => {
      if (this.source !== source) return;
      const frame = parse(raw as MessageEvent) as { k: string; e: string; d: unknown; i?: string } | null;
      if (!frame) return;
      const offset = frame.i !== undefined && /^\d+$/.test(frame.i) ? Number(frame.i) : undefined;
      // Not resumed: the screen resets, and starts again from what follows.
      const restarted = frame.e === 'ready' && !(frame.d as { resumed?: boolean } | null)?.resumed;
      if (offset !== undefined) this.terminalAt.set(frame.k, offset);
      else if (restarted) this.terminalAt.set(frame.k, null);
      for (const screen of [...(this.terminals.get(frame.k)?.screens ?? [])]) {
        if (screen.from > epoch) continue;
        if (offset !== undefined) screen.position.after = offset;
        else if (restarted) screen.position.after = null;
        screen.listener(frame.e, frame.d, frame.i);
      }
    });
    source.onerror = () => {
      if (this.source !== source) return;
      // Reconnected by us, not the browser, so it carries the positions as they are now.
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
    this.terminalAt = new Map();
  }

  private watchVisibility(): void {
    const doc = this.env.document;
    if (this.watchingVisibility || !doc) return;
    this.watchingVisibility = true;
    const apply = () => {
      if (doc.visibilityState === 'hidden') {
        if (this.hiddenTimer || this.released) return;
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
    };
    doc.addEventListener('visibilitychange', apply);
    // As it is now, too: a page opened in a background tab starts hidden,
    // and would otherwise hold its connection until it's first shown (P3
    // re-check).
    apply();
  }
}

/**
 * Where to ask a terminal's stream to start: where its screens are, when
 * they agree. Screens in different places start over from the backlog
 * together, each resetting first, rather than one being handed output it
 * already has.
 */
function terminalCursor(sub: TerminalSubscription): number | null {
  const at = [...sub.screens].map((s) => s.position.after);
  return at.length > 0 && at.every((a) => a === at[0]) ? at[0]! : null;
}

/** The newest change seen: `updatedAt` strings in one format compare in time order. */
function advanceSince(session: SessionSubscription, at: unknown): void {
  if (typeof at === 'string' && (session.since === null || at > session.since)) session.since = at;
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
