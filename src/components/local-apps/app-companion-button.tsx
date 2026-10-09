'use client';

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
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocalApps } from './app-hooks';
import { AppMark } from './app-mark';
import { isAppSurface } from './app-copy';
import { useAppAction } from './use-app-action';

/**
 * The composer's app button: opens one of your apps beside this chat, or
 * closes the one that's there. Sits with Attach, since both bring something
 * into the conversation. Shows only on a Home with local apps on, with at
 * least one app ready to open, and never in an app's own chats.
 */
export function AppCompanionButton({ chatId, surfaceKind }: { chatId: string; surfaceKind?: string | null }) {
  const { enabled, data } = useLocalApps({ live: false });
  const { busy, run } = useAppAction();
  if (!enabled || isAppSurface(surfaceKind)) return null;
  const apps = (data?.instances ?? [])
    .filter((item) => item.enabled && !item.archived && item.activation?.phase === 'active')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (apps.length === 0) return null;
  const current = data?.panels.find((item) => item.chatId === chatId);
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
            aria-pressed={!!current}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              current ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
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
            <AppMark name={app.displayName} size="xs" />
            <span className="min-w-0 flex-1 truncate">{app.displayName}</span>
            {current?.instanceId === app.id && <Check size={13} className="text-muted-foreground" aria-label="Open now" />}
          </DropdownMenuItem>
        ))}
        {current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void run(() => trpcClient.localApps.panel.mutate({ chatId, instanceId: null }))}>
              <X size={13} /> Close app
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
