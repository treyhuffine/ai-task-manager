'use client';

import { useState } from 'react';
import { KeyRound, SquareArrowOutUpRight, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tip } from '@/components/ui/tip';
import { useDashboard } from '@/contexts/dashboard-context';
import { useElementWidth } from '@/hooks/use-element-width';
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { AppApprovalBanner } from './app-approval-banner';
import { useAppAccess, useLocalApps } from './app-hooks';
import { AppMark } from './app-mark';
import { AppView } from './app-view';
import { AppToolSummary } from './app-tool-summary';
import { isAppSurface } from './app-copy';
import { AppGrantEditor } from './grant-editor';
import { useAppAction } from './use-app-action';

/** Below this width the app sits under the chat instead of beside it. */
const SIDE_WIDTH = 820;

/**
 * An app beside a chat (docs/local-apps.md): the chat keeps its whole
 * surface and the app takes a pane at its right, under it when the chat is
 * narrow. Nothing shows until an app is opened here, from the composer's
 * app button (`AppCompanionButton`), an agent's Open app control, or a
 * mention. The pane carries its own header, approval and access controls so
 * the chat's chrome stays the chat's.
 */
export function AppCompanion({
  chatId,
  surfaceKind,
  children,
}: {
  chatId: string;
  surfaceKind?: string | null;
  children: React.ReactNode;
}) {
  const { enabled, data } = useLocalApps();
  const { setActiveView } = useDashboard();
  const { busy, run } = useAppAction();
  const [access, setAccess] = useState(false);
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const side = width === null || width >= SIDE_WIDTH;

  const panel = data?.panels.find((item) => item.chatId === chatId);
  const instance = data?.instances.find((item) => item.id === panel?.instanceId);
  const owner = data?.grants.findLast(
    (item) => item.instanceId === instance?.id && item.principal.kind === 'owner-ui' && !item.revokedAt,
  );
  const approval = data?.approvals.find((item) => item.instanceId === instance?.id);
  const chatAccess = useAppAccess(instance?.id, chatId, data?.revision);

  if (!enabled || isAppSurface(surfaceKind)) return children;

  const close = () => void run(() => trpcClient.localApps.panel.mutate({ chatId, instanceId: null }));

  return (
    <div ref={measureRef} className={cn('flex min-h-0 flex-1', side ? 'flex-row' : 'flex-col')}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {panel && instance && (
        <aside
          aria-label={`${instance.displayName} beside this chat`}
          className={cn(
            'flex min-h-0 flex-col bg-background',
            side ? 'w-[min(45%,560px)] border-l border-border' : 'h-[45%] border-t border-border',
          )}
        >
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
            <AppMark name={instance.displayName} size="xs" />
            <h2 className="min-w-0 truncate text-[12px] font-medium text-foreground">{instance.displayName}</h2>
            <div className="flex-1" />
            {chatAccess.data === null ? (
              <button
                type="button"
                onClick={() => setAccess(true)}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
              >
                <KeyRound size={11} aria-hidden /> Allow chat access
              </button>
            ) : (
              <Tip label="What this chat may do in the app">
                <button
                  type="button"
                  onClick={() => setAccess(true)}
                  aria-label="Chat access"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <KeyRound size={13} />
                </button>
              </Tip>
            )}
            <Tip label="Open full screen">
              <button
                type="button"
                onClick={() =>
                  setActiveView({ kind: 'apps', route: `${instance.slug}${panel.path === '/' ? '' : panel.path}`, query: panel.query })
                }
                aria-label={`Open ${instance.displayName} full screen`}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <SquareArrowOutUpRight size={13} />
              </button>
            </Tip>
            <Tip label="Close the app beside this chat">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                aria-label={`Close ${instance.displayName}`}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <X size={13} />
              </button>
            </Tip>
          </div>
          {approval && (
            <AppApprovalBanner
              compact
              approval={approval}
              busy={busy}
              onDecide={(approve) => void run(() => trpcClient.localApps.approval.mutate({ id: approval.id, approve }))}
            />
          )}
          <div className="relative min-h-0 flex-1">
            {!instance.hasView ? <AppToolSummary id={instance.id} /> : <AppView
              id={instance.id}
              path={panel.path}
              query={panel.query}
              // As the chat once it's allowed in, your own view until then.
              chatId={chatAccess.data ? chatId : undefined}
              digest={instance.digest}
              authorityRevision={(chatAccess.data?.revision ?? 0) * 100000 + (owner?.revision ?? 0)}
              changeRevision={instance.changeRevision}
              waiting={!!approval}
              onNavigate={(value) => {
                const location = new URL(value, 'https://app.invalid');
                void run(() =>
                  trpcClient.localApps.panel.mutate({
                    chatId,
                    instanceId: instance.id,
                    path: location.pathname,
                    query: Object.fromEntries(location.searchParams),
                  }),
                );
              }}
            />}
          </div>
          <Dialog open={access} onOpenChange={setAccess}>
            <DialogContent className="max-h-[85vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>What this chat may do in {instance.displayName}</DialogTitle>
                <DialogDescription>
                  The chat can read the app&apos;s context and call the actions you allow here, and nothing else.
                </DialogDescription>
              </DialogHeader>
              <AppGrantEditor instanceId={instance.id} chatId={chatId} onSaved={() => setAccess(false)} />
            </DialogContent>
          </Dialog>
        </aside>
      )}
    </div>
  );
}
