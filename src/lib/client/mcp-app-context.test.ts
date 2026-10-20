import { describe, expect, it, vi } from 'vitest';
import { registerConnectedContext, selectConnectedContext, flushConnectedContext, visibleToPerson, visibleContextItems, connectedContextGroups, setConnectedContextContent, subscribeConnectedContext, connectedContextVersion, globalContextViewId, setConnectedContextAccess, noteSkippedContext } from './mcp-app-context';

it('attaches only the selected acknowledged view in the exact receiving chat', async () => {
  const a=registerConnectedContext('chat-a','view-a',async()=>({viewId:'view-a',revision:2}));
  const b=registerConnectedContext('chat-a','view-b',async()=>({viewId:'view-b',revision:3}));
  expect(await flushConnectedContext('chat-a')).toEqual([]);
  selectConnectedContext('chat-a','view-a'); expect(await flushConnectedContext('chat-a')).toEqual([{viewId:'view-a',revision:2}]);
  expect(await flushConnectedContext('chat-b')).toEqual([]);
  selectConnectedContext('chat-a','view-b'); expect(await flushConnectedContext('chat-a')).toEqual([{viewId:'view-b',revision:3}]);
  b(); expect(await flushConnectedContext('chat-a')).toEqual([]); a();
});
it('waits for context acknowledgement and propagates a failure to the send flow', async () => {
  let acknowledge!: () => void;
  const waiting = new Promise<void>(resolve=>{acknowledge=resolve;});
  const cleanup=registerConnectedContext('chat-c','view-c',async()=>{await waiting;return {viewId:'view-c',revision:4};});
  selectConnectedContext('chat-c','view-c');let finished=false;
  const flush=flushConnectedContext('chat-c').then(value=>{finished=true;return value;});
  await Promise.resolve(); expect(finished).toBe(false); acknowledge(); expect(await flush).toEqual([{viewId:'view-c',revision:4}]); cleanup();
  const failed=registerConnectedContext('chat-c','view-c',async()=>{throw new Error('Access changed');});
  selectConnectedContext('chat-c','view-c'); await expect(flushConnectedContext('chat-c')).rejects.toThrow('Access changed');failed();
});

