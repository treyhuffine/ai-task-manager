/**
 * Opening a chat is its read receipt, however it was opened. It used to lean on
 * the composer taking focus, and a chat opened from the header's Unread popover
 * never got focus, so it stayed unread while it was open. A tab nobody is looking
 * at holds the receipt, or every restart would read each chat left open in one.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReadOnOpen } from './use-workspaces';

const markRead = vi.hoisted(() => vi.fn(async (id: string) => ({ id })));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: { markRead } }));

let root: Root;
let client: QueryClient;
let visibility: DocumentVisibilityState;
let setVisibility: (next: DocumentVisibilityState) => Promise<void>;

function Harness({ chatId }: { chatId: string }) {
  useReadOnOpen(chatId);
  return null;
}

const show = (chatId: string) => act(async () => {
  root.render(createElement(QueryClientProvider, { client }, createElement(Harness, { chatId })));
});

beforeEach(() => {
  const { window, document, Event } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  setVisibility = (next) => act(async () => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  markRead.mockClear();
  client = new QueryClient();
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  // A settling mutation tells React on a timer, which must fire while `window` exists.
  const nextTimer = () => new Promise((resolve) => setTimeout(resolve, 0));
  await act(async () => {
    while (client.isMutating() > 0) await nextTimer();
    await nextTimer();
  });
  await act(async () => root.unmount());
  await nextTimer();
  client.clear();
  vi.unstubAllGlobals();
});

it('reads the chat when it opens, with no composer to take focus', async () => {
  await show('chat-a');
  expect(markRead.mock.calls).toEqual([['chat-a']]);
});

it('reads each chat you move to, and only once while one stays open', async () => {
  await show('chat-a');
  await show('chat-a');
  await show('chat-b');
  expect(markRead.mock.calls).toEqual([['chat-a'], ['chat-b']]);
});

it('holds the read in a tab nobody is looking at, and sends it when you come to the tab', async () => {
  visibility = 'hidden';
  await show('chat-a');
  expect(markRead).not.toHaveBeenCalled();
  await setVisibility('visible');
  expect(markRead.mock.calls).toEqual([['chat-a']]);
});

it("doesn't read a chat the hidden tab moved on from", async () => {
  visibility = 'hidden';
  await show('chat-a');
  await show('chat-b');
  await setVisibility('visible');
  expect(markRead.mock.calls).toEqual([['chat-b']]);
});

it('reads once, whatever the tab does afterwards', async () => {
  await show('chat-a');
  await setVisibility('hidden');
  await setVisibility('visible');
  expect(markRead.mock.calls).toEqual([['chat-a']]);

  markRead.mockClear();
  visibility = 'hidden';
  await show('chat-b');
  await setVisibility('visible');
  await setVisibility('hidden');
  await setVisibility('visible');
  expect(markRead.mock.calls).toEqual([['chat-b']]);
});

it('sends nothing without a chat', async () => {
  await show('');
  expect(markRead).not.toHaveBeenCalled();
});

it('reads optimistically, so the row and the count clear on the click', async () => {
  client.setQueryData(['sessions', 'rail'], { sessions: [{ id: 'chat-a', lastViewedAt: null, unreadMarkerAt: '2026-11-05T10:00:00.000Z' }] });
  client.setQueryData(['sessions', 'needs-review'], [{ id: 'chat-a' }, { id: 'chat-b' }]);
  await show('chat-a');
  const rail = client.getQueryData<{ sessions: { lastViewedAt: string | null; unreadMarkerAt: string | null }[] }>(['sessions', 'rail'])!;
  expect(rail.sessions[0]!.lastViewedAt).not.toBeNull();
  expect(rail.sessions[0]!.unreadMarkerAt).toBeNull();
  expect(client.getQueryData(['sessions', 'needs-review'])).toEqual([{ id: 'chat-b' }]);
});
