'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, KeyRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tip } from '@/components/ui/tip';
import { APP_NAME } from '@/constants/app';
import { ageLabel } from '@/lib/harness/rate-limit-display';
import { trpc, trpcClient } from '@/lib/trpc/client';

const STARTED_BY: Record<string, string> = { chat: 'From a chat', person: 'From you, on its screen', job: 'Its job', app: 'The app on its own' };

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.hubApps.pathKey() });
}

/**
 * What each app can reach through Ri, in one place (docs/personal-apps.md "The hub"): the
 * accounts and tools the person allowed, with one switch per app that turns it off.
 */
export function HubAccessList() {
  const apps = useQuery(trpc.hubApps.list.queryOptions(undefined, { staleTime: 15_000 }));
  const [open, setOpen] = useState<string | null>(null);
  if (!apps.data?.length) return null;
  return (
    <section aria-labelledby="hub-access" className="space-y-2">
      <h3 id="hub-access" className="flex items-center gap-1.5 text-xs font-semibold"><KeyRound size={13} aria-hidden />What your apps can reach</h3>
      <p className="text-[11px] text-muted-foreground">Apps that use your accounts through {APP_NAME}, and only what you allowed each one.</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {apps.data.map((app) => (
          <li key={app.id}>
            <button type="button" onClick={() => setOpen(app.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{app.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {app.off ? 'Turned off' : reach(app)}
                </span>
              </span>
              {app.pendingApprovals > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{app.pendingApprovals} waiting</span>}
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={!!open} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          {open && <HubAppPanel id={open} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function reach(app: { accounts: { service: string; account: string }[]; services: string[] }) {
  const parts = [...new Set(app.accounts.map((account) => `${account.service} (${account.account})`))];
  if (app.services.length) parts.push(`${APP_NAME}'s ${app.services.join(', ')}`);
  return parts.length ? parts.join(', ') : 'Nothing';
}

/** One app's access: what it can reach, what waits for the person, what it did, and the off switch. */
export function HubAppPanel({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const app = useQuery(trpc.hubApps.get.queryOptions({ id }, { refetchInterval: 10_000 }));
  const refresh = useRefresh();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const failed = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const narrow = useMutation({
    mutationFn: (remove: { connectionId: string; tool?: string } | { service: string }) => trpcClient.hubApps.narrow.mutate({ id, ...remove }),
    onSuccess: () => { setError(null); void refresh(); },
    onError: failed,
  });
  const decide = useMutation({
    mutationFn: (input: { ids: string[]; decision: 'approve' | 'deny' }) => trpcClient.integrations.approvePost.mutate({ body: input }),
    onSuccess: () => { setError(null); void refresh(); },
    onError: failed,
  });
  const turnOff = useMutation({
    mutationFn: async () => {
      const name = app.data?.name ?? 'This app';
      if (!await confirm({ title: `Turn off ${name}'s access?`, description: `${name} stops reaching your accounts and ${APP_NAME}'s services at its next call. Its waiting requests are dropped. To use it again, connect it to ${APP_NAME} again from the app.`, confirmLabel: 'Turn off', tone: 'destructive' })) return;
      await trpcClient.hubApps.turnOff.mutate({ id });
      await refresh();
    },
    onError: failed,
  });
  if (!app.data) return app.error ? <p role="alert" className="text-xs text-destructive">{app.error.message}</p> : null;
  const data = app.data;
  return (
    <div className="space-y-4">
      {embedded ? <h2 className="text-sm font-medium">What {data.name} can reach through {APP_NAME}</h2> : (
        <DialogHeader>
          <DialogTitle>{data.name}</DialogTitle>
          <DialogDescription>{data.off ? 'Turned off. It reaches nothing.' : `What it can reach through ${APP_NAME}, as you allowed it.`}</DialogDescription>
        </DialogHeader>
      )}
      {error && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error}</p>}
      {data.purpose && <p className="text-xs text-muted-foreground">What it says it&apos;s for: “{data.purpose}”. {APP_NAME} enforces only what&apos;s listed below.</p>}

      {!data.off && (
        <ul className="space-y-2">
          {data.accounts.map((account) => (
            <li key={account.connectionId} className="rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{account.service} <span className="text-muted-foreground">· {account.account}</span></span>
                <Button size="xs" variant="ghost" disabled={narrow.isPending} onClick={() => narrow.mutate({ connectionId: account.connectionId })}>Remove</Button>
              </div>
              <ul className="mt-1 flex flex-wrap gap-1">
                {account.tools.map((tool) => (
                  <li key={tool} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                    {tool}
                    <Tip label="Take this tool back"><button type="button" aria-label={`Remove ${tool}`} disabled={narrow.isPending} onClick={() => narrow.mutate({ connectionId: account.connectionId, tool })}><X size={11} /></button></Tip>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {data.services.map((service) => (
            <li key={service} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
              <span className="min-w-0 flex-1">{APP_NAME}&apos;s {service.replace(/_/g, ' ')}</span>
              <Button size="xs" variant="ghost" disabled={narrow.isPending} onClick={() => narrow.mutate({ service })}>Remove</Button>
            </li>
          ))}
          {!data.accounts.length && !data.services.length && <li className="text-xs text-muted-foreground">Nothing. It can connect again from the app to ask for more.</li>}
        </ul>
      )}

      {data.approvals.length > 0 && (
        <section aria-labelledby={`waiting-${id}`} className="space-y-1.5">
          <h3 id={`waiting-${id}`} className="text-xs font-semibold">Waiting for you</h3>
          {data.approvals.map((approval) => (
            <div key={approval.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
              <span className="min-w-0 flex-1"><span className="font-mono">{approval.actionId}</span>
                <span className="block text-muted-foreground">{approval.account ?? ''}{approval.hubApp ? ` · ${STARTED_BY[approval.hubApp.startedBy.kind] ?? ''}${approval.hubApp.startedBy.label ? ` (${approval.hubApp.startedBy.label})` : ''}` : ''}</span></span>
              <Button size="xs" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ ids: [approval.id], decision: 'deny' })}>Deny</Button>
              <Button size="xs" disabled={decide.isPending} onClick={() => decide.mutate({ ids: [approval.id], decision: 'approve' })}>Approve</Button>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby={`activity-${id}`} className="space-y-1.5">
        <h3 id={`activity-${id}`} className="text-xs font-semibold">Recent calls</h3>
        {data.calls.length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : (
          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-xs">
            {data.calls.map((call) => (
              <li key={call.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono">{call.tool}</span>
                <span className="shrink-0 text-muted-foreground">{STARTED_BY[call.startedByKind] ?? call.startedByKind}{call.startedByLabel ? ` (${call.startedByLabel})` : ''}</span>
                <span className={call.status === 'ok' ? 'shrink-0 text-muted-foreground' : 'shrink-0 text-amber-700 dark:text-amber-400'}>{call.status === 'ok' ? 'Done' : call.status.replace(/_/g, ' ')}</span>
                <span className="shrink-0 text-muted-foreground">{ageLabel(call.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!data.off && <Button size="sm" variant="outline" className="text-destructive" disabled={turnOff.isPending} onClick={() => turnOff.mutate()}>Turn off {data.name}&apos;s access</Button>}
    </div>
  );
}
