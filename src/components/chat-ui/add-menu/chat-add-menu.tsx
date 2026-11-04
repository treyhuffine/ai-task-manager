'use client';

/**
 * The + in an existing chat: the message rows, then what can happen around
 * this chat. Each row offers something the chat can really do right now, and
 * a row with nothing behind it isn't there. Its rows are built only while the
 * menu is open, since every composer carries one.
 */

import { useState, type ComponentProps } from 'react';
import { Clock, FolderPlus, Plug } from 'lucide-react';
import { LinkedFolderDefiner } from '@/components/agents/agent-folders';
import { usePersonalServices } from '@/components/home/use-personal-services';
import { AppCompanionRows } from '@/components/local-apps/app-companion-rows';
import { useSettingsLink } from '@/components/settings/settings-destination';
import { ScheduleChatDialog } from '@/components/triggers/schedule-chat-button';
import { DropdownMenuCheckboxItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import type { PermissionMode } from '@/db/types';
import { useSession } from '@/hooks/use-execution';
import { useAgentFolders, useWorkspace } from '@/hooks/use-workspaces';
import { conservativePlanReturn } from '@/lib/executor/permission-map';
import { PERMISSION_MODE_META } from '@/lib/permission-modes';
import { canScheduleChat } from '@/lib/triggers/chat-schedule';
import { AddMenuRow, ComposerAddMenu } from './composer-add-menu';

type Opened = 'schedule' | 'folder' | null;

interface PlanModeControl {
  on: boolean;
  /** This harness has a plan mode. */
  available: boolean;
  /** The mode can't change just now, while a turn runs. */
  disabled: boolean;
  set: (mode: PermissionMode) => void;
}

export function ChatAddMenu({ sessionId, planMode, ...menu }: Omit<ComponentProps<typeof ComposerAddMenu>, 'children'> & {
  sessionId: string;
  planMode: PlanModeControl;
}) {
  const [opened, setOpened] = useState<Opened>(null);
  return (
    <>
      <ComposerAddMenu {...menu}>
        <ChatRows sessionId={sessionId} planMode={planMode} onOpen={setOpened} />
      </ComposerAddMenu>
      <ScheduleChatDialog sessionId={sessionId} open={opened === 'schedule'} onOpenChange={(open) => setOpened(open ? 'schedule' : null)} />
      {opened === 'folder' && <LinkFolderDialog sessionId={sessionId} onClose={() => setOpened(null)} />}
    </>
  );
}

function ChatRows({ sessionId, planMode, onOpen }: {
  sessionId: string;
  planMode: PlanModeControl;
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
  const PlanIcon = PERMISSION_MODE_META.plan.Icon;
  return (
    <>
      <DropdownMenuSeparator />
      {canScheduleChat(chat) && <AddMenuRow icon={Clock} onSelect={() => onOpen('schedule')}>Schedule this chat</AddMenuRow>}
      {planMode.available && (
        <DropdownMenuCheckboxItem
          className="pointer-coarse:py-2.5"
          checked={planMode.on}
          disabled={planMode.disabled}
          onCheckedChange={(on) => planMode.set(on ? 'plan' : chat.prePlanMode ?? conservativePlanReturn(chat.harness))}
        >
          <PlanIcon className="text-muted-foreground" />
          Plan mode
        </DropdownMenuCheckboxItem>
      )}
      {folderAgentId && <AddMenuRow icon={FolderPlus} onSelect={() => onOpen('folder')}>Link a folder</AddMenuRow>}
      <AppCompanionRows chatId={chat.id} surfaceKind={chat.surfaceKind} />
      {personalServices && openPlugins && (
        <>
          <DropdownMenuSeparator />
          <AddMenuRow icon={Plug} onSelect={openPlugins}>{INTEGRATION_LABELS.plural} and plugins</AddMenuRow>
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
