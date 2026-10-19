import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { useEmailDraft } from './use-email-draft';
import type { EmailDraft } from '@/db/types';

const rpc = vi.hoisted(() => ({ update: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { email: { update: { mutate: rpc.update }, get: { query: rpc.get } } } }));

const initial: EmailDraft = { version: 1, revision: 0, status: 'draft', connectionId: 'gmail', to: 'a@example.com', cc: '', bcc: '', subject: 'Initial subject', body: 'Initial body', error: null, sentAt: null, fromLabel: null, messageId: null };
let latest: ReturnType<typeof useEmailDraft>;
let root: Root;
let client: QueryClient;
let incoming: EmailDraft;
const storage = new Map<string, string>();

function Harness() {
  const editor = useEmailDraft('draft', 'chat', incoming);
  useEffect(() => { latest = editor; });
  return createElement('output', null, editor.draft.body);
}
async function render() {
  await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Harness))); });
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}

beforeEach(() => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  storage.clear();
  incoming = { ...initial };
  rpc.update.mockReset();
  rpc.get.mockReset().mockImplementation(async () => ({ id: 'draft', sessionId: 'chat', draft: incoming }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

describe('shared human and AI email editing', () => {
  it('serializes rapid typing, coalesces pending fields, and protects input until acknowledgement', async () => {
    const finishes: ((value: unknown) => void)[] = [];
    rpc.update.mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
    await render();
    await act(async () => latest.change({ body: 'First keystroke' }));
    await act(async () => { latest.change({ body: 'Final body' }); latest.change({ subject: 'New subject' }); });
    expect(rpc.update).toHaveBeenCalledTimes(1);
    expect(latest.draft.body).toBe('Final body');
    expect(client.isMutating({ predicate: mutation => mutation.meta?.carriesInput === true })).toBe(1);
    await act(async () => finishes[0]({ draft: { ...initial, revision: 1, body: 'First keystroke' } }));
    await settle();
    expect(rpc.update).toHaveBeenNthCalledWith(2, { id: 'draft', sessionId: 'chat', expectedRevision: 1, patch: { body: 'Final body', subject: 'New subject' } });
    expect(latest.draft.body).toBe('Final body');
    await act(async () => finishes[1]({ draft: { ...initial, revision: 2, body: 'Final body', subject: 'New subject' } }));
    await settle();
    expect(latest.hasEdits).toBe(false);
    expect(storage.size).toBe(0);
    expect(latest.draft).toMatchObject({ revision: 2, body: 'Final body', subject: 'New subject' });
  });

  it('shows AI edits immediately while retaining local typing and requiring conflict resolution', async () => {
    let reject!: (error: Error) => void;
    rpc.update.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await render();
    await act(async () => latest.change({ body: 'Human body' }));
    incoming = { ...initial, revision: 1, body: 'AI body', subject: 'AI subject' };
    await render();
    expect(latest.draft).toMatchObject({ body: 'Human body', subject: 'AI subject' });
    await act(async () => reject(new Error('This email changed')));
    await settle();
    expect(latest.conflict?.body).toBe('AI body');
    expect(latest.draft.body).toBe('Human body');
    await act(async () => latest.change({ body: 'Human body, continued' }));
    expect(rpc.update).toHaveBeenCalledTimes(1);
    await act(async () => latest.resolve(false));
    expect(latest.draft).toMatchObject({ revision: 1, body: 'AI body', subject: 'AI subject' });
    expect(latest.hasEdits).toBe(false);
  });

  it('keeps explicit human edits while preserving unrelated new AI fields', async () => {
    rpc.update.mockRejectedValueOnce(new Error('Conflict'));
    await render();
    incoming = { ...initial, revision: 1, body: 'AI body', subject: 'AI subject' };
    await act(async () => latest.change({ body: 'Human body' }));
    await settle();
    rpc.update.mockResolvedValueOnce({ draft: { ...incoming, revision: 2, body: 'Human body' } });
    await act(async () => latest.resolve(true));
    await settle();
    expect(rpc.update).toHaveBeenLastCalledWith({ id: 'draft', sessionId: 'chat', expectedRevision: 1, patch: { body: 'Human body' } });
    expect(latest.draft).toMatchObject({ subject: 'AI subject', body: 'Human body', revision: 2 });
  });

  it('recovers unsaved edits across remounts without silently overwriting a newer revision', async () => {
    rpc.update.mockRejectedValue(new Error('Offline'));
    await render();
    await act(async () => latest.change({ body: 'Retained input' }));
    await settle();
    expect(storage.size).toBe(1);
    await act(async () => root.unmount());
    root = createRoot(document.getElementById('root')!);
    incoming = { ...initial, revision: 1, body: 'AI update' };
    await render();
    expect(latest.draft.body).toBe('Retained input');
    expect(latest.conflict?.body).toBe('AI update');
    expect(rpc.update).toHaveBeenCalledTimes(1);
  });

  it('shows the actual sent contents when another viewer sends while local edits are unsaved', async () => {
    rpc.update.mockRejectedValue(new Error('Offline'));
    await render();
    await act(async () => latest.change({ body: 'Unsent local body' }));
    await settle();
    incoming = { ...initial, revision: 2, status: 'sent', body: 'Actually sent' };
    await render();
    expect(latest.draft.body).toBe('Actually sent');
    expect(latest.edits.body).toBe('Unsent local body');
    expect(latest.hasEdits).toBe(true);
  });
});
