'use client';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';
/** A tools-only app is useful without a resource, iframe or invented resolver. */
export function AppToolSummary({ id, draft = false }: { id: string; draft?: boolean }) {
  const description = useQuery({ queryKey: ['local-apps', 'summary', id, draft], queryFn: () => trpcClient.localApps.toolSummary.query({ id, draft }) });
  return <div className="space-y-5 overflow-auto p-6 text-sm">
    <div><h2 className="font-semibold">{description.data?.name ?? 'App tools'}</h2><p className="mt-1 text-muted-foreground">{draft ? 'Use Try it to run these actions with sample records.' : 'Use Ask Ri or mention this app in a chat. Manage access to choose which actions an agent may use.'}</p></div>
    {description.error && <p role="alert">{description.error.message}</p>}
    {description.data?.actions.map(action => <article key={action.name} className="space-y-1 rounded-lg border border-border p-3"><h3 className="font-medium">{action.name}</h3><p className="text-xs text-muted-foreground">{action.description}</p>{draft && action.examples.map((example, i) => <details key={i} className="pt-2 text-xs"><summary>Sample input and result</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(example, null, 2)}</pre></details>)}</article>)}
  </div>;
}
