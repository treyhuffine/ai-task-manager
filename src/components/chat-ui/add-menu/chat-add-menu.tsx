'use client';

/**
 * The + in an existing chat: the message rows, then what can happen around
 * this chat. Each row offers something the chat can really do right now, and
 * a row with nothing behind it isn't there. Its rows are built only while the
 * menu is open, since every composer carries one.
 */

import { useState, type ComponentProps, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Cable, CheckSquare, Clock, FolderPlus, Plug, StickyNote } from 'lucide-react';
import { LinkedFolderDefiner } from '@/components/agents/agent-folders';
import { useChatCapabilities } from '@/components/chat-ui/chat-capabilities';
import type { ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import { mentionKind } from '@/components/chat/editor/mention-menu/ranking';
import type { MentionFilter } from '@/components/chat/editor/mention-menu/types';
import { usePersonalServices } from '@/components/home/use-personal-services';
import { AppCompanionRows } from '@/components/local-apps/app-companion-rows';
import { useSettingsLink } from '@/components/settings/settings-destination';
import { ScheduleChatDialog } from '@/components/triggers/schedule-chat-button';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { useSession } from '@/hooks/use-execution';
import { useAgentFolders, useMentionAgents, useWorkspace } from '@/hooks/use-workspaces';
import { canScheduleChat } from '@/lib/triggers/chat-schedule';
import { trpc } from '@/lib/trpc/client';
import { AddMenuRow, ComposerAddMenu } from './composer-add-menu';

type Opened = 'schedule' | 'folder' | null;

export function ChatAddMenu({ sessionId, ...menu }: Omit<ComponentProps<typeof ComposerAddMenu>, 'children' | 'mentions'> & {
  sessionId: string;
}) {
  const [opened, setOpened] = useState<Opened>(null);
  return (
    <>
      <ComposerAddMenu {...menu} mentions={<MentionRows sessionId={sessionId} editor={menu.editor} />}>
        <ChatRows sessionId={sessionId} onOpen={setOpened} />
      </ComposerAddMenu>
      <ScheduleChatDialog sessionId={sessionId} open={opened === 'schedule'} onOpenChange={(open) => setOpened(open ? 'schedule' : null)} />
      {opened === 'folder' && <LinkFolderDialog sessionId={sessionId} onClose={() => setOpened(null)} />}
    </>
  );
}

/**
 * The kinds worth a row, each opening the `@` menu narrowed to it. Connectors
 * are one row, not one per account: an account's logo, status and access are
 * already what the narrowed list shows, and a Home can hold dozens of them.
 * The other kinds are a chip away in Mention anything.
 */
function MentionRows({ sessionId, editor }: {
  sessionId: string;
  editor: RefObject<ChatInputEditorHandle | null>;
}) {
  const agents = useMentionAgents(useChatCapabilities().coordination !== false);
  const { data: connectors } = useQuery(trpc.chatSources.search.queryOptions({ chatId: sessionId, query: '', filter: 'connector' }, { enabled: !!sessionId, staleTime: 15_000 }));
  const open = (kind: MentionFilter) => () => editor.current?.openMentionMenu(mentionKind(kind).prefix);
  return (
    <>
      <AddMenuRow icon={CheckSquare} onSelect={open('task')}>Tasks</AddMenuRow>
      <AddMenuRow icon={StickyNote} onSelect={open('note')}>Notes</AddMenuRow>
      {agents.length > 0 && <AddMenuRow icon={Bot} onSelect={open('agent')}>Agents</AddMenuRow>}
      {(connectors?.total ?? 0) > 0 && <AddMenuRow icon={Cable} onSelect={open('connector')}>{INTEGRATION_LABELS.plural}</AddMenuRow>}
    </>
  );
}

function ChatRows({ sessionId, onOpen }: {
  sessionId: string;
  onOpen: (opened: Opened) => void;
}) {
  const { data: chat } = useSession(sessionId);
  const personalServices = usePersonalServices();
  const openPlugins = useSettingsLink('plugins');
  // Loaded before the pick, so Link a folder opens on the tap.
  const folderAgentId = personalServices ? chat?.workspaceId ?? null : null;
  useWorkspace(folderAgentId);
  useAgentFolders(folderAgentId);
  if (!chat) return null;
  return (
    <>
      <DropdownMenuSeparator />
      {canScheduleChat(chat) && <AddMenuRow icon={Clock} onSelect={() => onOpen('schedule')}>Schedule this chat</AddMenuRow>}
      {folderAgentId && <AddMenuRow icon={FolderPlus} onSelect={() => onOpen('folder')}>Link a folder</AddMenuRow>}
      <AppCompanionRows chatId={chat.id} surfaceKind={chat.surfaceKind} />
      {personalServices && openPlugins && (
        <>
          <DropdownMenuSeparator />
          <AddMenuRow icon={Plug} onSelect={openPlugins}>Add plugins</AddMenuRow>
        </>
      )}
    </>
  );
}

/** Linked folders belong to the agent, so this adds one for all of its chats. */
function LinkFolderDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data: chat } = useSession(sessionId);
  const workspaceId = chat?.workspaceId ?? null;
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: folders } = useAgentFolders(workspaceId);
  const on = folders?.devices[0];
  if (!workspace || !on) return null;
  return <LinkedFolderDefiner workspace={workspace} on={on} editing={null} open onOpenChange={(open) => { if (!open) onClose(); }} />;
}