describe('what apps attached, as the composer shows it', () => {
  const bolt = { type: 'text', text: 'Selected: M6 hex bolt', _meta: { 'openai/title': 'M6 hex bolt', 'openai/thumbnail': { src: 'https://example.com/bolt.png' } } };
  const hidden = { type: 'text', text: 'Viewer camera: isometric', annotations: { audience: ['assistant'] } };
  const both = { type: 'text', text: 'Shared with both', annotations: { audience: ['user', 'assistant'] } };

  it('shows titled, thumbnailed, image and link items and hides blocks for the assistant alone', () => {
    expect(visibleToPerson(hidden)).toBe(false);
    expect(visibleToPerson(both)).toBe(true);
    expect(visibleContextItems([bolt, hidden, both,
      { type: 'image', data: 'AAAA', mimeType: 'image/png', _meta: { 'openai/title': 'Front view' } },
      { type: 'image', data: 'AAAA', mimeType: 'text/html' },
      { type: 'resource_link', uri: 'cad://parts/washer', name: 'washer.stl', title: 'M6 washer' },
      { type: 'resource', resource: { uri: 'cad://parts/nut', text: '# Nut' } },
      { type: 'text', text: 'Unsafe', _meta: { 'openai/thumbnail': { src: 'javascript:alert(1)' } } },
    ])).toEqual([
      { kind: 'text', title: 'M6 hex bolt', text: 'Selected: M6 hex bolt', thumbnail: { src: 'https://example.com/bolt.png' } },
      { kind: 'text', text: 'Shared with both' },
      { kind: 'image', title: 'Front view', src: 'data:image/png;base64,AAAA' },
      { kind: 'link', title: 'M6 washer', uri: 'cad://parts/washer' },
      { kind: 'resource', title: 'cad://parts/nut', uri: 'cad://parts/nut', text: '# Nut' },
      { kind: 'text', text: 'Unsafe' },
    ]);
  });

  it('groups the chat\'s view and the global screen, each removable, and never an assistant-only group', async () => {
    const clearChat = vi.fn(async () => {}), clearScreen = vi.fn(async () => {});
    const offChat = registerConnectedContext('chat-g', 'view-chat', async () => ({ viewId: 'view-chat', revision: 1 }), { app: 'Bits & Bolts', clear: clearChat, content: [bolt] });
    const offScreen = registerConnectedContext(null, 'view-screen', async () => ({ viewId: 'view-screen', revision: 4 }), { app: 'Parts Library', clear: clearScreen, content: [hidden] });
    selectConnectedContext('chat-g', 'view-chat');
    selectConnectedContext(null, 'view-screen');
    // The screen goes with a chat's messages only once the home says that chat may use its account.
    expect(globalContextViewId()).toBe('view-screen');
    expect(await flushConnectedContext('chat-g')).toEqual([{ viewId: 'view-chat', revision: 1 }]);
    setConnectedContextAccess('chat-g', { 'view-screen': true });
    setConnectedContextAccess('chat-other', { 'view-screen': true });
    // The screen attached only assistant context: it is sent, but there is nothing to show.
    expect(connectedContextGroups('chat-g').map(group => group.app)).toEqual(['Bits & Bolts']);
    expect(await flushConnectedContext('chat-g')).toEqual([{ viewId: 'view-chat', revision: 1 }, { viewId: 'view-screen', revision: 4 }]);
    // Another chat gets only the global screen's.
    expect(await flushConnectedContext('chat-other')).toEqual([{ viewId: 'view-screen', revision: 4 }]);
    setConnectedContextContent(null, 'view-screen', [both]);
    const groups = connectedContextGroups('chat-g');
    expect(groups.map(group => group.app)).toEqual(['Bits & Bolts', 'Parts Library']);
    await groups[1]!.remove();
    expect(clearScreen).toHaveBeenCalledOnce();
    expect(clearChat).not.toHaveBeenCalled();
    setConnectedContextContent(null, 'view-screen', null);
    expect(connectedContextGroups('chat-g').map(group => group.app)).toEqual(['Bits & Bolts']);
    offChat(); offScreen();
    expect(connectedContextGroups('chat-g')).toEqual([]);
  });

  it('neither shows nor sends a global screen\'s context in a chat that may not use its account, and says when one was left off', async () => {
    const off = registerConnectedContext(null, 'view-global', async () => ({ viewId: 'view-global', revision: 2 }), { app: 'Parts Library', clear: async () => {}, content: [bolt] });
    selectConnectedContext(null, 'view-global');
    setConnectedContextAccess('chat-main', { 'view-global': true });
    setConnectedContextAccess('chat-agent', { 'view-global': false });
    expect(connectedContextGroups('chat-main').map(group => group.app)).toEqual(['Parts Library']);
    expect(connectedContextGroups('chat-agent')).toEqual([]);
    expect(await flushConnectedContext('chat-agent')).toEqual([]);
    // Unasked yet: not shown, not sent. Outside any chat it still shows.
    expect(connectedContextGroups('chat-new')).toEqual([]);
    expect(await flushConnectedContext('chat-new')).toEqual([]);
    expect(connectedContextGroups(null).map(group => group.app)).toEqual(['Parts Library']);
    // Access changed between asking and sending: the home left it off, the notice says so, and it stops showing.
    expect(noteSkippedContext('chat-main', [{ viewId: 'view-global', app: 'Parts Library', reason: 'This chat can\'t use that account.' }]))
      .toBe('Parts Library context wasn\'t sent with this message. This chat can\'t use that account.');
    expect(connectedContextGroups('chat-main')).toEqual([]);
    expect(noteSkippedContext('chat-main', undefined)).toBeNull();
    expect(noteSkippedContext('chat-main', [])).toBeNull();
    off();
  });

  it('tells subscribers about every change', () => {
    const listener = vi.fn();
    const off = subscribeConnectedContext(listener);
    const before = connectedContextVersion();
    const unregister = registerConnectedContext('chat-s', 'view-s', async () => undefined);
    selectConnectedContext('chat-s', 'view-s');
    unregister();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(connectedContextVersion()).toBe(before + 3);
    off();
  });
});
