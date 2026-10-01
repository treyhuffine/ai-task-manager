import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import type { ChatEventRecord } from '@/db/types';
import { ExecutionEvent } from './execution-event';

const fixtures = vi.hoisted(() => ({
  connection: { connection: { connected: false }, isLoading: false },
  recheck: { isSuccess: false, isPending: false, isError: false, variables: undefined as string | undefined, mutate: vi.fn() },
  claudeLogin: { isPending: false, error: null, mutate: vi.fn() },
  claudeStatus: { data: { loggedIn: false } },
  useConnection: vi.fn(),
  useClaudeLogin: vi.fn(),
  useClaudeStatus: vi.fn(),
  sendMessage: vi.fn(async () => ({})),
}));

vi.mock('@/hooks/use-harness-connection', () => ({
  useHarnessConnection: (...args: unknown[]) => {
    fixtures.useConnection(...args);
    return fixtures.connection;
  },
  useRecheckHarnessConnection: () => fixtures.recheck,
}));
vi.mock('@/hooks/use-claude-login', () => ({
  useClaudeLogin: () => {
    fixtures.useClaudeLogin();
    return fixtures.claudeLogin;
  },
  useClaudeAuthStatus: () => {
    fixtures.useClaudeStatus();
    return fixtures.claudeStatus;
  },
}));
vi.mock('@/hooks/use-execution', () => ({
  useSessionEvents: () => ({ data: [{ id: 'message-1', source: 'user', content: 'Continue the review', attachments: [] }] }),
}));
vi.mock('@/lib/api/sessions', () => ({ sessionsApi: { sendMessage: fixtures.sendMessage } }));
// Markdown rendering is unrelated to the auth_required branch, and imports
// browser-only syntax highlighting that this transcript test never renders.
vi.mock('@/components/ai-elements/message', () => ({
  Message: () => null, MessageContent: () => null, MessageResponse: () => null,
}));

let root: Root;
let container: HTMLElement;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.connection.connection.connected = false;
  fixtures.connection.isLoading = false;
  Object.assign(fixtures.recheck, { isSuccess: false, isPending: false, isError: false, variables: undefined });
  fixtures.claudeStatus.data.loggedIn = false;
  fixtures.claudeLogin.isPending = false;
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

async function renderAuth(providerType?: string, isLatestUnresolved = true) {
  const event = {
    id: 'auth-failure', source: 'auth_required', content: 'Please sign in',
    toolInput: { providerType, reason: 'expired' },
  } as ChatEventRecord;
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(ExecutionEvent, { event, sessionId: 'chat-1', isLatestUnresolved }),
  )));
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((element) => element.textContent === label);
}

async function click(label: string) {
  const target = button(label);
  expect(target, `Expected a ${label} button`).toBeDefined();
  await act(async () => target!.click());
}

describe('provider-aware auth_required transcript recovery', () => {
  it.each([
    ['antigravity', 'Antigravity', 'agy'],
    ['codex', 'Codex', 'codex login'],
  ])('uses %s sign-in instructions and checks that harness', async (harness, name, command) => {
    await renderAuth(harness);
    expect(container.textContent).toContain(`${name} needs you to sign in`);
    expect(container.querySelector('code')?.textContent).toBe(command);
    expect(button('Log in')).toBeUndefined();
    expect(fixtures.useClaudeLogin).not.toHaveBeenCalled();
    expect(fixtures.useClaudeStatus).not.toHaveBeenCalled();
    expect(fixtures.useConnection).toHaveBeenCalledWith(harness, true);
    await click('Check again');
    expect(fixtures.recheck.mutate).toHaveBeenCalledExactlyOnceWith(harness);
  });

  it('requires a fresh check of this harness before treating cached credentials as restored', async () => {
    fixtures.connection.connection.connected = true;
    await renderAuth('antigravity');
    expect(container.textContent).toContain('Antigravity needs you to sign in');
    expect(button('Resend')).toBeUndefined();

    // A successful check left by another harness must not dismiss this failure.
    Object.assign(fixtures.recheck, { isSuccess: true, variables: 'codex' });
    await renderAuth('antigravity');
    expect(button('Check again')).toBeDefined();
    expect(button('Resend')).toBeUndefined();

    fixtures.recheck.variables = 'antigravity';
    await renderAuth('antigravity');
    expect(container.textContent).toContain('Authentication restored');
    expect(button('Check again')).toBeUndefined();
    await click('Resend');
    expect(fixtures.sendMessage).toHaveBeenCalledExactlyOnceWith('chat-1', 'Continue the review', { attachments: [] });
  });

  it('does not restore auth when a fresh check still reports disconnected or is loading', async () => {
    Object.assign(fixtures.recheck, { isSuccess: true, variables: 'antigravity' });
    await renderAuth('antigravity');
    expect(button('Check again')).toBeDefined();
    expect(button('Resend')).toBeUndefined();

    fixtures.connection.connection.connected = true;
    fixtures.connection.isLoading = true;
    await renderAuth('antigravity');
    expect(button('Check again')).toBeDefined();
    expect(button('Resend')).toBeUndefined();
  });

  it.each(['claude', undefined])('preserves the Claude login action for provider %s', async (harness) => {
    await renderAuth(harness);
    expect(container.textContent).toContain('Claude needs to log in again');
    expect(container.textContent).toContain('Your access token expired.');
    expect(button('Check again')).toBeUndefined();
    expect(fixtures.useConnection).not.toHaveBeenCalled();
    await click('Log in');
    expect(fixtures.claudeLogin.mutate).toHaveBeenCalledOnce();
  });

  it('keeps Claude recovery after its existing login status probe', async () => {
    fixtures.claudeStatus.data.loggedIn = true;
    await renderAuth('claude');
    expect(container.textContent).toContain('Authentication restored');
    expect(button('Resend')).toBeDefined();
    expect(fixtures.useConnection).not.toHaveBeenCalled();
    expect(fixtures.recheck.mutate).not.toHaveBeenCalled();
  });

  it('keeps resolved Antigravity auth failures as history without login actions or probes', async () => {
    await renderAuth('antigravity', false);
    expect(container.textContent).toContain('Logged in to Antigravity');
    expect(container.querySelector('button')).toBeNull();
    expect(fixtures.useConnection).not.toHaveBeenCalled();
    expect(fixtures.useClaudeLogin).not.toHaveBeenCalled();
  });
});
