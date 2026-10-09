'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Chip, GroupHeading } from '@/components/settings/sections/integrations/parts';
import { trpcClient } from '@/lib/trpc/client';
import { KEY, type LocalAppInstance, type LocalAppsList } from './app-hooks';
import { AppGrantEditor } from './grant-editor';
import { AppSchedules } from './schedule-editor';
import { useAppAction } from './use-app-action';

/**
 * Everything about an installed app that isn't using it: its URL name, on or
 * off, archiving and removal, the service behind it, who may call it, its
 * schedules, and what it did lately. A dialog, like an agent's setup, so the
 * app stays where it was underneath.
 */
export function AppSettingsDialog({
  instance,
  data,
  open,
  onOpenChange,
  onRemoved,
}: {
  instance: LocalAppInstance;
  data: LocalAppsList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const id = instance.id;
  const { busy, run } = useAppAction();
  const configure = (patch: { slug?: string; enabled?: boolean; archived?: boolean }) =>
    run(() => trpcClient.localApps.configure.mutate({ id, revision: data.revision, patch }));

  const description = useQuery({
    queryKey: [...KEY, 'describe', id],
    queryFn: () => trpcClient.localApps.describe.query({ id }),
    enabled: open,
  });
  const serviceStatus = useQuery({
    queryKey: [...KEY, 'service-status', id],
    queryFn: () => trpcClient.localApps.serviceStatus.query({ id }),
    enabled: open && instance.enabled && !instance.archived,
    refetchInterval: open ? 5000 : false,
    retry: false,
  });

  const grants = data.grants.filter((grant) => grant.instanceId === id && !grant.revokedAt);
  const activity = data.invocations.filter((item) => item.instanceId === id).slice(-15).reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{instance.displayName}</DialogTitle>
          <DialogDescription>
            {instance.packageId} · {instance.version}. This package runs trusted native code as your user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-2">
            <GroupHeading>App</GroupHeading>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void configure({ slug: String(form.get('slug')) });
              }}
            >
              <label className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                URL name
                <Input
                  name="slug"
                  defaultValue={instance.slug}
                  pattern="[a-z][a-z0-9-]{0,47}"
                  className="mt-1 h-8 font-mono text-[12px]"
                />
              </label>
              <Button size="sm" variant="outline" disabled={busy}>
                Rename
              </Button>
            </form>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void configure({ enabled: !instance.enabled, archived: false })}>
                {instance.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(() => trpcClient.localApps.retry.mutate({ id }))}>
                Retry
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await trpcClient.localApps.export.mutate({ id });
                    window.location.assign(`/api/local-apps/export/${result.name}`);
                  })
                }
              >
                Export package
              </Button>
              {!instance.archived && (
                <Button size="xs" variant="outline" disabled={busy} onClick={() => void configure({ archived: true, enabled: false })}>
                  Archive
                </Button>
              )}
            </div>
          </section>

          {instance.activation?.phase === 'failed' && (
            <section className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <GroupHeading>Repair an interrupted change</GroupHeading>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Both packages and the stopped data snapshot are kept. Starting the staged version keeps the current
                records. Restoring the previous version uses its snapshot and keeps the failed version&apos;s records
                separately.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" disabled={busy} onClick={() => void run(() => trpcClient.localApps.repair.mutate({ id, revision: data.revision, choice: 'current' }))}>
                  Start staged version
                </Button>
                {instance.activation.snapshotId && (
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(() => trpcClient.localApps.repair.mutate({ id, revision: data.revision, choice: 'previous' }))}>
                    Restore previous snapshot
                  </Button>
                )}
              </div>
            </section>
          )}

          {(serviceStatus.data || serviceStatus.error) && (
            <section className="space-y-2" aria-label="Service status">
              <GroupHeading>Service</GroupHeading>
              {serviceStatus.error ? (
                <p role="alert" className="text-[11.5px] text-destructive">
                  {serviceStatus.error.message}
                </p>
              ) : (
                serviceStatus.data && (
                  <div className="space-y-1 text-[11.5px] text-muted-foreground">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={serviceStatus.data.ready ? 'ok' : 'neutral'}>{serviceStatus.data.ready ? 'Ready' : 'Starting'}</Chip>
                      <span>
                        {serviceStatus.data.worker.started
                          ? serviceStatus.data.worker.running
                            ? 'Worker processing'
                            : 'Worker ready'
                          : 'Worker stopped'}
                      </span>
                    </p>
                    {serviceStatus.data.pendingSetup && <p>Finish setup in the app to begin work.</p>}
                    <p>
                      {Object.entries(serviceStatus.data.jobs.states)
                        .map(([state, count]) => `${state}: ${count}`)
                        .join(', ') || 'No queued jobs'}
                      {serviceStatus.data.jobs.hasMore ? ' · more jobs waiting' : ''}
                    </p>
                    {serviceStatus.data.jobs.nextRunAt && <p>Next run: {serviceStatus.data.jobs.nextRunAt}</p>}
                  </div>
                )
              )}
            </section>
          )}

          <section className="space-y-2">
            <GroupHeading count={grants.length}>Access</GroupHeading>
            <p className="-mt-1 text-[11px] text-muted-foreground">
              Each caller has its own permission: your own view, a chat, an agent, a schedule.
            </p>
            {grants.map((grant) => (
              <div key={grant.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/20 p-3 text-[11.5px]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {grant.principal.kind}
                    <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">{grant.principal.id}</span>
                  </p>
                  <p className="text-muted-foreground">{grant.actions.join(', ') || 'No actions'}</p>
                </div>
                <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(() => trpcClient.localApps.revoke.mutate({ id: grant.id, revision: data.revision }))}>
                  Revoke
                </Button>
              </div>
            ))}
            <AppGrantEditor instanceId={id} />
          </section>

          {description.data?.contract && (
            <section className="space-y-2">
              <AppSchedules instanceId={id} contract={description.data.contract} />
            </section>
          )}

          <section className="space-y-2">
            <GroupHeading count={activity.length}>Recent activity</GroupHeading>
            {activity.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="space-y-0.5 text-[11.5px]">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <span className="font-mono text-foreground">{item.action}</span>
                    <span className="text-muted-foreground">{item.outcome}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {instance.archived && (
            <section className="space-y-2">
              <GroupHeading>Remove</GroupHeading>
              <p className="-mt-1 text-[11px] text-muted-foreground">
                Deletes the app and every record it kept. There is no undo.
              </p>
              <Button
                size="xs"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await trpcClient.localApps.remove.mutate({ id, revision: data.revision });
                    onOpenChange(false);
                    onRemoved();
                  })
                }
              >
                Remove app and records
              </Button>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
