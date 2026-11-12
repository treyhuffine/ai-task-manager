'use client';

import { usePersonalServices } from '@/components/home/use-personal-services';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { EntrypointIcon } from '@/components/mcp-apps/entrypoint-icon';
import { useConnectedCompanion, type ConnectedTab } from '@/lib/client/mcp-app-panel';
import { trpc } from '@/lib/trpc/client';

/**
 * The + menu's apps: opens one of your connected apps beside this chat, or
 * closes the one that's there. Lists the tabs connected apps offer beside a
 * chat (OpenAI's thread entrypoint), and shows only when there is at least
 * one. They are rows of the menu itself: a submenu opens to the side, and a
 * phone has no room there.
 */
export function AppCompanionRows({ chatId }: { chatId: string }) {
  const personalServices = usePersonalServices();
  const companion = useConnectedCompanion();
  // Only the tabs this chat may open: an agent's chat sees the accounts its agent may use.
  const connected = useQuery({ ...trpc.connectedApps.chatTabs.queryOptions({ chatId }, { staleTime: 15_000 }), enabled: personalServices && !!companion?.openTab });
  const tabs: (ConnectedTab & { app: string })[] = companion?.openTab ? (connected.data ?? [])
    .map((tab) => ({ serverId: tab.serverId, name: tab.name, title: tab.title, icons: tab.icons, app: tab.app }))
    .sort((a, b) => a.title.localeCompare(b.title)) : [];
  if (tabs.length === 0) return null;
  const tab = companion?.tab ?? null;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Beside this chat
      </DropdownMenuLabel>
      {tabs.map((item) => (
        <DropdownMenuItem key={`${item.serverId}:${item.name}`} onSelect={() => void companion?.openTab?.(item)} className="pointer-coarse:py-2.5">
          <EntrypointIcon icons={item.icons} size={14} />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.app.toLocaleLowerCase() !== item.title.toLocaleLowerCase() && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{item.app}</span>}
          {tab?.serverId === item.serverId && tab.name === item.name && <Check size={13} className="text-muted-foreground" aria-label="Open now" />}
        </DropdownMenuItem>
      ))}
      {tab && (
        <DropdownMenuItem className="pointer-coarse:py-2.5" onSelect={() => companion?.open(null)}>
          <X size={13} /> Close app
        </DropdownMenuItem>
      )}
    </>
  );
}
