/**
 * An unread chat stays unread while it's open. Leaving it reads it, and so does
 * engaging with it, but output that landed during the visit stays unread, and a
 * tab nobody is looking at reads nothing.
 */
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useReadOnEngage, useReadOnLeave } from './use-workspaces';

const markRead = vi.hoisted(() => vi.fn(async (id: string) => ({ id })));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: { markRead } }));

const RAIL = ['sessions', 'rail'];
const VIEWED = '2026-11-06T10:00:00.000Z';
const OUTPUT = '2026-11-06T11:00:00.000Z';
const LATER = '2026-11-06T12:00:00.000Z';
const unread = (id: string) => ({ id, lastOutcomeEventAt: OUTPUT, unreadMarkerAt: null, lastViewedAt: VIEWED });
const read = (id: string) => ({ id, lastOutcomeEventAt: VIEWED, unreadMarkerAt: null, lastViewedAt: OUTPUT });

let root: Root;
let client: QueryClient;
let visibility: DocumentVisibilityState;
let engage: () => void;

function Leave({ chatId }: { chatId: string }) {
  useReadOnLeave(chatId);
  return null;
}

function Engage({ chatId }: { chatId: string }) {
  const onEngage = useReadOnEngage(chatId);
  useEffect(() => {
    engage = onEngage;
  }, [onEngage]);
  return null;
}

const render = (child: ReturnType<typeof createElement> | null) => act(async () => {
  root.render(createElement(QueryClientProvider, { client }, child));
});
const enter = (chatId: string) => render(createElement(Leave, { chatId }));
const leave = () => render(null);

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
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

it('leaves an unread chat unread while it is open, and reads it when you leave', async () => {
  client.setQueryData(RAIL, { sessions: [unread('chat-a')] });
  await enter('chat-a');
  expect(markRead).not.toHaveBeenCalled();
  await leave();
  expect(markRead.mock.calls).toEqual([['chat-a']]);
});

it('reads the chat you left when you move to another, and not the new one', async () => {
  client.setQueryData(RAIL, { sessions: [unread('chat-a'), unread('chat-b')] });
  await enter('chat-a');
  await enter('chat-b');
  expect(markRead.mock.calls).toEqual([['chat-a']]);
});

it('keeps output that landed during the visit unread', async () => {
  client.setQueryData(RAIL, { sessions: [unread('chat-a')] });
  await enter('chat-a');
  client.setQueryData(RAIL, { sessions: [{ ...unread('chat-a'), lastOutcomeEventAt: LATER }] });
  await leave();
  expect(markRead).not.toHaveBeenCalled();
});

it('has nothing to read in a chat that was read when you came, even one you mark unread there', async () => {
  client.setQueryData(RAIL, { sessions: [read('chat-a')] });
  await enter('chat-a');
  client.setQueryData(RAIL, { sessions: [{ ...read('chat-a'), unreadMarkerAt: LATER }] });
  await leave();
  expect(markRead).not.toHaveBeenCalled();
});

it('sends nothing on leaving a chat you already read by engaging', async () => {
  client.setQueryData(RAIL, { sessions: [unread('chat-a')] });
  await enter('chat-a');
  client.setQueryData(RAIL, { sessions: [read('chat-a')] });
  await leave();
  expect(markRead).not.toHaveBeenCalled();
});

it('reads a sibling chat the rail has no row for, from its own record', async () => {
  client.setQueryData(RAIL, { sessions: [read('newest-chat')] });
  client.setQueryData(['session', 'older-chat'], unread('older-chat'));
  await enter('older-chat');
  await leave();
  expect(markRead.mock.calls).toEqual([['older-chat']]);
});

it('reads nothing when a tab nobody is looking at unmounts the chat', async () => {
  client.setQueryData(RAIL, { sessions: [unread('chat-a')] });
  await enter('chat-a');
  visibility = 'hidden';
  await leave();
  expect(markRead).not.toHaveBeenCalled();
});

it('marks the rail read as you leave, so the row and the count clear on the click', async () => {
  client.setQueryData(RAIL, { sessions: [unread('chat-a')] });
  client.setQueryData(['sessions', 'needs-review'], [{ id: 'chat-a' }, { id: 'chat-b' }]);
  await enter('chat-a');
  await leave();
  const rail = client.getQueryData<{ sessions: { lastViewedAt: string | null }[] }>(RAIL)!;
  expect(rail.sessions[0]!.lastViewedAt).not.toBe(VIEWED);
  expect(client.getQueryData(['sessions', 'needs-review'])).toEqual([{ id: 'chat-b' }]);
});

it('reads on engaging, once however many keystrokes follow', async () => {
  client.setQueryData(RAIL, { sessions: [unread('chat-a')] });
  await render(createElement(Engage, { chatId: 'chat-a' }));
  expect(markRead).not.toHaveBeenCalled();
  await act(async () => { engage(); engage(); engage(); });
  expect(markRead.mock.calls).toEqual([['chat-a']]);
});

it('sends nothing on engaging with a chat that is already read', async () => {
  client.setQueryData(RAIL, { sessions: [read('chat-a')] });
  await render(createElement(Engage, { chatId: 'chat-a' }));
  await act(async () => { engage(); });
  expect(markRead).not.toHaveBeenCalled();
});
