import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { expect, it, vi } from 'vitest';
import { trpc } from '@/lib/trpc/client';
import { LifecycleGuardProvider, useLifecycleGuard } from './lifecycle-guard';
const complete = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/api/tasks', () => ({ tasksApi: { complete } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
it('the mounted lifecycle guard invalidates typed workbench chips and review context', async () => {
  const { window, document } = parseHTML('<html><body></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const qc = new QueryClient();
  const chips = trpc.executions.tasksGet.queryKey({ params: { id: 'execution' } });
  const review = trpc.executions.reviewContextGet.queryKey({ params: { id: 'execution' } });
  qc.setQueryData<unknown>(chips as readonly unknown[], []); qc.setQueryData<unknown>(review as readonly unknown[], {});
  let guard: ReturnType<typeof useLifecycleGuard> | undefined;
  function Controls() { const value = useLifecycleGuard(); useEffect(() => { guard = value; }, [value]); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => { root.render(<QueryClientProvider client={qc}><LifecycleGuardProvider><Controls /></LifecycleGuardProvider></QueryClientProvider>); });
    await act(async () => { expect(await guard!.resolve({ taskId: 'task', command: 'complete' })).toBe(true); });
    expect(complete).toHaveBeenCalledOnce();
    expect(qc.getQueryState(chips)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(review)?.isInvalidated).toBe(true);
  } finally { await act(async () => root.unmount()); qc.clear(); vi.unstubAllGlobals(); }
});
