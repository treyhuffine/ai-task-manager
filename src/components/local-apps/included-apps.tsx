'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Chip, GroupHeading } from '@/components/settings/sections/integrations/parts';
import { trpcClient } from '@/lib/trpc/client';
import { Tip } from '@/components/ui/tip';
import { KEY, type LocalAppsList } from './app-hooks';
import { AppMark, INCLUDED_APP_ICONS } from './app-mark';
import { draftRoute } from './app-places';
import { useAppAction } from './use-app-action';

/** Included packages keep their existing preview, activation and update flow. */
export function IncludedApps({ data, search, navigate }: { data?: LocalAppsList; search: string; navigate: (route: string) => void }) {
  const { busy, run } = useAppAction();
  const result = useQuery({ queryKey: [...KEY, 'catalog'], queryFn: () => trpcClient.localApps.catalog.query() });
  const catalog = { ...result, data: result.data?.filter(entry => `${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase().trim())) };
  const [demoId, setDemoId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const demo = result.data?.find(entry => entry.packageId === demoId);
  const details = result.data?.find(entry => entry.packageId === detailsId);
  return <div className="space-y-5">
          {catalog.isPending && <p role="status" className="text-[11.5px] text-muted-foreground">Loading included apps…</p>}
          {catalog.data?.length === 0 && (
            <p role="status" className="text-[11.5px] text-muted-foreground">
              {search ? 'No included apps match this search.' : 'No included apps are available yet. You can build an app or import a package.'}
            </p>
          )}
          {!!catalog.data?.length && (
            <section className="space-y-2">
              <GroupHeading count={catalog.data.length}>Included apps</GroupHeading>
              <p className="-mt-1 text-[11px] text-muted-foreground">
                Ready-made apps with their own records. Preview one in the builder, so you can
                look it over and try it before you use it.
              </p>
              <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
                {catalog.data.map((entry) => {
                  const installed = data?.instances.find((item) => item.packageId === entry.packageId);
                  const pending = data?.drafts.find(item => !item.sourceInstanceId && (
                    item.catalogSource?.packageId === entry.packageId || item.validatedDigest === entry.artifactDigest
                  ));
                  const update = installed && !installed.archived && installed.digest !== entry.artifactDigest;
                  return (
                    <article
                      key={entry.packageId}
                      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card/20 p-3"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <AppMark name={entry.name} icon={INCLUDED_APP_ICONS[entry.packageId]} size="lg" />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-medium text-foreground">{entry.name}</h3>
                          <p className="text-[11px] leading-snug text-muted-foreground">{entry.description}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {installed ? (
                          <>
                            <Chip tone={installed.archived || !installed.enabled ? 'off' : 'ok'}>
                              {installed.archived ? 'Archived' : !installed.enabled ? 'Disabled' : 'Added'}
                            </Chip>
                            <Button size="xs" variant="outline" onClick={() => navigate(installed.slug)}>Open</Button>
                          </>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const draft = await trpcClient.localApps.addCatalog.mutate({ packageId: entry.packageId });
                                navigate(draftRoute(draft.id));
                              })
                            }
                          >
                            {pending ? 'Continue setup' : 'Preview app'}
                          </Button>
                        )}
                        {update && (
                          <Tip label="A newer version is included. Opens it as a preview, your records stay as they are.">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const draft = await trpcClient.localApps.updateCatalog.mutate({
                                    id: installed.id,
                                    revision: data!.revision,
                                  });
                                  navigate(draftRoute(draft.id));
                                })
                              }
                            >
                              Review update
                            </Button>
                          </Tip>
                        )}
                        <Button size="xs" variant="ghost" onClick={() => setDemoId(entry.packageId)}>
                          Sample data
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setDetailsId(entry.packageId)}>
                          Details
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {catalog.error && (
            <p role="alert" className="text-[11.5px] text-destructive">
              {catalog.error.message}
            </p>
          )}

      <Dialog open={!!demo} onOpenChange={(open) => !open && setDemoId(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{demo?.demo.heading}</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground">{demo?.demo.caption}</p>
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                {demo?.demo.columns.map((column) => (
                  <th key={column} className="p-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demo?.demo.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border-t border-border/60 p-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DialogContent>
      </Dialog>

      <Dialog open={!!details} onOpenChange={(open) => !open && setDetailsId(null)}>
        <DialogContent className="max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{details?.name}</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <dt className="text-muted-foreground">Version</dt>
            <dd>
              {details?.version} · {details?.license}
            </dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="break-all">{details?.source}</dd>
            <dt className="text-muted-foreground">Runs on</dt>
            <dd>
              {details?.target
                ? `${details.target.platform} ${details.target.arch}, Node ${details.target.nodeVersion}, ABI ${details.target.nodeAbi}`
                : 'The qualified host Node runtime'}
            </dd>
            <dt className="text-muted-foreground">Starts</dt>
            <dd>
              {details?.runtime === 'mcp-http-v1'
                ? 'As a background service with your Home.'
                : 'When opened or run.'}
            </dd>
            <dt className="text-muted-foreground">Digest</dt>
            <dd className="break-all font-mono text-[10.5px] text-muted-foreground">{details?.artifactDigest}</dd>
          </dl>
          <p className="text-[11px] text-muted-foreground">
            This is trusted native code, running as your user. Review the package before you use the app.
          </p>
        </DialogContent>
      </Dialog>
    </div>;
}
