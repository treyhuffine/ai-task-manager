'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AppWindow, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import { allowConsequence } from '@/lib/integrations/app-access-copy';
import { trpc, trpcClient } from '@/lib/trpc/client';

/**
 * Which personal apps an agent may use (docs/personal-apps.md). Allowing one is an access decision,
 * so Ri says what it means first, then the app's own consent screen asks which of its data this
 * agent may see and whether it may make changes. Each agent connects with its own OAuth client and
 * token, so that choice belongs to this agent alone.
 */
export function WorkspaceAppsSection({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const apps = useQuery(trpc.personalApps.list.queryOptions());
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.personalApps.pathKey() });
  const returnTo = typeof window === 'undefined' ? undefined : `${window.location.pathname}${window.location.search}`;

  const allow = useMutation({
    mutationFn: async (app: { id: string; name: string }) => {
      const go = await confirm({
        title: `Let ${workspaceName} use ${app.name}?`,
        description: allowConsequence(app.name, workspaceName),
        confirmLabel: `Continue to ${app.name}`,
      });
      if (!go) return;
      const start = await trpcClient.personalApps.allow.mutate({ appId: app.id, workspaceId, returnTo });
      await refresh();
      if (start.requiresAuth) await openIntegrationAuthorization(start.authUrl);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    onSuccess: () => setError(null),
  });
  const remove = useMutation({
    mutationFn: async (app: { id: string; name: string }) => {
      const go = await confirm({
        title: `Stop ${workspaceName} using ${app.name}?`,
        description: `${workspaceName} loses ${app.name}'s tools and Ri forgets this agent's sign-in to it. ${app.name} keeps its own data. To end its access in ${app.name} too, disconnect this agent in ${app.name}'s settings.`,
        confirmLabel: 'Stop using it',
        tone: 'destructive',
      });
      if (!go) return;
      await trpcClient.personalApps.disallow.mutate({ appId: app.id, workspaceId });
      await refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    onSuccess: () => setError(null),
  });

  const list = apps.data ?? [];
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Apps</h3>
        <p className="text-[12px] leading-normal text-muted-foreground">
          Your personal apps this agent may use. Each one asks what this agent may see.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {apps.isPending ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading apps…</div>
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground">No apps yet. Add one from Apps.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((app) => {
            const mine = app.agents.find((place) => place.place.kind === 'agent' && place.place.workspaceId === workspaceId);
            const busy = (allow.isPending && allow.variables?.id === app.id) || (remove.isPending && remove.variables?.id === app.id);
            return (
              <li key={app.id} className="flex items-center gap-3 px-3 py-2">
                <AppWindow size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-foreground">{app.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {!mine ? 'Not allowed' : mine.status === 'connected' ? 'Allowed' : mine.status === 'sign_in' ? `Waiting for you to allow it in ${app.name}` : mine.error ?? `${app.name} isn't answering`}
                  </p>
                </div>
                {mine && mine.status !== 'connected' && (
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => allow.mutate({ id: app.id, name: app.name })}>
                    {mine.status === 'sign_in' ? 'Continue' : 'Reconnect'}
                  </Button>
                )}
                {mine
                  ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => remove.mutate({ id: app.id, name: app.name })}>Remove</Button>
                  : <Button size="xs" variant="outline" disabled={busy} onClick={() => allow.mutate({ id: app.id, name: app.name })}>Allow</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
