'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hammer, LayoutGrid, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CatalogTile, Chip, GroupHeading } from '@/components/settings/sections/integrations/parts';
import { openSettings } from '@/components/settings/settings-store';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { trpcClient } from '@/lib/trpc/client';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import { Tip } from '@/components/ui/tip';
import { AppHeader, IconAction, PrimaryAction } from './app-header';
import { KEY, type LocalAppsList } from './app-hooks';
import { AppMark } from './app-mark';
import { appCondition, buildStatus, draftTitle } from './app-copy';
import { draftRoute } from './app-places';
import { useAppAction } from './use-app-action';

type Profile = 'react' | 'html' | 'static';

function LibraryMark() {
  return (
    <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <LayoutGrid size={16} />
    </span>
  );
}

function DraftMark() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Hammer size={16} />
    </span>
  );
}

/**
 * The library (docs/local-apps.md): your apps, the ones you're building,
 * and the included ones to start from. Each app opens from its tile, the
 * way a connector or a skill does in Plugins. New app starts a draft in the
 * builder right away. The other starting points and importing a package sit
 * behind More, since the standard case is one click.
 */
export function AppLibrary({ data, navigate }: { data: LocalAppsList; navigate: (route: string) => void }) {
  const { busy, run } = useAppAction();
  const catalog = useQuery({ queryKey: [...KEY, 'catalog'], queryFn: () => trpcClient.localApps.catalog.query() });
  const [demoId, setDemoId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const demo = catalog.data?.find((entry) => entry.packageId === demoId);
  const details = catalog.data?.find((entry) => entry.packageId === detailsId);
  const fileInput = useRef<HTMLInputElement>(null);

  const create = (profile: Profile) =>
    run(async () => {
      const draft = await trpcClient.localApps.createDraft.mutate({ profile });
      navigate(draftRoute(draft.id));
    });

  const importPackage = (file: File) =>
    run(async () => {
      const form = new FormData();
      form.append('package', file);
      const response = await fetch('/api/local-apps/import', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      navigate(draftRoute(result.id));
    }, 'The package could not be imported');

  const apps = [...data.instances].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const drafts = [...data.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const empty = apps.length === 0 && drafts.length === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <AppHeader mark={<LibraryMark />} title="Apps" subtitle="Personal tools with their own records and views.">
        <PrimaryAction icon={<Plus size={12} strokeWidth={2.5} />} disabled={busy} onClick={() => void create('react')}>
          New app
        </PrimaryAction>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconAction aria-label="More ways to start">
              <MoreHorizontal size={15} />
            </IconAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem disabled={busy} onSelect={() => void create('html')}>
              New app from plain HTML
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={() => void create('static')}>
              New app from a static page
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onSelect={() => fileInput.current?.click()}>
              Import a package…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.tgz"
          className="sr-only"
          aria-label="Import package"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importPackage(file);
          }}
        />
      </AppHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="@container mx-auto w-full max-w-3xl space-y-7 px-6 py-6">
          {empty && (
            <p className="max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
              Describe something you wish existed. Ri builds it with you, you use it here, and you change it as your
              life changes. Start with New app, or add one of the included apps below.
            </p>
          )}

          {apps.length > 0 && (
            <section className="space-y-2">
              <GroupHeading count={apps.length}>Your apps</GroupHeading>
              <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
                {apps.map((app) => {
                  const condition = appCondition(app);
                  return (
                    <CatalogTile
                      key={app.id}
                      logo={<AppMark name={app.displayName} size="lg" className={app.archived || !app.enabled ? 'opacity-50' : undefined} />}
                      name={app.displayName}
                      subtitle={<span className="inline-flex items-center gap-1.5"><span>{condition.label}</span>{app.hasActions && <Chip tone="neutral">Chat</Chip>}{app.hasView && <Chip tone="neutral">View</Chip>}</span>}
                      tone={condition.tone}
                      toneLabel={condition.label}
                      onOpen={() => navigate(app.slug)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {drafts.length > 0 && (
            <section className="space-y-2">
              <GroupHeading count={drafts.length}>In progress</GroupHeading>
              <p className="-mt-1 text-[11px] text-muted-foreground">
                Apps you&apos;re building or changing. Nothing uses a draft until you choose Use app in the builder.
              </p>
              <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
                {drafts.map((draft) => {
                  const status = buildStatus(draft);
                  return (
                    <CatalogTile
                      key={draft.id}
                      logo={<DraftMark />}
                      name={draftTitle(draft, data.instances)}
                      subtitle={
                        <>
                          <span className="mr-1.5 inline-block align-[1px]">
                            <Chip tone={status.tone ?? 'neutral'}>{status.label}</Chip>
                          </span>
                          {draft.buildError ?? `Changed ${formatCompactRelative(draft.updatedAt)}`}
                        </>
                      }
                      onOpen={() => navigate(draftRoute(draft.id))}
                    />
                  );
                })}
              </div>
            </section>
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
                  const installed = data.instances.find((item) => item.packageId === entry.packageId);
                  const pending = data.drafts.find(item => !item.sourceInstanceId && (
                    item.catalogSource?.packageId === entry.packageId || item.validatedDigest === entry.artifactDigest
                  ));
                  const update = installed && !installed.archived && installed.digest !== entry.artifactDigest;
                  return (
                    <article
                      key={entry.packageId}
                      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card/20 p-3"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <AppMark name={entry.name} size="lg" />
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
                                    revision: data.revision,
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

          <p className="text-[11px] text-muted-foreground">
            Looking for Gmail, Notion or Linear? Those are {INTEGRATION_LABELS.plural}, in Settings.{' '}
            <button
              type="button"
              onClick={() => openSettings('plugins', { anchor: 'integrations' })}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              Open {INTEGRATION_LABELS.plural}
            </button>
          </p>
        </div>
      </div>

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
    </div>
  );
}
