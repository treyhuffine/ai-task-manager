'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, FolderGit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { APP_NAME } from '@/constants/app';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { useCatalogApp } from './app-catalog';
import { AppStatusLine } from './app-status';

/**
 * Where an app's source lives (docs/personal-apps.md "Building and changing apps"), so Ri can fix
 * it later. An app Ri made changes through its builder and the kit's safe-change command. For an
 * app Ri didn't make, the person records its folder or git URL, and how it's built and deployed.
 */
export function AppSourcePanel({ appId, appName, onOpenBuild }: { appId: string; appName: string; onOpenBuild: (sourceId: string) => void }) {
  const queryClient = useQueryClient();
  const source = useQuery(trpc.appBuilds.forApp.queryOptions({ personalAppId: appId }));
  const [folder, setFolder] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: async (id: string) => { await trpcClient.appBuilds.startChange.mutate({ id }); return id; },
    onSuccess: (id) => { void queryClient.invalidateQueries({ queryKey: trpc.appBuilds.pathKey() }); onOpenBuild(id); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const record = useMutation({
    mutationFn: () => trpcClient.appBuilds.recordSource.mutate({ personalAppId: appId, name: appName, folder: folder || null, gitUrl: gitUrl || null, notes: notes || null }),
    onSuccess: () => { setEditing(false); setError(null); void queryClient.invalidateQueries({ queryKey: trpc.appBuilds.pathKey() }); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const catalogApp = useCatalogApp(source.data?.id);
  if (source.isPending) return null;
  const data = source.data;

  return (
    <section aria-labelledby="app-source" className="space-y-2">
      <h2 id="app-source" className="flex items-center gap-1.5 text-sm font-medium"><FolderGit2 size={14} aria-hidden />Its source</h2>
      {error && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error}</p>}
      {data ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">{data.folder ?? data.gitUrl}{data.notes ? `. ${data.notes}` : ''}</p>
          {data.createdByRi && data.url && data.folder && <AppStatusLine sourceId={data.id} name={data.name} />}
          {catalogApp && (
            <p className="text-muted-foreground">
              From {APP_NAME}&apos;s catalog, {catalogApp.installedVersion ?? 'unknown version'}.
              {catalogApp.updateAvailable && <> {catalogApp.version} is available. <button type="button" className="underline underline-offset-2" onClick={() => onOpenBuild(data.id)}>Update</button></>}
            </p>
          )}
          {data.createdByRi && (
            <div className="flex flex-wrap gap-2">
              {data.changeFolder
                ? <Button size="xs" variant="outline" onClick={() => onOpenBuild(data.id)}>Continue the change</Button>
                : <Button size="xs" variant="outline" disabled={change.isPending} onClick={() => change.mutate(data.id)}>Change app</Button>}
              <span className="self-center text-muted-foreground">An agent works on a copy. {APP_NAME} switches over only after the kit&apos;s checks pass.</span>
            </div>
          )}
        </div>
      ) : editing ? (
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); record.mutate(); }}>
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Its folder, like /Users/you/apps/bloom" />
          <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="Or its git URL" />
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="How it's built and deployed" />
          <div className="flex gap-2">
            <Button size="xs" type="submit" disabled={record.isPending || (!folder.trim() && !gitUrl.trim())}>Save</Button>
            <Button size="xs" type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          {APP_NAME} didn&apos;t make {appName}. <button type="button" className="underline underline-offset-2" onClick={() => setEditing(true)}>Say where its source is</button> so {APP_NAME} can fix it later.
        </p>
      )}
    </section>
  );
}
