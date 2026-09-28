/**
 * The page's one stream (P3 review): one connection whatever the page
 * follows, reconnected only when that changes, from where each left off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageStream } from './page-stream';

class FakeSource extends EventTarget {
  closed = false;
  onerror: ((e: Event) => void) | null = null;
  constructor(readonly url: string) {
    super();
  }
  close() {
    this.closed = true;
  }
  frame(event: string, data: unknown) {
    const e = new Event(event) as Event & { data: string };
    e.data = JSON.stringify(data);
    this.dispatchEvent(e);
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  set(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

let sources: FakeSource[];
let doc: FakeDocument;
let stream: PageStream;
const open = () => sources.filter((s) => !s.closed);
const sub = (source: FakeSource) => JSON.parse(new URL(source.url, 'http://x').searchParams.get('sub')!);

beforeEach(() => {
  vi.useFakeTimers();
  sources = [];
  doc = new FakeDocument();
  stream = new PageStream({ open: (url) => (sources.push(new FakeSource(url)), sources.at(-1)! as unknown as EventSource), document: doc as unknown as Document });
});
afterEach(() => vi.useRealTimers());

describe('one stream per page', () => {
  it('follows the dashboard, two chats and two terminals over one connection, each frame to its own', () => {
    const got: string[] = [];
    stream.subscribeGlobal((e) => got.push(`global ${e}`));
    stream.subscribeSession('chat-a', (e, d) => got.push(`a ${e} ${JSON.stringify(d)}`));
    stream.subscribeSession('chat-b', (e) => got.push(`b ${e}`));
    stream.subscribeTerminal('/sessions/chat-a', 't1', (e, d) => got.push(`t1 ${e} ${d}`), true);
    stream.subscribeTerminal('/sessions/chat-a', 't2', (e) => got.push(`t2 ${e}`), true);
    vi.advanceTimersByTime(50);
    expect(sources).toHaveLength(1);
    expect(stream.connections).toBe(1);
    expect(sub(sources[0]!)).toEqual({
      s: [['chat-a', null], ['chat-b', null]],
      t: [['/sessions/chat-a', 't1', null], ['/sessions/chat-a', 't2', null]],
    });
    const s = sources[0]!;
    s.frame('ready', {});
    s.frame('session', { s: 'chat-a', e: 'runtime', d: { running: true } });
    s.frame('terminal', { k: '/sessions/chat-a:t1', e: 'data', d: 'hello', i: '5' });
    expect(got).toEqual(['global ready', 'a runtime {"running":true}', 't1 data hello']);
  });

  it('reconnects only when what it follows changes, from where each left off', () => {
    stream.subscribeSession('chat', () => {});
    const hide = stream.subscribeTerminal('/sessions/chat', 't1', () => {}, true);
    vi.advanceTimersByTime(50);
    const first = sources[0]!;
    first.frame('session', { s: 'chat', e: 'chat_event', d: { id: 'ev-9' }, i: 'ev-9' });
    first.frame('terminal', { k: '/sessions/chat:t1', e: 'data', d: 'x', i: '42' });
    vi.advanceTimersByTime(50);
    expect(sources).toHaveLength(1);

    // The terminal tab is hidden, then shown again: it picks up at 42.
    hide();
    vi.advanceTimersByTime(50);
    expect(sources).toHaveLength(2);
    expect(sub(sources[1]!)).toEqual({ s: [['chat', 'ev-9']], t: [] });
    stream.subscribeTerminal('/sessions/chat', 't1', () => {}, false);
    vi.advanceTimersByTime(50);
    expect(sub(sources[2]!)).toEqual({ s: [['chat', 'ev-9']], t: [['/sessions/chat', 't1', 42]] });
    expect(open()).toEqual([sources[2]]);

    // A new screen for it starts from the whole backlog, even when its old
    // screen leaves in the same moment (a remount) and the set is as it was.
    stream.subscribeTerminal('/sessions/chat', 't1', () => {}, true);
    vi.advanceTimersByTime(50);
    expect(sources).toHaveLength(4);
    expect(sub(sources[3]!).t).toEqual([['/sessions/chat', 't1', null]]);
  });

  it('starts a chat fresh once nothing on the page follows it any more', () => {
    const leave = stream.subscribeSession('chat', () => {});
    vi.advanceTimersByTime(50);
    sources[0]!.frame('session', { s: 'chat', e: 'chat_event', d: {}, i: 'ev-1' });
    leave();
    vi.advanceTimersByTime(50);
    expect(stream.connections).toBe(0);
    stream.subscribeSession('chat', () => {});
    vi.advanceTimersByTime(50);
    expect(sub(sources.at(-1)!)).toEqual({ s: [['chat', null]], t: [] });
  });

  it('lets go of its connection while the page is hidden, and resumes when shown', () => {
    stream.subscribeGlobal(() => {});
    stream.subscribeSession('chat', () => {});
    vi.advanceTimersByTime(50);
    sources[0]!.frame('session', { s: 'chat', e: 'chat_event', d: {}, i: 'ev-3' });
    doc.set('hidden');
    vi.advanceTimersByTime(4_000);
    expect(stream.connections).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(stream.connections).toBe(0);
    doc.set('visible');
    expect(stream.connections).toBe(1);
    expect(sub(sources.at(-1)!)).toEqual({ s: [['chat', 'ev-3']], t: [] });
    // Back before the grace ran out: nothing was dropped.
    doc.set('hidden');
    vi.advanceTimersByTime(1_000);
    doc.set('visible');
    vi.advanceTimersByTime(10_000);
    expect(sources).toHaveLength(2);
  });

  it('reconnects itself after an error, with backoff, carrying the cursors as they are', () => {
    stream.subscribeSession('chat', () => {});
    vi.advanceTimersByTime(50);
    sources[0]!.frame('session', { s: 'chat', e: 'chat_event', d: {}, i: 'ev-7' });
    sources[0]!.fail();
    expect(sources[0]!.closed).toBe(true);
    expect(stream.connections).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(sub(sources[1]!)).toEqual({ s: [['chat', 'ev-7']], t: [] });
    sources[1]!.fail();
    vi.advanceTimersByTime(1_000);
    expect(sources).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(sources).toHaveLength(3);
  });

  it('holds no connection when nothing follows anything', () => {
    const leave = stream.subscribeGlobal(() => {});
    leave();
    vi.advanceTimersByTime(50);
    expect(sources).toHaveLength(0);
  });
});
