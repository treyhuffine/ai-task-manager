import type { ChatEventRecord } from '@/lib/api/dto/records';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionEvent } from './execution-event';

vi.mock('@/hooks/use-harness-connection', () => ({ useHarnessConnection: () => ({}), useRecheckHarnessConnection: () => ({}) }));
vi.mock('@/hooks/use-claude-login', () => ({ useClaudeLogin: () => ({}), useClaudeAuthStatus: () => ({}) }));
vi.mock('@/hooks/use-execution', () => ({ useSessionEvents: () => ({ data: [] }) }));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: {} }));
vi.mock('@/components/ai-elements/message', () => ({ Message: () => null, MessageContent: () => null, MessageResponse: () => null }));
// The view itself is tested with the real host. Here only which events become one matters.
vi.mock('@/components/mcp-apps/view', () => ({
  ConnectedView: ({ captureId }: { captureId: string }) => createElement('div', { 'data-tool-result': captureId }),
}));

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('a tool result in the transcript', () => {
  it.each([
    ['mcp_tool_result', 'written now'],
    ['mcp_app_result', 'written before October 20, 2026'],
  ])('opens its view from a %s marker (%s)', async (marker) => {
    const event = { id: 'result-1', sessionId: 'chat-1', source: 'system', role: 'system', content: marker, raw: null } as unknown as ChatEventRecord;
    await act(async () => root.render(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(ExecutionEvent, { event, sessionId: 'chat-1', isLatestUnresolved: false }))));
    expect(container.querySelector('[data-tool-result]')?.getAttribute('data-tool-result')).toBe('result-1');
  });
});
