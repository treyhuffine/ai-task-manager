'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, CheckCircle2, Circle, GitBranch, Loader2, XCircle } from 'lucide-react';
import { uuidv7 } from 'uuidv7';
import { HarnessChatSession } from '@/components/chat/harness-chat';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { APP_NAME } from '@/constants/app';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { ensureAppBuilderChat } from './new-app-dialog';

type Navigate = (route: string, options?: { replace?: boolean }) => void;

const STEP_LABELS: Record<string, string> = {
  create: 'Create', prepare: 'Get its dependencies', resolve: 'Find the commit', copy: 'Copy it out', install: 'Install', typecheck: 'Typecheck', test: 'Test',
  build: 'Build', rehearse: 'Try it on a copy of your data', stop: 'Stop the app', snapshot: 'Snapshot your data', switch: 'Switch over', rollback: 'Roll back',
};

/**
 * An app being built or changed (docs/personal-apps.md "Building and changing apps"): its builder
 * chat in the app's folder, or in a change's own working copy, and the kit's install and
 * safe-change steps as they run. The running app only ever changes through those steps.
 */
export function AppBuildPage({ sourceId, navigate }: { sourceId: string; navigate: Navigate }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const source = useQuery(trpc.appBuilds.get.queryOptions({ id: sourceId }, { refetchInterval: (query) => query.state.data?.job?.state === 'running' ? 1000 : 15_000 }));
  const chat = useQuery({ queryKey: ['app-builder-chat', sourceId], queryFn: () => ensureAppBuilderChat(sourceId), staleTime: 30_000 });
  const app = useQuery({ ...trpc.personalApps.get.queryOptions({ appId: source.data?.personalAppId ?? '' }), enabled: !!source.data?.personalAppId });
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.appBuilds.pathKey() });
  const action = useMutation({
    mutationFn: async (kind: 'install' | 'change' | 'apply' | 'discard') => {
      if (kind === 'install') return trpcClient.appBuilds.install.mutate({ id: sourceId, returnTo: `${window.location.pathname}${window.location.search}` });
      if (kind === 'change') {
        await trpcClient.appBuilds.startChange.mutate({ id: sourceId });
        // The builder's folder changed, so its next turn starts in the working copy.
        return null;
      }
      if (kind === 'apply') return trpcClient.appBuilds.applyChange.mutate({ id: sourceId });
      if (!await confirm({ title: 'Discard this change?', description: 'Its working copy goes. Its branch stays in the app’s repository. The running app doesn’t change.', confirmLabel: 'Discard', tone: 'destructive' })) return null;
      return trpcClient.appBuilds.discardChange.mutate({ id: sourceId });
    },
    onSuccess: () => { setError(null); void refresh(); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const askToFix = useMutation({
    mutationFn: async () => {
      const job = source.data?.job;
      const failed = job?.steps.find((step) => step.status === 'failed');
      const text = `The checks failed${failed ? ` at ${STEP_LABELS[failed.step] ?? failed.step}` : ''}: ${job?.result?.message ?? job?.error ?? ''}${job?.result?.log ? ` The full log is at ${job.result.log}.` : ''} Fix it and commit, then tell me.`;
      await trpcClient.sessions.messagesPost.mutate({ params: { id: chat.data!.id }, body: { id: uuidv7(), content: text } });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (!source.data) return <div className="p-6 text-sm"><Button variant="ghost" onClick={() => navigate('')}><ArrowLeft size={14} />Apps</Button><p className="mt-2 text-muted-foreground">{source.error?.message ?? 'Loading…'}</p></div>;
  const data = source.data;
  const job = data.job;
  const running = job?.state === 'running';
  const installed = !!data.url;
  const changing = !!data.changeFolder;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => navigate('')}><ArrowLeft size={14} />Apps</Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{data.name}</h1>
          <p className="truncate text-[11px] text-muted-foreground">{changing ? <><GitBranch size={11} className="mr-1 inline" aria-hidden />Changing in {data.changeFolder} on {data.changeBranch}</> : data.folder}</p>
        </div>
        {app.data?.ri && <Button size="sm" variant="ghost" onClick={() => navigate(`~connected/${app.data!.ri!.serverId}`)}>Open app</Button>}
        {data.createdByRi && !installed && <Button size="sm" disabled={running || action.isPending} onClick={() => action.mutate('install')}>Install and connect</Button>}
        {data.createdByRi && installed && !changing && <Button size="sm" variant="outline" disabled={running || action.isPending} onClick={() => action.mutate('change')}>Change app</Button>}
        {changing && <Button size="sm" variant="ghost" disabled={running || action.isPending} onClick={() => action.mutate('discard')}>Discard change</Button>}
        {changing && <Button size="sm" disabled={running || action.isPending} onClick={() => action.mutate('apply')}>Apply change</Button>}
      </header>

      {(error || job) && (
        <section aria-label="Progress" className="space-y-2 border-b border-border px-5 py-3 text-xs">
          {error && <p role="alert" className="flex items-start gap-2 text-destructive"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error}</p>}
          {job && (
            <>
              <ol className="flex flex-wrap gap-x-4 gap-y-1">
                {job.steps.map((step) => (
                  <li key={step.step} className="flex items-center gap-1">
                    {step.status === 'passed' ? <CheckCircle2 size={12} className="text-emerald-600 dark:text-emerald-400" aria-label="Passed" />
                      : step.status === 'failed' ? <XCircle size={12} className="text-destructive" aria-label="Failed" />
                      : step.status === 'started' ? <Loader2 size={12} className="animate-spin text-muted-foreground" aria-label="Running" />
                      : <Circle size={12} className="text-muted-foreground" aria-label="Skipped" />}
                    {STEP_LABELS[step.step] ?? step.step}
                  </li>
                ))}
                {running && !job.steps.length && <li className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Starting</li>}
              </ol>
              {job.state !== 'running' && (job.result?.message || job.error) && (
                <p className={job.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{job.result?.message || job.error}</p>
              )}
              {job.result?.log && job.state === 'failed' && <p className="text-muted-foreground">The full log is at <span className="font-mono">{job.result.log}</span>.</p>}
              {job.state === 'failed' && job.kind === 'change' && chat.data && (
                <Button size="xs" variant="outline" disabled={askToFix.isPending} onClick={() => askToFix.mutate()}>Ask the builder to fix it</Button>
              )}
              {job.authUrl && job.state === 'done' && app.data?.ri?.status !== 'connected' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{data.name} is running. Allow {APP_NAME} in it to finish connecting.</span>
                  <Button size="xs" onClick={() => void openIntegrationAuthorization(job.authUrl!)}>Allow {APP_NAME} in {data.name}</Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {chat.data ? <HarnessChatSession sessionId={chat.data.id} autoFocusComposer={false} />
          : <p role="status" className="p-6 text-xs text-muted-foreground">{chat.error?.message ?? 'Opening the builder chat…'}</p>}
      </div>
    </div>
  );
}
