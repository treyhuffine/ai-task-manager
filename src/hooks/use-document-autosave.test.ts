import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { DocumentSaveQueue, documentSaves } from '@/lib/client/document-saves';
import { useDocumentAutosave } from './use-document-autosave';

const notices = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: notices }));

let root: Root | undefined;
let stored: Map<string, string>;
let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let cleanupAllowed: boolean;
const writer = vi.fn(async () => {});

function Harness() {
  useDocumentAutosave('notes', 'review-note', { body: 'original' }, writer);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  stored = new Map();
  cleanupAllowed = true;
  storage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, value); },
    removeItem: key => {
      if (!cleanupAllowed) throw new Error('storage cleanup denied');
      stored.delete(key);
    },
  };
  Object.assign(window, { localStorage: storage, location: new URL('http://127.0.0.1/') });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  notices.warning.mockClear();
  notices.error.mockClear();
  writer.mockClear();
});
afterEach(async () => {
  cleanupAllowed = true;
  await act(async () => root?.unmount());
  await documentSaves.flushAll();
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Harness)));
}

it('does not silently replay a stale draft after an acknowledged write and denied cleanup', async () => {
  const previousSession = new DocumentSaveQueue(() => storage);
  previousSession.schedule('notes:review-note', { body: 'older draft' }, { body: 'original' }, async () => {});
  cleanupAllowed = false;
  await previousSession.flushAll();
  expect(previousSession.has()).toBe(false);
  expect(previousSession.draft('notes:review-note')).not.toBeNull();
  // Another client can subsequently restore the original body. Field equality
  // with the draft base must not be interpreted as permission to overwrite it.
  cleanupAllowed = true;
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(writer).not.toHaveBeenCalled();
  expect(notices.warning).toHaveBeenCalledOnce();
  const options = notices.warning.mock.calls[0][1];
  expect(options.action.label).toBe('Restore draft');
  expect(options.cancel.label).toBe('Discard draft');
  await act(async () => options.action.onClick());
  await act(async () => { await documentSaves.flushAll(); });
  expect(writer).toHaveBeenCalledExactlyOnceWith({ id: 'review-note', body: 'older draft' });
  expect(stored.size).toBe(0);
});

it('discards a retained draft only when the user chooses it', async () => {
  storage.setItem('ri:document-draft:v1:notes:review-note', JSON.stringify({ patch: { body: 'draft' }, base: { body: 'original' } }));
  await mount();
  expect(stored.size).toBe(1);
  notices.warning.mock.calls[0][1].cancel.onClick();
  expect(stored.size).toBe(0);
  expect(writer).not.toHaveBeenCalled();
});

it('reports a denied discard without losing the retained draft', async () => {
  storage.setItem('ri:document-draft:v1:notes:review-note', JSON.stringify({ patch: { body: 'draft' }, base: { body: 'original' } }));
  await mount();
  cleanupAllowed = false;
  expect(() => notices.warning.mock.calls[0][1].cancel.onClick()).not.toThrow();
  expect(stored.size).toBe(1);
  expect(writer).not.toHaveBeenCalled();
  expect(notices.error).toHaveBeenCalledWith('Could not discard the retained draft. It was left in storage.');
});

it('retires an explicitly restored personal legacy draft only after the scoped write is acknowledged', async () => {
  Object.assign(document.documentElement.dataset, { riAuthority: 'personal', riHome: 'personal-home', riViewer: 'local' });
  const legacyKey = 'ri:document-draft:v1:notes:review-note';
  storage.setItem(legacyKey, JSON.stringify({ patch: { body: 'draft' }, base: { body: 'original' } }));
  let acknowledge!: () => void;
  writer.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
  await mount();
  expect(writer).not.toHaveBeenCalled();
  await act(async () => notices.warning.mock.calls[0][1].action.onClick());
  const pending = documentSaves.flushAll();
  expect(stored.has(legacyKey)).toBe(true);
  expect(stored.size).toBe(2);
  await act(async () => { acknowledge(); await pending; });
  expect(stored.size).toBe(0);
  expect(writer).toHaveBeenCalledExactlyOnceWith({ id: 'review-note', body: 'draft' });
});

it('never offers an unscoped legacy draft to a team member with the same record id', async () => {
  Object.assign(document.documentElement.dataset, { riAuthority: 'team', riHome: 'team-home', riViewer: 'new-member' });
  const legacyKey = 'ri:document-draft:v1:notes:review-note';
  storage.setItem(legacyKey, JSON.stringify({ patch: { body: 'private legacy draft' }, base: { body: 'original' } }));
  await mount();
  expect(notices.warning).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
  expect(stored.has(legacyKey)).toBe(true);
});

it('keeps a pending draft with its original member when a cookie-only document identity changes', async () => {
  Object.assign(document.documentElement.dataset, { riAuthority: 'team', riHome: 'team-home', riViewer: 'original-member' });
  let edit!: (patch: { body: string }) => void;
  function Capture() {
    const save = useDocumentAutosave<{ id: string; body: string }>('notes', 'review-note', { body: 'original' }, writer);
    useEffect(() => { edit = save; }, [save]); return null;
  }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Capture)));
  await act(async () => edit({ body: 'Original member draft' }));
  document.documentElement.dataset.riViewer = 'replacement-member';
  await expect(documentSaves.flushAll()).rejects.toThrow();
  expect(writer).not.toHaveBeenCalled();
  expect([...stored.entries()]).toEqual([[expect.stringContaining('original-member'), expect.stringContaining('Original member draft')]]);
  // Only the original author can explicitly retry this pending session.
  document.documentElement.dataset.riViewer = 'original-member';
  await act(async () => documentSaves.flushAll());
  expect(writer).toHaveBeenCalledExactlyOnceWith({ id: 'review-note', body: 'Original member draft' });
});
