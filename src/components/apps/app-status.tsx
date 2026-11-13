'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, RotateCcw, ScrollText, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tip } from '@/components/ui/tip';
import { ageLabel } from '@/lib/harness/rate-limit-display';
import { trpc, trpcClient } from '@/lib/trpc/client';

type Status = Awaited<ReturnType<typeof trpcClient.appBuilds.status.query>>;

const LABELS: Record<Status['state'], string> = {
  running: 'Running', starting: 'Starting', stopped: 'Stopped', not_installed: 'Not installed', unknown: 'State unknown',
};

function dotClass(status: Status) {
  if (status.lastError) return 'bg-destructive';
  if (status.state === 'running') return 'bg-emerald-500';
  if (status.state === 'starting') return 'bg-amber-500';
  return 'bg-muted-foreground/50';
}

/** What the status says in words: its state, release and how long it's been up. */
export function statusSummary(status: Status): string {
  const parts = [LABELS[status.state]];
  if (status.state === 'running' && status.release) parts.push(`release ${status.release.slice(0, 12)}`);
  if (status.state === 'running' && status.since) parts.push(`since ${ageLabel(status.since)}`);
  return parts.join(', ');
}

/**
 * An installed app's state with Restart and Logs (docs/personal-apps.md "Status, Restart and
 * Logs"), from the kit's own commands. Ri never starts or reads the app's process itself.
 */
export function AppStatusLine({ sourceId, name, compact = false }: { sourceId: string; name: string; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useQuery({ ...trpc.appBuilds.job.queryOptions({ id: jobId ?? '' }), enabled: !!jobId, refetchInterval: (query) => query.state.data?.state === 'running' ? 1000 : false });
  const restarting = !!jobId && (!job.data || job.data.state === 'running');
  const status = useQuery(trpc.appBuilds.status.queryOptions({ id: sourceId }, { refetchInterval: restarting ? 3000 : 15_000 }));
  const restart = useMutation({
    mutationFn: () => trpcClient.appBuilds.restart.mutate({ id: sourceId }),
    onSuccess: (started) => { setError(null); setJobId(started.id); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  useEffect(() => {
    if (!job.data || job.data.state === 'running') return;
    void queryClient.invalidateQueries({ queryKey: trpc.appBuilds.status.queryKey({ id: sourceId }) });
    void queryClient.invalidateQueries({ queryKey: trpc.appBuilds.pathKey() });
  }, [job.data, queryClient, sourceId]);

  const data = status.data;
  const failure = error ?? (job.data?.state === 'failed' ? job.data.error ?? job.data.result?.message ?? 'Restart didn’t finish.' : null);
  const canControl = !!data && data.problem !== 'kit_too_old' && data.problem !== 'not_prepared' && data.problem !== 'no_folder' && data.state !== 'not_installed';

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {!data ? <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 size={12} className="animate-spin" />Checking {name}</span> : (
          <span className="flex min-w-0 items-center gap-1.5" role="status">
            <span className={`size-2 shrink-0 rounded-full ${dotClass(data)}`} aria-hidden />
            <span className="truncate">{restarting ? 'Restarting' : statusSummary(data)}</span>
          </span>
        )}
        {canControl && (
          <span className="ml-auto flex gap-1.5">
            <Tip label={`Stop ${name} and start it again`}>
              <Button size="xs" variant="outline" disabled={restarting || restart.isPending} onClick={() => restart.mutate()}>
                {restarting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} aria-hidden />}Restart
              </Button>
            </Tip>
            <Button size="xs" variant="outline" onClick={() => setLogsOpen(true)}><ScrollText size={12} aria-hidden />Logs</Button>
          </span>
        )}
      </div>
      {data?.lastError && <p className="flex items-start gap-1.5 text-destructive"><AlertCircle size={12} className="mt-0.5 shrink-0" /><span className="break-words font-mono text-[11px]">{data.lastError}</span></p>}
      {data?.message && !compact && <p className="text-muted-foreground">{data.message}</p>}
      {data?.message && compact && data.problem === 'kit_too_old' && <p className="text-muted-foreground">An older app kit. Update it to see its state.</p>}
      {failure && <p role="alert" className="flex items-start gap-1.5 text-destructive"><AlertCircle size={12} className="mt-0.5 shrink-0" />{failure}</p>}
      {job.data?.state === 'done' && job.data.result?.message && <p className="text-muted-foreground">{job.data.result.message}</p>}
      <AppLogsDialog sourceId={sourceId} name={name} open={logsOpen} onOpenChange={setLogsOpen} />
    </div>
  );
}

/** The end of an app's log: what its server printed, or its last install or change. */
export function AppLogsDialog({ sourceId, name, open, onOpenChange }: { sourceId: string; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [which, setWhich] = useState<'server' | 'change'>('server');
  const [follow, setFollow] = useState(true);
  const logs = useQuery({
    ...trpc.appBuilds.logs.queryOptions({ id: sourceId, lines: 500, change: which === 'change' }),
    enabled: open,
    refetchInterval: open && follow && which === 'server' ? 3000 : false,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Server size={15} aria-hidden />{name} logs</DialogTitle>
          <DialogDescription>The last 500 lines, from the app kit. Times are on this computer&apos;s clock.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={which} onValueChange={(value) => setWhich(value as 'server' | 'change')}>
            <TabsList>
              <TabsTrigger value="server">While running</TabsTrigger>
              <TabsTrigger value="change">Last install or change</TabsTrigger>
            </TabsList>
          </Tabs>
          {which === 'server' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={follow} onCheckedChange={setFollow} aria-label="Keep showing new lines" />Keep showing new lines
            </label>
          )}
          {logs.isFetching && <Loader2 size={12} className="animate-spin text-muted-foreground" aria-label="Loading" />}
        </div>
        <div className="max-h-[60vh] min-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
          {logs.error ? <p className="text-destructive">{logs.error.message}</p>
            : logs.data?.message ? <p className="text-muted-foreground">{logs.data.message}</p>
            : !logs.data ? <p className="text-muted-foreground">Loading…</p>
            : !logs.data.lines.length ? <p className="text-muted-foreground">Nothing yet.</p>
            : logs.data.lines.map((line, index) => (
              <div key={index} className="flex gap-2 whitespace-pre-wrap break-words">
                <span className="shrink-0 text-muted-foreground">{line.time ? new Date(line.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '        '}</span>
                <span className="min-w-0">{line.text}</span>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The apps Ri installed, each with its state, Restart and Logs, on the Apps page.
 */
export function InstalledAppsList({ onOpen }: { onOpen: (sourceId: string) => void }) {
  const sources = useQuery(trpc.appBuilds.list.queryOptions(undefined, { staleTime: 10_000 }));
  const installed = (sources.data ?? []).filter((source) => source.createdByRi && source.url && source.folder);
  if (!installed.length) return null;
  return (
    <section aria-labelledby="installed-apps" className="space-y-2">
      <h3 id="installed-apps" className="flex items-center gap-1.5 text-xs font-semibold"><Server size={13} aria-hidden />Running on this computer</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {installed.map((source) => (
          <li key={source.id} className="space-y-1 px-3 py-2">
            <button type="button" onClick={() => onOpen(source.id)} className="text-left text-sm hover:underline">{source.name}</button>
            <AppStatusLine sourceId={source.id} name={source.name} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}
