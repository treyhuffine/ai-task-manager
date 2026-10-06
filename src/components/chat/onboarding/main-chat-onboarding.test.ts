import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { MainChatOnboarding } from './main-chat-onboarding';

const fixtures = vi.hoisted(() => ({
  state: {
    name: null as string | null, description: 'Existing description', onboardedAt: null as string | null,
    orchestratorIntroducedAt: null as string | null,
    orchestratorName: null as string | null,
    defaultHarness: 'claude' as string | null,
    defaultModel: 'sonnet' as string | null,
    defaultEffort: 'high' as string | null,
    onboarding: null as unknown,
  },
  check: vi.fn(),
  update: vi.fn(),
  createChat: vi.fn(async () => ({ session: { id: 'chat-2' } })),
  switchChat: vi.fn(),
  saveHarness: vi.fn(async () => ({ harness: 'codex', model: 'gpt-6.1-sol', variant: null, effort: 'medium' })),
  progress: { show: vi.fn(), record: vi.fn(), finish: vi.fn(async () => {}), moveChat: vi.fn(async () => {}) },
  refetch: vi.fn(async () => ({})),
}));

vi.mock('@/hooks/use-user-state', () => ({
  useUserState: () => ({ data: fixtures.state, refetch: fixtures.refetch }),
  useUpdateUserState: () => ({ mutate: fixtures.update, mutateAsync: fixtures.update }),
  useOrchestratorName: () => 'Ri',
}));
vi.mock('./use-onboarding-progress', () => ({ useOnboardingProgress: () => fixtures.progress }));
vi.mock('@/hooks/use-workspaces', () => ({ useWorkspaces: () => ({ data: [] }) }));
vi.mock('@/hooks/use-areas', () => ({ useAreas: () => ({ data: [] }) }));
vi.mock('@/hooks/use-main-chat', () => ({
  mainChatKey: (scope: string | null) => ['main-chat', scope],
  useMainChat: () => ({ data: { session: { id: 'chat-1', harness: 'claude', model: 'sonnet', effort: 'high' } } }),
  createMainChat: fixtures.createChat,
  switchToMainChat: fixtures.switchChat,
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
vi.mock('@/components/chat/main-chat-intro', async () => {
  const { createElement } = await import('react');
  return {
    appMainChatIntro: () => ({ title: 'What should we work on?', description: '', starters: [] }),
    useEmptyChatActions: () => ({}),
    MainChatIntroPanel: ({ intro, footer }: { intro: { title: string }; footer?: ReactNode }) =>
      createElement('section', null, intro.title, footer),
  };
});
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
const AT = '2026-10-06T12:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fixtures.state, {
    name: null, onboardedAt: null, orchestratorIntroducedAt: null, orchestratorName: null, onboarding: null,
    defaultHarness: 'claude', defaultModel: 'sonnet', defaultEffort: 'high',
  });
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(MainChatOnboarding),
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
  expect(fixtures.createChat).not.toHaveBeenCalled();
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
    // Named in this chat in another window, which stopped at the harness.
    fixtures.state.onboarding = { steps: { identity: { status: 'answered', reply: 'Ri', chatId: 'chat-1', at: AT } } };
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
    expect(fixtures.createChat).toHaveBeenCalledExactlyOnceWith(null, { providerId: 'codex', model: 'gpt-6.1-sol', variant: undefined, effort: 'medium' });
    // The conversation moves to the new chat before it's shown.
    expect(fixtures.progress.moveChat).toHaveBeenCalledExactlyOnceWith('chat-1', 'chat-2');
    expect(fixtures.switchChat.mock.invocationCallOrder[0]).toBeGreaterThan(fixtures.progress.moveChat.mock.invocationCallOrder[0]!);
    expect(container.textContent).toContain('And what should I call you?');
  });

  it('stays on the harness step until the chat it replaces is ready, though the default is saved first', async () => {
    Object.assign(fixtures.state, { defaultHarness: null, defaultModel: null, defaultEffort: null });
    let finishCreate!: (value: { session: { id: string } }) => void;
    fixtures.createChat.mockImplementationOnce(() => new Promise((resolve) => (finishCreate = resolve)));
    fixtures.saveHarness.mockImplementationOnce(async () => {
      // The saved default reaches user state before the new chat exists.
      Object.assign(fixtures.state, { defaultHarness: 'codex', defaultModel: 'gpt-6.1-sol', defaultEffort: 'medium' });
      return { harness: 'codex', model: 'gpt-6.1-sol', variant: null, effort: 'medium' };
    });
    await render();
    await continueIdentity();
    await render();
    // Writing now would go to the chat being retired, so the next question waits.
    expect(container.textContent).not.toContain('And what should I call you?');
    await act(async () => finishCreate({ session: { id: 'chat-2' } }));
    await render();
    expect(container.textContent).toContain('And what should I call you?');
  });

  it('records the harness answer in the chat that replaced the empty one', async () => {
    Object.assign(fixtures.state, { defaultHarness: null, defaultModel: null, defaultEffort: null });
    // Switching shows the new chat, as the real switch does.
    fixtures.switchChat.mockImplementation((qc: QueryClient, scope: string | null, data: unknown) => qc.setQueryData(['main-chat', scope], data));
    await render();
    await continueIdentity();
    expect(fixtures.progress.record).toHaveBeenCalledWith('harness', { status: 'answered', reply: '', chatId: 'chat-2' });
  });
});

