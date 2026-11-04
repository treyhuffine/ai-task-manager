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
import { trpc, trpcClient } from '@/lib/trpc/client';
import { useLocalApps } from './app-hooks';
import { AppMark } from './app-mark';
import { isAppSurface } from './app-copy';
import { useAppAction } from './use-app-action';

/**
 * The + menu's apps: opens one of your apps beside this chat, or closes the
 * one that's there. Lists your local apps (on a Home with local apps on) and
 * the tabs connected apps offer beside a chat (OpenAI's thread entrypoint),
 * and shows only when there is at least one. Never in an app's own chats.
 * They are rows of the menu itself: a submenu opens to the side, and a phone
 * has no room there.
 */
export function AppCompanionRows({ chatId, surfaceKind }: { chatId: string; surfaceKind?: string | null }) {
  const personalServices = usePersonalServices();
  const { enabled, data } = useLocalApps({ live: false });
  const { busy, run } = useAppAction();
  const companion = useConnectedCompanion();
  // Only the tabs this chat may open: an agent's chat sees the accounts its agent may use.
  const connected = useQuery({ ...trpc.connectedApps.chatTabs.queryOptions({ chatId }, { staleTime: 15_000 }), enabled: personalServices && !!companion?.openTab && !isAppSurface(surfaceKind) });
  if (isAppSurface(surfaceKind)) return null;
  const apps = enabled ? (data?.instances ?? [])
    .filter((item) => item.enabled && !item.archived && item.hasView && item.activation?.phase === 'active')
    .sort((a, b) => a.displayName.localeCompare(b.displayName)) : [];
  const tabs: (ConnectedTab & { app: string })[] = companion?.openTab ? (connected.data ?? [])
    .map((tab) => ({ serverId: tab.serverId, name: tab.name, title: tab.title, icons: tab.icons, app: tab.app }))
    .sort((a, b) => a.title.localeCompare(b.title)) : [];
  if (apps.length === 0 && tabs.length === 0) return null;
  const current = enabled ? data?.panels.find((item) => item.chatId === chatId) : undefined;
  const tab = companion?.tab ?? null;
  const open = (instanceId: string) =>
    void run(() => trpcClient.localApps.panel.mutate({ chatId, instanceId, path: '/', query: {} }));

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Beside this chat
      </DropdownMenuLabel>
      {apps.map((app) => (
        <DropdownMenuItem key={app.id} disabled={busy} onSelect={() => open(app.id)} className="pointer-coarse:py-2.5">
          <AppMark name={app.displayName} icon={app.icon} size="xs" />
          <span className="min-w-0 flex-1 truncate">{app.displayName}</span>
          {current?.instanceId === app.id && <Check size={13} className="text-muted-foreground" aria-label="Open now" />}
        </DropdownMenuItem>
      ))}
      {tabs.map((item) => (
        <DropdownMenuItem key={`${item.serverId}:${item.name}`} onSelect={() => void companion?.openTab?.(item)} className="pointer-coarse:py-2.5">
          <EntrypointIcon icons={item.icons} size={14} />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.app.toLocaleLowerCase() !== item.title.toLocaleLowerCase() && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{item.app}</span>}
          {tab?.serverId === item.serverId && tab.name === item.name && <Check size={13} className="text-muted-foreground" aria-label="Open now" />}
        </DropdownMenuItem>
      ))}
      {(current || tab) && (
        <DropdownMenuItem className="pointer-coarse:py-2.5" onSelect={() => {
          if (tab) companion?.open(null);
          if (current) void run(() => trpcClient.localApps.panel.mutate({ chatId, instanceId: null }));
        }}>
          <X size={13} /> Close app
        </DropdownMenuItem>
      )}
    </>
  );
}
