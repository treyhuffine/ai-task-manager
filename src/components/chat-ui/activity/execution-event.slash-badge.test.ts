import type { ChatEventRecord } from '@/lib/api/dto/records';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionEvent } from './execution-event';

vi.mock('@/hooks/use-slash-commands', () => ({
  useSlashCommands: (sessionId: string | null | undefined) => ({
    data: sessionId
      ? {
          commands: [
            {
              id: 'review',
              name: 'review',
              description: 'Review the diff',
              source: 'installed-user',
              userInvocable: true,
              available: true,
              execution: { kind: 'provider-slash', provider: 'claude', commandText: '/review' },
            },
          ],
          diagnostics: [],
          inventorySource: 'none',
        }
      : undefined,
  }),
}));

vi.mock('@/components/ui/tip', () => ({ Tip: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/ai-elements/message', () => ({
  Message: ({ children }: { children: ReactNode }) => createElement('div', { 'data-testid': 'message' }, children),
  MessageContent: ({ children }: { children: ReactNode }) => createElement('div', { 'data-testid': 'message-content' }, children),
  MessageResponse: () => null,
}));
vi.mock('@/components/chat-ui/messages/copy-message-button', () => ({ CopyMessageButton: () => null }));

let root: Root;
let container: HTMLElement;
let client: QueryClient;

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

async function renderUserMessage(content: string) {
  const event = {
    id: 'msg-1',
    sessionId: 'chat-1',
    role: 'user',
    source: 'user',
    content,
    attachments: [],
    createdAt: '2026-11-16T09:00:00Z',
  } as unknown as ChatEventRecord;
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ExecutionEvent, { event, sessionId: 'chat-1' }),
      ),
    );
  });
}

describe('ExecutionEvent slash command badge', () => {
  it('renders a badge for a recognized leading slash command', async () => {
    await renderUserMessage('/review fix the login flow');
    const badge = container.querySelector('[data-slash-command="review"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('/review');
    expect(container.textContent).toContain('fix the login flow');
  });

  it('does not badge unknown slash paths or mid-sentence slashes', async () => {
    await renderUserMessage('/tmp/file.txt');
    expect(container.querySelector('[data-slash-command]')).toBeNull();

    await renderUserMessage('please run /review here');
    expect(container.querySelector('[data-slash-command]')).toBeNull();
  });
});
