import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import { useRuntimeStatus } from './use-execution';
import { useSessionStream } from './use-session-stream';
const h = vi.hoisted(() => ({ closeUnconfirmed: false, receive: undefined as undefined | ((kind: string, frame: unknown) => void) }));
vi.mock('@/lib/realtime/page-stream', () => ({ pageStream: () => ({ subscribeSession: (_id: string, receive: typeof h.receive) => { h.receive = receive; return () => {}; } }) }));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: { runtimeStatus: async () => ({ running: false, backgroundTasks: false, backgroundTaskIds: [], ...(h.closeUnconfirmed ? { closeUnconfirmed: true } : {}) }) } }));
let root: Root | undefined, client: QueryClient;
afterEach(async () => {
  await act(async () => { root?.unmount(); client?.clear(); });
  notifyManager.setScheduler(cb => setTimeout(cb, 0)); vi.unstubAllGlobals();
});
it('an idle runtime frame refreshes the close flag even though running does not change', async () => {
  const { window, document } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  notifyManager.setScheduler(queueMicrotask); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Viewer() { useSessionStream('chat'); const runtime = useRuntimeStatus('chat'); return createElement('span', null, runtime.data?.closeUnconfirmed ? 'Restart needed' : 'Ready'); }
  const container = document.createElement('div'); root = createRoot(container);
  await act(async () => { root!.render(createElement(QueryClientProvider, { client }, createElement(Viewer))); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(container.textContent).toBe('Ready');
  h.closeUnconfirmed = true;
  await act(async () => { h.receive!('runtime', { running: false }); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(container.textContent).toBe('Restart needed');
  h.closeUnconfirmed = false;
  await act(async () => { h.receive!('runtime', { running: false }); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(container.textContent).toBe('Ready');
});
