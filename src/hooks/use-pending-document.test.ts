import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { documentSaves } from '@/lib/client/document-saves';
import { optimisticPatch, rollbackOptimistic, type EntityRoot } from '@/lib/query/optimistic-entity';
import { useDocumentAutosave, usePendingDocument } from './use-document-autosave';

const notices = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: notices }));
let client: QueryClient;
let root: Root;
let container: HTMLDivElement;
let stored: Map<string, string>;
let fail: boolean;
let kind: EntityRoot;
let id: string;
let writer: Mock<(patch: Record<string, unknown>) => Promise<void>>;
const original = { id: 'one', title: 'Saved title', body: 'Saved body', name: 'Saved area', description: 'Saved description' };
const titleField = () => kind === 'areas' ? 'name' : 'title';
const bodyField = () => kind === 'areas' ? 'description' : 'body';

function Editor({ documentId }: { documentId: string }) {
  const { data: saved } = useQuery({ queryKey: [kind, documentId], queryFn: async () => original, enabled: false });
  const view = usePendingDocument(kind, documentId, saved);
  const autosave = useDocumentAutosave(kind, documentId, saved, async ({ id: entityId, ...patch }: { id: string } & Record<string, unknown>) => {
    const snapshot = await optimisticPatch(client, kind, entityId, patch);
    try { await writer(patch); } catch (error) { rollbackOptimistic(client, snapshot); throw error; }
  });
  // Props always synchronize this input, including after blur. Production's
  // real editor is also exercised by the desktop version recovery fixture.
  return createElement('div', null,
    createElement('input', { value: view?.[titleField()] ?? '', onChange: () => {}, onInput: (event: React.FormEvent<HTMLInputElement>) => autosave({ [titleField()]: event.currentTarget.value }) }),
    createElement('output', null, view?.[bodyField()] ?? ''),
  );
}
async function mount(documentId = id) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Editor, { documentId }))));
}
async function type(value: string) {
  await act(async () => {
    const input = container.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
const visible = () => container.querySelector('input')!.value;
beforeEach(() => {
  vi.useFakeTimers();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  stored = new Map();
  Object.assign(window, { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  fail = true; kind = 'notes'; id = 'one';
  writer = vi.fn(async () => { if (fail) throw new Error('API version changed (426)'); });
  notices.warning.mockClear(); notices.error.mockClear();
});
afterEach(async () => {
  fail = false; writer.mockImplementation(async () => {});
  await act(async () => { await documentSaves.flushAll(); root.unmount(); });
  client.clear(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each(['notes', 'tasks', 'areas'] as const)('keeps unsaved %s text visible after failed write, blur and refetch while the shared cache rolls back', async documentKind => {
  kind = documentKind; client.setQueryData([kind, id], original); await mount();
  await type('Unsaved edit');
  expect(visible()).toBe('Unsaved edit');
  await act(async () => { await expect(documentSaves.flush(`${kind}:${id}`)).rejects.toThrow('426'); });
  expect(client.getQueryData([kind, id])).toEqual(original);
  await act(async () => {
    container.querySelector('input')!.dispatchEvent(new window.Event('blur', { bubbles: true }));
    client.setQueryData([kind, id], { ...original, [titleField()]: 'Server title after refetch', [bodyField()]: 'New server detail' });
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(visible()).toBe('Unsaved edit');
  expect(container.querySelector('output')!.textContent).toBe('New server detail');
  expect((client.getQueryData([kind, id]) as typeof original)[titleField()]).toBe('Server title after refetch');
});

it('keeps newer typing ahead of a failed in-flight save and clears the overlay only after retry acknowledgement', async () => {
  client.setQueryData([kind, id], original); await mount();
  let reject!: (error: Error) => void;
  writer.mockImplementationOnce(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
  await type('First edit');
  let flushing!: Promise<void>;
  await act(async () => { flushing = documentSaves.flush(`${kind}:${id}`); });
  await type('Newer edit');
  await act(async () => {
    reject(new Error('API version changed (426)'));
    await expect(flushing).rejects.toThrow('426');
    client.setQueryData([kind, id], original); await vi.advanceTimersByTimeAsync(1);
  });
  expect(visible()).toBe('Newer edit'); expect(documentSaves.pendingPatch(`${kind}:${id}`)).toEqual({ title: 'Newer edit' });
  fail = false;
  await act(async () => { await documentSaves.flush(`${kind}:${id}`); await vi.advanceTimersByTimeAsync(1); });
  expect(visible()).toBe('Newer edit'); expect(documentSaves.pendingPatch(`${kind}:${id}`)).toBeUndefined();
  expect(writer.mock.calls.map(([patch]) => patch)).toEqual([{ title: 'First edit' }, { title: 'Newer edit' }]);
  await act(async () => { client.setQueryData([kind, id], { ...original, title: 'Later server edit' }); await vi.advanceTimersByTimeAsync(1); });
  expect(visible()).toBe('Later server edit');
});

it('shares active edits across editor remounts but never overlays another document or an older stored draft', async () => {
  client.setQueryData([kind, id], original); client.setQueryData([kind, 'two'], { ...original, id: 'two', title: 'Second note' }); await mount();
  await type('Current session edit');
  await mount('two'); expect(visible()).toBe('Second note');
  await mount(); expect(visible()).toBe('Current session edit');
  await act(async () => { fail = false; await documentSaves.flushAll(); });
  stored.set('ri:document-draft:v1:notes:two', JSON.stringify({ patch: { title: 'Older retained text' }, base: { title: 'Second note' } }));
  // A new editor mount exposes recovery, but the document remains the server
  // value until the user chooses Restore draft.
  await act(async () => root.render(createElement('div')));
  await mount('two'); expect(visible()).toBe('Second note');
  expect(notices.warning).toHaveBeenCalledOnce();
  await act(async () => notices.warning.mock.calls[0][1].action.onClick());
  expect(visible()).toBe('Older retained text');
});
