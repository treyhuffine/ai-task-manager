import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import { ChatAddMenu } from './chat-add-menu';

const h = vi.hoisted(() => ({
  chat: null as Record<string, unknown> | null,
  personal: true,
  plugins: (() => {}) as (() => void) | null,
  agents: [{ kind: 'agent', id: 'other' }] as unknown[],
  connectors: 3,
  opened: [] as (string | undefined)[],
  rows: new Map<string, () => void>(),
}));

// The open menu's rows render inline so they can be read, and each row's action is kept.
vi.mock('./composer-add-menu', () => ({
  ComposerAddMenu: ({ mentions, children }: { mentions: ReactNode; children: ReactNode }) => createElement('div', null, mentions, children),
  AddMenuRow: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => {
    h.rows.set(String(children), onSelect);
    return createElement('button', null, children);
  },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { items: [], total: h.connectors } }) }));
vi.mock('@/lib/trpc/client', () => ({ trpc: { chatSources: { search: { queryOptions: () => ({}) } } } }));
vi.mock('@/components/ui/dropdown-menu', () => ({ DropdownMenuSeparator: () => createElement('hr') }));
vi.mock('@/components/agents/agent-folders', () => ({ LinkedFolderDefiner: () => null }));
vi.mock('@/components/home/use-personal-services', () => ({ usePersonalServices: () => h.personal }));
vi.mock('@/components/apps/app-companion-rows', () => ({ AppCompanionRows: () => createElement('button', null, 'Example app') }));
vi.mock('@/components/apps/chat-app-tools', () => ({ ChatAppToolsRow: () => null, ChatAppToolsDialog: () => null }));
vi.mock('@/components/settings/settings-destination', () => ({ useSettingsLink: () => h.plugins }));
vi.mock('@/components/triggers/schedule-chat-button', () => ({ ScheduleChatDialog: () => null }));
vi.mock('@/hooks/use-execution', () => ({ useSession: () => ({ data: h.chat }) }));
vi.mock('@/hooks/use-workspaces', () => ({
  useWorkspace: () => ({ data: null }),
  useAgentFolders: () => ({ data: null }),
  useMentionAgents: (enabled: boolean) => enabled ? h.agents : [],
}));

const render = (coordination = true) => renderToStaticMarkup(createElement(
  ChatCapabilities.Provider,
  { value: { deliveryReceipts: true, prepareResults: true, coordination } },
  createElement(ChatAddMenu, {
    sessionId: 'chat',
    editor: { current: { openMentionMenu: (prefix?: string) => { h.opened.push(prefix); } } as never },
    onPick: () => {},
  }),
));

beforeEach(() => {
  h.personal = true;
  h.plugins = () => {};
  h.agents = [{ kind: 'agent', id: 'other' }];
  h.connectors = 3;
  h.opened = [];
  h.rows.clear();
  h.chat = {
    id: 'chat', status: 'active', type: 'execution', surfaceKind: null, externalSessionId: null, surfaceRef: null,
    workspaceId: 'agent', harness: 'claude', prePlanMode: null,
  };
});

it('offers everything an agent chat can do', () => {
  const html = render();
  for (const row of ['Tasks', 'Notes', 'Agents', 'Connectors', 'Example app', 'Schedule this chat', 'Link a folder', 'Add plugins']) expect(html).toContain(row);
});

it('leaves mode changes to the mode chip', () => {
  expect(render()).not.toContain('Plan mode');
});

it('narrows the @ menu to the kind a row names', () => {
  render();
  for (const row of ['Tasks', 'Notes', 'Agents', 'Connectors']) h.rows.get(row)?.();
  expect(h.opened).toEqual(['task:', 'note:', 'agent:', 'connector:']);
});

it('keeps connectors to one row however many accounts there are', () => {
  h.connectors = 40;
  expect(render().match(/Connectors/g)).toHaveLength(1);
});

it('leaves out a row with nothing behind it', () => {
  h.connectors = 0;
  expect(render()).not.toContain('Connectors');
  h.agents = [];
  expect(render()).not.toContain('Agents');
  // A shared chat can't reach other agents.
  h.agents = [{ kind: 'agent', id: 'other' }];
  expect(render(false)).not.toContain('Agents');
  // The main chat has no agent to link a folder to.
  h.chat = { ...h.chat, workspaceId: null };
  expect(render()).not.toContain('Link a folder');
  // Setup and review chats aren’t scheduled.
  h.chat = { ...h.chat, type: 'content' };
  expect(render()).not.toContain('Schedule this chat');
  h.plugins = null;
  expect(render()).not.toContain('Add plugins');
});

it('keeps personal rows out of a team Home', () => {
  h.personal = false;
  const html = render();
  expect(html).not.toContain('Link a folder');
  expect(html).not.toContain('Add plugins');
  expect(html).toContain('Schedule this chat');
});

it('still names what can be mentioned before the chat has loaded', () => {
  h.chat = null;
  const html = render();
  expect(html).toContain('Tasks');
  expect(html).not.toContain('Schedule this chat');
});
