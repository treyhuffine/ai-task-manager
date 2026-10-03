import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { MainChatOnboarding } from './main-chat-onboarding';

const fixtures = vi.hoisted(() => ({
  state: {
    name: 'Trey', description: 'Existing description', onboardedAt: null,
    orchestratorIntroducedAt: null,
    defaultHarness: 'claude' as string | null,
    defaultModel: 'sonnet' as string | null,
    defaultEffort: 'high' as string | null,
  },
  check: vi.fn(),
  update: vi.fn(),
  newChat: vi.fn(async () => ({})),
  saveHarness: vi.fn(async () => ({ harness: 'codex', model: 'gpt-6.1-sol', variant: null, effort: 'medium' })),
}));

vi.mock('@/hooks/use-user-state', () => ({
  useUserState: () => ({ data: fixtures.state }),
  useUpdateUserState: () => ({ mutate: fixtures.update, mutateAsync: fixtures.update }),
}));
vi.mock('@/hooks/use-workspaces', () => ({ useWorkspaces: () => ({ data: [] }) }));
vi.mock('@/hooks/use-areas', () => ({ useAreas: () => ({ data: [] }) }));
vi.mock('@/hooks/use-main-chat', () => ({
  useMainChat: () => ({ data: { session: { harness: 'claude', model: 'sonnet', effort: 'high' } } }),
  useNewMainChat: () => ({ mutateAsync: fixtures.newChat }),
}));
vi.mock('@/components/onboarding/harness-save', () => ({ saveHarnessSetup: fixtures.saveHarness }));
vi.mock('./use-harness-check', () => ({
  useHarnessCheck: (enabled: boolean) => {
    fixtures.check(enabled);
    // A disabled TanStack query can still return an earlier ready result.
    return { data: { status: 'ready', harness: 'codex', report: {} } };
  },
}));
vi.mock('@/components/orchestrator/identity-editor', () => ({
  IdentityEditor: () => null,
  draftFromState: () => ({}),
  draftName: () => 'Ri',
  useSaveIdentity: () => ({ save: async () => true, saving: false }),
}));
vi.mock('@/components/workspaces/workspace-create-modal', () => ({ WorkspaceCreateModal: () => null }));
vi.mock('@/components/chat/main-chat-intro', () => ({ appMainChatIntro: () => [], useEmptyChatActions: () => ({}) }));
vi.mock('./onboarding-apps', () => ({ OnboardingApps: () => null }));
vi.mock('./onboarding-areas', () => ({
  AreasStep: () => null, NO_AREAS: 'None', areasLines: () => null,
  useAreaSuggestions: () => ({ data: { areas: [] }, isFetching: false }),
}));
vi.mock('./onboarding-import', () => ({
  ImportProgress: () => null, ImportStep: () => null, importQuestion: () => null,
  importableHistory: () => ({ projects: 0, chats: 0, sources: [] }),
  recentProjects: () => [], useImportDiscovery: () => ({ data: {}, isPending: false }),
}));
vi.mock('./onboarding-about', () => ({
  ABOUT_SKIPPED: 'Skip', AboutStep: () => null, aboutQuestion: () => null,
  useAboutDraft: () => ({ data: {}, isFetching: false }),
}));
vi.mock('./import-runner', () => ({ useImportRun: () => null }));
vi.mock('./onboarding-default-model', () => ({ DefaultModelLine: () => null }));
vi.mock('./onboarding-ui', async () => {
  const { createElement } = await import('react');
  const wrapper = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  const button = ({ children, onClick, disabled, busy }: {
    children?: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean;
  }) => createElement('button', { onClick, disabled: disabled || busy }, children);
  return { Card: wrapper, PrimaryButton: button, QuietButton: button, Reply: wrapper, Says: wrapper, Turn: wrapper, Typing: () => null };
});

let root: Root;
let client: QueryClient;
let container: HTMLElement;
let stored: Map<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fixtures.state, { defaultHarness: 'claude', defaultModel: 'sonnet', defaultEffort: 'high' });
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  stored = new Map();
  Object.assign(window, {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div');
  root = createRoot(container);
  client = new QueryClient();
  client.setQueryData(['home', 'identity'], { id: 'home-1' });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(MainChatOnboarding, { onSkip: vi.fn() }),
  )));
}

async function continueIdentity() {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('Continue'));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

function expectSavedChoiceUntouched() {
  expect(fixtures.state).toMatchObject({ defaultHarness: 'claude', defaultModel: 'sonnet', defaultEffort: 'high' });
  expect(fixtures.check.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
  expect(fixtures.saveHarness).not.toHaveBeenCalled();
  expect(fixtures.newChat).not.toHaveBeenCalled();
  expect(fixtures.update).not.toHaveBeenCalled();
}

describe('resuming setup with a saved default', () => {
  it('preserves the home choice in a fresh browser and moves directly from identity to the user name', async () => {
    await render();
    // A saved harness does not hide the guidance for an unfinished new home.
    expect(container.textContent).toContain('Already use Ri on another computer?');
    await continueIdentity();
    expect(container.textContent).toContain('And what should I call you?');
    expectSavedChoiceUntouched();
  });

  it('skips a saved harness step even when the disabled query has a cached ready Codex result', async () => {
    stored.set('ri.mainChat.onboarding:home-1', JSON.stringify({ step: 'harness', replies: { identity: 'Ri' } }));
    await render();
    expect(container.textContent).toContain('And what should I call you?');
    expectSavedChoiceUntouched();
  });

  it('still checks and saves a detected harness when the home has never chosen', async () => {
    Object.assign(fixtures.state, { defaultHarness: null, defaultModel: null, defaultEffort: null });
    await render();
    expect(fixtures.check).toHaveBeenCalledWith(true);
    await continueIdentity();
    expect(fixtures.saveHarness).toHaveBeenCalledExactlyOnceWith({ harness: 'codex' });
    expect(fixtures.newChat).toHaveBeenCalledExactlyOnceWith({ providerId: 'codex', model: 'gpt-6.1-sol', variant: undefined, effort: 'medium' });
    expect(container.textContent).toContain('And what should I call you?');
  });
});
