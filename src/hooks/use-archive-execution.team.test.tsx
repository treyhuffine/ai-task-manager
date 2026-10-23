// Probe: the shared execution header/session menu archive hook inside a Team document (WorkContext, no DashboardProvider).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/file-icons', () => ({ fileIconUrl: () => '', folderIconUrl: () => '', iconForFile: () => '', iconForFolder: () => '' }));
import { WorkContext } from '@/contexts/work-context';
import { useArchiveExecution } from '@/hooks/use-archive-execution';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

const navigation = { openAgent: () => {}, openExecution: () => {}, openTask: () => {}, openNote: () => {}, goHome: () => {} };
const activity = { activeSessionId: null, streamingSessionIds: new Set<string>(), backgroundSessionIds: new Set<string>(), pendingInputSessionIds: new Set<string>(), setActiveExecutionId: () => {}, setSessionStreaming: () => {} };

function UsesArchive() { useArchiveExecution(); return createElement('span', null, 'ok'); }

it('useArchiveExecution renders inside the Team WorkContext', () => {
  const client = new QueryClient();
  let error: unknown = null;
  try {
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ConfirmProvider, null, createElement(WorkContext, { navigation, activity }, createElement(UsesArchive)))));
  } catch (e) { error = e; }
  // Expected for correct reuse: no error. Record the actual outcome.
  expect(String(error)).toBe('null');
});
