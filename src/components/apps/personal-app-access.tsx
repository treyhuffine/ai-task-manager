'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bot, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import { allowConsequence } from '@/lib/integrations/app-access-copy';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { APP_NAME } from '@/constants/app';
import { HubAppPanel } from './hub-access';

type PlaceStatus = 'connected' | 'sign_in' | 'unavailable';
const statusText = (status: PlaceStatus, app: string, error?: string) =>
  status === 'connected' ? 'Connected' : status === 'sign_in' ? `Waiting for you to allow it in ${app}` : error ?? `${app} isn't answering`;

/**
 * Who uses a personal app (docs/personal-apps.md): Ri's own chats, and each agent allowed to. Each
 * is its own connection with its own OAuth client, so the app's consent screen set what each sees.
 * Allowing an agent says what that means first (spec Decision 3).
 */
export function PersonalAppAccess({ appId, onRemoved }: { appId: string; onRemoved: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const app = useQuery(trpc.personalApps.get.queryOptions({ appId }));
  // What the app can reach through Ri's hub, when it connected back to Ri.
  const hub = useQuery(trpc.hubApps.list.queryOptions(undefined, { staleTime: 15_000 }));
  const hubApp = hub.data?.find((item) => item.personalAppId === appId);
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.personalApps.pathKey() }),
    queryClient.invalidateQueries({ queryKey: trpc.connectedApps.pathKey() }),
  ]);
  const returnTo = () => `${window.location.pathname}${window.location.search}`;
  const failed = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const allow = useMutation({
    mutationFn: async (agent: { id: string; name: string }) => {
      const name = app.data!.name;
      if (!await confirm({ title: `Let ${agent.name} use ${name}?`, description: allowConsequence(name, agent.name), confirmLabel: `Continue to ${name}` })) return;
      const start = await trpcClient.personalApps.allow.mutate({ appId, workspaceId: agent.id, returnTo: returnTo() });
      await refresh();
      if (start.requiresAuth) await openIntegrationAuthorization(start.authUrl);
    },
    onError: failed,
  });
  const disallow = useMutation({
    mutationFn: async (agent: { id: string; name: string }) => {
      const name = app.data!.name;
      if (!await confirm({ title: `Stop ${agent.name} using ${name}?`, description: `${agent.name} loses ${name}'s tools and Ri forgets this agent's sign-in to it. To end its access in ${name} too, disconnect it in ${name}'s settings.`, confirmLabel: 'Stop using it', tone: 'destructive' })) return;
      await trpcClient.personalApps.disallow.mutate({ appId, workspaceId: agent.id });
      await refresh();
    },
    onError: failed,
  });
  const reconnectRi = useMutation({
    mutationFn: async () => {
      const ri = app.data?.ri;
      if (!ri) return;
      const start = await trpcClient.integrations.mcpServerPost.mutate({ params: { id: ri.serverId }, body: { returnTo: returnTo() } });
      if ('authUrl' in start && start.authUrl) await openIntegrationAuthorization(start.authUrl);
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: async () => {
      const name = app.data!.name;
      if (!await confirm({ title: `Remove ${name} from ${APP_NAME}?`, description: `${APP_NAME} and every agent lose ${name}'s tools and screens, and ${APP_NAME} forgets every sign-in to it. ${name} keeps running with its own data.`, confirmLabel: 'Remove', tone: 'destructive' })) return;
      await trpcClient.personalApps.remove.mutate({ appId });
      await refresh();
      onRemoved();
    },
    onError: failed,
  });

  if (!app.data) return null;
  const { name, ri, agents } = app.data;
  const allowed = new Map(agents.flatMap((place) => place.place.kind === 'agent' ? [[place.place.workspaceId, place] as const] : []));
  const others = (workspaces ?? []).filter((workspace) => !allowed.has(workspace.id));
  const busy = allow.isPending || disallow.isPending || remove.isPending || reconnectRi.isPending;

  return (
    <section aria-labelledby="app-access" className="space-y-2">
      <h2 id="app-access" className="text-sm font-medium">Who uses {name}</h2>
      <p className="max-w-prose text-xs text-muted-foreground">
        Each place connects on its own, and {name} asked each one what it may see. An agent you allow sees whatever {name} shows it, including what {name} read from your accounts.
      </p>
      {error && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error}</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        <li className="flex items-center gap-3 px-3 py-2 text-sm">
          <MessageCircle size={14} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block truncate">{APP_NAME}&apos;s own chats</span>
            <span className="block text-xs text-muted-foreground">{ri ? statusText(ri.status, name, ri.error) : 'Not connected'}</span></span>
          {ri && ri.status !== 'connected' && <Button size="xs" variant="outline" disabled={busy} onClick={() => reconnectRi.mutate()}>{ri.status === 'sign_in' ? 'Continue' : 'Reconnect'}</Button>}
        </li>
        {[...allowed.entries()].map(([workspaceId, place]) => (
          <li key={workspaceId} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Bot size={14} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block truncate">{place.label}</span>
              <span className="block text-xs text-muted-foreground">{statusText(place.status, name, place.error)}</span></span>
            {place.status !== 'connected' && <Button size="xs" variant="outline" disabled={busy} onClick={() => allow.mutate({ id: workspaceId, name: place.label })}>{place.status === 'sign_in' ? 'Continue' : 'Reconnect'}</Button>}
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => disallow.mutate({ id: workspaceId, name: place.label })}>Remove</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {others.length > 0 && (
          <select aria-label={`Allow an agent to use ${name}`} value="" disabled={busy} className="rounded-md border bg-background p-1.5 text-xs"
            onChange={(event) => { const agent = others.find((workspace) => workspace.id === event.target.value); if (agent) allow.mutate({ id: agent.id, name: agent.name }); }}>
            <option value="">Allow an agent…</option>
            {others.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        )}
        <Button size="xs" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove.mutate()}>Remove {name}</Button>
      </div>
      {hubApp && <div className="pt-4"><HubAppPanel id={hubApp.id} embedded /></div>}
    </section>
  );
}