describe('progress kept on the home', () => {
  it('records each answer in this chat and puts the next question on screen', async () => {
    await render();
    await continueIdentity();
    expect(fixtures.progress.record).toHaveBeenCalledWith('identity', { status: 'answered', reply: 'Ri', chatId: 'chat-1' });
    expect(fixtures.progress.show).toHaveBeenLastCalledWith('you', 'chat-1');
  });

  it('opens with the welcome for a home that has answered nothing, from fresh user state', async () => {
    await render();
    // Cached state can be a refetch old, and a message since may have skipped a step.
    expect(fixtures.refetch).toHaveBeenCalled();
    expect(container.textContent).toContain('Hi, welcome to Ri.');
  });

  it('keeps the welcome when this same conversation is opened again, its answers replayed', async () => {
    Object.assign(fixtures.state, { orchestratorName: 'Rye' });
    fixtures.state.onboarding = { steps: { identity: { status: 'answered', reply: 'Rye', chatId: 'chat-1', at: AT } } };
    await render();
    expect(container.textContent).toContain('Hi, welcome to Ri.');
    expect(container.textContent).toContain('Rye it is.');
    expect(container.textContent).not.toContain('A few things are left');
  });

  it('picks up after a skipped step with a short line, not the welcome, and does not replay earlier chats', async () => {
    Object.assign(fixtures.state, { orchestratorName: 'Rye' });
    fixtures.state.onboarding = {
      steps: {
        identity: { status: 'answered', reply: 'Rye', chatId: 'earlier', at: AT },
        you: { status: 'skipped', chatId: 'earlier', at: AT },
      },
    };
    await render();
    expect(container.textContent).not.toContain('Hi, welcome to Ri.');
    expect(container.textContent).toContain('A few things are left from setting up.');
    expect(container.textContent).not.toContain('Rye it is.');
    expect(container.textContent).not.toContain('And what should I call you?');
  });

  it('never asks again what is already on file, like a name given before', async () => {
    Object.assign(fixtures.state, { name: 'Trey', orchestratorName: 'Rye' });
    await render();
    expect(container.textContent).not.toContain('What should I go by?');
    expect(container.textContent).not.toContain('And what should I call you?');
  });

  it('records Skip setup as finishing, and shows the usual intro', async () => {
    await render();
    const skip = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Skip setup');
    await act(async () => skip!.click());
    expect(fixtures.progress.finish).toHaveBeenCalledWith({ skipped: true, chatId: 'chat-1' });
    expect(container.textContent).toContain('What should we work on?');
  });
});

describe('a home that finished setting up', () => {
  beforeEach(() => {
    Object.assign(fixtures.state, { name: 'Trey', orchestratorName: 'Rye', onboardedAt: AT, orchestratorIntroducedAt: AT });
  });

  it('opens on the usual intro, with nothing to set up, when it finished before steps were recorded', async () => {
    await render();
    expect(container.textContent).toContain('What should we work on?');
    expect(container.textContent).not.toContain('New');
    expect(fixtures.progress.show).not.toHaveBeenCalled();
  });

  it('offers a step it has no record of as one quiet line under the intro, never the conversation', async () => {
    // Every step recorded but apps: as if apps were added after it finished.
    const steps = Object.fromEntries(
      ['identity', 'harness', 'you', 'import', 'about', 'areas', 'agent'].map((step) => [step, { status: 'not_asked', at: AT }]),
    );
    fixtures.state.onboarding = { steps };
    await render();
    expect(container.textContent).toContain('What should we work on?');
    expect(container.textContent).toContain('Connect the apps you use');
    expect(container.textContent).not.toContain('Hi, welcome to Ri.');
    expect(fixtures.progress.show).toHaveBeenCalledWith('apps', 'chat-1');

    const notNow = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Not now');
    await act(async () => notNow!.click());
    expect(fixtures.progress.record).toHaveBeenCalledWith('apps', { status: 'skipped', chatId: 'chat-1' });
  });
});
