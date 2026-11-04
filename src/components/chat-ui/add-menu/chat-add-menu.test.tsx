import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatAddMenu } from './chat-add-menu';

const h = vi.hoisted(() => ({
  chat: null as Record<string, unknown> | null,
  personal: true,
  plugins: (() => {}) as (() => void) | null,
  setPlan: undefined as undefined | ((on: boolean) => void),
  pass: ({ children }: { children?: ReactNode }) => children,
}));

// The open menu's rows render inline so they can be read.
vi.mock('./composer-add-menu', () => ({
  ComposerAddMenu: h.pass,
  AddMenuRow: ({ children }: { children: ReactNode }) => createElement('button', null, children),
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuSeparator: () => createElement('hr'),
  DropdownMenuCheckboxItem: ({ children, checked, disabled, onCheckedChange }: { children: ReactNode; checked: boolean; disabled: boolean; onCheckedChange: (on: boolean) => void }) => {
    h.setPlan = onCheckedChange;
    return createElement('button', { 'aria-checked': checked, disabled }, children);
  },
}));
vi.mock('@/components/agents/agent-folders', () => ({ LinkedFolderDefiner: () => null }));
vi.mock('@/components/home/use-personal-services', () => ({ usePersonalServices: () => h.personal }));
vi.mock('@/components/local-apps/app-companion-rows', () => ({ AppCompanionRows: () => createElement('button', null, 'Example app') }));
vi.mock('@/components/settings/settings-destination', () => ({ useSettingsLink: () => h.plugins }));
vi.mock('@/components/triggers/schedule-chat-button', () => ({ ScheduleChatDialog: () => null }));
vi.mock('@/hooks/use-execution', () => ({ useSession: () => ({ data: h.chat }) }));
vi.mock('@/hooks/use-workspaces', () => ({ useWorkspace: () => ({ data: null }), useAgentFolders: () => ({ data: null }) }));

const set = vi.fn();
const render = (plan: { on?: boolean; available?: boolean; disabled?: boolean } = {}) => renderToStaticMarkup(createElement(ChatAddMenu, {
  sessionId: 'chat',
  editor: { current: null },
  onPick: () => {},
  planMode: { on: false, available: true, disabled: false, set, ...plan },
}));

beforeEach(() => {
  set.mockClear();
  h.personal = true;
  h.plugins = () => {};
  h.chat = {
    id: 'chat', status: 'active', type: 'execution', surfaceKind: null, externalSessionId: null, surfaceRef: null,
    workspaceId: 'agent', harness: 'claude', prePlanMode: null,
  };
});

it('offers everything an agent chat can do', () => {
  const html = render();
  for (const row of ['Example app', 'Schedule this chat', 'Plan mode', 'Link a folder', 'Connectors and plugins']) expect(html).toContain(row);
});

it('leaves out a row with nothing behind it', () => {
  // The main chat has no agent to link a folder to.
  h.chat = { ...h.chat, workspaceId: null };
  expect(render()).not.toContain('Link a folder');
  // Setup and review chats aren’t scheduled.
  h.chat = { ...h.chat, type: 'content' };
  expect(render()).not.toContain('Schedule this chat');
  expect(render({ available: false })).not.toContain('Plan mode');
  h.plugins = null;
  expect(render()).not.toContain('plugins');
});

it('keeps personal rows out of a team Home', () => {
  h.personal = false;
  const html = render();
  expect(html).not.toContain('Link a folder');
  expect(html).not.toContain('plugins');
  expect(html).toContain('Schedule this chat');
});

it('shows only the message rows until the chat has loaded', () => {
  h.chat = null;
  expect(render()).toBe('');
});

it('turns plan mode on, and off back to the mode it came from', () => {
  expect(render({ on: true })).toContain('aria-checked="true"');
  h.setPlan?.(false);
  expect(set).toHaveBeenLastCalledWith('ask');

  h.chat = { ...h.chat, prePlanMode: 'auto_all' };
  render({ on: true });
  h.setPlan?.(false);
  expect(set).toHaveBeenLastCalledWith('auto_all');

  render({ on: false });
  h.setPlan?.(true);
  expect(set).toHaveBeenLastCalledWith('plan');
  expect(render({ disabled: true })).toContain('disabled');
});
