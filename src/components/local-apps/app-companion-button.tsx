'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, LayoutGrid, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tip';
import { connectedAppsQuery } from '@/components/mcp-apps/catalog';
import { EntrypointIcon } from '@/components/mcp-apps/entrypoint-icon';
import { useConnectedCompanion, type ConnectedTab } from '@/lib/client/mcp-app-panel';
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocalApps } from './app-hooks';
import { AppMark } from './app-mark';
import { isAppSurface } from './app-copy';
import { useAppAction } from './use-app-action';

/**
 * The composer's app button: opens one of your apps beside this chat, or
 * closes the one that's there. Sits with Attach, since both bring something
 * into the conversation. Lists your local apps (on a Home with local apps on)
 * and the tabs connected apps offer beside a chat (OpenAI's thread
 * entrypoint), and shows only when there is at least one. Never in an app's
 * own chats.
 */
export function AppCompanionButton({ chatId, surfaceKind }: { chatId: string; surfaceKind?: string | null }) {
  const { enabled, data } = useLocalApps({ live: false });
  const { busy, run } = useAppAction();
  const companion = useConnectedCompanion();
  const connected = useQuery({ ...connectedAppsQuery(), enabled: !!companion?.openTab && !isAppSurface(surfaceKind) });
  if (isAppSurface(surfaceKind)) return null;
  const apps = enabled ? (data?.instances ?? [])
    .filter((item) => item.enabled && !item.archived && item.hasView && item.activation?.phase === 'active')
    .sort((a, b) => a.displayName.localeCompare(b.displayName)) : [];
  const tabs: (ConnectedTab & { app: string })[] = companion?.openTab ? (connected.data ?? [])
    .filter((app) => app.available)
    .flatMap((app) => app.threads.map((thread) => ({ serverId: app.id, name: thread.name, title: thread.title, icons: thread.icons, app: app.toolkitName })))
    .sort((a, b) => a.title.localeCompare(b.title)) : [];
  if (apps.length === 0 && tabs.length === 0) return null;
  const current = enabled ? data?.panels.find((item) => item.chatId === chatId) : undefined;
  const tab = companion?.tab ?? null;
  const open = (instanceId: string) =>
    void run(() => trpcClient.localApps.panel.mutate({ chatId, instanceId, path: '/', query: {} }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Tip label="Open an app beside this chat">
          <button
            type="button"
            disabled={busy}
            aria-label="Open an app beside this chat"
            aria-pressed={!!current || !!tab}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              current || tab ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <LayoutGrid size={15} />
          </button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-[200px]">
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Beside this chat
        </DropdownMenuLabel>
        {apps.map((app) => (
          <DropdownMenuItem key={app.id} onSelect={() => open(app.id)}>
            <AppMark name={app.displayName} icon={app.icon} size="xs" />
            <span className="min-w-0 flex-1 truncate">{app.displayName}</span>
            {current?.instanceId === app.id && <Check size={13} className="text-muted-foreground" aria-label="Open now" />}
          </DropdownMenuItem>
        ))}
        {tabs.map((item) => (
          <DropdownMenuItem key={`${item.serverId}:${item.name}`} onSelect={() => void companion?.openTab?.(item)}>
            <EntrypointIcon icons={item.icons} size={14} />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.app.toLocaleLowerCase() !== item.title.toLocaleLowerCase() && <span className="shrink-0 truncate text-[11px] text-muted-foreground">{item.app}</span>}
            {tab?.serverId === item.serverId && tab.name === item.name && <Check size={13} className="text-muted-foreground" aria-label="Open now" />}
          </DropdownMenuItem>
        ))}
        {(current || tab) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => {
              if (tab) companion?.open(null);
              if (current) void run(() => trpcClient.localApps.panel.mutate({ chatId, instanceId: null }));
            }}>
              <X size={13} /> Close app
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
