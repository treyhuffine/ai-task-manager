/**
 * Independent d0c788f review probes. No server or real computer involved.
 *
 * P3 re-check, findings 2 and 5. Adapted to the fix: a terminal screen now
 * brings its own position (`{ after }`), which the page stream moves only
 * for output it hands that screen. So the probe's `fresh = true` is a new
 * position (a new xterm), and `false` is the same screen's position again
 * (the still-mounted xterm shown again).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageStream } from '@/lib/realtime/page-stream';

class Source extends EventTarget {
  closed = false;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) { super(); }
  close() { this.closed = true; }
  terminal(data: string, offset: number) {
    const event = new Event('terminal') as Event & { data: string };
    event.data = JSON.stringify({ k: '/sessions/chat:term', e: 'data', d: data, i: String(offset) });
    this.dispatchEvent(event);
  }
}
class Doc extends EventTarget { visibilityState: DocumentVisibilityState = 'visible'; }
let sources: Source[];
let doc: Doc;
let stream: PageStream;
const cursor = () => JSON.parse(new URL(sources.at(-1)!.url, 'http://test').searchParams.get('sub')!).t[0][2];
beforeEach(() => {
  vi.useFakeTimers(); sources = []; doc = new Doc();
  stream = new PageStream({ document: doc, open: (url) => {
    const source = new Source(url); sources.push(source); return source as unknown as EventSource;
  } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('does not acknowledge terminal output arriving after its tab unsubscribes', () => {
  const screen: string[] = [];
  const draw = (event: string, data: unknown) => { if (event === 'data') screen.push(String(data)); };
  const screenAt = { after: null as number | null };
  const leave = stream.subscribeTerminal('/sessions/chat', 'term', screenAt, draw);
  vi.advanceTimersByTime(20);
  sources[0]!.terminal('old', 3);
  leave();
  // The old HTTP stream stays open during the 20ms subscription coalescing window.
  sources[0]!.terminal('FINAL', 8);
  vi.advanceTimersByTime(20);
  stream.subscribeTerminal('/sessions/chat', 'term', screenAt, draw);
  vi.advanceTimersByTime(20);
  expect(screen).toEqual(['old']);
  // Asking for offset 8 instead loses FINAL forever on this still-mounted screen.
  expect(cursor()).toBe(3);
});

it('a fresh terminal remount still requests the backlog after a late old-stream frame', () => {
  const leave = stream.subscribeTerminal('/sessions/chat', 'term', { after: null }, () => {});
  vi.advanceTimersByTime(20);
  sources[0]!.terminal('old', 3);
  leave();
  stream.subscribeTerminal('/sessions/chat', 'term', { after: null }, () => {});
  sources[0]!.terminal('FINAL', 8);
  vi.advanceTimersByTime(20);
  // The new xterm has no old backlog. A cursor here permanently skips it.
  expect(cursor()).toBeNull();
});

it('releases the connection even when the page was already hidden at first mount', () => {
  doc.visibilityState = 'hidden';
  stream.subscribeGlobal(() => {});
  vi.advanceTimersByTime(10_000);
  expect(stream.connections).toBe(0);
});
